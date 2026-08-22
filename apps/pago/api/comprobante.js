import { exigirMetodo, json, leerBody, manejarError, ErrorVisible } from "./_lib/http.js";
import {
  buscarReserva,
  buscarTarifasEspeciales,
  leerConfigTarifas,
  leerPorcentajeDeReserva,
  pagosAprobados,
  transferenciasConfirmadas,
  firmarSubidaDeComprobante,
  leerObjetoDeComprobante,
  leerCabeceraDeComprobante,
  borrarComprobante,
  guardarComprobante,
} from "./_lib/supabase.js";
import { tipoRealDeArchivo } from "./_lib/formato-archivo.js";
import { calcularPrecio, calcularRecargo } from "./_lib/precios.js";
import { calcularCobro, sumarPagado, normalizarModo } from "./_lib/cobro.js";
import { avisarComprobanteSubido } from "./_lib/mails.js";
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

async function estadoDeCobro(reserva, modo) {
  const [tarifasConfig, especiales, porcentajeReserva] = await Promise.all([
    leerConfigTarifas(),
    buscarTarifasEspeciales(reserva.check_in, reserva.check_out),
    leerPorcentajeDeReserva(),
  ]);

  const precio = calcularPrecio(reserva, tarifasConfig.temporadas, especiales);

  const [pagos, transferencias] = await Promise.all([
    pagosAprobados(reserva.id),
    transferenciasConfirmadas(reserva.id),
  ]);

  const cobro = calcularCobro({
    precioTotal: precio.total,
    porcentajeReserva,
    pagadoBase: sumarPagado({ pagos, transferencias }),
    modo,
  });

  const medio = tarifasConfig.medios.find((m) => m.clave === "transferencia" && m.habilitado);
  if (!medio) {
    throw new ErrorVisible(
      409,
      "El pago por transferencia no está disponible en este momento.",
      "transferencia_deshabilitada",
    );
  }

  return { cobro, importe: calcularRecargo(cobro.aCobrarBase, medio, null) };
}

export default async function handler(req, res) {
  if (!exigirMetodo(req, res, "POST")) return;

  let ref = "";

  try {
    const cuerpo = leerBody(req);
    ref = String(cuerpo.ref || "").trim();
    const modo = normalizarModo(cuerpo.modo);

    const reserva = await buscarReserva(ref);
    const { cobro, importe } = await estadoDeCobro(reserva, modo);

    if (cobro.yaPagada) {
      throw new ErrorVisible(409, "Esta reserva ya está paga por completo.", "ya_pagada");
    }

    if (cuerpo.accion === "firmar") {
      const mime = exigirMime(cuerpo.mime);

      const nombre = `${Date.now()}-${crypto.randomUUID()}.${FORMATOS[mime]}`;
      const path = `${reserva.id}/${nombre}`;

      const firma = await firmarSubidaDeComprobante(path);

      log.info("comprobante.firmado", { ref: reserva.id, mime, concepto: cobro.concepto });
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

      const declarado = exigirMime(objeto.mime);
      const bytes = Number(objeto.bytes || 0);

      if (!bytes || bytes > MAX_BYTES) {
        await borrarComprobante(path);
        throw new ErrorVisible(
          400,
          `El comprobante no puede pesar más de ${MAX_BYTES / 1024 / 1024} MB.`,
          "archivo_grande",
        );
      }

      const mime = tipoRealDeArchivo(await leerCabeceraDeComprobante(path));

      if (!mime) {
        await borrarComprobante(path);
        log.warn("comprobante.contenido_rechazado", { ref: reserva.id, declarado, bytes });
        throw new ErrorVisible(
          400,
          `Ese archivo no es un ${FORMATOS_TXT}. Puede estar dañado, o tener la extensión cambiada.`,
          "contenido_invalido",
        );
      }

      if (mime !== declarado) {
        log.warn("comprobante.mime_no_coincide", { ref: reserva.id, declarado, real: mime });
      }

      const fila = await guardarComprobante({
        booking_id: reserva.id,
        path,
        mime,
        bytes,
        monto_declarado: importe.total,
        monto_base: importe.totalBase,
        concepto: cobro.concepto,
      });

      log.info("comprobante.registrado", {
        ref: reserva.id,
        bytes,
        mime,
        concepto: cobro.concepto,
        monto: importe.total,
      });

      try {
        await avisarComprobanteSubido({
          reserva,
          comprobante: {
            id: fila.id,
            path,
            mime,
            monto: importe.total,
            montoBase: importe.totalBase,
            concepto: cobro.concepto,
            subidoEn: fila.created_at,
          },
          cobro,
        });
      } catch (error) {
        log.error("comprobante.mails_fallaron", error, { ref: reserva.id, comprobante: fila.id });
      }

      return json(res, 201, {
        ok: true,
        comprobanteId: fila.id,
        monto: importe.total,
        concepto: cobro.concepto,
      });
    }

    throw new ErrorVisible(400, "Pedido incompleto.", "accion_invalida");
  } catch (error) {
    manejarError(res, "comprobante", error, { ref });
  }
}
