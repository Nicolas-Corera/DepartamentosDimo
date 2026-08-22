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
