import { exigirMetodo, json, manejarError } from "./_lib/http.js";
import { haySesion, cerrarSesion } from "./_lib/sesion.js";

export default async function handler(req, res) {
  if (!exigirMetodo(req, res, ["GET", "DELETE"])) return;

  try {
    if (req.method === "DELETE") {
      cerrarSesion(res);
      return json(res, 200, { ok: true });
    }

    if (!haySesion(req)) {
      return json(res, 401, { ok: false, codigo: "sin_sesion" });
    }

    json(res, 200, { ok: true });
  } catch (error) {
    manejarError(res, "sesion", error);
  }
}
