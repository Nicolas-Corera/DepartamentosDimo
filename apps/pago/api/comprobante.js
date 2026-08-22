/**
 * POST /api/comprobante
 * ---------------------------------------------------------------------------
 * El comprobante de una transferencia. Dos pasos, los dos por acá:
 *
 *   { ref, accion: "firmar",    nombre, mime }  -> { path, token, expiraEn }
 *   { ref, accion: "registrar", path }          -> { ok, comprobanteId, monto }
 *
 * Por qué dos pasos y no un solo POST con el archivo adentro
 * ----------------------------------------------------------
 * Mandar el archivo en el body obliga a codificarlo en base64 (crece un 33%) y
 * lo hace pasar por la función, que en Vercel tiene un tope de 4,5 MB de body.
 * Una foto de un comprobante sacada con el celular lo puede superar, y el
 * rechazo sería incomprensible para quien la sube.
 *
 * Con la URL firmada el archivo va del navegador a Storage directo. La función
 * solo mueve JSON, no hay tope práctico de tamaño, y el bucket sigue cerrado:
 * el token firmado autoriza UNA subida a UNA ruta que elige el servidor, y
 * vence. `anon` no tiene ninguna política sobre el bucket — darle INSERT sería
 * regalarle a cualquiera un disco gratis contra nuestra cuenta.
 *
 * El segundo paso no es opcional ni ceremonial: es el que mira el objeto YA
 * subido y recién ahí escribe la fila. Lo que se guarda es el tamaño y el tipo
 * REALES que reporta Storage, no los que declaró el navegador.
 *
 * Qué NO hace este endpoint: dar por pagada la reserva. Un comprobante es
 * alguien diciendo "ya transferí". La plata se confirma mirando la cuenta.
 * Ver pago/sql/comprobantes-transferencia.sql.
 */

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

/**
 * Los cuatro formatos que pidió el negocio. La extensión sale de acá y no del
 * nombre que mandó el navegador: `comprobante.pdf.exe` guardaría un `.exe` en
 * el bucket si confiáramos en el nombre.
 */
const FORMATOS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/pdf": "pdf",
};

/** Los mismos formatos, dichos como los diría una persona. */
const FORMATOS_TXT = "PNG, JPG, JPEG o PDF";

/** Tope duro. Storage lo vuelve a aplicar del lado del servidor. */
const MAX_BYTES = 5 * 1024 * 1024;

/** La subida tiene que ocurrir en el momento: el token no es para guardar. */
const MINUTOS_DE_VIDA = 10;

function exigirMime(crudo) {
  // Chrome manda "image/jpeg" para .jpg y .jpeg; algunos Windows viejos mandan
  // "image/jpg", que no es un MIME real pero llega igual.
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

/**
 * Solo aceptamos rutas que generamos nosotros: "<uuid de la reserva>/<archivo>".
 * Sin esto, el paso de registrar aceptaría cualquier `path` y se podría colgar
 * el comprobante de otra persona de una reserva propia.
 */
function exigirPathDeLaReserva(crudo, bookingId) {
  const path = String(crudo || "").trim();
  if (!path.startsWith(`${bookingId}/`) || path.includes("..")) {
    throw new ErrorVisible(400, "La subida no corresponde a esta reserva.", "path_invalido");
  }
  return path;
}

/** El total que hay que transferir, calculado en el servidor. */
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

    // Misma puerta que tiene el cobro con tarjeta: si ya está paga, no hay nada
    // que transferir y subir un comprobante solo genera confusión después.
    const yaPaga = await tienePagoAprobado(reserva.id);
    if (yaPaga) {
      throw new ErrorVisible(409, "Esta reserva ya está paga.", "ya_pagada");
    }

    // ------------------------------------------------------------- firmar
    if (cuerpo.accion === "firmar") {
      const mime = exigirMime(cuerpo.mime);

      // El nombre del archivo lo pone el servidor. El que manda el navegador
      // no se usa ni para la extensión: solo se registra el tipo.
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

    // ---------------------------------------------------------- registrar
    if (cuerpo.accion === "registrar") {
      const path = exigirPathDeLaReserva(cuerpo.path, reserva.id);

      // La fuente de verdad es Storage, no lo que dice el navegador. Si el
      // objeto no está, la subida falló y no hay nada que registrar.
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

      // Storage ya aplica el tope del bucket, pero un bucket se reconfigura
      // desde el panel con dos clics y este chequeo no depende de eso.
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
