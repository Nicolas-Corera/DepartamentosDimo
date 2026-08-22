import { leerConfig } from "./_lib/env.js";
import { exigirMetodo, json, manejarError, ErrorVisible } from "./_lib/http.js";
import {
  buscarReserva,
  buscarTarifasEspeciales,
  leerConfigTarifas,
  leerConfigDeCobro,
  pagosAprobados,
  transferenciasConfirmadas,
  ultimoComprobante,
} from "./_lib/supabase.js";
import { calcularPrecio, calcularRecargo, maximoDeCuotas } from "./_lib/precios.js";
import { calcularCobro, sumarPagado, normalizarModo, etiquetaDeConcepto } from "./_lib/cobro.js";
import { log } from "./_lib/log.js";

function enmascararDni(dni) {
  const limpio = String(dni || "");
  if (limpio.length < 4) return "•••";
  return `•••••${limpio.slice(-3)}`;
}

export default async function handler(req, res) {
  if (!exigirMetodo(req, res, "GET")) return;

  const ref = String(req.query?.ref || "").trim();
  const modo = normalizarModo(req.query?.modo);

  try {
    if (!ref) {
      throw new ErrorVisible(
        400,
        "Falta el código de reserva. Entrá con el link que te enviamos por mail.",
        "sin_ref",
      );
    }

    const config = leerConfig();
    const reserva = await buscarReserva(ref);

    const [tarifasConfig, especiales, cobroConfig] = await Promise.all([
      leerConfigTarifas(),
      buscarTarifasEspeciales(reserva.check_in, reserva.check_out),
      leerConfigDeCobro(),
    ]);

    const precio = calcularPrecio(reserva, tarifasConfig.temporadas, especiales, cobroConfig.tarifaLimpieza);

    const [pagos, transferencias, comprobante] = await Promise.all([
      pagosAprobados(reserva.id),
      transferenciasConfirmadas(reserva.id),
      ultimoComprobante(reserva.id),
    ]);

    const cobro = calcularCobro({
      precioTotal: precio.total,
      porcentajeReserva: cobroConfig.porcentajeReserva,
      pagadoBase: sumarPagado({ pagos, transferencias }),
      modo,
    });

    const planesHabilitados = tarifasConfig.planes.filter((p) => p.habilitado);

    const medios = tarifasConfig.medios
      .filter((m) => m.habilitado)
      .map((m) => {
        const base = calcularRecargo(cobro.aCobrarBase, m, null);
        return {
          clave: m.clave,
          nombre: m.nombre,
          recargoPorcentaje: m.recargo_porcentaje,
          total: base.total,
          recargo: base.recargo,

          planes:
            m.clave === "credito"
              ? planesHabilitados.map((p) => {
                  const conPlan = calcularRecargo(cobro.aCobrarBase, m, p);
                  return {
                    cuotas: p.cuotas,
                    recargoPorcentaje: conPlan.recargoPorcentaje,
                    total: conPlan.total,
                    recargo: conPlan.recargo,
                    valorCuota: conPlan.valorCuota,
                  };
                })
              : [],
        };
      });

    if (precio.nochesSinTemporada > 0) {
      log.warn("reserva.noches_sin_temporada", {
        ref: reserva.id,
        noches: precio.nochesSinTemporada,
      });
    }

    log.info("reserva.consultada", {
      ref: reserva.id,
      modo,
      concepto: cobro.concepto,
      noches: precio.cantidadNoches,
      base: precio.total,
      pagado: cobro.pagado,
      a_cobrar: cobro.aCobrarBase,
      ya_pagada: cobro.yaPagada,
    });

    json(res, 200, {
      publicKey: config.mp.publicKey,

      contacto: {
        mail: config.mails.contacto.mail,
        whatsapp: config.mails.contacto.whatsapp,
      },

      supabaseUrl: config.supabase.url,
      maxCuotas: maximoDeCuotas(tarifasConfig.planes),
      reserva: {
        id: reserva.id,
        nombre: reserva.nombre,
        email: reserva.email,
        dni: enmascararDni(reserva.dni),
        checkIn: reserva.check_in,
        checkOut: reserva.check_out,
        personas: reserva.personas,
        adultos: reserva.adultos,
        ninos: reserva.ninos,
        estado: reserva.estado,
      },
      precio,
      medios,

      cobro: {
        modo: cobro.modo,
        concepto: cobro.concepto,
        etiqueta: etiquetaDeConcepto(cobro.concepto),
        porcentajeReserva: cobro.porcentajeReserva,
        montoTotal: cobro.montoTotal,
        montoReserva: cobro.montoReserva,
        pagado: cobro.pagado,
        saldo: cobro.saldo,
        aCobrarBase: cobro.aCobrarBase,
        esParcial: cobro.esParcial,
        seniaCubierta: cobro.seniaCubierta,
      },

      pagos: pagos.map((p) => ({
        referencia: p.mp_payment_id,
        concepto: p.concepto,
        monto: Number(p.monto),
        montoBase: Number(p.monto_base ?? p.monto),
        fecha: p.aprobado_en || p.created_at,
        medio: p.metodo,
      })),

      pago: cobro.yaPagada
        ? { yaPagada: true, monto: cobro.pagado }
        : { yaPagada: false },

      transferencia: comprobante,
    });
  } catch (error) {
    manejarError(res, "reserva", error, { ref });
  }
}
