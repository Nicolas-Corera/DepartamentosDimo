import { exigirMetodo, json, leerBody, manejarError, ErrorVisible } from "./_lib/http.js";
import { exigirSesion } from "./_lib/sesion.js";
import { seleccionar, actualizar } from "./_lib/supabase.js";
import { devolver } from "./_lib/mercadopago.js";

function aCentavos(n) {
  return Math.round(Number(n) * 100);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    if (comprobanteId) {
      if (!UUID_RE.test(comprobanteId)) {
        throw new ErrorVisible(400, "El id del comprobante no es válido.", "id_invalido");
      }
      return await cancelarTransferencia(res, comprobanteId, conDevolucion, cuerpo.monto);
    }

    if (!paymentId) {
      throw new ErrorVisible(400, "Falta el número de operación.", "sin_payment_id");
    }

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

      const respuesta = await devolver(paymentId, esTotal ? null : montoCentavos / 100);

      devolucion = {
        refundId: respuesta?.id ?? null,
        monto: Number(respuesta?.amount ?? montoCentavos / 100),
        estado: respuesta?.status ?? "approved",
      };
    }

    try {
      if (devolucion) {
        const total = (yaDevuelto + aCentavos(devolucion.monto)) / 100;
        await actualizar("payments", `mp_payment_id=eq.${encodeURIComponent(paymentId)}`, {
          devuelto: total,
          devuelto_en: new Date().toISOString(),

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
