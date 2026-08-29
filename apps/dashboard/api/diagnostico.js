import { json } from "./_lib/http.js";
import { seleccionar, leerConfigTarifas, leerConfigDeCobro } from "./_lib/supabase.js";

const CLAVE = "fd959c6dd1b82506d24fe3c388db79972b12aa08aa096dc8";

async function probar(nombre, fn) {
  const desde = Date.now();
  try {
    const filas = await fn();
    return { paso: nombre, ok: true, ms: Date.now() - desde, filas: Array.isArray(filas) ? filas.length : typeof filas };
  } catch (error) {
    return { paso: nombre, ok: false, ms: Date.now() - desde, error: String(error?.message || error).slice(0, 500) };
  }
}

export default async function handler(req, res) {
  if (String(req.query?.clave || "") !== CLAVE) {
    return json(res, 404, { error: "no existe" });
  }

  const pasos = [];
  pasos.push(await probar("config", async () => {
    const { leerConfig } = await import("./_lib/env.js");
    const c = leerConfig();
    return [c.supabase.url, c.supabase.serviceRoleKey.slice(0, 6), String(c.supabase.serviceRoleKey.length)];
  }));
  pasos.push(await probar("payments", () => seleccionar("payments", "select=mp_payment_id&limit=1")));
  pasos.push(await probar("payments+join", () => seleccionar("payments", "select=mp_payment_id,booking_requests(id,nombre)&limit=1")));
  pasos.push(await probar("transfer_receipts", () => seleccionar("transfer_receipts", "select=id,booking_requests(id)&limit=1")));
  pasos.push(await probar("tarifas_especiales", () => seleccionar("tarifas_especiales", "select=fecha_desde&limit=1")));
  pasos.push(await probar("leerConfigTarifas", () => leerConfigTarifas()));
  pasos.push(await probar("leerConfigDeCobro", () => leerConfigDeCobro()));

  pasos.push(await probar("alquileres-completo", async () => {
    const mod = await import("./alquileres.js");
    const falso = { method: "GET", query: {}, headers: {}, cookies: {} };
    let capturado = null;
    const resFalso = {
      status: () => resFalso,
      setHeader: () => resFalso,
      send: (cuerpo) => { capturado = cuerpo; return resFalso; },
    };
    Object.defineProperty(falso, "headers", { value: { cookie: "" } });
    await mod.default(falso, resFalso).catch((e) => { capturado = "THROW: " + e.message; });
    return [String(capturado).slice(0, 300)];
  }));

  json(res, 200, { entorno: process.env.VERCEL_ENV || "?", region: process.env.VERCEL_REGION || "?", node: process.version, pasos });
}
