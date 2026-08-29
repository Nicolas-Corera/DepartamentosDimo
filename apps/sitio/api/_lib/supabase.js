import { leerConfig } from "./env.js";

const TIEMPO_LIMITE_MS = 12_000;

async function pedir(ruta, opciones = {}) {
  const { supabase } = leerConfig();

  const arranque = Date.now();

  let respuesta;
  try {
    respuesta = await fetch(`${supabase.url}/rest/v1/${ruta}`, {
      ...opciones,
      headers: {
        apikey: supabase.serviceRoleKey,
        Authorization: `Bearer ${supabase.serviceRoleKey}`,
        "Content-Type": "application/json",
        ...opciones.headers,
      },
      signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
    });
  } catch (falla) {
    const segundos = ((Date.now() - arranque) / 1000).toFixed(1);
    const metodo = opciones.method || "GET";
    throw new Error(
      `No se pudo hablar con Supabase (${metodo} ${ruta.split("?")[0]}) ` +
        `despues de ${segundos}s: ${falla.message}`,
    );
  }

  const texto = await respuesta.text();

  if (!respuesta.ok) {
    let detalle = texto;
    let codigo = "";
    try {
      const j = JSON.parse(texto);
      detalle = j.message || j.error || j.hint || texto;
      codigo = j.code || "";
    } catch {
    }

    const error = new Error(`Supabase (${respuesta.status}): ${detalle}`);
    error.codigoPostgres = codigo;
    error.status = respuesta.status;
    throw error;
  }

  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

export function seleccionar(tabla, consulta = "select=*") {
  return pedir(`${tabla}?${consulta}`);
}

export async function fechasOcupadas() {
  const filas = await pedir("rpc/fechas_ocupadas", {
    method: "POST",
    body: "{}",
  });
  return (filas || []).map((f) => ({ check_in: f.check_in, check_out: f.check_out }));
}

export async function contarDesde(tabla, desdeISO, tope) {
  const filas = await pedir(
    `${tabla}?select=created_at&created_at=gte.${encodeURIComponent(desdeISO)}&limit=${tope}`,
  );
  return filas?.length || 0;
}

export async function insertarConsulta(fila) {
  const filas = await pedir("booking_requests", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(fila),
  });
  return filas?.[0] || null;
}

export async function leerConfigTarifas() {
  const [temporadas, medios, planes] = await Promise.all([
    seleccionar(
      "temporadas",
      "select=clave,nombre,fecha_desde,fecha_hasta,precio_por_noche,orden&order=orden",
    ),
    seleccionar("medios_pago", "select=clave,nombre,habilitado,recargo_porcentaje,orden&order=orden"),
    seleccionar("planes_cuotas", "select=cuotas,habilitado,recargo_porcentaje&order=cuotas"),
  ]);

  if (!temporadas?.length) {
    throw new Error("La tabla `temporadas` está vacía: no se puede calcular el precio.");
  }

  return {
    temporadas,
    medios: (medios || []).map((m) => ({ ...m, recargo_porcentaje: Number(m.recargo_porcentaje) })),
    planes: (planes || []).map((p) => ({
      ...p,
      cuotas: Number(p.cuotas),
      recargo_porcentaje: Number(p.recargo_porcentaje),
    })),
  };
}

export function buscarTarifasEspeciales(checkIn, checkOut) {
  return seleccionar(
    "tarifas_especiales",
    `select=fecha_desde,fecha_hasta,precio_por_noche,motivo` +
      `&fecha_desde=lte.${checkOut}&fecha_hasta=gte.${checkIn}`,
  );
}

export async function leerConfigDeCobro() {
  const filas = await seleccionar(
    "configuracion_pagos",
    "select=porcentaje_reserva,tarifa_limpieza&id=eq.1",
  );
  const pct = Number(filas?.[0]?.porcentaje_reserva);

  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
    throw new Error(
      "configuracion_pagos.porcentaje_reserva no es un porcentaje válido. " +
        "Corré sql/fase4-pagos-y-mails.sql y revisalo en el panel, pestaña Tarifas.",
    );
  }

  const limpieza = Number(filas?.[0]?.tarifa_limpieza ?? 0);
  const tarifaLimpieza = Number.isFinite(limpieza) && limpieza > 0 ? limpieza : 0;

  return { porcentajeReserva: pct, tarifaLimpieza };
}

export async function reservarEnvioDeMail(clave, tipo, destinatarios) {
  try {
    await pedir("emails_enviados", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ clave, tipo, destinatarios }),
    });
    return true;
  } catch (error) {
    if (error.codigoPostgres === "23505") return false;
    console.warn("[mails] no se pudo reservar el envío:", error.message);
    return false;
  }
}

export async function anotarResultadoDeMail(clave, { resendId, error }) {
  try {
    await pedir(`emails_enviados?clave=eq.${encodeURIComponent(clave)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ resend_id: resendId || null, error: error || null }),
    });
  } catch (falla) {
    console.warn("[mails] no se pudo anotar el resultado:", falla.message);
  }
}

export async function liberarEnvioDeMail(clave) {
  try {
    await pedir(`emails_enviados?clave=eq.${encodeURIComponent(clave)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  } catch (falla) {
    console.warn("[mails] no se pudo liberar el envío:", falla.message);
  }
}

export async function insertarResena(fila) {
  const filas = await pedir("reviews", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(fila),
  });
  return filas?.[0] || null;
}
