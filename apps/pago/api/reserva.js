import { leerConfig } from "./_lib/env.js";
import { exigirMetodo, json, manejarError, ErrorVisible } from "./_lib/http.js";
import {
  buscarReserva,
  tienePagoAprobado,
  buscarTarifasEspeciales,
  leerConfigTarifas,
  ultimoComprobante,
} from "./_lib/supabase.js";
import { calcularPrecio, calcularRecargo, maximoDeCuotas } from "./_lib/precios.js";
import { log } from "./_lib/log.js";

function enmascararDni(dni) {
  const limpio = String(dni || "");
  if (limpio.length < 4) return "•••";
  return `•••••${limpio.slice(-3)}`;
}

export default async function handler(req, res) {
  if (!exigirMetodo(req, res, "GET")) return;

  const ref = String(req.query?.ref || "").trim();

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
    const [tarifasConfig, especiales] = await Promise.all([
      leerConfigTarifas(),
      buscarTarifasEspeciales(reserva.check_in, reserva.check_out),
    ]);

    const precio = calcularPrecio(reserva, tarifasConfig.temporadas, especiales);
    const [pagoAprobado, comprobante] = await Promise.all([
      tienePagoAprobado(reserva.id),
      ultimoComprobante(reserva.id),
    ]);

    const planesHabilitados = tarifasConfig.planes.filter((p) => p.habilitado);
    const medios = tarifasConfig.medios
      .filter((m) => m.habilitado)
      .map((m) => {
        const base = calcularRecargo(precio.total, m, null);
        return {
          clave: m.clave,
          nombre: m.nombre,
          recargoPorcentaje: m.recargo_porcentaje,
          total: base.total,
          recargo: base.recargo,

          planes:
            m.clave === "credito"
              ? planesHabilitados.map((p) => {
                  const conPlan = calcularRecargo(precio.total, m, p);
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
      noches: precio.cantidadNoches,
      base: precio.total,
      tarifa_uniforme: precio.tarifaUniforme,
      especiales: precio.noches.filter((n) => n.motivo).length,
      ya_pagada: Boolean(pagoAprobado),
    });

    json(res, 200, {
      publicKey: config.mp.publicKey,

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
      pago: pagoAprobado
        ? { yaPagada: true, paymentId: pagoAprobado.mp_payment_id, monto: pagoAprobado.monto }
        : { yaPagada: false },

      transferencia: comprobante,
    });
  } catch (error) {
    manejarError(res, "reserva", error, { ref });
  }
}
