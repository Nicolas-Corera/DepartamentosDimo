/**
 * api/_lib/http.js
 * ---------------------------------------------------------------------------
 * Lo repetido en todos los endpoints del panel: responder JSON, exigir un
 * método, leer el body y traducir un error a una respuesta.
 *
 * Es hermano del `pago/api/_lib/http.js`, pero deliberadamente separado: son
 * dos proyectos de Vercel distintos y compartir el archivo obligaría a un
 * paquete común o a un symlink que Vercel no sigue. Duplicar 60 líneas sale
 * más barato que eso.
 */

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

/** Acepta un método o una lista. */
export function exigirMetodo(req, res, metodos) {
  const permitidos = Array.isArray(metodos) ? metodos : [metodos];
  if (permitidos.includes(req.method)) return true;
  res.setHeader("Allow", permitidos.join(", "));
  json(res, 405, { error: `Este endpoint solo acepta ${permitidos.join(" o ")}.` });
  return false;
}

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
 * Política de errores del panel.
 *
 * A diferencia del checkout, del otro lado hay una sola persona y es la dueña
 * del sistema: acá el mensaje de error puede ser específico y decir qué falló,
 * porque no hay a quién filtrarle información. Lo único que nunca sale es el
 * texto de un ErrorDeConfig, que puede nombrar variables y credenciales.
 */
export function manejarError(res, evento, error) {
  if (error instanceof ErrorVisible) {
    console.warn(`[${evento}] rechazado: ${error.codigo} — ${error.message}`);
    return json(res, error.status, { error: error.message, codigo: error.codigo });
  }

  if (error?.name === "ErrorDeConfig") {
    console.error(`[${evento}] configuración:`, error.message);
    return json(res, 500, {
      error: "El panel no está configurado correctamente. Revisá las variables de entorno en Vercel.",
      codigo: "config",
    });
  }

  console.error(`[${evento}] error:`, error?.message || error);
  return json(res, 500, {
    error: error?.message || "Algo falló del lado del servidor.",
    codigo: "interno",
  });
}

/** El entero que llega por body, validado. Devuelve null si no sirve. */
export function entero(valor, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

/** El porcentaje que llega por body (admite un decimal). null si no sirve. */
export function porcentaje(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

/** "2027-01-15" y nada más. null si no es una fecha ISO. */
export function fechaISO(valor) {
  const s = String(valor || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : s;
}
