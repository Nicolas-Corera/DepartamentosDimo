import { exigirMetodo, json, leerBody, manejarError, ErrorVisible } from "./_lib/http.js";
import { exigirSesion } from "./_lib/sesion.js";
import { seleccionar, actualizar, firmarLectura } from "./_lib/supabase.js";
import { avisarTransferenciaConfirmada } from "./_lib/mails.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    `select=id,booking_id,path,mime,bytes,monto_declarado,monto_base,concepto,` +
      `estado,created_at,revisado_en,` +
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

    if (req.method === "GET") {
      const id = exigirId(req.query?.id);
      const fila = await buscarComprobante(id);

      const huesped = (fila.booking_requests?.nombre || "comprobante")
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .toLowerCase();
      const nombre = `comprobante-${huesped}-${fila.booking_requests?.check_in || ""}.${
        EXTENSIONES[fila.mime] || "bin"
      }`;

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

    const cuerpo = leerBody(req);
    const id = exigirId(cuerpo.id);
    const accion = String(cuerpo.accion || "").trim();

    if (accion !== "aprobar" && accion !== "rechazar") {
      throw new ErrorVisible(400, "Acción desconocida.", "accion_invalida");
    }

    const fila = await buscarComprobante(id);

    if (fila.estado !== "pendiente") {
      throw new ErrorVisible(
        409,
        `Este comprobante ya estaba ${fila.estado === "confirmado" ? "aprobado" : "rechazado"}.`,
        "ya_resuelto",
      );
    }

    const aprobado = accion === "aprobar";
    const revisadoEn = new Date().toISOString();

    const actualizadas = await actualizar("transfer_receipts", `id=eq.${id}`, {
      estado: aprobado ? "confirmado" : "rechazado",
      revisado_en: revisadoEn,
    });
    if (!actualizadas?.length) {
      throw new ErrorVisible(404, "Ese comprobante ya no existe.", "comprobante_inexistente");
    }

    if (aprobado) {
      await actualizar("booking_requests", `id=eq.${fila.booking_id}`, {
        estado: "confirmada",
      });
    }

    console.log(`[comprobantes] ${aprobado ? "aprobado" : "rechazado"} ${id}`);

    let recibo = null;
    if (aprobado) {
      try {
        const resultado = await avisarTransferenciaConfirmada({ ...fila, revisado_en: revisadoEn });
        recibo = resultado?.recibo?.numeroTexto || null;
      } catch (error) {
        console.error(
          "[comprobantes] el comprobante quedó aprobado pero los mails fallaron:",
          error.message,
        );
      }
    }

    return json(res, 200, {
      ok: true,
      id,
      estado: aprobado ? "confirmado" : "rechazado",
      estadoReserva: aprobado ? "confirmada" : fila.booking_requests?.estado || null,
      recibo,

      avisoDevolucion: aprobado
        ? null
        : "Si hay que devolver la transferencia, hacelo a mano desde MercadoPago: " +
          "esa plata no entró por la API y el panel no la puede mover.",
    });
  } catch (error) {
    manejarError(res, "comprobantes", error);
  }
}
