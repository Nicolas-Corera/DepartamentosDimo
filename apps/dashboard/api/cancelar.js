/**
 * POST /api/cancelar
 * ---------------------------------------------------------------------------
 * Cancela una reserva ya paga y, si se pide, devuelve la plata.
 *
 *     { "paymentId": "1327928212",   "devolver": true, "monto": 40000 }
 *     { "comprobanteId": "<uuid>",   "devolver": true, "monto": 40000 }
 *
 * `monto` es opcional: sin él se devuelve todo lo que quede por devolver.
 * `devolver: false` cancela la reserva sin tocar la plata — para cuando la
 * devolución no corresponde.
 *
 * ---------------------------------------------------------------------------
 * DOS ORÍGENES, DOS SIGNIFICADOS DE "DEVOLVER"
 *
 * Con `paymentId` (MercadoPago) la plata SALE de verdad: se le pide un `refund`
 * a la API y recién después se escribe en la base.
 *
 * Con `comprobanteId` (transferencia) la plata NO sale: esa transferencia nunca
 * pasó por MercadoPago, no hay `payment` con id contra el cual pedir un refund,
 * y no hay forma de hacerlo desde acá. La devolución la hace una persona, a
 * mano, desde la cuenta. Lo único que hace este endpoint es **anotar cuánto se
 * devolvió**, para que el registro no siga diciendo que se cobró todo.
 *
 * Las dos ramas terminan igual: la reserva pasa a 'cancelada' y las noches se
 * liberan.
 *
 * ---------------------------------------------------------------------------
 * ESTO MUEVE PLATA DE VERDAD Y NO SE PUEDE DESHACER
 *
 * Una devolución en MercadoPago no tiene botón de "revertir". Por eso:
 *
 *   - El monto máximo lo calcula el SERVIDOR (cobrado − ya devuelto). Aunque el
 *     panel muestre otra cosa, acá no se puede devolver más de lo que entró.
 *   - Se devuelve PRIMERO y se escribe en la base DESPUÉS. Si se hiciera al
 *     revés y MercadoPago fallara, quedaría una reserva marcada como devuelta
 *     con la plata todavía en la cuenta — el peor error posible, porque nadie
 *     lo nota hasta que el huésped reclama.
 *   - Si la devolución sale bien pero la base falla, se responde OK igual y se
 *     grita en el log: la plata ya salió, y decirle al operador "falló" lo
 *     invitaría a devolver de nuevo.
 *
 * Cancelar la reserva la pasa a estado 'cancelada', y como `fechas_ocupadas()`
 * solo cuenta las 'confirmada', las noches se liberan solas en el calendario
 * del sitio.
 */

import { exigirMetodo, json, leerBody, manejarError, ErrorVisible } from "./_lib/http.js";
import { exigirSesion } from "./_lib/sesion.js";
import { seleccionar, actualizar } from "./_lib/supabase.js";
import { devolver } from "./_lib/mercadopago.js";

