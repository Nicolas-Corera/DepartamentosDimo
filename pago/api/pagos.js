/**
 * POST /api/pagos
 * ---------------------------------------------------------------------------
 * Recibe lo que arma el Card Payment Brick y crea el pago con la Checkout API
 * (POST /v1/payments).
 *
 * Body esperado:
 *   {
 *     "ref": "<uuid de la reserva>",
 *     "formData": { ...lo que entrega el onSubmit del Brick... }
 *   }
 *
 * De `formData` se usan SOLO estos campos:
 *   token, payment_method_id, issuer_id, installments, payer.email,
 *   payer.identification
 *
 * `transaction_amount` viene en formData, pero se IGNORA a propósito: el monto
 * lo recalcula el servidor con las fechas guardadas en la reserva. Si el
 * navegador pudiera elegir cuánto paga, alguien pagaría $1.
 *
 * Los datos de la tarjeta nunca pasan por acá: el Brick los cambia por un
 * `token` de un solo uso contra los servidores de MercadoPago. Este endpoint
 * ve el token y nada más.
 */

import { leerConfig } from "./_lib/env.js";
import { exigirMetodo, json, leerBody, manejarError, ErrorVisible } from "./_lib/http.js";
import { buscarReserva, guardarPago, tienePagoAprobado, confirmarReserva } from "./_lib/supabase.js";
import { calcularPrecio } from "./_lib/precios.js";
import {
  crearPago,
  resumirPago,
  esPedidoDuplicado,
  buscarPagoPorReferencia,
} from "./_lib/mercadopago.js";
import { mensajeDePago } from "./_lib/mensajes.js";
import { log, ofuscarEmail } from "./_lib/log.js";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fechaCorta(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return String(iso);
  return `${m[3]} ${MESES[Number(m[2]) - 1]}`;
}

function textoDescripcion(reserva, precio) {
  const base = `Reserva Dimo ${fechaCorta(reserva.check_in)} al ${fechaCorta(reserva.check_out)}`;
  return precio.esSenia ? `${base} (seña ${precio.porcentajeACobrar}%)` : base;
}

/**
 * Valida lo que llega del Brick antes de gastarlo en una llamada a la API.
 * Un campo faltante acá es un error de integración, no del que paga: se
 * loguea y se devuelve un mensaje sobrio.
 */
function validarFormData(formData, maxCuotas) {
  if (!formData || typeof formData !== "object") {
    throw new ErrorVisible(400, "No recibimos los datos del formulario de pago.", "form_vacio");
  }

  const token = String(formData.token || "").trim();
  if (!token) {
    throw new ErrorVisible(
      400,
      "El formulario de pago expiró. Recargá la página y volvé a cargar la tarjeta.",
      "sin_token",
    );
  }

  const paymentMethodId = String(formData.payment_method_id || "").trim();
  if (!paymentMethodId) {
    throw new ErrorVisible(
      400,
      "No pudimos identificar el tipo de tarjeta. Revisá el número e intentá de nuevo.",
      "sin_medio_de_pago",
    );
  }

  // El Brick manda 1 para débito. Cualquier cosa fuera de rango es sospechosa.
  const cuotas = Number(formData.installments || 1);
  if (!Number.isInteger(cuotas) || cuotas < 1 || cuotas > maxCuotas) {
    throw new ErrorVisible(
      400,
      "La cantidad de cuotas no es válida. Elegí otra y volvé a intentar.",
      "cuotas_invalidas",
    );
  }

  return {
    token,
    paymentMethodId,
    cuotas,
    issuerId: formData.issuer_id ? String(formData.issuer_id) : null,
    email: String(formData.payer?.email || "").trim().toLowerCase(),
    identificacion: formData.payer?.identification || null,
  };
}

