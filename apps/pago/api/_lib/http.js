/**
 * api/_lib/http.js
 * ---------------------------------------------------------------------------
 * Cuatro cosas repetidas en los tres endpoints: responder JSON, exigir un
 * método, leer el body y traducir un error interno a una respuesta que se le
 * pueda mostrar a una persona.
 */

import { log } from "./log.js";
import { ErrorDeConfig } from "./env.js";

/** Error con mensaje pensado para mostrarle al visitante. */
export class ErrorVisible extends Error {
  constructor(status, mensaje, codigo) {
    super(mensaje);
    this.name = "ErrorVisible";
    this.status = status;
    this.codigo = codigo || "error";
  }
}

export function json(res, status, cuerpo) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(JSON.stringify(cuerpo));
}

export function exigirMetodo(req, res, metodo) {
  if (req.method === metodo) return true;
  res.setHeader("Allow", metodo);
  json(res, 405, { error: `Este endpoint solo acepta ${metodo}.` });
  return false;
}

/**
 * Vercel ya parsea el JSON en req.body, pero en `vercel dev` y con algunos
 * content-type llega como string. Esto normaliza los dos casos.
 */
export function leerBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      throw new ErrorVisible(400, "El cuerpo del pedido no es JSON válido.", "body_invalido");
    }
  }
  return req.body;
}

/**
 * Una sola política de errores para todos los endpoints:
 *   - ErrorVisible      -> su status y su mensaje, tal cual.
 *   - ErrorDeConfig     -> 500 genérico afuera, mensaje completo en el log.
 *                          Un problema de credenciales es nuestro, no del que
 *                          está pagando, y su detalle no se publica.
 *   - cualquier otro    -> 500 genérico.
 */
export function manejarError(res, evento, error, datos) {
  if (error instanceof ErrorVisible) {
    log.warn(`${evento}.rechazado`, { ...datos, codigo: error.codigo, motivo: error.message });
    return json(res, error.status, { error: error.message, codigo: error.codigo });
  }

  if (error instanceof ErrorDeConfig) {
    log.error(`${evento}.config`, error, datos);
    return json(res, 500, {
      error:
        "El sistema de pagos no está configurado correctamente. " +
        "Avisanos y lo resolvemos: no se hizo ningún cobro.",
      codigo: "config",
    });
  }

  log.error(`${evento}.error`, error, datos);
  return json(res, 500, {
    error: "Tuvimos un problema procesando el pedido. Volvé a intentar en unos minutos.",
    codigo: "interno",
  });
}
