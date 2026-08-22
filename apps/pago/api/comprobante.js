import { exigirMetodo, json, leerBody, manejarError, ErrorVisible } from "./_lib/http.js";
import {
  buscarReserva,
  tienePagoAprobado,
  buscarTarifasEspeciales,
  leerConfigTarifas,
  firmarSubidaDeComprobante,
  leerObjetoDeComprobante,
  borrarComprobante,
  guardarComprobante,
} from "./_lib/supabase.js";
import { calcularPrecio, calcularRecargo } from "./_lib/precios.js";
import { log } from "./_lib/log.js";

const FORMATOS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/pdf": "pdf",
};

const FORMATOS_TXT = "PNG, JPG, JPEG o PDF";

const MAX_BYTES = 5 * 1024 * 1024;

const MINUTOS_DE_VIDA = 10;

function exigirMime(crudo) {
  const mime = String(crudo || "").trim().toLowerCase() === "image/jpg"
    ? "image/jpeg"
    : String(crudo || "").trim().toLowerCase();

  if (!FORMATOS[mime]) {
    throw new ErrorVisible(
      400,
      `Ese archivo no es un comprobante válido. Subí un ${FORMATOS_TXT}.`,
      "formato_invalido",
    );
  }
  return mime;
}

function exigirPathDeLaReserva(crudo, bookingId) {
  const path = String(crudo || "").trim();
  if (!path.startsWith(`${bookingId}/`) || path.includes("..")) {
    throw new ErrorVisible(400, "La subida no corresponde a esta reserva.", "path_invalido");
  }
  return path;
}

async function montoDeLaTransferencia(reserva) {
  const [tarifasConfig, especiales] = await Promise.all([
    leerConfigTarifas(),
    buscarTarifasEspeciales(reserva.check_in, reserva.check_out),
  ]);

  const precio = calcularPrecio(reserva, tarifasConfig.temporadas, especiales);
  const medio = tarifasConfig.medios.find((m) => m.clave === "transferencia" && m.habilitado);
  if (!medio) {
    throw new ErrorVisible(
      409,
      "El pago por transferencia no está disponible en este momento.",
      "transferencia_deshabilitada",
    );
  }
  return calcularRecargo(precio.total, medio, null).total;
}

export default async function handler(req, res) {
  if (!exigirMetodo(req, res, "POST")) return;

  let ref = "";

  try {
    const cuerpo = leerBody(req);
    ref = String(cuerpo.ref || "").trim();

    const reserva = await buscarReserva(ref);

    const yaPaga = await tienePagoAprobado(reserva.id);
    if (yaPaga) {
      throw new ErrorVisible(409, "Esta reserva ya está paga.", "ya_pagada");
    }

    if (cuerpo.accion === "firmar") {
      const mime = exigirMime(cuerpo.mime);

      const nombre = `${Date.now()}-${crypto.randomUUID()}.${FORMATOS[mime]}`;
      const path = `${reserva.id}/${nombre}`;

      const firma = await firmarSubidaDeComprobante(path);

      log.info("comprobante.firmado", { ref: reserva.id, mime });
      return json(res, 200, {
        path: firma.path,
        token: firma.token,
        expiraEnMinutos: MINUTOS_DE_VIDA,
        maxBytes: MAX_BYTES,
      });
    }

    if (cuerpo.accion === "registrar") {
      const path = exigirPathDeLaReserva(cuerpo.path, reserva.id);

      const objeto = await leerObjetoDeComprobante(path);
      if (!objeto) {
        throw new ErrorVisible(
          400,
          "No nos llegó el archivo. Volvé a elegirlo e intentá de nuevo.",
          "subida_incompleta",
        );
      }

      const mime = exigirMime(objeto.mime);
      const bytes = Number(objeto.bytes || 0);

      if (!bytes || bytes > MAX_BYTES) {
        await borrarComprobante(path);
        throw new ErrorVisible(
          400,
          `El comprobante no puede pesar más de ${MAX_BYTES / 1024 / 1024} MB.`,
          "archivo_grande",
        );
      }

      const monto = await montoDeLaTransferencia(reserva);
      const fila = await guardarComprobante({
        booking_id: reserva.id,
        path,
        mime,
        bytes,
        monto_declarado: monto,
      });

      log.info("comprobante.registrado", { ref: reserva.id, bytes, mime });
      return json(res, 201, { ok: true, comprobanteId: fila.id, monto });
    }

    throw new ErrorVisible(400, "Pedido incompleto.", "accion_invalida");
  } catch (error) {
    manejarError(res, "comprobante", error, { ref });
  }
}
