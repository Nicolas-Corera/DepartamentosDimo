/**
 * GET /api/reserva?ref=<uuid>
 * ---------------------------------------------------------------------------
 * Lo primero que pide la página: con el código de reserva del link devuelve el
 * resumen, el precio base ya calculado, los medios de pago habilitados con su
 * recargo, los planes de cuotas y la Public Key para montar el Brick.
 *
 * Por qué devuelve los recargos y no un solo monto: el total depende de con qué
 * vaya a pagar, y eso se elige en la página. Se manda la tabla entera para que
 * el resumen pueda mostrar el total de cada pestaña sin ir y volver al servidor
 * en cada clic. El monto que se cobra igual lo recalcula `/api/pagos`: esto es
 * para mostrar.
 *
 * Qué NO devuelve: el DNI completo (va enmascarado) ni el Access Token. El mail
 * sí, porque es el de quien reserva y sirve para precargar el formulario — el
 * link con el uuid ya es la credencial de acceso a esa reserva.
 */

import { leerConfig } from "./_lib/env.js";
import { exigirMetodo, json, manejarError, ErrorVisible } from "./_lib/http.js";
import {
  buscarReserva,
  tienePagoAprobado,
  buscarTarifasEspeciales,
  leerConfigTarifas,
} from "./_lib/supabase.js";
import { calcularPrecio, calcularRecargo, maximoDeCuotas } from "./_lib/precios.js";
import { log } from "./_lib/log.js";

/** "32456789" -> "•••••789". Alcanza para que la persona se reconozca. */
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
    const pagoAprobado = await tienePagoAprobado(reserva.id);

    // El total de cada pestaña, precalculado. Transferencia y débito son un
    // solo pago; crédito trae además el desglose de cada plan de cuotas.
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
          // Solo el crédito ofrece cuotas. Para el resto la lista queda vacía y
          // la página no dibuja el selector.
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
      // No rompe el pago (se cobró al precio de temporada baja), pero significa
      // que hay un hueco en la configuración y se está cobrando por defecto.
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
      // Para subir el comprobante de transferencia el navegador le pega directo
      // a Storage con una URL firmada, así que necesita saber a qué host. Es un
      // dato público: es la misma URL que ya está en el JS del sitio principal.
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
    });
  } catch (error) {
    manejarError(res, "reserva", error, { ref });
  }
}
