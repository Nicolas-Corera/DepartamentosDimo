import crypto from "node:crypto";
import { leerConfig } from "./env.js";

const BASE = "https://api.mercadopago.com";

async function mp(ruta, opciones = {}) {
  const { mpAccessToken } = leerConfig();

  const respuesta = await fetch(`${BASE}${ruta}`, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${mpAccessToken}`,
      "Content-Type": "application/json",
      ...opciones.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });

  const datos = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok) {
    const detalle =
      datos?.message ||
      datos?.error ||
      (Array.isArray(datos?.cause) ? datos.cause.map((c) => c.description).join("; ") : "") ||
      `HTTP ${respuesta.status}`;
    const error = new Error(detalle);
    error.status = respuesta.status;
    throw error;
  }

  return datos;
}

export function consultarPago(paymentId) {
  return mp(`/v1/payments/${encodeURIComponent(paymentId)}`);
}

export function devolver(paymentId, monto = null) {
  const clave = crypto
    .createHash("sha256")
    .update(`refund:${paymentId}:${monto == null ? "total" : monto}`)
    .digest("hex")
    .slice(0, 32);

  return mp(`/v1/payments/${encodeURIComponent(paymentId)}/refunds`, {
    method: "POST",
    headers: { "X-Idempotency-Key": clave },
    body: JSON.stringify(monto == null ? {} : { amount: Number(monto) }),
  });
}
