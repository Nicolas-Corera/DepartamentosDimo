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

export function manejarError(res, evento, error) {
  if (error instanceof ErrorVisible) {
    console.warn(`[${evento}] rechazado: ${error.codigo} — ${error.message}`);
    return json(res, error.status, { error: error.message, codigo: error.codigo });
  }

  if (error?.name === "ErrorDeConfig") {
    console.error(`[${evento}] configuración:`, error.message);
    return json(res, 500, { error: error.message, codigo: "config" });
  }

  console.error(`[${evento}] error:`, error?.message || error);
  return json(res, 500, {
    error: error?.message || "Algo falló del lado del servidor.",
    codigo: "interno",
  });
}

export function entero(valor, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

export function porcentaje(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

export function fechaISO(valor) {
  const s = String(valor || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : s;
}
