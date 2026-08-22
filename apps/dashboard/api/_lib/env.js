/**
 * api/_lib/env.js
 * ---------------------------------------------------------------------------
 * Las variables de entorno del panel, leídas y validadas en un solo lugar.
 *
 * El panel es un proyecto de Vercel aparte del sitio y del checkout, así que
 * tiene sus propias variables. Necesita cuatro cosas:
 *
 *   PANEL_CODIGO                 el código de acceso (lo que se tipea en el login)
 *   PANEL_SESION_SECRET          con qué se firma la cookie de sesión
 *   SUPABASE_URL                 la misma que el resto del proyecto
 *   SUPABASE_SERVICE_ROLE_KEY    la misma que el checkout: saltea RLS
 *   MP_ACCESS_TOKEN              solo para las devoluciones
 *
 * Ninguna de estas sale nunca al navegador.
 */

export class ErrorDeConfig extends Error {
  constructor(mensaje, pista) {
    super(pista ? `${mensaje}\n  → ${pista}` : mensaje);
    this.name = "ErrorDeConfig";
    this.pista = pista;
  }
}

function requerida(nombre, pista) {
  const valor = (process.env[nombre] || "").trim();
  if (!valor) throw new ErrorDeConfig(`Falta la variable de entorno ${nombre}.`, pista);
  return valor;
}

/** Cuánto dura la sesión sin volver a pedir el código. */
export const HORAS_DE_SESION = 12;

let cache = null;

export function leerConfig() {
  if (cache) return cache;

  const codigo = requerida(
    "PANEL_CODIGO",
    "Son 6 dígitos. Es lo único que separa a cualquiera de los datos de tus " +
      "huéspedes y del botón de devolver plata: que sea uno que no uses en otro lado.",
  );

  if (!/^\d{6}$/.test(codigo)) {
    throw new ErrorDeConfig(
      "PANEL_CODIGO tiene que ser exactamente 6 dígitos.",
      `Recibí ${codigo.length} caracteres. El formulario del login tiene 6 casilleros numéricos.`,
    );
  }

  const secreto = requerida(
    "PANEL_SESION_SECRET",
    "Una cadena larga y al azar; con esto se firma la cookie de sesión. " +
      "Generala con: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
  );

  if (secreto.length < 32) {
    throw new ErrorDeConfig(
      "PANEL_SESION_SECRET es demasiado corto (mínimo 32 caracteres).",
      "Si se puede adivinar, se puede firmar una cookie de sesión válida sin saber el código.",
    );
  }

  const supabaseUrl = requerida("SUPABASE_URL").replace(/\/+$/, "");
  if (!/^https:\/\//.test(supabaseUrl)) {
    throw new ErrorDeConfig(`SUPABASE_URL tiene que empezar con https:// (recibí: "${supabaseUrl}").`);
  }

  const serviceRoleKey = requerida(
    "SUPABASE_SERVICE_ROLE_KEY",
    "Supabase → Project Settings → API → service_role. El panel lee y escribe " +
      "tablas con RLS cerrado; con la anon no puede hacer nada.",
  );

  /**
   * Freno de mano: si acá pegaron la clave PÚBLICA por error, el panel entra
   * igual (el login solo necesita el código) y recién falla al pedir datos, con
   * un "permission denied" de PostgREST que no dice nada de claves. Es el error
   * más fácil de cometer y el más difícil de diagnosticar, así que se detecta
   * al leer la configuración y se dice con todas las letras.
   */
  const pareceAnon =
    serviceRoleKey.startsWith("sb_publishable_") ||
    (serviceRoleKey.startsWith("eyJ") && /"role"\s*:\s*"anon"/.test(decodificarJwt(serviceRoleKey)));

  if (pareceAnon) {
    throw new ErrorDeConfig(
      "SUPABASE_SERVICE_ROLE_KEY tiene una clave PÚBLICA (anon/publishable).",
      "El panel necesita la service_role: todas las tablas que toca tienen RLS " +
        "activo y ninguna política, así que con la clave pública no puede leer " +
        "ni escribir nada. Supabase → Project Settings → API → service_role.",
    );
  }

  cache = {
    codigo,
    secreto,
    supabase: { url: supabaseUrl, serviceRoleKey },
    // Lazy: solo lo necesita el endpoint de cancelación. Si se exigiera acá, un
    // MP_ACCESS_TOKEN faltante tiraría abajo el panel entero — no se podrían ni
    // ver las tarifas por no poder devolver plata.
    get mpAccessToken() {
      return requerida(
        "MP_ACCESS_TOKEN",
        "El mismo del checkout. Se usa para las devoluciones desde Alquileres.",
      );
    },
    entorno: process.env.VERCEL_ENV || "development",
  };

  return cache;
}

/** El payload de un JWT, sin validar la firma: solo para mirar el `role`. */
function decodificarJwt(token) {
  const partes = token.split(".");
  if (partes.length !== 3) return "";
  try {
    return Buffer.from(partes[1], "base64url").toString("utf8");
  } catch {
    return "";
  }
}

/* ---------------------------------------------------------------------------
   Chequeo del .env sin levantar nada:

       node --env-file=.env api/_lib/env.js
       npm run env:check

   No imprime ninguna credencial ni el código: solo dice si cierra.
   --------------------------------------------------------------------------- */
if (process.argv[1] && process.argv[1].endsWith("env.js")) {
  try {
    const c = leerConfig();
    console.log("\n  OK  configuración del panel válida");
    console.log(`      entorno            ${c.entorno}`);
    console.log(`      supabase           ${c.supabase.url}`);
    console.log(`      código de acceso   ${c.codigo.length} dígitos (cargado)`);
    console.log(`      sesión             dura ${HORAS_DE_SESION} h`);
    try {
      c.mpAccessToken;
      console.log("      devoluciones       habilitadas (MP_ACCESS_TOKEN cargado)\n");
    } catch {
      console.log("      devoluciones       NO disponibles (falta MP_ACCESS_TOKEN)\n");
    }
  } catch (e) {
    console.error(`\n  ERROR  ${e.message}\n`);
    process.exit(1);
  }
}
