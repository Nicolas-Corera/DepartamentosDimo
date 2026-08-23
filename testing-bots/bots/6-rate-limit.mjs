import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { config, CARPETA_REPORTES } from "../lib/config.mjs";
import { exigirSoloLocal } from "../lib/guardia.mjs";
import { crearRegistro } from "../lib/registro.mjs";
import { servidoresListos } from "../lib/preflight.mjs";
import { pedir, dormir } from "../lib/http.mjs";
import { consultaConTopes, resenaConTopes, REF_INEXISTENTE } from "../lib/datos.mjs";

const BOT = "6-rate-limit";

const registro = crearRegistro(BOT);
const urls = [config.urls.sitio, config.urls.pago, config.urls.panel];

exigirSoloLocal(BOT, urls);
if (!(await servidoresListos(BOT, ["sitio", "pago", "panel"]))) process.exit(1);

const SEMILLA = Date.now();

function ipDeLaTanda(indice) {
  const a = (SEMILLA >> 16) % 250;
  const b = (SEMILLA >> 8) % 250;
  return `198.51.${a + 1}.${((b + indice * 7) % 250) + 1}`;
}

const RAFAGA = Math.max(config.rateLimit.rafaga, 12);

const OBJETIVOS = [
  {
    clave: "consulta",
    etiqueta: "Sitio · POST /api/consulta",
    url: `${config.urls.sitio}/api/consulta`,
    metodo: "POST",
    cuerpo: () => consultaConTopes(),
    topeEsperado: config.rateLimit.topesEsperados.consulta,
    exigirLimite: true,
    nota: "tope por IP en api/_lib/limite.js",
  },
  {
    clave: "resena",
    etiqueta: "Sitio · POST /api/resena",
    url: `${config.urls.sitio}/api/resena`,
    metodo: "POST",
    cuerpo: () => resenaConTopes(),
    topeEsperado: config.rateLimit.topesEsperados.resena,
    exigirLimite: true,
    nota: "tope por IP en api/_lib/limite.js",
  },
  {
    clave: "login",
    etiqueta: "Panel · POST /api/login",
    url: `${config.urls.panel}/api/login`,
    metodo: "POST",
    cuerpo: () => ({ codigo: String(100000 + Math.floor(Math.random() * 899999)) }),
    topeEsperado: config.rateLimit.topesEsperados.login,
    exigirLimite: true,
    nota: "bloqueo por intentos fallidos en api/_lib/sesion.js",
  },
  {
    clave: "pagos",
    etiqueta: "Pago · POST /api/pagos",
    url: `${config.urls.pago}/api/pagos`,
    metodo: "POST",
    cuerpo: () => ({ ref: REF_INEXISTENTE, modo: "reserva", formData: { token: "x" } }),
    topeEsperado: null,
    exigirLimite: false,
    nota: "hoy no tiene tope propio; la reserva inexistente corta antes de llamar a MercadoPago",
  },
  {
    clave: "comprobante",
    etiqueta: "Pago · POST /api/comprobante",
    url: `${config.urls.pago}/api/comprobante`,
    metodo: "POST",
    cuerpo: () => ({ ref: REF_INEXISTENTE, modo: "reserva", accion: "firmar", mime: "image/png" }),
    topeEsperado: null,
    exigirLimite: false,
    nota: "hoy no tiene tope propio; es uno de los endpoints que mandan mail",
  },
  {
    clave: "reserva",
    etiqueta: "Pago · GET /api/reserva",
    url: `${config.urls.pago}/api/reserva?ref=${REF_INEXISTENTE}`,
    metodo: "GET",
    cuerpo: () => null,
    topeEsperado: null,
    exigirLimite: false,
    nota: "hoy no tiene tope propio; cada llamada pega tres veces contra Supabase",
  },
];

function detectarCaptcha(respuesta) {
  const cuerpo = (respuesta.texto || "").toLowerCase();
  return /captcha|recaptcha|hcaptcha|turnstile/.test(cuerpo);
}

