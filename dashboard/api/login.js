/**
 * POST /api/login
 * ---------------------------------------------------------------------------
 * Recibe { codigo: "123456" }, lo compara contra PANEL_CODIGO y, si da, devuelve
 * la cookie de sesión firmada. Es el único endpoint del panel que no exige
 * sesión previa — todos los demás la exigen.
 *
 * Lo que NO hace, a propósito: decir por qué falló. Un "código incorrecto" y un
 * "código de largo inválido" son el mismo mensaje, porque cualquier diferencia
 * es información gratis para quien esté probando combinaciones.
 */

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
      // Una demora fija de medio segundo. No cambia nada para quien tipea bien
      // el código y le pone techo a la cantidad de intentos por segundo.
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
