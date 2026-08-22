import { exigirMetodo, json, leerBody, manejarError, ErrorVisible } from "./_lib/http.js";
import { insertarResena } from "./_lib/supabase.js";
import { avisarResenaNueva } from "./_lib/mails.js";
import { exigirCupoDeIp, exigirCupoGlobal } from "./_lib/limite.js";

const NOMBRE_MIN = 2;
const NOMBRE_MAX = 40;
const TEXTO_MIN = 5;
const TEXTO_MAX = 180;
const PALABRAS_MAX = 35;

function validar(cuerpo) {
  const name = String(cuerpo.name || "").trim();
  if (name.length < NOMBRE_MIN || name.length > NOMBRE_MAX) {
    throw new ErrorVisible(
      400,
      `El nombre va de ${NOMBRE_MIN} a ${NOMBRE_MAX} caracteres.`,
      "validacion",
    );
  }

  const rating = Number(cuerpo.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new ErrorVisible(400, "Elegí un puntaje de 1 a 5 estrellas.", "validacion");
  }

  const text = String(cuerpo.text || "").trim();
  if (text.length < TEXTO_MIN || text.length > TEXTO_MAX) {
    throw new ErrorVisible(
      400,
      `El comentario va de ${TEXTO_MIN} a ${TEXTO_MAX} caracteres.`,
      "validacion",
    );
  }

  const palabras = text.split(/\s+/).filter(Boolean).length;
  if (palabras > PALABRAS_MAX) {
    throw new ErrorVisible(
      400,
      `El comentario no puede pasar de ${PALABRAS_MAX} palabras.`,
      "validacion",
    );
  }

  return { name, rating, text, approved: false };
}

export default async function handler(req, res) {
  if (!exigirMetodo(req, res, "POST")) return;

  try {
    exigirCupoDeIp(req, "resena");

    const fila = validar(leerBody(req));

    await exigirCupoGlobal("resena");

    let resena;
    try {
      resena = await insertarResena(fila);
    } catch (error) {
      if (error.codigoPostgres === "23505") {
        throw new ErrorVisible(
          409,
          "Ya hay una reseña publicada con ese nombre y ese mismo comentario.",
          "duplicada",
        );
      }
      if (error.codigoPostgres === "23514") {
        throw new ErrorVisible(
          400,
          `Revisá el largo: el nombre va de ${NOMBRE_MIN} a ${NOMBRE_MAX} caracteres y el comentario de ${TEXTO_MIN} a ${TEXTO_MAX}.`,
          "validacion",
        );
      }
      throw error;
    }

    if (!resena?.id) {
      throw new Error("Supabase aceptó la reseña pero no devolvió la fila.");
    }

    console.log(`[resena] ${resena.id} — ${fila.name} — ${fila.rating}/5`);

    try {
      await avisarResenaNueva({
        resena: {
          id: resena.id,
          name: resena.name,
          rating: resena.rating,
          text: resena.text,
          createdAt: resena.created_at,
        },
      });
    } catch (error) {
      console.error("[resena] la reseña quedó guardada pero el mail falló:", error.message);
    }

    return json(res, 201, { ok: true, id: resena.id });
  } catch (error) {
    manejarError(res, "resena", error);
  }
}
