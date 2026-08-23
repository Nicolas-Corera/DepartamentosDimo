import { leerConfig } from "./_lib/env.js";
import { exigirMetodo, json, leerBody, manejarError, ErrorVisible } from "./_lib/http.js";
import {
  buscarReserva,
  guardarPago,
  confirmarReserva,
  buscarTarifasEspeciales,
  leerConfigTarifas,
  leerConfigDeCobro,
  pagosAprobados,
  transferenciasConfirmadas,
} from "./_lib/supabase.js";
import {
  calcularPrecio,
  calcularRecargo,
  planDeCuotas,
  maximoDeCuotas,
  medioDePago,
} from "./_lib/precios.js";
import { calcularCobro, sumarPagado, normalizarModo, etiquetaDeConcepto } from "./_lib/cobro.js";
import {
  crearPago,
  resumirPago,
  esPedidoDuplicado,
  buscarPagoPorReferencia,
  tipoDeTarjeta,
} from "./_lib/mercadopago.js";
import { mensajeDePago } from "./_lib/mensajes.js";
import { avisarSeniaPagada, avisarPagoCompletado, medioTexto } from "./_lib/mails.js";
import { enSegundoPlano } from "./_lib/segundo-plano.js";
import { log, ofuscarEmail } from "./_lib/log.js";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fechaCorta(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return String(iso);
  return `${m[3]} ${MESES[Number(m[2]) - 1]}`;
}

function diaDeSalida(ultimaNoche) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ultimaNoche));
  if (!m) return String(ultimaNoche);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

const PREFIJOS = {
  reserva: "Seña reserva Dimo",
  saldo: "Saldo reserva Dimo",
  total: "Reserva Dimo",
};

function textoDescripcion(reserva, concepto, cuotas) {
  const base = `${PREFIJOS[concepto] || PREFIJOS.total} ${fechaCorta(reserva.check_in)} al ${fechaCorta(diaDeSalida(reserva.check_out))}`;
  return cuotas > 1 ? `${base} (${cuotas} cuotas)` : base;
}

function validarFormData(formData, maxCuotas) {
  if (!formData || typeof formData !== "object") {
    throw new ErrorVisible(400, "No recibimos los datos del formulario de pago.", "form_vacio");
  }

  const token = String(formData.token || "").trim();
  if (!token) {
    throw new ErrorVisible(
      400,
      "El formulario de pago expiró. Recargá la página y volvé a cargar la tarjeta.",
      "sin_token",
    );
  }

  const paymentMethodId = String(formData.payment_method_id || "").trim();
  if (!paymentMethodId) {
    throw new ErrorVisible(
      400,
      "No pudimos identificar el tipo de tarjeta. Revisá el número e intentá de nuevo.",
      "sin_medio_de_pago",
    );
  }

  const cuotas = Number(formData.installments || 1);
  if (!Number.isInteger(cuotas) || cuotas < 1 || cuotas > maxCuotas) {
    throw new ErrorVisible(
      400,
      "La cantidad de cuotas no es válida. Elegí otra y volvé a intentar.",
      "cuotas_invalidas",
    );
  }

  return {
    token,
    paymentMethodId,
    cuotas,
    issuerId: formData.issuer_id ? String(formData.issuer_id) : null,
    email: String(formData.payer?.email || "").trim().toLowerCase(),
    identificacion: formData.payer?.identification || null,
  };
}

