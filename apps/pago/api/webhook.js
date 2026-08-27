import { leerConfig } from "./_lib/env.js";
import { exigirMetodo, json, leerBody } from "./_lib/http.js";
import {
  validarFirmaWebhook,
  consultarPago,
  resumirPago,
  esPagoInexistente,
  tsEnMs,
} from "./_lib/mercadopago.js";
import {
  guardarPago,
  confirmarReserva,
  esUuid,
  existeReserva,
  buscarReserva,
  buscarPagoGuardado,
  completarDatosDePago,
  buscarTarifasEspeciales,
  leerConfigTarifas,
  leerConfigDeCobro,
  pagosAprobados,
  transferenciasConfirmadas,
} from "./_lib/supabase.js";
import { calcularPrecio } from "./_lib/precios.js";
import {
  calcularCobro,
  sumarPagado,
  montoDeLaSenia,
  deducirBase,
  deducirConcepto,
} from "./_lib/cobro.js";
import { avisarSeniaPagada, avisarPagoCompletado, medioTexto } from "./_lib/mails.js";
import { enSegundoPlano } from "./_lib/segundo-plano.js";
import { log } from "./_lib/log.js";

const TIPOS_DE_PAGO = new Set(["payment", "payment.created", "payment.updated"]);

function demoraDesde(ts) {
  const enMs = tsEnMs(ts);
  return enMs == null ? null : Date.now() - enMs;
}

const MEDIO_POR_TIPO = {
  credit_card: "credito",
  debit_card: "debito",
  prepaid_card: "debito",
  bank_transfer: "transferencia",
  account_money: "transferencia",
};

async function avisarPorMail(resumen, bookingId, guardado) {
  const reserva = await buscarReserva(bookingId);

  const [tarifasConfig, especiales, cobroConfig] = await Promise.all([
    leerConfigTarifas(),
    buscarTarifasEspeciales(reserva.check_in, reserva.check_out),
    leerConfigDeCobro(),
  ]);

  const precio = calcularPrecio(reserva, tarifasConfig.temporadas, especiales, cobroConfig.tarifaLimpieza);

  const [pagos, transferencias] = await Promise.all([
    pagosAprobados(reserva.id),
    transferenciasConfirmadas(reserva.id),
  ]);

  const claveMedio = MEDIO_POR_TIPO[resumen.tipo] || "credito";

  let montoBase = Number(guardado?.monto_base);
  if (!Number.isFinite(montoBase) || montoBase <= 0) {
    const medio = tarifasConfig.medios.find((m) => m.clave === claveMedio);
    const plan = tarifasConfig.planes.find((p) => Number(p.cuotas) === Number(resumen.cuotas));

    const recargo =
      Number(medio?.recargo_porcentaje || 0) +
      (claveMedio === "credito" ? Number(plan?.recargo_porcentaje || 0) : 0);

    montoBase = deducirBase(resumen.monto, recargo);
    log.warn("webhook.monto_base_deducido", {
      payment_id: resumen.mp_payment_id,
      monto: resumen.monto,
      recargo,
      monto_base: montoBase,
    });
  }

  const pagadoOtros = sumarPagado({
    pagos: pagos.filter((p) => p.mp_payment_id !== resumen.mp_payment_id),
    transferencias,
  });

  const concepto =
    guardado?.concepto ||
    deducirConcepto({
      montoBase,
      montoTotal: precio.total,
      montoReserva: montoDeLaSenia(precio.total, cobroConfig.porcentajeReserva),
      pagadoPrevio: pagadoOtros,
    });

  if (!guardado?.concepto || !Number.isFinite(Number(guardado?.monto_base))) {
    await completarDatosDePago(resumen.mp_payment_id, {
      concepto,
      monto_base: montoBase,
    });
  }

  const cobro = calcularCobro({
    precioTotal: precio.total,
    porcentajeReserva: cobroConfig.porcentajeReserva,
    pagadoBase: pagadoOtros + montoBase,
    modo: concepto === "reserva" ? "reserva" : "total",
  });

  const detalle = {
    concepto,
    monto: Number(resumen.monto),
    montoBase,
    recargo: Math.max(0, Number(resumen.monto) - montoBase),
    medio: claveMedio,
    medioTexto: medioTexto(claveMedio, resumen.cuotas),
    cuotas: resumen.cuotas,
    ultimosCuatro: resumen.ultimos_cuatro,
    referencia: resumen.mp_payment_id,
    fecha: resumen.aprobado_en || new Date().toISOString(),
  };

  if (concepto === "reserva") {
    await avisarSeniaPagada({ reserva, pago: detalle, cobro });
  } else {
    await avisarPagoCompletado({ reserva, pago: detalle, cobro });
  }
}

