import crypto from "node:crypto";
import {
  MercadoPagoConfig,
  Payment,
  WebhookSignatureValidator,
  InvalidWebhookSignatureError,
} from "mercadopago";
import { leerConfig } from "./env.js";
import { log } from "./log.js";

let clientePagos = null;

function pagos() {
  if (clientePagos) return clientePagos;
  const { mp } = leerConfig();
  const cliente = new MercadoPagoConfig({
    accessToken: mp.accessToken,
    options: { timeout: 10_000 },
  });
  clientePagos = new Payment(cliente);
  return clientePagos;
}

export function claveIdempotencia(ref, token) {
  const hash = crypto.createHash("sha256").update(`${ref}:${token}`).digest("hex");

  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join("-");
}

export async function crearPago(datos) {
  const { mp } = leerConfig();

  const body = {
    transaction_amount: datos.monto,
    token: datos.token,
    description: datos.descripcion,
    installments: datos.cuotas,
    payment_method_id: datos.paymentMethodId,

    external_reference: datos.ref,
    statement_descriptor: mp.statementDescriptor,
    payer: {
      email: datos.pagador.email,
      identification: datos.pagador.identificacion,
    },
    metadata: {
      booking_id: datos.ref,
      origen: "sitio-pago-dimo",
    },
  };

  if (datos.issuerId) body.issuer_id = datos.issuerId;
  if (datos.pagador.nombre) body.payer.first_name = datos.pagador.nombre;

  const idempotencyKey = claveIdempotencia(datos.ref, datos.token);

  log.info("mp.crearPago.inicio", {
    ref: datos.ref,
    monto: datos.monto,
    cuotas: datos.cuotas,
    payment_method_id: datos.paymentMethodId,
    idempotency_key: idempotencyKey,
  });

  const respuesta = await pagos().create({ body, requestOptions: { idempotencyKey } });

  log.info("mp.crearPago.ok", {
    ref: datos.ref,
    payment_id: respuesta?.id,
    status: respuesta?.status,
    status_detail: respuesta?.status_detail,
  });

  return respuesta;
}

export async function consultarPago(paymentId) {
  return pagos().get({ id: String(paymentId) });
}

export function esPedidoDuplicado(error) {
  if (!error) return false;
  const status = error.status || error.statusCode;
  if (status === 423) return true;
  if (error.error === "resource_already_locked") return true;
  return Array.isArray(error.cause) && error.cause.some((c) => Number(c?.code) === 2001);
}

export async function buscarPagoPorReferencia(ref, monto) {
  const respuesta = await pagos().search({
    options: {
      external_reference: ref,
      sort: "date_created",
      criteria: "desc",
      limit: 10,
    },
  });

  const resultados = respuesta?.results || [];
  if (!resultados.length) return null;

  const candidatos =
    monto == null
      ? resultados
      : resultados.filter((p) => Math.abs(Number(p.transaction_amount) - Number(monto)) < 0.01);

  if (!candidatos.length) return null;

  return candidatos.find((p) => p.status === "approved") || candidatos[0];
}

export function resumirPago(pago) {
  return {
    mp_payment_id: String(pago.id),
    external_reference: pago.external_reference || null,
    status: pago.status,
    status_detail: pago.status_detail || null,
    monto: pago.transaction_amount,
    moneda: pago.currency_id || "ARS",
    metodo: pago.payment_method_id || null,
    tipo: pago.payment_type_id || null,
    cuotas: normalizarCuotas(pago.installments),
    ultimos_cuatro: normalizarUltimosCuatro(pago.card?.last_four_digits),
    payer_email: pago.payer?.email || null,
    aprobado_en: pago.date_approved || null,
  };
}

function normalizarUltimosCuatro(valor) {
  const limpio = String(valor ?? "").trim();
  return /^[0-9]{4}$/.test(limpio) ? limpio : null;
}

function normalizarCuotas(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 && n <= 24 ? n : null;
}

const TOLERANCIA_FIRMA_MS = 15 * 60 * 1000;

