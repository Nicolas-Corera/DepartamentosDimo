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

function decodificarJwt(token) {
  const partes = token.split(".");
  if (partes.length !== 3) return "";
  try {
    return Buffer.from(partes[1], "base64url").toString("utf8");
  } catch {
    return "";
  }
}

const REMITENTES = {
  consultas: "Departamentos Dimo <consultas@departamentosdimo.com.ar>",
  reservas: "Departamentos Dimo <reservas@departamentosdimo.com.ar>",
  pagos: "Departamentos Dimo <pagos@departamentosdimo.com.ar>",
};

let cache = null;

export function leerConfig() {
  if (cache) return cache;

  const supabaseUrl = requerida(
    "SUPABASE_URL",
    "Supabase → Project Settings → API → Project URL.",
  ).replace(/\/+$/, "");

  if (!/^https:\/\//.test(supabaseUrl)) {
    throw new ErrorDeConfig(`SUPABASE_URL tiene que empezar con https:// (recibí: "${supabaseUrl}").`);
  }

  const serviceRoleKey = requerida(
    "SUPABASE_SERVICE_ROLE_KEY",
    "Supabase → Project Settings → API → service_role. Es SECRETA: el alta de " +
      "consultas necesita saltear RLS porque booking_requests no tiene política " +
      "de select y el endpoint necesita el id de la fila que acaba de crear.",
  );

  const pareceAnon =
    serviceRoleKey.startsWith("sb_publishable_") ||
    (serviceRoleKey.startsWith("eyJ") && /"role"\s*:\s*"anon"/.test(decodificarJwt(serviceRoleKey)));

  if (pareceAnon) {
    throw new ErrorDeConfig(
      "SUPABASE_SERVICE_ROLE_KEY tiene una clave PÚBLICA (anon/publishable).",
      "Con la anon no se puede leer la fila recién insertada, así que no habría " +
        "id con el que armar los links de pago.",
    );
  }

  const apiKey = opcional("RESEND_API_KEY");
  const duenos = listaDeMails("DUENOS_EMAILS");

  const motivos = [];
  if (!apiKey) motivos.push("falta RESEND_API_KEY");
  if (!duenos.length) motivos.push("DUENOS_EMAILS no tiene ninguna dirección válida");

  cache = {
    supabase: { url: supabaseUrl, serviceRoleKey },

    mails: {
      habilitados: motivos.length === 0,
      motivo: motivos.join(" y "),
      apiKey,
      duenos,
      de: {
        consultas: opcional("MAIL_DE_CONSULTAS", REMITENTES.consultas),
        reservas: opcional("MAIL_DE_RESERVAS", REMITENTES.reservas),
        pagos: opcional("MAIL_DE_PAGOS", REMITENTES.pagos),
      },
    },

    urls: {
      sitio: sinBarra(opcional("SITIO_URL", "https://departamentosdimo.com.ar")),
      pago: sinBarra(opcional("PAGO_URL", "https://pago.departamentosdimo.com.ar")),
      panel: sinBarra(opcional("PANEL_URL", "https://dash.departamentosdimo.com.ar")),
    },

    entorno: process.env.VERCEL_ENV || "development",
  };

  return cache;
}

if (process.argv[1] && process.argv[1].endsWith("env.js")) {
  try {
    const c = leerConfig();
    console.log("\n  OK  configuración del sitio válida");
    console.log(`      entorno                ${c.entorno}`);
    console.log(`      supabase               ${c.supabase.url}`);
    console.log(
      `      mails                  ${
        c.mails.habilitados
          ? `activos → ${c.mails.duenos.length} dueño(s): ${c.mails.duenos.join(", ")}`
          : `DESACTIVADOS (${c.mails.motivo})`
      }`,
    );
    console.log(`      links de pago          ${c.urls.pago}/?ref=...&modo=reserva|total\n`);
  } catch (e) {
    console.error(`\n  ERROR  ${e.message}\n`);
    process.exit(1);
  }
}
