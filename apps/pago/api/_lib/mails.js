import { leerConfig } from "./env.js";
import { despachar } from "./resend.js";
import { log } from "./log.js";
import {
  reservarEnvioDeMail,
  anotarResultadoDeMail,
  liberarEnvioDeMail,
  descargarComprobante,
} from "./supabase.js";
import {
  desdeLaBase,
  linksDePago,
  reservaInquilino,
  reservaDueno,
  pagoInquilino,
  pagoDuenos,
  comprobanteInquilino,
  comprobanteDuenos,
} from "./plantillas.js";

const MEDIOS = {
  transferencia: "Transferencia bancaria",
  debito: "Tarjeta de débito",
  credito: "Tarjeta de crédito",
};

const EXTENSIONES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/pdf": "pdf",
};

export function medioTexto(medio, cuotas) {
  const nombre = MEDIOS[medio] || medio || "—";
  return Number(cuotas) > 1 ? `${nombre} · ${cuotas} cuotas` : nombre;
}

async function enviarUnaVez(clave, tipo, destinatarios, armar) {
  const { mails } = leerConfig();

  if (!mails.habilitados) {
    log.warn("mail.desactivado", { clave, tipo, motivo: mails.motivo });
    return false;
  }

  const limpios = (destinatarios || []).filter(Boolean);
  if (!limpios.length) {
    log.warn("mail.sin_destinatarios", { clave, tipo });
    return false;
  }

  const nuestro = await reservarEnvioDeMail(clave, tipo, limpios);
  if (!nuestro) {
    log.info("mail.ya_enviado", { clave, tipo });
    return false;
  }

  try {
    const mensaje = await armar();
    const id = await despachar(mails.apiKey, { ...mensaje, to: limpios });
    await anotarResultadoDeMail(clave, { resendId: id });
    log.info("mail.enviado", { clave, tipo, resend_id: id, destinatarios: limpios.length });
    return true;
  } catch (error) {
    await liberarEnvioDeMail(clave);
    log.error("mail.fallo", error, { clave, tipo });
    return false;
  }
}

export async function avisarSeniaPagada({ reserva, pago, cobro }) {
  const config = leerConfig();
  const datos = desdeLaBase(reserva);
  const links = linksDePago(config.urls.pago, reserva.id);
  const clave = `reserva:${pago.referencia}`;

  const contexto = { reserva: datos, pago, cobro, links };

  await Promise.all([
    enviarUnaVez(`${clave}:inquilino`, "reserva_inquilino", [datos.email], async () => ({
      from: config.mails.de.reservas,
      replyTo: config.mails.duenos[0],
      ...reservaInquilino(contexto),
    })),

    enviarUnaVez(`${clave}:duenos`, "reserva_duenos", config.mails.duenos, async () => ({
      from: config.mails.de.reservas,
      replyTo: datos.email,
      ...reservaDueno(contexto),
    })),
  ]);
}

export async function avisarPagoCompletado({ reserva, pago, cobro, comprobante }) {
  const config = leerConfig();
  const datos = desdeLaBase(reserva);

  const adjuntosDuenos = [];

  if (comprobante?.path) {
    const bytes = await descargarComprobante(comprobante.path);
    if (bytes) {
      const extension = EXTENSIONES[comprobante.mime] || "bin";
      adjuntosDuenos.push({
        nombre: `comprobante-transferencia-${String(reserva.id).slice(0, 8)}.${extension}`,
        contenido: bytes.toString("base64"),
      });
    }
  }

  const clave = comprobante ? `pago:transfer:${comprobante.id}` : `pago:${pago.referencia}`;
  const contexto = { reserva: datos, pago, cobro };

  await Promise.all([
    enviarUnaVez(`${clave}:inquilino`, "pago_inquilino", [datos.email], async () => ({
      from: config.mails.de.pagos,
      replyTo: config.mails.duenos[0],
      ...pagoInquilino(contexto),
    })),

    enviarUnaVez(`${clave}:duenos`, "pago_duenos", config.mails.duenos, async () => ({
      from: config.mails.de.pagos,
      replyTo: datos.email,
      adjuntos: adjuntosDuenos,
      ...pagoDuenos({ ...contexto, comprobanteAdjunto: adjuntosDuenos.length > 0 }),
    })),
  ]);
}

export async function avisarComprobanteSubido({ reserva, comprobante, cobro }) {
  const config = leerConfig();
  const datos = desdeLaBase(reserva);
  const clave = `comprobante:${comprobante.id}`;

  let adjunto = [];
  if (comprobante.path) {
    const bytes = await descargarComprobante(comprobante.path);
    if (bytes) {
      adjunto = [
        {
          nombre: `comprobante-${String(reserva.id).slice(0, 8)}.${EXTENSIONES[comprobante.mime] || "bin"}`,
          contenido: bytes.toString("base64"),
        },
      ];
    }
  }

  const contexto = { reserva: datos, comprobante, cobro };

  await Promise.all([
    enviarUnaVez(`${clave}:inquilino`, "comprobante_inquilino", [datos.email], async () => ({
      from: config.mails.de.reservas,
      replyTo: config.mails.duenos[0],
      ...comprobanteInquilino(contexto),
    })),

    enviarUnaVez(`${clave}:duenos`, "comprobante_duenos", config.mails.duenos, async () => ({
      from: config.mails.de.reservas,
      replyTo: datos.email,
      adjuntos: adjunto,
      ...comprobanteDuenos({ ...contexto, panelUrl: `${config.urls.panel}/#alquileres` }),
    })),
  ]);
}
