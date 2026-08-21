/**
 * api/_lib/supabase.js
 * ---------------------------------------------------------------------------
 * Cliente de Supabase con la clave service_role. Solo backend.
 *
 * Por qué service_role y no la anon: `booking_requests` es una tabla solo-alta
 * (el sitio inserta y nada más; no hay política de SELECT y encima se revocaron
 * los permisos de lectura para `anon`). Para leer la reserva y calcular el monto
 * hace falta saltear RLS, y eso solo lo hace la service_role. Ver SUPABASE.md.
 *
 * Esta clave NUNCA sale de acá: no se manda al navegador, no se loguea.
 */

import { createClient } from "@supabase/supabase-js";
import { leerConfig } from "./env.js";
import { log } from "./log.js";
import { ErrorVisible } from "./http.js";

let cliente = null;

export function db() {
  if (cliente) return cliente;
  const { supabase } = leerConfig();
  cliente = createClient(supabase.url, supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Client-Info": "dimo-pagos/1.0" } },
  });
  return cliente;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function esUuid(valor) {
  return typeof valor === "string" && UUID_RE.test(valor.trim());
}

/**
 * Trae la reserva por id. Devuelve solo las columnas que se usan: no hace falta
 * arrastrar el vehículo ni el mensaje hasta acá.
 */
export async function buscarReserva(id) {
  if (!esUuid(id)) {
    throw new ErrorVisible(400, "El código de reserva no es válido.", "ref_invalida");
  }

  const { data, error } = await db()
    .from("booking_requests")
    .select("id, nombre, email, dni, check_in, check_out, personas, adultos, ninos, estado")
    .eq("id", id.trim())
    .maybeSingle();

  if (error) {
    log.error("supabase.buscarReserva", error, { ref: id });
    throw new Error(`No se pudo leer la reserva: ${error.message}`);
  }
  if (!data) {
    throw new ErrorVisible(
      404,
      "No encontramos esa reserva. Revisá que el link sea el que te enviamos.",
      "reserva_inexistente",
    );
  }
  return data;
}

/**
 * Las tarifas especiales que se solapan con el rango de la estadía.
 *
 * Se filtra en la base y no en memoria: la tabla puede tener años de fines de
 * semana largo cargados y a una reserva de 5 noches le tocan una o ninguna.
 *
 * El solapamiento es la condición clásica de dos rangos: empieza antes de que
 * termine la estadía Y termina después de que empiece.
 */
export async function buscarTarifasEspeciales(checkIn, checkOut) {
  const { data, error } = await db()
    .from("tarifas_especiales")
    .select("fecha_desde, fecha_hasta, precio_por_noche, motivo")
    .lte("fecha_desde", checkOut)
    .gte("fecha_hasta", checkIn);

  if (error) {
    // No es fatal: sin tarifas especiales el precio sale por temporada. Pero se
    // grita en el log, porque significa cobrar un fin de semana largo barato.
    log.error("supabase.buscarTarifasEspeciales", error, { checkIn, checkOut });
    return [];
  }
  return data || [];
}

/**
 * Guarda o actualiza el pago. Es idempotente por `mp_payment_id`: el webhook
 * puede llegar varias veces (MercadoPago reintenta) y siempre termina en la
 * misma fila. El último estado consultado a la API pisa al anterior.
 */
export async function guardarPago(fila) {
  const { data, error } = await db()
    .from("payments")
    .upsert({ ...fila, updated_at: new Date().toISOString() }, { onConflict: "mp_payment_id" })
    .select("id, mp_payment_id, status")
    .single();

  if (error) {
    log.error("supabase.guardarPago", error, { mp_payment_id: fila.mp_payment_id });
    throw new Error(`No se pudo guardar el pago: ${error.message}`);
  }
  return data;
}

/** ¿Esta reserva ya tiene un pago aprobado? Evita cobrar dos veces lo mismo. */
export async function tienePagoAprobado(bookingId) {
  const { data, error } = await db()
    .from("payments")
    .select("mp_payment_id, monto, created_at")
    .eq("booking_id", bookingId)
    .eq("status", "approved")
    .limit(1);

  if (error) {
    log.error("supabase.tienePagoAprobado", error, { ref: bookingId });
    return null; // Ante la duda no bloqueamos el pago: peor es no poder pagar.
  }
  return data?.[0] || null;
}

/**
 * Marca la reserva como confirmada cuando el pago se aprueba.
 * Se puede apagar con CONFIRMAR_RESERVA_AL_APROBAR=false si preferís
 * confirmarlas a mano desde el panel de Supabase.
 */
export async function confirmarReserva(bookingId) {
  const { error } = await db()
    .from("booking_requests")
    .update({ estado: "confirmada" })
    .eq("id", bookingId)
    .neq("estado", "confirmada");

  if (error) {
    // No es fatal: el pago ya está cobrado y registrado en `payments`.
    // Se avisa fuerte para poder corregirlo a mano.
    log.error("supabase.confirmarReserva", error, { ref: bookingId });
    return false;
  }
  return true;
}

/* ===========================================================================
   Configuración de tarifas
   ---------------------------------------------------------------------------
   Los precios ya no están en variables de entorno: viven en tres tablas que se
   editan desde el dashboard. Se leen en cada pedido, sin caché.

   Sin caché a propósito: son tres SELECT de menos de 30 filas contra un índice
   primario, y el proceso serverless se recicla cada dos por tres, así que una
   caché en memoria acertaría poco y agregaría el peor de los bugs posibles —
   que cambies un precio en el dashboard y siga cobrando el viejo sin que se
   entienda por qué.
   =========================================================================== */

/**
 * Las temporadas, los medios de pago y los planes de cuotas, en una sola vuelta.
 *
 * Si alguna consulta falla se corta con un error: a diferencia de las tarifas
 * especiales (donde seguir de largo solo significa cobrar un fin de semana
 * largo a precio de semana), sin temporadas no hay precio que calcular y
 * seguir sería inventar un monto.
 */
export async function leerConfigTarifas() {
  const [temporadas, medios, planes] = await Promise.all([
    db().from("temporadas").select("clave, nombre, fecha_desde, fecha_hasta, precio_por_noche, orden").order("orden"),
    db().from("medios_pago").select("clave, nombre, habilitado, recargo_porcentaje, orden").order("orden"),
    db().from("planes_cuotas").select("cuotas, habilitado, recargo_porcentaje").order("cuotas"),
  ]);

  for (const [nombre, r] of [["temporadas", temporadas], ["medios_pago", medios], ["planes_cuotas", planes]]) {
    if (r.error) {
      log.error("supabase.leerConfigTarifas", r.error, { tabla: nombre });
      throw new Error(`No se pudo leer la configuración de tarifas (${nombre}): ${r.error.message}`);
    }
  }

  if (!temporadas.data?.length) {
    throw new Error(
      "La tabla `temporadas` está vacía. Corré pago/sql/configuracion-tarifas.sql en Supabase.",
    );
  }

  return {
    temporadas: temporadas.data,
    // Los porcentajes llegan como string desde PostgREST (numeric), y sumarlos
    // como texto da "0.008.00". Se normalizan una sola vez, acá.
    medios: (medios.data || []).map((m) => ({
      ...m,
      recargo_porcentaje: Number(m.recargo_porcentaje),
    })),
    planes: (planes.data || []).map((p) => ({
      ...p,
      cuotas: Number(p.cuotas),
      recargo_porcentaje: Number(p.recargo_porcentaje),
    })),
  };
}
