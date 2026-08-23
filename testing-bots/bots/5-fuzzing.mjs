import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { config, CARPETA_REPORTES } from "../lib/config.mjs";
import { exigirSoloLocal, avisoDeEscritura } from "../lib/guardia.mjs";
import { crearRegistro } from "../lib/registro.mjs";
import { pedir, dormir } from "../lib/http.mjs";
import {
  consultaValida,
  consultaConTopes,
  resenaValida,
  resenaConTopes,
  REF_INEXISTENTE,
} from "../lib/datos.mjs";

const BOT = "5-fuzzing";

const registro = crearRegistro(BOT);
const urls = [config.urls.sitio, config.urls.pago, config.urls.panel];

exigirSoloLocal(BOT, urls);

const LARGO = "A".repeat(10_000);
const LARGUISIMO = "A".repeat(120_000);

const MUTACIONES = [
  { nombre: "string de 10k", valor: LARGO },
  { nombre: "string de 120k", valor: LARGUISIMO },
  { nombre: "vacío", valor: "" },
  { nombre: "solo espacios", valor: "        " },
  { nombre: "null", valor: null },
  { nombre: "número", valor: 12345 },
  { nombre: "negativo", valor: -1 },
  { nombre: "cero", valor: 0 },
  { nombre: "enorme", valor: 9_999_999_999_999 },
  { nombre: "decimal", valor: 1.5 },
  { nombre: "booleano", valor: true },
  { nombre: "array", valor: [1, 2, 3] },
  { nombre: "objeto", valor: { a: { b: { c: 1 } } } },
  { nombre: "xss", valor: "<script>alert(1)</script>" },
  { nombre: "xss atributo", valor: '"><img src=x onerror=alert(1)>' },
  { nombre: "sqli comilla", valor: "' OR '1'='1" },
  { nombre: "sqli drop", valor: "1; DROP TABLE booking_requests;--" },
  { nombre: "postgrest embed", valor: "*,payments(*)" },
  { nombre: "postgrest filtro", valor: "eq.1&select=*" },
  { nombre: "template", valor: "${7*7}" },
  { nombre: "plantilla doble", valor: "{{7*7}}" },
  { nombre: "traversal", valor: "../../../../etc/passwd" },
  { nombre: "traversal windows", valor: "..\\..\\..\\windows\\win.ini" },
  { nombre: "byte nulo", valor: "hola\u0000mundo" },
  { nombre: "salto de línea", valor: "linea1\r\nlinea2\r\n\r\n" },
  { nombre: "unicode raro", valor: "𝕥𝕖𝕤𝕥 🧨 ‮" },
  { nombre: "fecha imposible", valor: "2026-02-30" },
  { nombre: "fecha basura", valor: "9999-99-99" },
  { nombre: "uuid falso", valor: "no-soy-un-uuid" },
];

