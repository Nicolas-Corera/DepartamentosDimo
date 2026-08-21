/**
 * api/_lib/supabase.js
 * ---------------------------------------------------------------------------
 * Acceso a Supabase por PostgREST, con `fetch` y sin dependencias.
 *
 * Por qué no `@supabase/supabase-js` como en el checkout: el panel es un
 * proyecto de Vercel aparte, y el SDK entero (con sus dependencias de realtime
 * y storage, que acá no se usan) es lo único que lo obligaría a tener
 * node_modules. Estas cuarenta líneas cubren lo que el panel necesita —
 * seleccionar, actualizar, insertar y borrar— y el deploy queda sin instalar
 * nada.
 *
 * Siempre con service_role: todas las tablas que toca el panel tienen RLS
 * activo y ninguna política. La clave no sale nunca de este archivo.
 */

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
      /* la respuesta no era JSON: se usa el texto crudo */
    }

    /**
     * Los mensajes de PostgREST son precisos pero no dicen qué hacer. Estos
     * tres son los únicos que se ven en la práctica cuando el panel se acaba
     * de configurar, y los tres tienen una causa concreta que conviene nombrar
     * en vez de dejar al operador leyendo "permission denied for table".
     */
    let pista = "";
    if (/permission denied/i.test(detalle) || codigo === "42501") {
      // El caso concreto de la clave equivocada. Se detecta por el mensaje y no
      // por el status: un 401 también lo devuelve una clave vencida o un reloj
      // corrido, y mandar a cambiar la service_role por un problema de hora
      // hace perder más tiempo del que ahorra.
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

/** SELECT. `consulta` es el query string de PostgREST ya armado. */
export function seleccionar(tabla, consulta = "select=*") {
  return pedir(`${tabla}?${consulta}`);
}

/** UPDATE de las filas que matcheen el filtro. Devuelve las filas actualizadas. */
export function actualizar(tabla, filtro, cambios) {
  return pedir(`${tabla}?${filtro}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(cambios),
  });
}

/** INSERT. Acepta una fila o un array. */
export function insertar(tabla, filas) {
  return pedir(tabla, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(filas),
  });
}

/** DELETE de las filas que matcheen el filtro. */
export function borrar(tabla, filtro) {
  return pedir(`${tabla}?${filtro}`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
}

/**
 * INSERT ... ON CONFLICT DO UPDATE, sobre la clave primaria de la tabla.
 *
 * Es lo que usa el guardado de tarifas: la pantalla manda las tres temporadas,
 * los tres medios y los planes de cuotas, y esto los pisa de una. Sin upsert
 * habría que averiguar cuáles existen y cuáles no antes de escribir.
 */
export function upsert(tabla, filas) {
  return pedir(tabla, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(filas),
  });
}
