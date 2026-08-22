import { ErrorVisible } from "./http.js";
import { contarDesde } from "./supabase.js";

const VENTANA_MS = 60 * 60 * 1000;

const TOPES = {
  consulta: {
    tabla: "booking_requests",
    porIp: 5,
    global: 20,
    mensaje:
      "Recibimos varias consultas seguidas desde tu conexión. " +
      "Esperá un rato y volvé a probar, o escribinos por WhatsApp y te contestamos al toque.",
    mensajeGlobal:
      "Estamos recibiendo muchas consultas en este momento. " +
      "Probá de nuevo más tarde, o escribinos por WhatsApp y te contestamos al toque.",
  },
  resena: {
    tabla: "reviews",
    porIp: 3,
    global: 15,
    mensaje:
      "Ya dejaste varias reseñas seguidas. Esperá un rato antes de mandar otra.",
    mensajeGlobal:
      "Estamos recibiendo muchas reseñas en este momento. Probá de nuevo más tarde.",
  },
};

const usos = new Map();

function ipDe(req) {
  const reenviada = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return reenviada || req.socket?.remoteAddress || "desconocida";
}

function limpiar(ahora) {
  for (const [clave, marcas] of usos) {
    const vivas = marcas.filter((t) => ahora - t < VENTANA_MS);
    if (vivas.length) usos.set(clave, vivas);
    else usos.delete(clave);
  }
}

export function exigirCupoDeIp(req, accion) {
  const tope = TOPES[accion];
  if (!tope) return;

  const ahora = Date.now();
  if (usos.size > 500) limpiar(ahora);

  const clave = `${accion}:${ipDe(req)}`;
  const previos = (usos.get(clave) || []).filter((t) => ahora - t < VENTANA_MS);

  if (previos.length >= tope.porIp) {
    throw new ErrorVisible(429, tope.mensaje, "demasiados_intentos");
  }

  previos.push(ahora);
  usos.set(clave, previos);
}

export async function exigirCupoGlobal(accion) {
  const tope = TOPES[accion];
  if (!tope) return;

  const desde = new Date(Date.now() - VENTANA_MS).toISOString();

  let recientes;
  try {
    recientes = await contarDesde(tope.tabla, desde, tope.global);
  } catch {
    return;
  }

  if (recientes >= tope.global) {
    throw new ErrorVisible(429, tope.mensajeGlobal, "demasiados_intentos");
  }
}