export default async function handler(req, res) {
  if (!exigirMetodo(req, res, "POST")) return;

  let ref = "";

  try {
    const config = leerConfig();
    const body = leerBody(req);
    ref = String(body.ref || "").trim();
    const modo = normalizarModo(body.modo);

    const reserva = await buscarReserva(ref);

    const [tarifasConfig, especiales, cobroConfig] = await Promise.all([
      leerConfigTarifas(),
      buscarTarifasEspeciales(reserva.check_in, reserva.check_out),
      leerConfigDeCobro(),
    ]);

    const datos = validarFormData(body.formData, maximoDeCuotas(tarifasConfig.planes));
    const precio = calcularPrecio(reserva, tarifasConfig.temporadas, especiales, cobroConfig.tarifaLimpieza);

    const [pagosPrevios, transferencias] = await Promise.all([
      pagosAprobados(reserva.id),
      transferenciasConfirmadas(reserva.id),
    ]);

    const cobro = calcularCobro({
      precioTotal: precio.total,
      porcentajeReserva: cobroConfig.porcentajeReserva,
      pagadoBase: sumarPagado({ pagos: pagosPrevios, transferencias }),
      modo,
    });

    if (cobro.yaPagada) {
      throw new ErrorVisible(
        409,
        "Esta reserva ya está paga por completo. Si creés que es un error, escribinos antes de volver a intentar.",
        "ya_pagada",
      );
    }

    const claveMedio = await tipoDeTarjeta(datos.paymentMethodId);
    const medio = medioDePago(claveMedio, tarifasConfig.medios);
    if (!medio) {
      throw new ErrorVisible(
        400,
        "Ese medio de pago no está habilitado en este momento. Probá con otro.",
        "medio_deshabilitado",
      );
    }

    const plan = claveMedio === "credito" ? planDeCuotas(datos.cuotas, tarifasConfig.planes) : null;
    if (claveMedio === "credito" && datos.cuotas > 1 && !plan) {
      throw new ErrorVisible(
        400,
        "Esa cantidad de cuotas no está disponible. Elegí otra y volvé a intentar.",
        "cuotas_invalidas",
      );
    }

    const importe = calcularRecargo(cobro.aCobrarBase, medio, plan);
    const cuotasACobrar = claveMedio === "credito" ? datos.cuotas : 1;

    log.info("pago.intento", {
      ref: reserva.id,
      modo,
      concepto: cobro.concepto,
      base: importe.totalBase,
      recargo_porcentaje: importe.recargoPorcentaje,
      monto: importe.total,
      medio: claveMedio,
      cuotas: cuotasACobrar,
      payment_method_id: datos.paymentMethodId,
      email: ofuscarEmail(datos.email || reserva.email),
    });

    let pago;
    try {
      pago = await crearPago({
        ref: reserva.id,
        monto: importe.total,
        cuotas: cuotasACobrar,
        token: datos.token,
        paymentMethodId: datos.paymentMethodId,
        issuerId: datos.issuerId,
        descripcion: textoDescripcion(reserva, cobro.concepto, cuotasACobrar),
        pagador: {
          email: datos.email || reserva.email,
          identificacion: datos.identificacion || { type: "DNI", number: reserva.dni },
          nombre: reserva.nombre?.split(" ")[0] || null,
        },
      });
    } catch (error) {
      if (!esPedidoDuplicado(error)) throw error;

      log.warn("pago.duplicado_recuperando", { ref: reserva.id, monto: importe.total });
      pago = await buscarPagoPorReferencia(reserva.id, importe.total);

      if (!pago) {
        throw new ErrorVisible(
          409,
          "Ya recibimos tu pago y lo estamos confirmando. No vuelvas a pagar: " +
            "en unos minutos te llega el mail con el comprobante.",
          "pago_en_curso",
        );
      }
      log.info("pago.duplicado_resuelto", { ref: reserva.id, payment_id: pago.id });
    }

    const resumen = resumirPago(pago);
    const aprobado = resumen.status === "approved";

    try {
      await guardarPago({
        ...resumen,
        booking_id: reserva.id,
        concepto: cobro.concepto,
        monto_base: importe.totalBase,
      });

      if (aprobado && config.confirmarReservaAlAprobar) {
        await confirmarReserva(reserva.id);
      }
    } catch (error) {
      log.error("pago.no_se_pudo_registrar", error, {
        ref: reserva.id,
        payment_id: resumen.mp_payment_id,
        status: resumen.status,
      });
    }

    const cobroFinal = calcularCobro({
      precioTotal: precio.total,
      porcentajeReserva: cobroConfig.porcentajeReserva,
      pagadoBase: cobro.pagado + (aprobado ? importe.totalBase : 0),
      modo,
    });

    if (aprobado) {
      const detalle = {
        concepto: cobro.concepto,
        monto: importe.total,
        montoBase: importe.totalBase,
        recargo: importe.recargo,
        medio: claveMedio,
        medioTexto: medioTexto(claveMedio, cuotasACobrar),
        cuotas: cuotasACobrar,
        ultimosCuatro: resumen.ultimos_cuatro,
        referencia: resumen.mp_payment_id,
        fecha: resumen.aprobado_en || new Date().toISOString(),
      };

      await enSegundoPlano(
        "pago.mails",
        () =>
          cobro.concepto === "reserva"
            ? avisarSeniaPagada({ reserva, pago: detalle, cobro: cobroFinal })
            : avisarPagoCompletado({ reserva, pago: detalle, cobro: cobroFinal }),
        (error) =>
          log.error("pago.mails_fallaron", error, {
            ref: reserva.id,
            payment_id: resumen.mp_payment_id,
          }),
      );
    }

    const mensaje = mensajeDePago(resumen.status, resumen.status_detail);

    log.info("pago.resultado", {
      ref: reserva.id,
      payment_id: resumen.mp_payment_id,
      concepto: cobro.concepto,
      status: resumen.status,
      status_detail: resumen.status_detail,
      saldo: cobroFinal.saldo,
    });

    json(res, 200, {
      paymentId: resumen.mp_payment_id,
      status: resumen.status,
      statusDetail: resumen.status_detail,
      monto: resumen.monto,
      cuotas: resumen.cuotas,
      ultimosCuatro: resumen.ultimos_cuatro,
      recargo: importe.recargo,
      recargoPorcentaje: importe.recargoPorcentaje,
      concepto: cobro.concepto,
      etiqueta: etiquetaDeConcepto(cobro.concepto),

      cobro: {
        montoTotal: cobroFinal.montoTotal,
        pagado: cobroFinal.pagado,
        saldo: cobroFinal.saldo,
        completa: cobroFinal.saldo <= 0,
      },

      mensaje,
    });
  } catch (error) {
    const status = error?.status || error?.statusCode;
    if (status === 400 && !(error instanceof ErrorVisible)) {
      log.error("pago.rechazado_por_api", error, { ref });
      return json(res, 400, {
        error:
          "MercadoPago no aceptó la operación. Revisá los datos de la tarjeta y volvé a intentar.",
        codigo: "api_rechazo",
        mensaje: {
          titulo: "No pudimos procesar el pago",
          detalle:
            "MercadoPago rechazó la operación antes de cobrarla. Revisá los datos de la tarjeta y probá de nuevo.",
          accion: "reintentar",
          grupo: "rechazado",
        },
      });
    }
    manejarError(res, "pago", error, { ref });
  }
}
