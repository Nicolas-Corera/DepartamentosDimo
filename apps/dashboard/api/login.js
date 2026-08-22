import { exigirMetodo, json, leerBody, manejarError, ErrorVisible } from "./_lib/http.js";
import {
  codigoEsCorrecto,
  abrirSesion,
  estaBloqueado,
  registrarIntentoFallido,
  limpiarIntentos,
} from "./_lib/sesion.js";

export default async function handler(req, res) {
  if (!exigirMetodo(req, res, "POST")) return;

  try {
    if (estaBloqueado(req)) {
      throw new ErrorVisible(
        429,
        "Demasiados intentos fallidos. Esperá unos minutos y volvé a probar.",
        "bloqueado",
      );
    }

    const { codigo } = leerBody(req);

    if (!codigoEsCorrecto(codigo)) {
      registrarIntentoFallido(req);

      await new Promise((r) => setTimeout(r, 500));
      throw new ErrorVisible(401, "El código no es correcto.", "codigo_invalido");
    }

    limpiarIntentos(req);
    const vence = abrirSesion(res);

    console.log("[login] sesión abierta");
    json(res, 200, { ok: true, vence });
  } catch (error) {
    manejarError(res, "login", error);
  }
}
