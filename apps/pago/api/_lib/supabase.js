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

export async function buscarReserva(id) {
  if (!esUuid(id)) {
    throw new ErrorVisible(400, "El código de reserva no es válido.", "ref_invalida");
  }

  const { data, error } = await db()
    .from("booking_requests")
    .select(
      "id, nombre, email, dni, telefono, procedencia, check_in, check_out, " +
        "personas, adultos, ninos, edades_ninos, vehiculo, vehiculo_marca, " +
        "vehiculo_modelo, vehiculo_tipo, vehiculo_anio, mensaje, estado",
    )
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

export async function buscarTarifasEspeciales(checkIn, checkOut) {
  const { data, error } = await db()
    .from("tarifas_especiales")
    .select("fecha_desde, fecha_hasta, precio_por_noche, motivo")
    .lte("fecha_desde", checkOut)
    .gte("fecha_hasta", checkIn);

  if (error) {
    log.error("supabase.buscarTarifasEspeciales", error, { checkIn, checkOut });
    return [];
  }
  return data || [];
}

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

export async function tienePagoAprobado(bookingId) {
  const { data, error } = await db()
    .from("payments")
    .select("mp_payment_id, monto, created_at")
    .eq("booking_id", bookingId)
    .eq("status", "approved")
    .limit(1);

  if (error) {
    log.error("supabase.tienePagoAprobado", error, { ref: bookingId });
    return null;
  }
  return data?.[0] || null;
}

export async function confirmarReserva(bookingId) {
  const { error } = await db()
    .from("booking_requests")
    .update({ estado: "confirmada" })
    .eq("id", bookingId)
    .neq("estado", "confirmada");

  if (error) {
    log.error("supabase.confirmarReserva", error, { ref: bookingId });
    return false;
  }
  return true;
}

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

export async function ultimoComprobante(bookingId) {
  const { data, error } = await db()
    .from("transfer_receipts")
    .select("id, estado, monto_declarado, created_at, revisado_en")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    log.warn("supabase.ultimoComprobante", { ref: bookingId, motivo: error.message });
    return null;
  }

  const fila = data?.[0];
  if (!fila) return null;

  return {
    id: fila.id,
    estado: fila.estado,
    monto: Number(fila.monto_declarado || 0),
    subidoEn: fila.created_at,
    revisadoEn: fila.revisado_en,
  };
}

const BUCKET = "comprobantes";

export async function firmarSubidaDeComprobante(path) {
  const { data, error } = await db().storage.from(BUCKET).createSignedUploadUrl(path);

  if (error) {
    log.error("supabase.firmarSubidaDeComprobante", error, { path });
    throw new Error(`No se pudo preparar la subida del comprobante: ${error.message}`);
  }
  return { path: data.path, token: data.token };
}

export async function leerObjetoDeComprobante(path) {
  const { data, error } = await db().storage.from(BUCKET).info(path);

  if (error) {
    if (error.statusCode === "404" || error.status === 404) return null;
    log.error("supabase.leerObjetoDeComprobante", error, { path });
    throw new Error(`No se pudo verificar el comprobante: ${error.message}`);
  }
  if (!data) return null;

  return {
    mime: data.contentType || data.metadata?.mimetype || "",
    bytes: Number(data.size ?? data.metadata?.size ?? 0),
  };
}

export async function borrarComprobante(path) {
  const { error } = await db().storage.from(BUCKET).remove([path]);
  if (error) log.warn("supabase.borrarComprobante", { path, motivo: error.message });
}

export async function guardarComprobante(fila) {
  const { data, error } = await db()
    .from("transfer_receipts")
    .insert(fila)
    .select("id, created_at")
    .single();

  if (error) {
    log.error("supabase.guardarComprobante", error, { path: fila.path });
    throw new Error(`No se pudo registrar el comprobante: ${error.message}`);
  }
  return data;
}

