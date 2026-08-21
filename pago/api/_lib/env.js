/**
 * api/_lib/env.js
 * ---------------------------------------------------------------------------
 * Lee y valida TODAS las variables de entorno en un solo lugar.
 *
 * Por qué existe: si una credencial falta o está mal, quiero enterarme con un
 * mensaje claro en el log del servidor y devolver un 500 controlado — no un
 * "undefined is not a string" tres capas más abajo, ni peor: un pago que sale
 * con el ambiente equivocado.
 *
 * Se puede correr suelto para chequear el .env:
 *     node api/_lib/env.js
 */

/** Error de configuración: es culpa del servidor, no del que paga. */
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

function entero(nombre, { min, max, porDefecto }) {
  const crudo = (process.env[nombre] || "").trim();
  if (!crudo) {
    if (porDefecto !== undefined) return porDefecto;
    throw new ErrorDeConfig(`Falta la variable de entorno ${nombre}.`);
  }
  const n = Number(crudo);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ErrorDeConfig(
      `${nombre} tiene que ser un número entero entre ${min} y ${max} (recibí: "${crudo}").`,
      "Sin puntos de miles ni comas: 30000, no 30.000.",
    );
  }
  return n;
}

function booleana(nombre, porDefecto) {
  const crudo = (process.env[nombre] || "").trim().toLowerCase();
  if (!crudo) return porDefecto;
  return crudo === "true" || crudo === "1" || crudo === "si" || crudo === "sí";
}

/**
 * MercadoPago entrega dos juegos de credenciales. Las de prueba llevan el
 * prefijo TEST-, las reales APP_USR-. Mezclarlas es EL error clásico: el Brick
 * genera el token con una public key y el backend lo intenta cobrar con un
 * access token del otro ambiente, y MercadoPago devuelve un críptico
 * "invalid card_token_id" que no dice nada de ambientes.
 */
function ambienteDeCredencial(valor) {
  if (valor.startsWith("TEST-")) return "test";
  if (valor.startsWith("APP_USR-")) return "produccion";
  return "desconocido";
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

  // Aviso, no error: en un preview de Vercel querés las de prueba, pero si
  // alguien pone las reales a propósito para un test final, no le rompemos
  // el deploy. Al revés (test en producción) sí es grave y lo gritamos.
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

  // Freno de mano: si acá pegaron la anon por error, el backend no puede leer
  // booking_requests (es solo-alta) y todo falla con un 401 confuso.
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

      /**
       * Lazy a propósito: la clave del webhook la necesita SOLO el webhook.
       * Si se exigiera acá, un `MP_WEBHOOK_SECRET` vacío tiraría abajo también
       * `/api/reserva` y `/api/pagos` — es decir, nadie podría pagar por no
       * poder validar una notificación. Con el getter, cada endpoint falla
       * únicamente por lo que de verdad usa.
       */
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
      maxCuotas: entero("MP_MAX_CUOTAS", { min: 1, max: 24, porDefecto: 6 }),
      ambiente: ambToken,
    },
    supabase: { url: supabaseUrl, serviceRoleKey },
    precios: {
      porNoche: entero("PRECIO_NOCHE_ARS", { min: 1, max: 100_000_000 }),
      limpieza: entero("TASA_LIMPIEZA_ARS", { min: 0, max: 100_000_000 }),
      porcentajeACobrar: entero("PORCENTAJE_A_COBRAR", {
        min: 1,
        max: 100,
        porDefecto: 100,
      }),
      moneda: "ARS",
    },
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

/* ---------------------------------------------------------------------------
   Chequeo manual del .env, sin levantar nada:

       node --env-file=.env api/_lib/env.js      (Node 20+)
       npm run env:check                         (hace exactamente eso)

   No imprime ninguna credencial: solo dice si la configuración cierra.
   --------------------------------------------------------------------------- */
if (process.argv[1] && process.argv[1].endsWith("env.js")) {
  try {
    const c = leerConfig();
    console.log("\n  OK  configuración válida");
    console.log(`      ambiente MercadoPago   ${c.mp.ambiente}`);
    console.log(`      entorno                ${c.entorno}`);
    console.log(`      precio por noche       $${c.precios.porNoche.toLocaleString("es-AR")}`);
    console.log(`      tasa de limpieza       $${c.precios.limpieza.toLocaleString("es-AR")}`);
    console.log(`      se cobra               ${c.precios.porcentajeACobrar}% del total`);
    console.log(`      max. cuotas            ${c.mp.maxCuotas}\n`);
  } catch (e) {
    console.error(`\n  ERROR  ${e.message}\n`);
    process.exit(1);
  }
}
