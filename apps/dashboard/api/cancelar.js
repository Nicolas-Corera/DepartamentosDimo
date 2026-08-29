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

  await actualizar("transfer_receipts", `id=eq.${comprobanteId}`, {
    cancelado_en: new Date().toISOString(),
  });

  if (comprobante.booking_id) {
    await actualizar("booking_requests", `id=eq.${comprobante.booking_id}`, {
      estado: "cancelada",
    });
  }

  console.log(`[cancelar] cancelado — comprobante ${comprobanteId}`);

  return json(res, 200, {
    ok: true,
    devolucion,
    cancelada: true,

    avisoDevolucion: devolucion
      ? "Quedó anotado, pero la plata no salió de ningún lado: la transferencia " +
        "la tenés que devolver vos a mano desde MercadoPago."
      : null,
  });
}

async function cancelarReserva(res, bookingId, conDevolucion, montoPedido) {
  const [pagos, comprobantes, reservas] = await Promise.all([
    seleccionar(
      "payments",
      `select=mp_payment_id,monto,devuelto,created_at&booking_id=eq.${bookingId}` +
        "&status=eq.approved&order=created_at.asc",
    ),
    seleccionar(
      "transfer_receipts",
      `select=id,monto_declarado,devuelto,created_at&booking_id=eq.${bookingId}` +
        "&estado=eq.confirmado&order=created_at.asc",
    ),
    seleccionar("booking_requests", `select=id,estado&id=eq.${bookingId}`),
  ]);

  if (!reservas?.[0]) {
    throw new ErrorVisible(404, "No encontramos esa reserva.", "reserva_inexistente");
  }

  const objetivos = [
    ...(pagos || []).map((p) => ({
      tipo: "pago",
      id: p.mp_payment_id,
      cobrado: aCentavos(p.monto),
      yaDevuelto: aCentavos(p.devuelto || 0),
    })),
    ...(comprobantes || []).map((c) => ({
      tipo: "transferencia",
      id: c.id,
      cobrado: aCentavos(c.monto_declarado),
      yaDevuelto: aCentavos(c.devuelto || 0),
    })),
  ].map((o) => ({ ...o, disponible: Math.max(0, o.cobrado - o.yaDevuelto) }));

  if (!objetivos.length) {
    throw new ErrorVisible(
      409,
      "Esta reserva no tiene ningún pago aprobado: no hay nada que cancelar.",
      "sin_pagos",
    );
  }

  const disponible = objetivos.reduce((suma, o) => suma + o.disponible, 0);

  let devolucion = null;
  const fallas = [];

  if (conDevolucion) {
    if (disponible <= 0) {
      throw new ErrorVisible(
        409,
        "Esta reserva ya figura devuelta por completo.",
        "ya_devuelto",
      );
    }

    let restante = disponible;
    if (montoPedido != null && montoPedido !== "") {
      restante = aCentavos(montoPedido);
      if (!Number.isInteger(restante) || restante <= 0) {
        throw new ErrorVisible(400, "El monto a devolver tiene que ser mayor a 0.", "monto_invalido");
      }
      if (restante > disponible) {
        throw new ErrorVisible(
          400,
          `No se puede devolver más de lo que queda ($${(disponible / 100).toLocaleString("es-AR")}).`,
          "monto_excedido",
        );
      }
    }

    let automatico = 0;
    let manual = 0;

    for (const o of objetivos) {
      if (restante <= 0) break;
      if (o.disponible <= 0) continue;

      const parte = Math.min(o.disponible, restante);

      try {
        if (o.tipo === "pago") {
          const esTotal = parte === o.disponible && o.yaDevuelto === 0;
          const respuesta = await devolver(o.id, esTotal ? null : parte / 100);
          const hecho = aCentavos(respuesta?.amount ?? parte / 100);
          const total = (o.yaDevuelto + hecho) / 100;

          await actualizar("payments", `mp_payment_id=eq.${encodeURIComponent(o.id)}`, {
            devuelto: total,
            devuelto_en: new Date().toISOString(),

            ...(aCentavos(total) >= o.cobrado ? { status: "refunded" } : {}),
            updated_at: new Date().toISOString(),
          });

          automatico += hecho;
          restante -= hecho;
        } else {
          await actualizar("transfer_receipts", `id=eq.${o.id}`, {
            devuelto: (o.yaDevuelto + parte) / 100,
            devuelto_en: new Date().toISOString(),
          });

          manual += parte;
          restante -= parte;
        }
      } catch (error) {
        fallas.push(
          `${o.tipo === "pago" ? `el pago ${o.id}` : "la transferencia"}: ${error.message}`,
        );
      }
    }

    if (!automatico && !manual) {
      throw new ErrorVisible(
        409,
        `No se pudo devolver nada — ${fallas.join(" · ")}`,
        "devolucion_fallida",
      );
    }

    devolucion = {
      monto: (automatico + manual) / 100,
      montoAutomatico: automatico / 100,
      montoManual: manual / 100,
      manual: manual > 0,
    };
  }

  const cancelado_en = new Date().toISOString();

  await actualizar("booking_requests", `id=eq.${bookingId}`, { estado: "cancelada" });
  await Promise.all([
    actualizar("payments", `booking_id=eq.${bookingId}`, { cancelado_en }),
    actualizar("transfer_receipts", `booking_id=eq.${bookingId}`, { cancelado_en }),
  ]);

  console.log(`[cancelar] reserva cancelada — booking ${bookingId}`);

  return json(res, 200, {
    ok: true,
    devolucion,
    cancelada: true,

    aviso: fallas.length
      ? `La reserva quedó cancelada, pero no se pudo devolver todo — ${fallas.join(" · ")}`
      : null,

    avisoDevolucion: devolucion?.manual
      ? "Lo que entró por transferencia solo quedó anotado: esa plata la tenés " +
        "que devolver vos a mano desde MercadoPago."
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
    const bookingId = String(cuerpo.bookingId || "").trim();
    const conDevolucion = cuerpo.devolver !== false;

    if (bookingId) {
      if (!UUID_RE.test(bookingId)) {
        throw new ErrorVisible(400, "El id de la reserva no es válido.", "id_invalido");
      }
      return await cancelarReserva(res, bookingId, conDevolucion, cuerpo.monto);
    }

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

    const ahora = new Date().toISOString();

    try {
      const cambios = { cancelado_en: ahora, updated_at: ahora };

      if (devolucion) {
        const total = (yaDevuelto + aCentavos(devolucion.monto)) / 100;
        cambios.devuelto = total;
        cambios.devuelto_en = ahora;
        if (aCentavos(total) >= cobrado) cambios.status = "refunded";
      }

      await actualizar("payments", `mp_payment_id=eq.${encodeURIComponent(paymentId)}`, cambios);

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

    console.log(`[cancelar] cancelado — pago ${paymentId}`);

    json(res, 200, {
      ok: true,
      devolucion,
      cancelada: true,
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