export function esPagoInexistente(error) {
  if (!error) return false;
  if (Number(error.status || error.statusCode) === 404) return true;
  if (error.error === "not_found") return true;
  return Array.isArray(error.cause) && error.cause.some((c) => Number(c?.code) === 2000);
}

export function validarFirmaWebhook({ signatureHeader, requestId, dataId, secreto, ahora }) {
  if (!secreto) return { valido: false, motivo: "no hay MP_WEBHOOK_SECRET configurado" };
  if (!dataId) return { valido: false, motivo: "falta data.id" };

  const ts = tsDeLaFirma(signatureHeader);

  try {
    WebhookSignatureValidator.validate({
      xSignature: signatureHeader,
      xRequestId: requestId,
      dataId,
      secret: secreto,
    });
  } catch (error) {
    if (error instanceof InvalidWebhookSignatureError) {
      return { valido: false, motivo: error.reason, ts };
    }
    throw error;
  }

  const emitidoEnMs = tsEnMs(ts);
  if (emitidoEnMs == null) return { valido: false, motivo: "MissingTimestamp", ts };

  const desfasaje = Math.abs((ahora ?? Date.now()) - emitidoEnMs);
  if (desfasaje > TOLERANCIA_FIRMA_MS) {
    return { valido: false, motivo: "TimestampOutOfTolerance", ts, desfasaje_ms: desfasaje };
  }

  return { valido: true, ts };
}

function tsDeLaFirma(signatureHeader) {
  const m = /(?:^|,)\s*ts\s*=\s*(\d+)/.exec(String(signatureHeader || ""));
  return m ? Number(m[1]) : null;
}

export function tsEnMs(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

let catalogoMedios = null;

export async function tipoDeTarjeta(paymentMethodId) {
  const id = String(paymentMethodId || "").trim().toLowerCase();
  if (!id) return "credito";

  try {
    if (!catalogoMedios) {
      const { mp } = leerConfig();
      const respuesta = await fetch("https://api.mercadopago.com/v1/payment_methods", {
        headers: { Authorization: `Bearer ${mp.accessToken}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);

      const filas = await respuesta.json();
      catalogoMedios = new Map();

      for (const fila of Array.isArray(filas) ? filas : []) {
        const clave = String(fila.id).toLowerCase();
        if (!catalogoMedios.has(clave)) catalogoMedios.set(clave, new Set());
        catalogoMedios.get(clave).add(fila.payment_type_id);
      }
    }

    const tipos = catalogoMedios.get(id);
    if (tipos?.size) {
      if (tipos.has("credit_card")) return "credito";

      if (tipos.has("debit_card") || tipos.has("prepaid_card")) return "debito";
    }
  } catch (error) {
    log.warn("mp.catalogoMedios.falló", { motivo: error?.message || String(error) });
  }

  return /^deb/.test(id) || id === "maestro" ? "debito" : "credito";
}

export async function devolverPago(paymentId, monto = null) {
  const { mp } = leerConfig();

  const cuerpo = monto == null ? {} : { amount: Number(monto) };
  const clave = crypto
    .createHash("sha256")
    .update(`refund:${paymentId}:${monto == null ? "total" : monto}`)
    .digest("hex")
    .slice(0, 32);

  log.info("mp.devolucion.inicio", { payment_id: String(paymentId), monto });

  const respuesta = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}/refunds`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${mp.accessToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": clave,
    },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(15_000),
  });

  const datos = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok) {
    const detalle = datos?.message || datos?.error || `HTTP ${respuesta.status}`;
    log.error("mp.devolucion.rechazada", new Error(detalle), {
      payment_id: String(paymentId),
      monto,
      status: respuesta.status,
    });
    const error = new Error(detalle);
    error.status = respuesta.status;
    throw error;
  }

  log.info("mp.devolucion.ok", {
    payment_id: String(paymentId),
    refund_id: datos?.id,
    monto: datos?.amount,
    status: datos?.status,
  });

  return datos;
}
