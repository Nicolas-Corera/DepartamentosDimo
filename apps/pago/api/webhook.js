import { leerConfig } from "./_lib/env.js";
import { exigirMetodo, json, leerBody } from "./_lib/http.js";
import { validarFirmaWebhook, consultarPago, resumirPago } from "./_lib/mercadopago.js";
import { guardarPago, confirmarReserva, esUuid } from "./_lib/supabase.js";
import { log } from "./_lib/log.js";

const TIPOS_DE_PAGO = new Set(["payment", "payment.created", "payment.updated"]);

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

    dataId = String(req.query?.["data.id"] || body?.data?.id || body?.id || "").trim();
    const tipo = String(req.query?.type || body?.type || body?.topic || "").trim();

    const firma = validarFirmaWebhook({
      signatureHeader: req.headers["x-signature"],
      requestId: req.headers["x-request-id"],
      dataId,
      secreto: config.mp.webhookSecret,
    });

    if (!firma.valido) {
      log.warn("webhook.firma_invalida", { data_id: dataId, tipo, motivo: firma.motivo });
      return json(res, 401, { error: "firma inválida" });
    }

    if (!TIPOS_DE_PAGO.has(tipo)) {
      log.info("webhook.ignorado", { tipo, data_id: dataId });
      return json(res, 200, { ok: true, ignorado: tipo || "sin tipo" });
    }

    const pago = await consultarPago(dataId);
    const resumen = resumirPago(pago);

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

      demora_ms: demoraDesde(firma.ts),
    });

    return json(res, 200, { ok: true, status: resumen.status });
  } catch (error) {
    log.error("webhook.error", error, { data_id: dataId });
    return json(res, 500, { error: "no se pudo procesar la notificación" });
  }
}
