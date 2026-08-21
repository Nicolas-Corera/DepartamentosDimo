/**
 * api/_lib/log.js
 * ---------------------------------------------------------------------------
 * Logs de la integración con MercadoPago.
 *
 * Regla no negociable: NUNCA loguear datos de tarjeta ni credenciales.
 * Los logs de Vercel los ve cualquiera que tenga acceso al proyecto y quedan
 * guardados. El token de tarjeta, el CVV, el número, el access token y el DNI
 * del pagador no tienen por qué estar ahí.
 *
 * Por eso no se loguean objetos crudos: todo pasa por `limpiar()`, que sustituye
 * las claves prohibidas por "[oculto]" — incluso si están anidadas.
 */

/**
 * Nombres de campo que jamás salen en un log, en cualquier nivel del objeto.
 * Si mañana MercadoPago agrega uno nuevo, se agrega acá y listo.
 */
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

/**
 * Un mail entero en un log es un dato personal de más. Con el dominio y las
 * dos primeras letras alcanza para rastrear un caso puntual.
 */
export function ofuscarEmail(email) {
  if (typeof email !== "string" || !email.includes("@")) return "[oculto]";
  const [usuario, dominio] = email.split("@");
  return `${usuario.slice(0, 2)}***@${dominio}`;
}

function emitir(nivel, evento, datos) {
  const linea = {
    ts: new Date().toISOString(),
    nivel,
    evento,
    ...limpiar(datos || {}),
  };
  const salida = nivel === "error" ? console.error : nivel === "warn" ? console.warn : console.log;
  salida(`[pagos] ${JSON.stringify(linea)}`);
}

export const log = {
  info: (evento, datos) => emitir("info", evento, datos),
  warn: (evento, datos) => emitir("warn", evento, datos),

  /**
   * Para errores: guarda lo que sirve para diagnosticar (status HTTP, código de
   * MercadoPago, mensaje) y descarta el resto de la respuesta, que puede traer
   * el eco de los datos que mandamos.
   */
  error: (evento, error, datos) => {
    const detalle = {
      mensaje: error?.message || String(error),
      // El SDK de MercadoPago cuelga el detalle de la API en estas propiedades.
      status: error?.status || error?.statusCode,
      causa: Array.isArray(error?.cause)
        ? error.cause.map((c) => ({ code: c?.code, description: c?.description }))
        : undefined,
      mp_error: error?.error,
    };
    emitir("error", evento, { ...datos, error: detalle });
  },
};
