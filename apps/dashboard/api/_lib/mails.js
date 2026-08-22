import { leerConfig } from "./env.js";
import { despachar } from "./resend.js";
import { generarRecibo, nombreDeArchivo, numeroDeRecibo } from "./recibo.js";
import {
  reservarEnvioDeMail,
  anotarResultadoDeMail,
  liberarEnvioDeMail,
  crearRecibo,
  descargarComprobante,
  leerConfigTarifas,
  buscarTarifasEspeciales,
  leerPorcentajeDeReserva,
  pagosAprobados,
  transferenciasConfirmadas,
  buscarReservaCompleta,
} from "./supabase.js";
import { calcularPrecio } from "./precios.js";
import { calcularCobro, sumarPagado } from "./cobro.js";
import { desdeLaBase, pagoInquilino, pagoDuenos } from "./plantillas.js";

const EXTENSIONES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/pdf": "pdf",
};

async function enviarUnaVez(clave, tipo, destinatarios, armar) {
  const { mails } = leerConfig();

  if (!mails.habilitados) {
    console.warn(`[mails] desactivados (${mails.motivo}) — no se envía ${tipo}`);
    return false;
  }

  const limpios = (destinatarios || []).filter(Boolean);
  if (!limpios.length) {
    console.warn(`[mails] sin destinatarios para ${tipo}`);
    return false;
  }

  const nuestro = await reservarEnvioDeMail(clave, tipo, limpios);
  if (!nuestro) {
    console.log(`[mails] ${clave} ya se había enviado`);
    return false;
  }

  try {
    const mensaje = await armar();
    const id = await despachar(mails.apiKey, { ...mensaje, to: limpios });
    await anotarResultadoDeMail(clave, { resendId: id });
    console.log(`[mails] enviado ${tipo} (${clave}) → ${limpios.length} destinatario(s)`);
    return true;
  } catch (error) {
    await liberarEnvioDeMail(clave);
    console.error(`[mails] falló ${tipo} (${clave}):`, error.message);
    return false;
  }
}

export async function avisarTransferenciaConfirmada(comprobante) {
  const config = leerConfig();

  const reservaFila = await buscarReservaCompleta(comprobante.booking_id);
  if (!reservaFila) {
    console.warn(`[mails] la reserva ${comprobante.booking_id} ya no existe`);
    return null;
  }

  const [tarifas, especiales, porcentajeReserva] = await Promise.all([
    leerConfigTarifas(),
    buscarTarifasEspeciales(reservaFila.check_in, reservaFila.check_out),
    leerPorcentajeDeReserva(),
  ]);

  const precio = calcularPrecio(reservaFila, tarifas.temporadas, especiales || []);

  const [pagos, transferencias] = await Promise.all([
    pagosAprobados(reservaFila.id),
    transferenciasConfirmadas(reservaFila.id),
  ]);

  const cobro = calcularCobro({
    precioTotal: precio.total,
    porcentajeReserva,
    pagadoBase: sumarPagado({ pagos: pagos || [], transferencias: transferencias || [] }),
    modo: "total",
  });

  const montoBase = Number(comprobante.monto_base ?? comprobante.monto_declarado) || 0;
  const monto = Number(comprobante.monto_declarado) || 0;
  const concepto = comprobante.concepto || (cobro.saldo > 0 ? "reserva" : "total");

  const fila = await crearRecibo({
    booking_id: reservaFila.id,
    origen: "transferencia",
    mp_payment_id: null,
    transfer_receipt_id: comprobante.id,
    concepto,
    monto,
    monto_base: montoBase,
    recargo: Math.max(0, monto - montoBase),
    moneda: "ARS",
  });

  const recibo = {
    numero: fila.numero,
    numeroTexto: numeroDeRecibo(fila.numero, config.mails.emisor.puntoVenta),
    emitidoEn: fila.created_at,
    cae: null,
    caeVence: null,
  };

  const datos = desdeLaBase(reservaFila);

  const pago = {
    concepto,
    monto,
    montoBase,
    recargo: Math.max(0, monto - montoBase),
    medio: "transferencia",
    medioTexto: "Transferencia bancaria",
    cuotas: 1,
    ultimosCuatro: null,
    referencia: `TR-${String(comprobante.id).slice(0, 8).toUpperCase()}`,
    fecha: comprobante.revisado_en || new Date().toISOString(),
  };

  let pdf = null;
  try {
    pdf = await generarRecibo({
      emisor: config.mails.emisor,
      reserva: datos,
      pago,
      cobro,
      recibo,
    });
  } catch (error) {
    console.error("[recibo] no se pudo generar el PDF:", error.message);
  }

  const adjuntoRecibo = pdf
    ? [{ nombre: nombreDeArchivo(recibo, datos), contenido: pdf.toString("base64") }]
    : [];

  const adjuntosDuenos = [...adjuntoRecibo];

  const bytes = await descargarComprobante(comprobante.path);
  if (bytes) {
    adjuntosDuenos.push({
      nombre: `comprobante-transferencia-${recibo.numeroTexto}.${
        EXTENSIONES[comprobante.mime] || "bin"
      }`,
      contenido: bytes.toString("base64"),
    });
  }

  const clave = `pago:transfer:${comprobante.id}`;
  const contexto = { reserva: datos, pago, cobro, recibo };

  await Promise.all([
    enviarUnaVez(`${clave}:inquilino`, "pago_inquilino", [datos.email], async () => ({
      from: config.mails.de.pagos,
      replyTo: config.mails.duenos[0],
      adjuntos: adjuntoRecibo,
      ...pagoInquilino(contexto),
    })),

    enviarUnaVez(`${clave}:duenos`, "pago_duenos", config.mails.duenos, async () => ({
      from: config.mails.de.pagos,
      replyTo: datos.email,
      adjuntos: adjuntosDuenos,
      ...pagoDuenos({ ...contexto, comprobanteAdjunto: adjuntosDuenos.length > adjuntoRecibo.length }),
    })),
  ]);

  return { recibo, cobro };
}
