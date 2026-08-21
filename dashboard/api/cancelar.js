/**
 * POST /api/cancelar
 * ---------------------------------------------------------------------------
 * Cancela una reserva ya paga y, si se pide, devuelve la plata.
 *
 *     { "paymentId": "1327928212", "devolver": true, "monto": 40000 }
 *
 * `monto` es opcional: sin él se devuelve todo lo que quede por devolver.
 * `devolver: false` cancela la reserva sin tocar la plata — para cuando la
 * devolución se hace por otro lado (transferencia, efectivo) o directamente no
 * corresponde.
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

export default async function handler(req, res) {
  if (!exigirMetodo(req, res, "POST")) return;

  let paymentId = "";

  try {
    exigirSesion(req);

    const cuerpo = leerBody(req);
    paymentId = String(cuerpo.paymentId || "").trim();
    const conDevolucion = cuerpo.devolver !== false;

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
