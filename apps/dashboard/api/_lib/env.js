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

export const HORAS_DE_SESION = 12;

function opcional(nombre, porDefecto = "") {
  return (process.env[nombre] || "").trim() || porDefecto;
}

function listaDeMails(nombre) {
  return opcional(nombre)
    .split(/[,;\s]+/)
    .map((m) => m.trim().toLowerCase())
    .filter((m) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m));
}

function sinBarra(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

const REMITENTES = {
  consultas: "Departamentos Dimo <consultas@departamentosdimo.com.ar>",
  reservas: "Departamentos Dimo <reservas@departamentosdimo.com.ar>",
  pagos: "Departamentos Dimo <pagos@departamentosdimo.com.ar>",
  resenas: "Departamentos Dimo <resenas@departamentosdimo.com.ar>",
};

function leerConfigDeMails() {
  const apiKey = opcional("RESEND_API_KEY");
  const duenos = listaDeMails("DUENOS_EMAILS");

  const motivos = [];
  if (!apiKey) motivos.push("falta RESEND_API_KEY");
  if (!duenos.length) motivos.push("DUENOS_EMAILS no tiene ninguna dirección válida");

  return {
    habilitados: motivos.length === 0,
    motivo: motivos.join(" y "),
    apiKey,
    duenos,

    de: {
      consultas: opcional("MAIL_DE_CONSULTAS", REMITENTES.consultas),
      reservas: opcional("MAIL_DE_RESERVAS", REMITENTES.reservas),
      pagos: opcional("MAIL_DE_PAGOS", REMITENTES.pagos),
      resenas: opcional("MAIL_DE_RESENAS", REMITENTES.resenas),
    },
  };
}

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

    mails: leerConfigDeMails(),

    urls: {
      sitio: sinBarra(opcional("SITIO_URL", "https://departamentosdimo.com.ar")),
      pago: sinBarra(opcional("PAGO_URL", "https://pago.departamentosdimo.com.ar")),
      panel: sinBarra(opcional("PANEL_URL", "https://dash.departamentosdimo.com.ar")),
    },

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

function decodificarJwt(token) {
  const partes = token.split(".");
  if (partes.length !== 3) return "";
  try {
    return Buffer.from(partes[1], "base64url").toString("utf8");
  } catch {
    return "";
  }
}

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
      console.log("      devoluciones       habilitadas (MP_ACCESS_TOKEN cargado)");
    } catch {
      console.log("      devoluciones       NO disponibles (falta MP_ACCESS_TOKEN)");
    }
    console.log(
      `      mails              ${
        c.mails.habilitados
          ? `activos → ${c.mails.duenos.length} dueño(s): ${c.mails.duenos.join(", ")}`
          : `DESACTIVADOS (${c.mails.motivo})`
      }\n`,
    );
  } catch (e) {
    console.error(`\n  ERROR  ${e.message}\n`);
    process.exit(1);
  }
}