export default async function handler(req, res) {
  if (!exigirMetodo(req, res, "POST")) return;

  let ref = "";

  try {
    const config = leerConfig();
    const body = leerBody(req);
    ref = String(body.ref || "").trim();

    const datos = validarFormData(body.formData, config.mp.maxCuotas);
    const reserva = await buscarReserva(ref);
    const precio = calcularPrecio(reserva, config.precios);

    // Freno contra el doble cobro por vías distintas (dos pestañas, dos
    // tarjetas). La idempotencia de MercadoPago cubre el reintento del MISMO
    // pedido; esto cubre el caso de dos pedidos distintos sobre una reserva ya
    // saldada.
    const yaAprobado = await tienePagoAprobado(reserva.id);
    if (yaAprobado) {
      throw new ErrorVisible(
        409,
        "Esta reserva ya está paga. Si creés que es un error, escribinos antes de volver a intentar.",
        "ya_pagada",
      );
    }

    log.info("pago.intento", {
      ref: reserva.id,
      monto: precio.aCobrar,
      cuotas: datos.cuotas,
      payment_method_id: datos.paymentMethodId,
      email: ofuscarEmail(datos.email || reserva.email),
    });

    let pago;
    try {
      pago = await crearPago({
        ref: reserva.id,
        monto: precio.aCobrar,
        cuotas: datos.cuotas,
        token: datos.token,
        paymentMethodId: datos.paymentMethodId,
        issuerId: datos.issuerId,
        descripcion: textoDescripcion(reserva, precio),
        pagador: {
          // El titular de la tarjeta puede no ser quien reservó (paga un
          // familiar, por ejemplo). Por eso mandan los datos del formulario, y
          // los de la reserva son solo el respaldo.
          email: datos.email || reserva.email,
          identificacion: datos.identificacion || { type: "DNI", number: reserva.dni },
          nombre: reserva.nombre?.split(" ")[0] || null,
        },
      });
    } catch (error) {
      if (!esPedidoDuplicado(error)) throw error;

      /**
       * Doble clic: los dos requests salieron con la misma clave de
       * idempotencia y MercadoPago bloqueó el segundo con un 423
       * `resource_already_locked`. El cobro NO se duplicó — eso es justamente
       * lo que hizo la clave — pero este request se quedó sin respuesta.
       *
       * Devolver acá un error genérico sería lo peor que podemos hacer: la
       * persona pagó bien y leería "volvé a intentar", que es una invitación a
       * pagar dos veces. Así que le preguntamos a MercadoPago cuál fue el pago
       * de esta reserva y mostramos ese.
       */
      log.warn("pago.duplicado_recuperando", { ref: reserva.id });
      pago = await buscarPagoPorReferencia(reserva.id);

      if (!pago) {
        // El request gemelo sigue en vuelo. No inventamos un resultado:
        // decimos lo único cierto, y sobre todo decimos "no pagues de nuevo".
        throw new ErrorVisible(
          409,
          "Ya recibimos tu pago y lo estamos confirmando. No vuelvas a pagar: " +
            "en unos minutos te llega el mail con el comprobante.",
          "pago_en_curso",
        );
      }
      log.info("pago.duplicado_resuelto", { ref: reserva.id, payment_id: pago.id });
    }

    const resumen = resumirPago(pago);

    /**
     * A partir de acá el cobro YA ocurrió. Guardar en la base y confirmar la
     * reserva son tareas nuestras, y si fallan no pueden cambiar lo que se le
     * dice a la persona: si le devolviéramos un error después de haberle
     * cobrado, lo más probable es que pague de nuevo con otra tarjeta.
     *
     * Así que se registra el problema a los gritos en el log y se sigue. El
     * webhook vuelve a sincronizar este pago más tarde — es exactamente para
     * esto que existe.
     */
    try {
      // Se guarda SIEMPRE, aprobado o rechazado: el historial de intentos es
      // lo que después explica "pagué y no me figura".
      await guardarPago({ ...resumen, booking_id: reserva.id });

      if (resumen.status === "approved" && config.confirmarReservaAlAprobar) {
        await confirmarReserva(reserva.id);
      }
    } catch (error) {
      log.error("pago.no_se_pudo_registrar", error, {
        ref: reserva.id,
        payment_id: resumen.mp_payment_id,
        status: resumen.status,
      });
    }

    const mensaje = mensajeDePago(resumen.status, resumen.status_detail);

    log.info("pago.resultado", {
      ref: reserva.id,
      payment_id: resumen.mp_payment_id,
      status: resumen.status,
      status_detail: resumen.status_detail,
    });

    json(res, 200, {
      paymentId: resumen.mp_payment_id,
      status: resumen.status,
      statusDetail: resumen.status_detail,
      monto: resumen.monto,
      cuotas: resumen.cuotas,
      ultimosCuatro: resumen.ultimos_cuatro,
      mensaje,
    });
  } catch (error) {
    // Un 400 de la API es un problema con los datos del pago: se traduce a algo
    // accionable en vez de un 500 mudo.
    //
    // 401 y 403 quedan fuera a propósito. Son "nuestro Access Token está mal",
    // no "tu tarjeta está mal": mandarle a la persona "revisá los datos de la
    // tarjeta" cuando el problema es una credencial nuestra la hace perder el
    // tiempo cargando la tarjeta de nuevo, y nos esconde el error real.
    // Esos caen al 500 genérico, que es lo honesto, y quedan en el log.
    const status = error?.status || error?.statusCode;
    if (status === 400 && !(error instanceof ErrorVisible)) {
      log.error("pago.rechazado_por_api", error, { ref });
      return json(res, 400, {
        error:
          "MercadoPago no aceptó la operación. Revisá los datos de la tarjeta y volvé a intentar.",
        codigo: "api_rechazo",
        mensaje: {
          titulo: "No pudimos procesar el pago",
          detalle:
            "MercadoPago rechazó la operación antes de cobrarla. Revisá los datos de la tarjeta y probá de nuevo.",
          accion: "reintentar",
          grupo: "rechazado",
        },
      });
    }
    manejarError(res, "pago", error, { ref });
  }
}
