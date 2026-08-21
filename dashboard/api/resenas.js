/**
 * GET    /api/resenas  — todas, aprobadas y pendientes
 * PATCH  /api/resenas  — { id, aprobada: true } aprueba
 * DELETE /api/resenas  — { id } la borra de la base
 * ---------------------------------------------------------------------------
 * La tabla `reviews` tiene RLS: el sitio público solo puede LEER las aprobadas
 * e INSERTAR con `approved = false`. No hay política de UPDATE ni de DELETE,
 * así que moderarlas desde el navegador es imposible por diseño. El panel lo
 * hace con service_role, que saltea RLS — y por eso este endpoint exige sesión.
 *
 * Aprobar es lo que las publica en el sitio: hasta entonces la reseña existe
 * pero `fetchReviews()` no la trae, porque filtra por `approved = true`.
 */

import { exigirMetodo, json, leerBody, manejarError, ErrorVisible } from "./_lib/http.js";
import { exigirSesion } from "./_lib/sesion.js";
import { seleccionar, actualizar, borrar } from "./_lib/supabase.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function exigirId(cuerpo) {
  const id = String(cuerpo?.id || "").trim();
  if (!UUID_RE.test(id)) {
    throw new ErrorVisible(400, "El id de la reseña no es válido.", "id_invalido");
  }
  return id;
}

export default async function handler(req, res) {
  if (!exigirMetodo(req, res, ["GET", "PATCH", "DELETE"])) return;

  try {
    exigirSesion(req);

    // ---------------------------------------------------------------- GET
    if (req.method === "GET") {
      // Las pendientes primero: son las que piden una decisión. Dentro de cada
      // grupo, las más nuevas arriba.
      const filas =
        (await seleccionar(
          "reviews",
          "select=id,name,rating,text,approved,created_at&order=approved.asc,created_at.desc",
        )) || [];

      return json(res, 200, {
        resenas: filas.map((r) => ({
          id: r.id,
          nombre: r.name,
          puntaje: r.rating,
          texto: r.text,
          aprobada: r.approved,
          fecha: r.created_at,
        })),
        pendientes: filas.filter((r) => !r.approved).length,
      });
    }

    const cuerpo = leerBody(req);
    const id = exigirId(cuerpo);

    // -------------------------------------------------------------- PATCH
    if (req.method === "PATCH") {
      // Solo se toca `approved`. El nombre, el puntaje y el texto son de quien
      // los escribió: el panel modera, no edita reseñas ajenas.
      const aprobada = cuerpo.aprobada !== false;
      const filas = await actualizar("reviews", `id=eq.${id}`, { approved: aprobada });

      if (!filas?.length) {
        throw new ErrorVisible(404, "Esa reseña ya no existe.", "resena_inexistente");
      }

      console.log(`[resenas] ${aprobada ? "aprobada" : "despublicada"} ${id}`);
      return json(res, 200, { ok: true, id, aprobada });
    }

    // ------------------------------------------------------------- DELETE
    const filas = await borrar("reviews", `id=eq.${id}`);
    if (!filas?.length) {
      throw new ErrorVisible(404, "Esa reseña ya no existe.", "resena_inexistente");
    }

    console.log(`[resenas] eliminada ${id}`);
    json(res, 200, { ok: true, id });
  } catch (error) {
    manejarError(res, "resenas", error);
  }
}
