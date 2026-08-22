import { exigirMetodo, json, manejarError } from "./_lib/http.js";
import { fechasOcupadas } from "./_lib/supabase.js";

export default async function handler(req, res) {
  if (!exigirMetodo(req, res, "GET")) return;

  try {
    return json(res, 200, { fechas: await fechasOcupadas() });
  } catch (error) {
    manejarError(res, "ocupacion", error);
  }
}
