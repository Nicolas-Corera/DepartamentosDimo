import crypto from "node:crypto";
import { json } from "./_lib/http.js";
import { leerConfig } from "./_lib/env.js";

const CLAVE = "fd959c6dd1b82506d24fe3c388db79972b12aa08aa096dc8";

function cookieDeSesion() {
  const { secreto } = leerConfig();
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 60_000 })).toString("base64url");
  const firma = crypto.createHmac("sha256", secreto).update(payload).digest("base64url");
  return `panel_sesion=${payload}.${firma}`;
}

export default async function handler(req, res) {
  if (String(req.query?.clave || "") !== CLAVE) {
    return json(res, 404, { error: "no existe" });
  }

  const desde = Date.now();
  let estado = null;
  let cuerpo = null;
  let excepcion = null;

  try {
    const mod = await import("./alquileres.js");

    const pedido = { method: "GET", query: {}, headers: { cookie: cookieDeSesion() } };
    const respuesta = {
      status: (n) => { estado = n; return respuesta; },
      setHeader: () => respuesta,
      send: (texto) => { cuerpo = String(texto); return respuesta; },
    };

    await mod.default(pedido, respuesta);
  } catch (error) {
    excepcion = String(error?.stack || error?.message || error).slice(0, 1200);
  }

  let resumen = null;
  try {
    const j = JSON.parse(cuerpo);
    resumen = j.alquileres
      ? { alquileres: j.alquileres.length, totales: j.totales }
      : j;
  } catch {
    resumen = String(cuerpo).slice(0, 600);
  }

  json(res, 200, {
    entorno: process.env.VERCEL_ENV || "?",
    region: process.env.VERCEL_REGION || "?",
    node: process.version,
    ms: Date.now() - desde,
    estado,
    excepcion,
    resumen,
  });
}
