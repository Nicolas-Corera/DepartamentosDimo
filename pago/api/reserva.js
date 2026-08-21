/**
 * GET /api/reserva?ref=<uuid>
 * ---------------------------------------------------------------------------
 * Lo primero que pide la página: con el código de reserva del link devuelve el
 * resumen, el monto ya calculado y la Public Key para montar el Brick.
 *
 * Por qué la Public Key sale de acá y no de un archivo generado en el build:
 * ya hay un backend, así que no hace falta inventar un paso de build ni dejar
 * la clave escrita en el repo. Un endpoint menos que mantener.
 *
 * Qué NO devuelve: el DNI completo (va enmascarado) ni el Access Token. El mail
 * sí, porque es el de quien reserva y sirve para precargar el formulario — el
 * link con el uuid ya es la credencial de acceso a esa reserva.
 */

import { leerConfig } from "./_lib/env.js";
import { exigirMetodo, json, manejarError, ErrorVisible } from "./_lib/http.js";
import { buscarReserva, tienePagoAprobado, buscarTarifasEspeciales } from "./_lib/supabase.js";
import { calcularPrecio } from "./_lib/precios.js";
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
    const tarifas = await buscarTarifasEspeciales(reserva.check_in, reserva.check_out);
    const precio = calcularPrecio(reserva, config.precios, tarifas);
    const pagoAprobado = await tienePagoAprobado(reserva.id);

    log.info("reserva.consultada", {
      ref: reserva.id,
      noches: precio.cantidadNoches,
      monto: precio.aCobrar,
      tarifa_uniforme: precio.tarifaUniforme,
      especiales: precio.noches.filter((n) => n.motivo).length,
      ya_pagada: Boolean(pagoAprobado),
    });

    json(res, 200, {
      publicKey: config.mp.publicKey,
      maxCuotas: config.mp.maxCuotas,
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
      pago: pagoAprobado
        ? { yaPagada: true, paymentId: pagoAprobado.mp_payment_id, monto: pagoAprobado.monto }
        : { yaPagada: false },
    });
  } catch (error) {
    manejarError(res, "reserva", error, { ref });
  }
}
