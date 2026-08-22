/**
 * GET   /api/comprobantes?id=<uuid>  — URL temporal para ver y para bajar
 * PATCH /api/comprobantes            — { id, accion: "aprobar" | "rechazar" }
 * ---------------------------------------------------------------------------
 * Los comprobantes de transferencia que sube la gente desde la página de pago.
 * Llegan a `transfer_receipts` con estado 'pendiente' y esperan a que alguien
 * los mire contra el extracto del banco.
 *
 * El archivo vive en el bucket privado `comprobantes`, sin ninguna política de
 * RLS: no lo lee nadie salvo service_role. Para mostrárselo al operador se le
 * firma una URL que vence sola. Nunca se hace público el bucket.
 *
 * ---------------------------------------------------------------------------
 * APROBAR NO MUEVE PLATA, Y RECHAZAR TAMPOCO
 *
 * Una transferencia bancaria no pasa por la API de MercadoPago: la plata entra
 * a la cuenta por fuera de todo esto. No hay `payment` que devolver ni
 * `refund` que crear, así que:
 *
 *   - Aprobar dice "vi la plata en la cuenta": marca el comprobante como
 *     confirmado y pasa la reserva a 'confirmada', que es lo que bloquea las
 *     noches en el calendario del sitio.
 *   - Rechazar dice "este comprobante no es válido", que NO es lo mismo que
 *     "esta reserva se murió". La reserva queda como estaba y quien la hizo
 *     puede volver al link de pago y pagar con otro medio, o subir otro
 *     comprobante. Si hubiera que devolver plata, se devuelve A MANO desde la
 *     cuenta de MercadoPago: este endpoint no lo hace y no puede hacerlo.
 *
 * Rechazar no libera fechas porque nunca las bloqueó: una reserva con un
 * comprobante pendiente sigue en 'nueva', y `fechas_ocupadas()` solo cuenta las
 * 'confirmada'. Lo único que se bloqueó alguna vez es lo que se aprobó.
 *
 * Es la diferencia con /api/cancelar, que sí mueve plata porque del otro lado
 * hay un pago de MercadoPago con su id.
 */

import { exigirMetodo, json, leerBody, manejarError, ErrorVisible } from "./_lib/http.js";
import { exigirSesion } from "./_lib/sesion.js";
import { seleccionar, actualizar, firmarLectura } from "./_lib/supabase.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cuánto vale la URL firmada.
 *
 * Quince minutos: el operador abre el comprobante, lo mira, quizás lo baja y
 * recién después decide. Con cinco minutos la imagen se le caía en la cara
 * mientras pensaba; con quince, si el link se filtrara igual queda muerto para
 * cuando le sirva a alguien.
 */
const MINUTOS_DE_VIDA = 15;

const EXTENSIONES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/pdf": "pdf",
};

function exigirId(valor) {
  const id = String(valor || "").trim();
  if (!UUID_RE.test(id)) {
    throw new ErrorVisible(400, "El id del comprobante no es válido.", "id_invalido");
  }
  return id;
}

async function buscarComprobante(id) {
  const filas = await seleccionar(
    "transfer_receipts",
    `select=id,booking_id,path,mime,bytes,monto_declarado,estado,created_at,` +
      `booking_requests(nombre,email,check_in,check_out,estado)` +
      `&id=eq.${id}`,
  );

  const fila = filas?.[0];
  if (!fila) {
    throw new ErrorVisible(404, "Ese comprobante ya no existe.", "comprobante_inexistente");
  }
  return fila;
}

