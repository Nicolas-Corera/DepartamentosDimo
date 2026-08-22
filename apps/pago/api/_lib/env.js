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

function booleana(nombre, porDefecto) {
  const crudo = (process.env[nombre] || "").trim().toLowerCase();
  if (!crudo) return porDefecto;
  return crudo === "true" || crudo === "1" || crudo === "si" || crudo === "sí";
}

function ambienteDeCredencial(valor) {
  if (valor.startsWith("TEST-")) return "test";
  if (valor.startsWith("APP_USR-")) return "produccion";
  return "desconocido";
}

const REMITENTES = {
  consultas: "Departamentos Dimo <consultas@departamentosdimo.com.ar>",
  reservas: "Departamentos Dimo <reservas@departamentosdimo.com.ar>",
  pagos: "Departamentos Dimo <pagos@departamentosdimo.com.ar>",
  resenas: "Departamentos Dimo <resenas@departamentosdimo.com.ar>",
};

export function leerConfigDeMails() {
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

  const publicKey = requerida(
    "MP_PUBLIC_KEY",
    "Panel de MercadoPago → tu aplicación → Credenciales de prueba → Public Key.",
  );
  const accessToken = requerida(
    "MP_ACCESS_TOKEN",
    "Panel de MercadoPago → tu aplicación → Credenciales de prueba → Access Token.",
  );

  const ambPublic = ambienteDeCredencial(publicKey);
  const ambToken = ambienteDeCredencial(accessToken);

  if (ambPublic === "desconocido" || ambToken === "desconocido") {
    throw new ErrorDeConfig(
      "Las credenciales de MercadoPago no tienen el formato esperado.",
      'Tienen que empezar con "TEST-" (prueba) o "APP_USR-" (producción). ' +
        "Revisá que no hayas pegado la de otra sección del panel.",
    );
  }
  if (ambPublic !== ambToken) {
    throw new ErrorDeConfig(
      `MP_PUBLIC_KEY es de ${ambPublic} y MP_ACCESS_TOKEN es de ${ambToken}.`,
      "Las dos tienen que ser del mismo ambiente. Si mezclás, el token de " +
        "tarjeta que genera el Brick no sirve para cobrar y MercadoPago " +
        'responde "invalid card_token_id".',
    );
  }

  const entornoVercel = process.env.VERCEL_ENV || "development";
  if (entornoVercel === "production" && ambToken === "test") {
    console.warn(
      "[config] ⚠️  Estás en PRODUCCIÓN con credenciales de PRUEBA de " +
        "MercadoPago. Ningún pago va a ser real.",
    );
  }
  if (entornoVercel !== "production" && ambToken === "produccion") {
    console.warn(
      `[config] ⚠️  Entorno "${entornoVercel}" con credenciales REALES de ` +
        "MercadoPago. Todo lo que cobres acá se cobra de verdad.",
    );
  }

  const supabaseUrl = requerida(
    "SUPABASE_URL",
    "La misma que usa el sitio principal: https://xxxxxxxxxxxx.supabase.co",
  ).replace(/\/+$/, "");

  if (!/^https:\/\//.test(supabaseUrl)) {
    throw new ErrorDeConfig(
      `SUPABASE_URL tiene que empezar con https:// (recibí: "${supabaseUrl}").`,
    );
  }

  const serviceRoleKey = requerida(
    "SUPABASE_SERVICE_ROLE_KEY",
    "Supabase → Project Settings → API → service_role. Es SECRETA: saltea RLS " +
      "y nunca puede llegar al navegador.",
  );

  const pareceAnon =
    serviceRoleKey.startsWith("sb_publishable_") ||
    (serviceRoleKey.startsWith("eyJ") && /"role"\s*:\s*"anon"/.test(decodificarJwt(serviceRoleKey)));
  if (pareceAnon) {
    throw new ErrorDeConfig(
      "SUPABASE_SERVICE_ROLE_KEY tiene una clave PÚBLICA (anon/publishable).",
      "Necesito la service_role: la tabla booking_requests es solo-alta y " +
        "la anon no puede leerla.",
    );
  }

  cache = {
    mp: {
      publicKey,
      accessToken,

      get webhookSecret() {
        return requerida(
          "MP_WEBHOOK_SECRET",
          "Panel de MercadoPago → tu aplicación → Webhooks → Generar clave secreta. " +
            "Sin esto no se puede validar la firma y el webhook rechaza todo.",
        );
      },

      statementDescriptor: (process.env.MP_STATEMENT_DESCRIPTOR || "DIMO")
        .trim()
        .slice(0, 13),
      ambiente: ambToken,
    },
    supabase: { url: supabaseUrl, serviceRoleKey },

    mails: leerConfigDeMails(),

    urls: {
      sitio: sinBarra(opcional("SITIO_URL", "https://departamentosdimo.com.ar")),
      pago: sinBarra(opcional("PAGO_URL", "https://pago.departamentosdimo.com.ar")),
      panel: sinBarra(opcional("PANEL_URL", "https://dash.departamentosdimo.com.ar")),
    },

    moneda: "ARS",
    confirmarReservaAlAprobar: booleana("CONFIRMAR_RESERVA_AL_APROBAR", true),
    entorno: entornoVercel,
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
    console.log("\n  OK  configuración válida");
    console.log(`      ambiente MercadoPago   ${c.mp.ambiente}`);
    console.log(`      entorno                ${c.entorno}`);
    console.log(`      supabase               ${c.supabase.url}`);
    console.log(`      precios                en la base (temporadas / medios_pago / planes_cuotas)`);
    console.log(
      `      mails                  ${
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
