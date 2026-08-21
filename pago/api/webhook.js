/**
 * POST /api/webhook
 * ---------------------------------------------------------------------------
 * Recibe las notificaciones de MercadoPago y sincroniza el estado del pago.
 *
 * Dos reglas que definen todo este archivo:
 *
 * 1. NO SE CONFÍA EN EL PAYLOAD. La notificación dice "pasó algo con el pago
 *    123456"; nunca se toma de ahí el estado. Con ese id se consulta
 *    GET /v1/payments/{id} con nuestro Access Token y se guarda lo que
 *    responde la API, que es la única fuente de verdad.
 *
 * 2. SIN FIRMA VÁLIDA, NO SE PROCESA. Se valida el header `x-signature`
 *    (HMAC-SHA256) antes de tocar la base. Si no valida, 401 y afuera.
 *
 * Por qué existe, si /api/pagos ya sabe cómo salió el pago: porque hay estados
 * que cambian DESPUÉS. Un pago "in_process" que se aprueba a las 6 horas, una
 * devolución, un contracargo. Sin webhook, la base se queda con la foto del
 * primer segundo.
 *
 * MercadoPago espera un 200/201 rápido. Si tardamos o devolvemos error,
 * reintenta — por eso todo lo de acá es idempotente: procesar la misma
 * notificación diez veces deja exactamente el mismo resultado.
 */

import { leerConfig } from "./_lib/env.js";
import { exigirMetodo, json, leerBody } from "./_lib/http.js";
import { validarFirmaWebhook, consultarPago, resumirPago } from "./_lib/mercadopago.js";
import { guardarPago, confirmarReserva, esUuid } from "./_lib/supabase.js";
import { log } from "./_lib/log.js";

/** Los `type` que nos interesan. El resto se acepta y se descarta. */
const TIPOS_DE_PAGO = new Set(["payment", "payment.created", "payment.updated"]);

/**
 * El `ts` de la firma llega a veces en segundos y a veces en milisegundos
 * según el tipo de notificación. Diez dígitos son segundos.
 */
function demoraDesde(ts) {
  if (!ts || Number.isNaN(ts)) return null;
  const enMs = ts < 1e12 ? ts * 1000 : ts;
  return Date.now() - enMs;
}

export default async function handler(req, res) {
  if (!exigirMetodo(req, res, "POST")) return;

  let dataId = "";

  try {
    const config = leerConfig();
    const body = leerBody(req);

    // El id llega por query string; el body es el respaldo (según el tipo de
    // notificación, MercadoPago manda uno, el otro, o los dos).
    dataId = String(req.query?.["data.id"] || body?.data?.id || body?.id || "").trim();
    const tipo = String(req.query?.type || body?.type || body?.topic || "").trim();

    /* --- 1. firma ------------------------------------------------------- */
    const firma = validarFirmaWebhook({
      signatureHeader: req.headers["x-signature"],
      requestId: req.headers["x-request-id"],
      dataId,
      secreto: config.mp.webhookSecret,
    });

    if (!firma.valido) {
      // 401 a propósito: así el panel de MercadoPago muestra la notificación
      // como fallida y queda el rastro de que algo no cierra.
      log.warn("webhook.firma_invalida", { data_id: dataId, tipo, motivo: firma.motivo });
      return json(res, 401, { error: "firma inválida" });
    }

    if (!TIPOS_DE_PAGO.has(tipo)) {
      // 200: no es un error, simplemente no es asunto nuestro. Si devolviéramos
      // otra cosa, MercadoPago lo reintentaría para siempre.
      log.info("webhook.ignorado", { tipo, data_id: dataId });
      return json(res, 200, { ok: true, ignorado: tipo || "sin tipo" });
    }

    /* --- 2. la verdad la tiene la API, no el payload -------------------- */
    const pago = await consultarPago(dataId);
    const resumen = resumirPago(pago);

    // El external_reference es el uuid de la reserva, puesto por nosotros al
    // crear el pago. Si viene con otra cosa, guardamos el pago igual pero sin
    // atarlo a ninguna reserva: preferimos un registro huérfano antes que uno
    // asociado al azar.
    const bookingId = esUuid(resumen.external_reference) ? resumen.external_reference : null;
    if (!bookingId && resumen.external_reference) {
      log.warn("webhook.external_reference_desconocido", {
        payment_id: resumen.mp_payment_id,
        external_reference: resumen.external_reference,
      });
    }

    await guardarPago({ ...resumen, booking_id: bookingId });

    if (resumen.status === "approved" && bookingId && config.confirmarReservaAlAprobar) {
      await confirmarReserva(bookingId);
    }

    log.info("webhook.procesado", {
      payment_id: resumen.mp_payment_id,
      status: resumen.status,
      status_detail: resumen.status_detail,
      ref: bookingId,
      // Cuánto tardó desde que MercadoPago firmó el pedido. Si esto crece,
      // es que estamos cerca del timeout de la notificación.
      demora_ms: demoraDesde(firma.ts),
    });

    return json(res, 200, { ok: true, status: resumen.status });
  } catch (error) {
    // 500 a propósito: MercadoPago reintenta la notificación y, como todo el
    // camino es idempotente, el reintento arregla el problema solo.
    log.error("webhook.error", error, { data_id: dataId });
    return json(res, 500, { error: "no se pudo procesar la notificación" });
  }
}
