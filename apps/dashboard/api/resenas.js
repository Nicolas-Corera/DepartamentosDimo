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

    if (req.method === "GET") {
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

    if (req.method === "PATCH") {
      const aprobada = cuerpo.aprobada !== false;
      const filas = await actualizar("reviews", `id=eq.${id}`, { approved: aprobada });

      if (!filas?.length) {
        throw new ErrorVisible(404, "Esa reseña ya no existe.", "resena_inexistente");
      }

      console.log(`[resenas] ${aprobada ? "aprobada" : "despublicada"} ${id}`);
      return json(res, 200, { ok: true, id, aprobada });
    }

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