const RASTROS = [
  { patron: /\n\s+at\s+\w/, que: "stack trace de Node" },
  { patron: /at Object\.<anonymous>/, que: "stack trace de Node" },
  { patron: /node:internal/, que: "ruta interna de Node" },
  { patron: /node_modules[\\/]/, que: "ruta de node_modules" },
  { patron: /\/var\/task\//, que: "ruta de la lambda de Vercel" },
  { patron: /[A-Z]:\\Users\\/, que: "ruta absoluta de Windows" },
  { patron: /PGRST\d{3}/, que: "código de error de PostgREST" },
  { patron: /duplicate key value|violates \w+ constraint|relation "/i, que: "error crudo de Postgres" },
  { patron: /service_role|sb_secret_|SUPABASE_SERVICE/i, que: "clave secreta de Supabase" },
  { patron: /APP_USR-[\w-]{10,}/, que: "access token de MercadoPago (producción)" },
  { patron: /MP_ACCESS_TOKEN|RESEND_API_KEY|PANEL_SESION_SECRET/i, que: "nombre de variable secreta" },
  { patron: /postgres(ql)?:\/\/\S+:\S+@/i, que: "cadena de conexión con credenciales" },
  { patron: /ECONNREFUSED|ETIMEDOUT|ENOTFOUND/, que: "error de red sin envolver" },
];

const hallazgos = [];
let enviados = 0;

function anotar(severidad, caso, detalle, respuesta) {
  hallazgos.push({
    severidad,
    endpoint: `${caso.metodo} ${caso.ruta}`,
    caso: caso.titulo,
    detalle,
    status: respuesta?.status ?? null,
    muestra: (respuesta?.texto || "").slice(0, 300),
  });

  const linea = `${caso.metodo} ${caso.ruta} · ${caso.titulo} → ${detalle}`;
  if (severidad === "alta") registro.error(linea, { status: respuesta?.status });
  else registro.aviso(linea, { status: respuesta?.status });
}

function revisar(caso, respuesta) {
  if (respuesta.fallo) {
    anotar("alta", caso, `sin respuesta: ${respuesta.fallo}`, respuesta);
    return;
  }

  const cuerpo = respuesta.texto || "";
  const esApi = caso.ruta.startsWith("/api/");

  if (respuesta.status >= 500) {
    anotar("alta", caso, `respondió ${respuesta.status}`, respuesta);
  }

  for (const rastro of RASTROS) {
    if (rastro.patron.test(cuerpo)) {
      anotar("alta", caso, `filtra ${rastro.que}`, respuesta);
      break;
    }
  }

  if (esApi && respuesta.status !== 0) {
    const tipo = String(respuesta.cabeceras["content-type"] || "");
    if (!tipo.includes("application/json")) {
      anotar("media", caso, `Content-Type "${tipo || "ausente"}" en vez de JSON`, respuesta);
    }
  }

  if (esApi && respuesta.status >= 400 && respuesta.status < 500) {
    if (!respuesta.json || typeof respuesta.json.error !== "string") {
      anotar("media", caso, "error sin campo \"error\" legible", respuesta);
    }
  }

  if (caso.reflejo && cuerpo.includes(caso.reflejo)) {
    anotar("media", caso, "devuelve el payload sin escapar (reflejo)", respuesta);
  }

  if (caso.esperados && !caso.esperados.includes(respuesta.status)) {
    anotar(
      "media",
      caso,
      `status ${respuesta.status}, esperaba ${caso.esperados.join(" o ")}`,
      respuesta,
    );
  }
}

function ipRotativa() {
  const n = enviados;
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${(n % 254) + 1}`;
}

async function correr(caso) {
  enviados += 1;

  const respuesta = await pedir(caso.url, {
    metodo: caso.metodo,
    cuerpo: caso.cuerpo === undefined ? null : caso.cuerpo,
    cabeceras: { "X-Forwarded-For": ipRotativa(), ...caso.cabeceras },
    crudo: caso.crudo,
    timeoutMs: config.fuzzing.timeoutMs,
  });

  revisar(caso, respuesta);
  await dormir(config.fuzzing.pausaMs);
  return respuesta;
}

function reflejoDe(valor) {
  if (typeof valor !== "string") return null;
  if (valor.length < 6 || valor.length > 200) return null;
  return valor;
}

async function fuzzearCampos({ base, url, ruta, campos, esperados }) {
  for (const campo of campos) {
    for (const mutacion of MUTACIONES) {
      const cuerpo = { ...base };
      cuerpo[campo] = mutacion.valor;

      await correr({
        metodo: "POST",
        ruta,
        url,
        titulo: `${campo} = ${mutacion.nombre}`,
        cuerpo,
        esperados,
        reflejo: reflejoDe(mutacion.valor),
      });
    }

    const sinCampo = { ...base };
    delete sinCampo[campo];

    await correr({
      metodo: "POST",
      ruta,
      url,
      titulo: `${campo} = ausente`,
      cuerpo: sinCampo,
      esperados,
    });
  }
}

async function fuzzearCuerpo(url, ruta, esperados) {
  const raros = [
    { titulo: "cuerpo vacío", cuerpo: "", tipo: "application/json" },
    { titulo: "JSON roto", cuerpo: "{ esto no es json", tipo: "application/json" },
    { titulo: "array en la raíz", cuerpo: "[1,2,3]", tipo: "application/json" },
    { titulo: "string en la raíz", cuerpo: '"hola"', tipo: "application/json" },
    { titulo: "null en la raíz", cuerpo: "null", tipo: "application/json" },
    { titulo: "JSON anidado 200 niveles", cuerpo: "[".repeat(200) + "]".repeat(200), tipo: "application/json" },
    { titulo: "prototype pollution", cuerpo: '{"__proto__":{"admin":true}}', tipo: "application/json" },
    { titulo: "content-type de formulario", cuerpo: "nombre=x&dni=y", tipo: "application/x-www-form-urlencoded" },
    { titulo: "content-type XML (XXE)", cuerpo: '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY e SYSTEM "file:///etc/passwd">]><r>&e;</r>', tipo: "application/xml" },
    { titulo: "sin content-type", cuerpo: '{"nombre":"x"}', tipo: null },
  ];

  for (const raro of raros) {
    await correr({
      metodo: "POST",
      ruta,
      url,
      titulo: raro.titulo,
      cuerpo: raro.cuerpo,
      crudo: true,
      cabeceras: raro.tipo ? { "Content-Type": raro.tipo } : {},
      esperados,
    });
  }
}

async function fuzzearMetodos(url, ruta, permitidos) {
  for (const metodo of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    if (permitidos.includes(metodo)) continue;

    await correr({
      metodo,
      ruta,
      url,
      titulo: `método ${metodo} no permitido`,
      cuerpo: metodo === "GET" || metodo === "OPTIONS" ? undefined : {},
      esperados: [400, 401, 404, 405, 501],
    });
  }
}

async function fuzzearQuery({ url, ruta, parametros, esperados }) {
  for (const parametro of parametros) {
    for (const mutacion of MUTACIONES) {
      if (typeof mutacion.valor === "object" && mutacion.valor !== null) continue;
      if (String(mutacion.valor ?? "").length > 3000) continue;

      const destino = new URL(url);
      destino.searchParams.set(parametro, String(mutacion.valor));

      await correr({
        metodo: "GET",
        ruta,
        url: destino.toString(),
        titulo: `?${parametro} = ${mutacion.nombre}`,
        esperados,
        reflejo: reflejoDe(mutacion.valor),
      });
    }
  }
}

async function main() {
  registro.titulo("BOT 5 · Fuzzing y validación de inputs", [
    `Entorno: ${config.entorno}`,
    `Sitio: ${config.urls.sitio}   Pago: ${config.urls.pago}   Panel: ${config.urls.panel}`,
    ...avisoDeEscritura(BOT),
  ]);

  const baseConsulta = config.permitirEscritura ? consultaValida() : consultaConTopes();
  const baseResena = config.permitirEscritura ? resenaValida() : resenaConTopes();

  if (!config.permitirEscritura) {
    registro.info(
      "Base de consulta con dos campos inválidos a propósito (dni y check_in): " +
        "como el fuzzer muta un campo por vez, siempre queda uno que hace fallar la validación " +
        "antes del insert.",
    );
    registro.info("Base de reseña igual, con name y rating inválidos.");
  }

  registro.info(
    "Cada pedido va con un X-Forwarded-For distinto: si no, el tope de 5 consultas " +
      "por IP por hora corta el fuzzing en el sexto pedido. El tope se verifica en el bot 6.",
  );

  registro.seccion("Sitio · POST /api/consulta");
  await fuzzearCampos({
    base: baseConsulta,
    url: `${config.urls.sitio}/api/consulta`,
    ruta: "/api/consulta",
    esperados: [400, 409, 429],
    campos: [
      "nombre",
      "email",
      "dni",
      "telefono",
      "telefonoPais",
      "check_in",
      "check_out",
      "personas",
      "adultos",
      "ninos",
      "edades_ninos",
      "vehiculo",
      "vehiculo_anio",
      "vehiculo_tipo",
      "procedencia",
      "mensaje",
    ],
  });

  await fuzzearCuerpo(`${config.urls.sitio}/api/consulta`, "/api/consulta", [400, 429]);
  await fuzzearMetodos(`${config.urls.sitio}/api/consulta`, "/api/consulta", ["POST"]);

  registro.seccion("Sitio · POST /api/resena");
  await fuzzearCampos({
    base: baseResena,
    url: `${config.urls.sitio}/api/resena`,
    ruta: "/api/resena",
    esperados: [400, 409, 429],
    campos: ["name", "rating", "text"],
  });

  await fuzzearCuerpo(`${config.urls.sitio}/api/resena`, "/api/resena", [400, 429]);
  await fuzzearMetodos(`${config.urls.sitio}/api/resena`, "/api/resena", ["POST"]);

  registro.seccion("Sitio · GET /api/ocupacion");
  await fuzzearQuery({
    url: `${config.urls.sitio}/api/ocupacion`,
    ruta: "/api/ocupacion",
    parametros: ["desde", "select", "id"],
    esperados: [200],
  });
  await fuzzearMetodos(`${config.urls.sitio}/api/ocupacion`, "/api/ocupacion", ["GET"]);

  registro.seccion("Pago · GET /api/reserva");
  await fuzzearQuery({
    url: `${config.urls.pago}/api/reserva`,
    ruta: "/api/reserva",
    parametros: ["ref", "modo"],
    esperados: [400, 404],
  });
  await fuzzearMetodos(`${config.urls.pago}/api/reserva`, "/api/reserva", ["GET"]);

  registro.seccion("Pago · POST /api/pagos");
  await fuzzearCampos({
    base: { ref: REF_INEXISTENTE, modo: "reserva", formData: { token: "x", payment_method_id: "visa", installments: 1 } },
    url: `${config.urls.pago}/api/pagos`,
    ruta: "/api/pagos",
    esperados: [400, 404, 409],
    campos: ["ref", "modo", "formData"],
  });
  await fuzzearCuerpo(`${config.urls.pago}/api/pagos`, "/api/pagos", [400, 404]);
  await fuzzearMetodos(`${config.urls.pago}/api/pagos`, "/api/pagos", ["POST"]);

  registro.seccion("Pago · POST /api/comprobante");
  await fuzzearCampos({
    base: { ref: REF_INEXISTENTE, modo: "reserva", accion: "firmar", mime: "image/png" },
    url: `${config.urls.pago}/api/comprobante`,
    ruta: "/api/comprobante",
    esperados: [400, 404, 409],
    campos: ["ref", "modo", "accion", "mime", "path"],
  });

  registro.info("Path de otra reserva: probando que la subida no se pueda apuntar afuera");
  for (const path of [
    "../otra-reserva/robado.png",
    "/etc/passwd",
    `${REF_INEXISTENTE}/../../algo.png`,
    "11111111-1111-4111-8111-111111111111/ajeno.png",
  ]) {
    await correr({
      metodo: "POST",
      ruta: "/api/comprobante",
      url: `${config.urls.pago}/api/comprobante`,
      titulo: `path ajeno "${path}"`,
      cuerpo: { ref: REF_INEXISTENTE, modo: "reserva", accion: "registrar", path },
      esperados: [400, 404, 409],
    });
  }

  registro.seccion("Pago · POST /api/webhook");
  for (const caso of [
    { titulo: "sin firma", cabeceras: {} },
    { titulo: "firma vacía", cabeceras: { "x-signature": "", "x-request-id": "x" } },
    { titulo: "firma inventada", cabeceras: { "x-signature": "ts=1,v1=deadbeef", "x-request-id": "x" } },
    { titulo: "firma con inyección", cabeceras: { "x-signature": "ts=1,v1=' OR '1'='1", "x-request-id": "../.." } },
    { titulo: "ts enorme", cabeceras: { "x-signature": "ts=99999999999999,v1=aa", "x-request-id": "x" } },
  ]) {
    await correr({
      metodo: "POST",
      ruta: "/api/webhook",
      url: `${config.urls.pago}/api/webhook?type=payment&data.id=123`,
      titulo: caso.titulo,
      cuerpo: { type: "payment", data: { id: "123" } },
      cabeceras: caso.cabeceras,
      esperados: [401],
    });
  }

  registro.seccion("Panel · endpoints protegidos, sin sesión");
  const protegidos = [
    { ruta: "/api/tarifas", metodo: "GET" },
    { ruta: "/api/tarifas", metodo: "PUT", cuerpo: {} },
    { ruta: "/api/alquileres", metodo: "GET" },
    { ruta: "/api/resenas", metodo: "GET" },
    { ruta: "/api/resenas", metodo: "PATCH", cuerpo: { id: REF_INEXISTENTE, aprobada: true } },
    { ruta: "/api/resenas", metodo: "DELETE", cuerpo: { id: REF_INEXISTENTE } },
    { ruta: "/api/comprobantes", metodo: "GET" },
    { ruta: "/api/comprobantes", metodo: "PATCH", cuerpo: { id: REF_INEXISTENTE, estado: "confirmado" } },
    { ruta: "/api/cancelar", metodo: "POST", cuerpo: { paymentId: "1", devolver: true } },
  ];

  for (const endpoint of protegidos) {
    await correr({
      metodo: endpoint.metodo,
      ruta: endpoint.ruta,
      url: `${config.urls.panel}${endpoint.ruta}`,
      titulo: "sin cookie de sesión",
      cuerpo: endpoint.cuerpo,
      esperados: [401],
    });
  }

  registro.seccion("Panel · cookie de sesión falsificada");
  for (const galleta of [
    "panel_sesion=cualquiera",
    "panel_sesion=eyJleHAiOjk5OTk5OTk5OTk5OTl9.firmatrucha",
    `panel_sesion=${Buffer.from(JSON.stringify({ exp: 9_999_999_999_999 })).toString("base64url")}.aaaa`,
    "panel_sesion=.",
    "panel_sesion=a.b.c.d",
  ]) {
    await correr({
      metodo: "GET",
      ruta: "/api/alquileres",
      url: `${config.urls.panel}/api/alquileres`,
      titulo: `cookie "${galleta.slice(0, 40)}…"`,
      cabeceras: { Cookie: galleta },
      esperados: [401],
    });
  }

  registro.seccion("Panel · POST /api/login");
  registro.info(
    "Solo 4 payloads: el endpoint bloquea a los 8 intentos fallidos por IP en 10 minutos. " +
      "El bot 6 se encarga de verificar ese tope.",
  );

  for (const codigo of [null, "", { $ne: "" }, "' OR '1'='1"]) {
    await correr({
      metodo: "POST",
      ruta: "/api/login",
      url: `${config.urls.panel}/api/login`,
      titulo: `codigo = ${JSON.stringify(codigo)}`,
      cuerpo: { codigo },
      esperados: [401, 429],
    });
  }

  mkdirSync(CARPETA_REPORTES, { recursive: true });
  const reporte = join(CARPETA_REPORTES, `fuzzing-${new Date().toISOString().slice(0, 10)}.json`);

  const altas = hallazgos.filter((h) => h.severidad === "alta");
  const medias = hallazgos.filter((h) => h.severidad === "media");

  writeFileSync(
    reporte,
    JSON.stringify(
      {
        bot: BOT,
        fecha: new Date().toISOString(),
        entorno: config.entorno,
        urls: config.urls,
        escrituraHabilitada: config.permitirEscritura,
        pedidosEnviados: enviados,
        hallazgos,
      },
      null,
      2,
    ),
    "utf8",
  );

  registro.seccion("Resultado");
  registro.info(`${enviados} pedidos enviados`);

  if (!hallazgos.length) {
    registro.ok("Ningún input rompió la validación: sin 5xx, sin stack traces, sin fugas.");
  } else {
    registro.info(`${altas.length} hallazgos altos, ${medias.length} medios`);
  }

  registro.info(`Reporte: ${reporte}`);

  const salida = registro.cierre();
  process.exit(altas.length ? 1 : salida);
}

main().catch((error) => {
  registro.error(`el bot se cayó: ${error.stack || error.message}`);
  registro.cierre();
  process.exit(1);
});
