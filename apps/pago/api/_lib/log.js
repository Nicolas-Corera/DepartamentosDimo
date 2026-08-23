const CLAVES_PROHIBIDAS = new Set([
  "token",
  "card_token",
  "cardtoken",
  "card",
  "cardnumber",
  "card_number",
  "securitycode",
  "security_code",
  "cvv",
  "cvc",
  "expirationmonth",
  "expiration_month",
  "expirationyear",
  "expiration_year",
  "cardholder",
  "cardholdername",
  "access_token",
  "accesstoken",
  "authorization",
  "x-signature",
  "apikey",
  "api_key",
  "service_role",
  "identification",
  "number",
  "dni",
  "password",
  "secret",
  "webhook_secret",
]);

const PROFUNDIDAD_MAX = 6;

function limpiar(valor, profundidad = 0) {
  if (valor === null || valor === undefined) return valor;
  if (profundidad > PROFUNDIDAD_MAX) return "[…]";

  if (Array.isArray(valor)) {
    return valor.slice(0, 20).map((v) => limpiar(v, profundidad + 1));
  }
  if (valor instanceof Error) {
    return { name: valor.name, message: valor.message };
  }
  if (typeof valor === "object") {
    const salida = {};
    for (const [clave, v] of Object.entries(valor)) {
      salida[clave] = CLAVES_PROHIBIDAS.has(clave.toLowerCase())
        ? "[oculto]"
        : limpiar(v, profundidad + 1);
    }
    return salida;
  }
  return valor;
}

export function ofuscarEmail(email) {
  if (typeof email !== "string" || !email.includes("@")) return "[oculto]";
  const [usuario, dominio] = email.split("@");
  return `${usuario.slice(0, 2)}***@${dominio}`;
}

const CLAVES_RESERVADAS = ["ts", "nivel", "evento"];

function emitir(nivel, evento, datos) {
  const limpios = limpiar(datos || {});
  for (const clave of CLAVES_RESERVADAS) delete limpios[clave];

  const linea = {
    ts: new Date().toISOString(),
    nivel,
    evento,
    ...limpios,
  };
  const salida = nivel === "error" ? console.error : nivel === "warn" ? console.warn : console.log;
  salida(`[pagos] ${JSON.stringify(linea)}`);
}

export const log = {
  info: (evento, datos) => emitir("info", evento, datos),
  warn: (evento, datos) => emitir("warn", evento, datos),

  error: (evento, error, datos) => {
    const detalle = {
      mensaje: error?.message || String(error),

      status: error?.status || error?.statusCode,
      causa: Array.isArray(error?.cause)
        ? error.cause.map((c) => ({ code: c?.code, description: c?.description }))
        : undefined,
      mp_error: error?.error,
    };
    emitir("error", evento, { ...datos, error: detalle });
  },
};