/** Los centavos importan: se compara con dos decimales, no con enteros. */
function aCentavos(n) {
  return Math.round(Number(n) * 100);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La rama de las transferencias.
 *
 * No le pide nada a MercadoPago porque no hay nada que pedirle: anota lo que
 * dice el operador que ya devolvió a mano, y cancela la reserva.
 *
 * El tope lo pone igual el servidor, con el mismo criterio que la otra rama:
 * no se puede anotar una devolución mayor a lo que entró.
 */
async function cancelarTransferencia(res, comprobanteId, conDevolucion, montoPedido) {
  const filas = await seleccionar(
    "transfer_receipts",
    `select=id,booking_id,estado,monto_declarado,devuelto&id=eq.${comprobanteId}`,
  );
  const comprobante = filas?.[0];

  if (!comprobante) {
    throw new ErrorVisible(404, "No encontramos ese comprobante.", "comprobante_inexistente");
  }
  if (comprobante.estado !== "confirmado") {
    throw new ErrorVisible(
      409,
      "Ese comprobante todavía no está aprobado: no hay ningún alquiler que cancelar.",
      "comprobante_no_aprobado",
    );
  }

  const cobrado = aCentavos(comprobante.monto_declarado);
  const yaDevuelto = aCentavos(comprobante.devuelto || 0);
  const disponible = cobrado - yaDevuelto;

  let devolucion = null;

  if (conDevolucion) {
    if (disponible <= 0) {
      throw new ErrorVisible(409, "Esta transferencia ya figura devuelta por completo.", "ya_devuelto");
    }

    let montoCentavos = disponible;
    if (montoPedido != null && montoPedido !== "") {
      montoCentavos = aCentavos(montoPedido);
      if (!Number.isInteger(montoCentavos) || montoCentavos <= 0) {
        throw new ErrorVisible(400, "El monto a devolver tiene que ser mayor a 0.", "monto_invalido");
      }
      if (montoCentavos > disponible) {
        throw new ErrorVisible(
          400,
          `No se puede anotar más de lo que queda ($${(disponible / 100).toLocaleString("es-AR")}).`,
          "monto_excedido",
        );
      }
    }

    await actualizar("transfer_receipts", `id=eq.${comprobanteId}`, {
      devuelto: (yaDevuelto + montoCentavos) / 100,
      devuelto_en: new Date().toISOString(),
    });

    devolucion = { monto: montoCentavos / 100, manual: true };
  }

  if (comprobante.booking_id) {
    await actualizar("booking_requests", `id=eq.${comprobante.booking_id}`, {
      estado: "cancelada",
    });
  }

  console.log(`[cancelar] reserva cancelada — comprobante ${comprobanteId}`);

  return json(res, 200, {
    ok: true,
    devolucion,
    cancelada: Boolean(comprobante.booking_id),
    // Lo dice el backend para que el aviso no dependa de que alguien se acuerde
    // de escribirlo en la pantalla.
    avisoDevolucion: devolucion
      ? "Quedó anotado, pero la plata no salió de ningún lado: la transferencia " +
        "la tenés que devolver vos a mano desde MercadoPago."
      : null,
  });
}

export default async function handler(req, res) {
  if (!exigirMetodo(req, res, "POST")) return;

  let paymentId = "";

  try {
    exigirSesion(req);

    const cuerpo = leerBody(req);
    paymentId = String(cuerpo.paymentId || "").trim();
    const comprobanteId = String(cuerpo.comprobanteId || "").trim();
    const conDevolucion = cuerpo.devolver !== false;

    // Las transferencias se van por otro camino: no hay plata que mover.
    if (comprobanteId) {
      if (!UUID_RE.test(comprobanteId)) {
        throw new ErrorVisible(400, "El id del comprobante no es válido.", "id_invalido");
      }
      return await cancelarTransferencia(res, comprobanteId, conDevolucion, cuerpo.monto);
    }

    if (!paymentId) {
      throw new ErrorVisible(400, "Falta el número de operación.", "sin_payment_id");
    }

    // --- El estado real, desde la base -------------------------------------
    const filas = await seleccionar(
      "payments",
      `select=mp_payment_id,booking_id,status,monto,devuelto&mp_payment_id=eq.${encodeURIComponent(paymentId)}`,
    );
    const pago = filas?.[0];

    if (!pago) {
      throw new ErrorVisible(404, "No encontramos ese pago en el registro.", "pago_inexistente");
    }

    const cobrado = aCentavos(pago.monto);
    const yaDevuelto = aCentavos(pago.devuelto || 0);
    const disponible = cobrado - yaDevuelto;

    let devolucion = null;

    if (conDevolucion) {
      if (pago.status !== "approved") {
        throw new ErrorVisible(
          409,
          `Este pago está en estado "${pago.status}": no hay nada aprobado para devolver.`,
          "pago_no_aprobado",
        );
      }
      if (disponible <= 0) {
        throw new ErrorVisible(
          409,
          "Este pago ya fue devuelto por completo.",
          "ya_devuelto",
        );
      }

      // Sin monto = todo lo que quede. Con monto, se valida contra el máximo
      // real, no contra lo que crea el navegador.
      let montoCentavos = disponible;
      if (cuerpo.monto != null && cuerpo.monto !== "") {
        montoCentavos = aCentavos(cuerpo.monto);
        if (!Number.isInteger(montoCentavos) || montoCentavos <= 0) {
          throw new ErrorVisible(400, "El monto a devolver tiene que ser mayor a 0.", "monto_invalido");
        }
        if (montoCentavos > disponible) {
          throw new ErrorVisible(
            400,
            `No se puede devolver más de lo que queda disponible ($${(disponible / 100).toLocaleString("es-AR")}).`,
            "monto_excedido",
          );
        }
      }

      const esTotal = montoCentavos === disponible && yaDevuelto === 0;

      console.log(
        `[cancelar] devolviendo ${esTotal ? "TODO" : `$${montoCentavos / 100}`} del pago ${paymentId}`,
      );

      // ---- La plata sale acá ----
      const respuesta = await devolver(paymentId, esTotal ? null : montoCentavos / 100);

      devolucion = {
        refundId: respuesta?.id ?? null,
        monto: Number(respuesta?.amount ?? montoCentavos / 100),
        estado: respuesta?.status ?? "approved",
      };
    }

    // --- Recién ahora se escribe -------------------------------------------
    try {
      if (devolucion) {
        const total = (yaDevuelto + aCentavos(devolucion.monto)) / 100;
        await actualizar("payments", `mp_payment_id=eq.${encodeURIComponent(paymentId)}`, {
          devuelto: total,
          devuelto_en: new Date().toISOString(),
          // Solo se marca `refunded` si se devolvió TODO. Con una devolución
          // parcial el pago sigue aprobado —  hay plata cobrada— y ponerlo en
          // refunded lo sacaría del neto del reporte.
          ...(aCentavos(total) >= cobrado ? { status: "refunded" } : {}),
          updated_at: new Date().toISOString(),
        });
      }

      if (pago.booking_id) {
        await actualizar("booking_requests", `id=eq.${pago.booking_id}`, { estado: "cancelada" });
      }
    } catch (error) {
      console.error(
        `[cancelar] LA DEVOLUCIÓN SALIÓ BIEN PERO NO SE PUDO REGISTRAR — pago ${paymentId}: ${error.message}`,
      );
      return json(res, 200, {
        ok: true,
        devolucion,
        aviso:
          "La devolución se hizo en MercadoPago, pero no se pudo actualizar el registro. " +
          "No la repitas: revisá la reserva a mano en Supabase.",
      });
    }

    console.log(`[cancelar] reserva cancelada — pago ${paymentId}`);

    json(res, 200, {
      ok: true,
      devolucion,
      cancelada: Boolean(pago.booking_id),
    });
  } catch (error) {
    // Un rechazo de MercadoPago no es un 500 nuestro: se muestra tal cual, que
    // es lo que le permite al operador entender si el pago es muy viejo, si ya
    // tenía un contracargo, o si es otra cosa.
    if (error?.status >= 400 && error?.status < 500 && !(error instanceof ErrorVisible)) {
      console.error(`[cancelar] MercadoPago rechazó la devolución del pago ${paymentId}:`, error.message);
      return json(res, 400, {
        error: `MercadoPago no aceptó la devolución: ${error.message}`,
        codigo: "mp_rechazo",
      });
    }
    manejarError(res, "cancelar", error);
  }
}
