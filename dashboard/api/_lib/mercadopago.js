/**
 * api/_lib/mercadopago.js
 * ---------------------------------------------------------------------------
 * Lo único que el panel le pide a MercadoPago: devolver plata y consultar un
 * pago. Con `fetch` contra la API REST, sin el SDK — son dos llamadas.
 *
 * El Access Token no sale de este archivo.
 */

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

/** GET /v1/payments/{id} — la fuente de verdad sobre el estado de un pago. */
export function consultarPago(paymentId) {
  return mp(`/v1/payments/${encodeURIComponent(paymentId)}`);
}

/**
 * POST /v1/payments/{id}/refunds — devolución total o parcial.
 *
 * Sin `monto` devuelve todo. Con `monto`, esa parte: MercadoPago admite varias
 * devoluciones parciales sobre el mismo pago mientras la suma no supere lo
 * cobrado.
 *
 * La clave de idempotencia lleva el monto adentro a propósito. Dos devoluciones
 * parciales distintas sobre el mismo pago tienen que poder convivir (devolver
 * $10.000 hoy y $5.000 mañana son dos operaciones legítimas), pero un doble
 * clic sobre LA MISMA no puede devolver la plata dos veces. Con el monto en la
 * clave, el reintento exacto es idempotente y las devoluciones distintas no se
 * pisan.
 */
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