export default async function handler(req, res) {
  if (!exigirMetodo(req, res, "POST")) return;

  let dataId = "";

  try {
    const config = leerConfig();
    const body = leerBody(req);

    dataId = String(req.query?.["data.id"] || body?.data?.id || body?.id || "").trim();
    const tipo = String(req.query?.type || body?.type || body?.topic || "").trim();

    const firma = validarFirmaWebhook({
      signatureHeader: req.headers["x-signature"],
      requestId: req.headers["x-request-id"],
      dataId,
      secreto: config.mp.webhookSecret,
    });

    if (!firma.valido) {
      log.warn("webhook.firma_invalida", {
        data_id: dataId,
        tipo,
        motivo: firma.motivo,
        firma_ts: firma.ts ?? null,
        desfasaje_ms: firma.desfasaje_ms ?? null,
      });
      return json(res, 401, { error: "firma inválida" });
    }

    if (!TIPOS_DE_PAGO.has(tipo)) {
      log.info("webhook.ignorado", { tipo, data_id: dataId });
      return json(res, 200, { ok: true, ignorado: tipo || "sin tipo" });
    }

    let pago;
    try {
      pago = await consultarPago(dataId);
    } catch (error) {
      if (!esPagoInexistente(error)) throw error;

      log.warn("webhook.pago_inexistente", { data_id: dataId, tipo });
      return json(res, 200, { ok: true, ignorado: "pago inexistente" });
    }

    const resumen = resumirPago(pago);

    const refDeReserva = esUuid(resumen.external_reference) ? resumen.external_reference : null;
    if (!refDeReserva && resumen.external_reference) {
      log.warn("webhook.external_reference_desconocido", {
        payment_id: resumen.mp_payment_id,
        external_reference: resumen.external_reference,
      });
    }

    const [guardado, reservaViva] = await Promise.all([
      buscarPagoGuardado(resumen.mp_payment_id),
      refDeReserva ? existeReserva(refDeReserva) : Promise.resolve(false),
    ]);

    const bookingId = reservaViva ? refDeReserva : null;

    if (refDeReserva && !reservaViva) {
      log.warn("webhook.reserva_borrada", {
        payment_id: resumen.mp_payment_id,
        external_reference: refDeReserva,
      });
    }

    await guardarPago({ ...resumen, booking_id: bookingId });

    if (resumen.status === "approved" && bookingId && config.confirmarReservaAlAprobar) {
      await confirmarReserva(bookingId);
    }

    if (resumen.status === "approved" && bookingId) {
      await enSegundoPlano(
        "webhook.mails",
        () => avisarPorMail(resumen, bookingId, guardado),
        (error) =>
          log.error("webhook.mails_fallaron", error, {
            payment_id: resumen.mp_payment_id,
            ref: bookingId,
          }),
      );
    }

    log.info("webhook.procesado", {
      payment_id: resumen.mp_payment_id,
      status: resumen.status,
      status_detail: resumen.status_detail,
      ref: bookingId,

      demora_ms: demoraDesde(firma.ts),
    });

    return json(res, 200, { ok: true, status: resumen.status });
  } catch (error) {
    log.error("webhook.error", error, { data_id: dataId });
    return json(res, 500, { error: "no se pudo procesar la notificación" });
  }
}