export default async function handler(req, res) {
  if (!exigirMetodo(req, res, ["GET", "PATCH"])) return;

  try {
    exigirSesion(req);

    // ---------------------------------------------------------------- GET
    if (req.method === "GET") {
      const id = exigirId(req.query?.id);
      const fila = await buscarComprobante(id);

      // El nombre con el que se baja: el del huésped y las fechas, no el uuid
      // generado. Es lo que hace que la carpeta de descargas sea legible.
      // NFD parte cada letra acentuada en letra + tilde suelta, y
      // `\p{Diacritic}` se lleva las tildes: "José Ñandú" queda "jose-nandu" y
      // no "jos-and". Sin el paso de NFD, el filtro de abajo se comería la
      // letra entera junto con su tilde.
      const huesped = (fila.booking_requests?.nombre || "comprobante")
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .toLowerCase();
      const nombre = `comprobante-${huesped}-${fila.booking_requests?.check_in || ""}.${
        EXTENSIONES[fila.mime] || "bin"
      }`;

      // Dos URLs sobre el mismo archivo: una se ve, la otra se baja. Es un solo
      // parámetro de diferencia, pero pedirlas juntas evita un segundo viaje
      // cuando el operador aprieta "Descargar".
      const [ver, descargar] = await Promise.all([
        firmarLectura(fila.path, MINUTOS_DE_VIDA * 60),
        firmarLectura(fila.path, MINUTOS_DE_VIDA * 60, nombre),
      ]);

      return json(res, 200, {
        id: fila.id,
        mime: fila.mime,
        bytes: fila.bytes,
        nombreArchivo: nombre,
        estado: fila.estado,
        monto: Number(fila.monto_declarado || 0),
        subidoEn: fila.created_at,
        huesped: fila.booking_requests?.nombre || null,
        ver,
        descargar,
        expiraEnMinutos: MINUTOS_DE_VIDA,
      });
    }

    // -------------------------------------------------------------- PATCH
    const cuerpo = leerBody(req);
    const id = exigirId(cuerpo.id);
    const accion = String(cuerpo.accion || "").trim();

    if (accion !== "aprobar" && accion !== "rechazar") {
      throw new ErrorVisible(400, "Acción desconocida.", "accion_invalida");
    }

    const fila = await buscarComprobante(id);

    // Decidir dos veces sobre el mismo comprobante casi siempre es un doble
    // clic o dos pestañas abiertas. Se corta acá antes de tocar la reserva.
    if (fila.estado !== "pendiente") {
      throw new ErrorVisible(
        409,
        `Este comprobante ya estaba ${fila.estado === "confirmado" ? "aprobado" : "rechazado"}.`,
        "ya_resuelto",
      );
    }

    const aprobado = accion === "aprobar";

    /* Orden: primero el comprobante, después la reserva.

       Si fallara el segundo paso, queda un comprobante resuelto con la reserva
       en su estado anterior — visible y corregible a mano. Al revés quedaría
       una reserva confirmada por un comprobante que sigue figurando como
       pendiente, y esa sí es una inconsistencia que nadie mira. */
    const actualizadas = await actualizar("transfer_receipts", `id=eq.${id}`, {
      estado: aprobado ? "confirmado" : "rechazado",
      revisado_en: new Date().toISOString(),
    });
    if (!actualizadas?.length) {
      throw new ErrorVisible(404, "Ese comprobante ya no existe.", "comprobante_inexistente");
    }

    /* La reserva solo se toca al aprobar.

       'confirmada' es lo que bloquea las noches: `fechas_ocupadas()` solo
       cuenta ese estado.

       Al rechazar NO se toca: la reserva sigue viva y quien la hizo puede
       volver al link de pago y pagar con otro medio. Cancelarla acá le cerraba
       la puerta por un comprobante mal sacado, y encima no liberaba nada
       —seguía en 'nueva', que nunca ocupó fechas—. Si además hay que dar de
       baja la reserva, eso es una decisión aparte. */
    if (aprobado) {
      await actualizar("booking_requests", `id=eq.${fila.booking_id}`, {
        estado: "confirmada",
      });
    }

    console.log(`[comprobantes] ${aprobado ? "aprobado" : "rechazado"} ${id}`);

    return json(res, 200, {
      ok: true,
      id,
      estado: aprobado ? "confirmado" : "rechazado",
      estadoReserva: aprobado ? "confirmada" : fila.booking_requests?.estado || null,
      // Se lo dice el backend para que el aviso del panel no dependa de que
      // alguien se acuerde de escribirlo en la pantalla.
      avisoDevolucion: aprobado
        ? null
        : "Si hay que devolver la transferencia, hacelo a mano desde MercadoPago: " +
          "esa plata no entró por la API y el panel no la puede mover.",
    });
  } catch (error) {
    manejarError(res, "comprobantes", error);
  }
}