async function medirObjetivo(objetivo, indice) {
  const ip = ipDeLaTanda(indice);
  registro.seccion(`${objetivo.etiqueta}  (IP simulada ${ip})`);
  registro.info(objetivo.nota);

  const intentos = [];
  let primer429 = null;
  let captcha = false;

  for (let i = 1; i <= RAFAGA; i += 1) {
    const respuesta = await pedir(objetivo.url, {
      metodo: objetivo.metodo,
      cuerpo: objetivo.cuerpo(),
      cabeceras: { "X-Forwarded-For": ip },
      timeoutMs: config.fuzzing.timeoutMs,
    });

    intentos.push({ n: i, status: respuesta.status, ms: respuesta.ms, codigo: respuesta.json?.codigo || null });

    if (detectarCaptcha(respuesta)) captcha = true;

    if (respuesta.status === 429 && primer429 === null) {
      primer429 = i;
      registro.ok(`freno activado en el intento ${i}`, {
        codigo: respuesta.json?.codigo || null,
        mensaje: (respuesta.json?.error || "").slice(0, 90),
      });
    }

    if (respuesta.fallo) {
      registro.error(`intento ${i} sin respuesta: ${respuesta.fallo}`);
      break;
    }

    await dormir(config.rateLimit.pausaMs);
  }

  const resultado = {
    endpoint: objetivo.etiqueta,
    clave: objetivo.clave,
    ipSimulada: ip,
    rafaga: RAFAGA,
    primer429,
    topeEsperado: objetivo.topeEsperado,
    exigirLimite: objetivo.exigirLimite,
    captcha,
    intentos,
  };

  if (primer429 === null) {
    if (objetivo.exigirLimite) {
      registro.error(
        `SIN LÍMITE: ${RAFAGA} pedidos seguidos y ninguno fue rechazado con 429. ` +
          `Se esperaba el freno en el pedido ${objetivo.topeEsperado + 1}.`,
      );
      resultado.veredicto = "sin_limite_y_deberia_tener";
    } else {
      registro.aviso(
        `SIN LÍMITE: ${RAFAGA} pedidos seguidos, ninguno rechazado. ` +
          "Es un hueco conocido (ver docs/SEGURIDAD.md, parte B).",
      );
      resultado.veredicto = "sin_limite_conocido";
    }
    return resultado;
  }

  const esperado = objetivo.topeEsperado === null ? null : objetivo.topeEsperado + 1;

  if (esperado !== null && primer429 !== esperado) {
    registro.aviso(
      `el freno cortó en el pedido ${primer429}, se esperaba en el ${esperado}. ` +
        "Puede ser que ya hubiera pedidos previos de esa IP en la ventana.",
    );
    resultado.veredicto = "limite_en_otro_numero";
  } else {
    registro.ok(`límite verificado: corta en el pedido ${primer429}`);
    resultado.veredicto = "limite_ok";
  }

  if (!captcha) registro.info("no se ofreció CAPTCHA: el freno es solo por cupo");

  return resultado;
}

async function main() {
  registro.titulo("BOT 6 · Rate limiting y abuso", [
    `Entorno: ${config.entorno}`,
    `Ráfaga: ${RAFAGA} pedidos por endpoint`,
    "Cada endpoint usa una IP simulada distinta (X-Forwarded-For), nueva en cada corrida.",
    "Así el cupo arranca limpio y no te bloqueás tu propia IP por una hora.",
    "Los payloads son inválidos a propósito: el cupo se descuenta antes de validar, así que",
    "el freno se puede medir sin insertar una sola fila.",
  ]);

  const resultados = [];

  for (let i = 0; i < OBJETIVOS.length; i += 1) {
    resultados.push(await medirObjetivo(OBJETIVOS[i], i));
  }

  mkdirSync(CARPETA_REPORTES, { recursive: true });
  const reporte = join(CARPETA_REPORTES, `rate-limit-${new Date().toISOString().slice(0, 10)}.json`);

  writeFileSync(
    reporte,
    JSON.stringify(
      { bot: BOT, fecha: new Date().toISOString(), entorno: config.entorno, resultados },
      null,
      2,
    ),
    "utf8",
  );

  registro.seccion("Resumen");
  for (const r of resultados) {
    const texto =
      r.primer429 === null
        ? `SIN LÍMITE en ${r.rafaga} pedidos`
        : `corta en el pedido ${r.primer429}`;
    registro.info(`${r.endpoint.padEnd(32)} ${texto}`);
  }

  const sinLimiteGrave = resultados.filter((r) => r.veredicto === "sin_limite_y_deberia_tener");
  registro.info(`Reporte: ${reporte}`);

  const salida = registro.cierre();
  process.exit(sinLimiteGrave.length ? 1 : salida);
}

main().catch((error) => {
  registro.error(`el bot se cayó: ${error.stack || error.message}`);
  registro.cierre();
  process.exit(1);
});
