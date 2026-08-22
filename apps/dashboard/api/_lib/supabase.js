import { leerConfig } from "./env.js";

async function pedir(ruta, opciones = {}) {
  const { supabase } = leerConfig();

  const respuesta = await fetch(`${supabase.url}/rest/v1/${ruta}`, {
    ...opciones,
    headers: {
      apikey: supabase.serviceRoleKey,
      Authorization: `Bearer ${supabase.serviceRoleKey}`,
      "Content-Type": "application/json",
      ...opciones.headers,
    },
    signal: AbortSignal.timeout(12_000),
  });

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

    let pista = "";
    if (/permission denied/i.test(detalle) || codigo === "42501") {
      pista =
        " → Revisá SUPABASE_SERVICE_ROLE_KEY en Vercel: estas tablas tienen RLS " +
        "activo y sin políticas, así que con la clave pública (anon) no se puede " +
        "leer nada. Tiene que ser la service_role.";
    } else if (respuesta.status === 401 || respuesta.status === 403) {
      pista =
        " → Supabase rechazó la credencial. Puede ser la clave (revisá " +
        "SUPABASE_SERVICE_ROLE_KEY) o, si el mensaje habla del JWT y de fechas, " +
        "el reloj del servidor corrido respecto del de Supabase.";
    } else if (codigo === "42P01" || /does not exist/i.test(detalle)) {
      pista =
        " → Falta correr pago/sql/configuracion-tarifas.sql en Supabase, o " +
        "SUPABASE_URL apunta a otro proyecto.";
    } else if (respuesta.status === 404) {
      pista = " → Revisá que SUPABASE_URL sea la del proyecto correcto.";
    }

    throw new Error(`Supabase (${respuesta.status}): ${detalle}${pista}`);
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

export function actualizar(tabla, filtro, cambios) {
  return pedir(`${tabla}?${filtro}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(cambios),
  });
}

export function insertar(tabla, filas) {
  return pedir(tabla, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(filas),
  });
}

export function borrar(tabla, filtro) {
  return pedir(`${tabla}?${filtro}`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
}

export function upsert(tabla, filas) {
  return pedir(tabla, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(filas),
  });
}

export async function firmarLectura(path, segundos, descargarComo) {
  const { supabase } = leerConfig();

  const respuesta = await fetch(
    `${supabase.url}/storage/v1/object/sign/comprobantes/${path}`,
    {
      method: "POST",
      headers: {
        apikey: supabase.serviceRoleKey,
        Authorization: `Bearer ${supabase.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: segundos }),
      signal: AbortSignal.timeout(12_000),
    },
  );

  if (!respuesta.ok) {
    const detalle = await respuesta.text();
    throw new Error(`Storage (${respuesta.status}): ${detalle.slice(0, 200)}`);
  }

  const { signedURL } = await respuesta.json();
  const sufijo = descargarComo ? `&download=${encodeURIComponent(descargarComo)}` : "";
  return `${supabase.url}/storage/v1${signedURL}${sufijo}`;
}

export async function descargarComprobante(path) {
  const { supabase } = leerConfig();

  const respuesta = await fetch(
    `${supabase.url}/storage/v1/object/comprobantes/${path}`,
    {
      headers: {
        apikey: supabase.serviceRoleKey,
        Authorization: `Bearer ${supabase.serviceRoleKey}`,
      },
      signal: AbortSignal.timeout(20_000),
    },
  );

  if (!respuesta.ok) {
    console.warn(`[storage] no se pudo bajar ${path}: ${respuesta.status}`);
    return null;
  }
  return Buffer.from(await respuesta.arrayBuffer());
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
    if (/duplicate key|23505/.test(error.message)) return false;
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

export async function crearRecibo(fila) {
  const columna = fila.mp_payment_id ? "mp_payment_id" : "transfer_receipt_id";
  const valor = fila.mp_payment_id || fila.transfer_receipt_id;
  const filtro = `${columna}=eq.${encodeURIComponent(valor)}`;

  const existentes = await seleccionar("recibos", `select=id,numero,created_at&${filtro}`);
  if (existentes?.[0]) return existentes[0];

  try {
    const nuevas = await insertar("recibos", [fila]);
    if (nuevas?.[0]) return nuevas[0];
  } catch (error) {
    if (!/duplicate key|23505/.test(error.message)) throw error;
  }

  const reintento = await seleccionar("recibos", `select=id,numero,created_at&${filtro}`);
  if (reintento?.[0]) return reintento[0];

  throw new Error("No se pudo emitir el recibo.");
}

export async function leerConfigTarifas() {
  const [temporadas, medios] = await Promise.all([
    seleccionar(
      "temporadas",
      "select=clave,nombre,fecha_desde,fecha_hasta,precio_por_noche,orden&order=orden",
    ),
    seleccionar("medios_pago", "select=clave,nombre,habilitado,recargo_porcentaje&order=orden"),
  ]);

  if (!temporadas?.length) {
    throw new Error("La tabla `temporadas` está vacía: no se puede calcular el precio.");
  }

  return {
    temporadas,
    medios: (medios || []).map((m) => ({ ...m, recargo_porcentaje: Number(m.recargo_porcentaje) })),
  };
}

export function buscarTarifasEspeciales(checkIn, checkOut) {
  return seleccionar(
    "tarifas_especiales",
    "select=fecha_desde,fecha_hasta,precio_por_noche,motivo" +
      `&fecha_desde=lte.${checkOut}&fecha_hasta=gte.${checkIn}`,
  );
}

export async function leerPorcentajeDeReserva() {
  const filas = await seleccionar("configuracion_pagos", "select=porcentaje_reserva&id=eq.1");
  const pct = Number(filas?.[0]?.porcentaje_reserva);

  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
    throw new Error("configuracion_pagos.porcentaje_reserva no es un porcentaje válido.");
  }
  return pct;
}

export function pagosAprobados(bookingId) {
  return seleccionar(
    "payments",
    "select=mp_payment_id,monto,monto_base,concepto,metodo,cuotas,aprobado_en,created_at" +
      `&booking_id=eq.${bookingId}&status=eq.approved&order=created_at.asc`,
  );
}

export function transferenciasConfirmadas(bookingId) {
  return seleccionar(
    "transfer_receipts",
    "select=id,monto_declarado,monto_base,concepto,created_at,revisado_en" +
      `&booking_id=eq.${bookingId}&estado=eq.confirmado&order=created_at.asc`,
  );
}

export function buscarReservaCompleta(bookingId) {
  return seleccionar(
    "booking_requests",
    "select=id,nombre,email,dni,telefono,procedencia,check_in,check_out,personas," +
      "adultos,ninos,edades_ninos,vehiculo,vehiculo_marca,vehiculo_modelo," +
      `vehiculo_tipo,vehiculo_anio,mensaje,estado&id=eq.${bookingId}`,
  ).then((filas) => filas?.[0] || null);
}