export async function leerPorcentajeDeReserva() {
  const { data, error } = await db()
    .from("configuracion_pagos")
    .select("porcentaje_reserva")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    log.error("supabase.leerPorcentajeDeReserva", error, {});
    throw new Error(
      `No se pudo leer la configuración de cobro: ${error.message}. ` +
        "Corré sql/fase4-pagos-y-mails.sql en Supabase.",
    );
  }

  const pct = Number(data?.porcentaje_reserva);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
    throw new Error(
      "configuracion_pagos.porcentaje_reserva no es un porcentaje válido. " +
        "Revisalo en el panel, pestaña Tarifas.",
    );
  }
  return pct;
}

export async function pagosAprobados(bookingId) {
  const { data, error } = await db()
    .from("payments")
    .select("mp_payment_id, monto, monto_base, concepto, metodo, cuotas, aprobado_en, created_at")
    .eq("booking_id", bookingId)
    .eq("status", "approved")
    .order("created_at", { ascending: true });

  if (error) {
    log.error("supabase.pagosAprobados", error, { ref: bookingId });
    throw new Error(`No se pudieron leer los pagos de la reserva: ${error.message}`);
  }
  return data || [];
}

export async function transferenciasConfirmadas(bookingId) {
  const { data, error } = await db()
    .from("transfer_receipts")
    .select("id, monto_declarado, monto_base, concepto, created_at, revisado_en")
    .eq("booking_id", bookingId)
    .eq("estado", "confirmado")
    .order("created_at", { ascending: true });

  if (error) {
    log.error("supabase.transferenciasConfirmadas", error, { ref: bookingId });
    throw new Error(`No se pudieron leer las transferencias de la reserva: ${error.message}`);
  }
  return data || [];
}

export async function reservarEnvioDeMail(clave, tipo, destinatarios) {
  const { error } = await db()
    .from("emails_enviados")
    .insert({ clave, tipo, destinatarios });

  if (!error) return true;

  if (error.code === "23505") return false;

  log.warn("supabase.reservarEnvioDeMail", { clave, motivo: error.message });
  return false;
}

export async function anotarResultadoDeMail(clave, { resendId, error }) {
  const { error: falla } = await db()
    .from("emails_enviados")
    .update({ resend_id: resendId || null, error: error || null })
    .eq("clave", clave);

  if (falla) log.warn("supabase.anotarResultadoDeMail", { clave, motivo: falla.message });
}

export async function liberarEnvioDeMail(clave) {
  const { error } = await db().from("emails_enviados").delete().eq("clave", clave);
  if (error) log.warn("supabase.liberarEnvioDeMail", { clave, motivo: error.message });
}

export async function descargarComprobante(path) {
  const { data, error } = await db().storage.from(BUCKET).download(path);

  if (error) {
    log.warn("supabase.descargarComprobante", { path, motivo: error.message });
    return null;
  }
  return Buffer.from(await data.arrayBuffer());
}

export async function marcarComprobanteConCobro(id, { concepto, montoBase }) {
  const { error } = await db()
    .from("transfer_receipts")
    .update({ concepto, monto_base: montoBase })
    .eq("id", id);

  if (error) log.warn("supabase.marcarComprobanteConCobro", { id, motivo: error.message });
}

export async function buscarPagoGuardado(mpPaymentId) {
  const { data, error } = await db()
    .from("payments")
    .select("mp_payment_id, booking_id, status, monto, monto_base, concepto, metodo, cuotas, aprobado_en, created_at")
    .eq("mp_payment_id", String(mpPaymentId))
    .maybeSingle();

  if (error) {
    log.warn("supabase.buscarPagoGuardado", { mp_payment_id: mpPaymentId, motivo: error.message });
    return null;
  }
  return data;
}

export async function completarDatosDePago(mpPaymentId, cambios) {
  const { error } = await db()
    .from("payments")
    .update(cambios)
    .eq("mp_payment_id", String(mpPaymentId));

  if (error) log.warn("supabase.completarDatosDePago", { mp_payment_id: mpPaymentId, motivo: error.message });
}
