import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const RAIZ_REPO = resolve(RAIZ, "..");

export const CARPETA_LOGS = join(RAIZ, "logs");
export const CARPETA_REPORTES = join(RAIZ, "reportes");

function leerArchivoEnv(ruta) {
  let crudo;
  try {
    crudo = readFileSync(ruta, "utf8");
  } catch {
    return {};
  }

  const salida = {};
  for (const linea of crudo.split(/\r?\n/)) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#")) continue;

    const corte = limpia.indexOf("=");
    if (corte === -1) continue;

    const clave = limpia.slice(0, corte).trim();
    let valor = limpia.slice(corte + 1).trim();

    const comillas =
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"));
    if (comillas && valor.length >= 2) valor = valor.slice(1, -1);

    if (clave) salida[clave] = valor;
  }
  return salida;
}

const propio = leerArchivoEnv(join(RAIZ, ".env"));
const delPanel = leerArchivoEnv(join(RAIZ_REPO, "apps", "dashboard", ".env"));

function env(clave, porDefecto = null) {
  const valor = process.env[clave] ?? propio[clave];
  return valor === undefined || valor === null || valor === "" ? porDefecto : valor;
}

function numero(valor, porDefecto) {
  if (valor === null || valor === undefined || valor === "") return porDefecto;
  const n = Number(valor);
  return Number.isFinite(n) ? n : porDefecto;
}

const ARCHIVO_ENV = join(RAIZ, ".env");

function lineaEnElEnv(clave) {
  try {
    const lineas = readFileSync(ARCHIVO_ENV, "utf8").split(/\r?\n/);
    const i = lineas.findIndex((l) => l.trim().startsWith(`${clave}=`));
    return i === -1 ? null : i + 1;
  } catch {
    return null;
  }
}

function exigirUrlValida(clave, valor) {
  const limpio = String(valor || "").trim().replace(/\/+$/, "");

  let url;
  try {
    url = new URL(limpio);
  } catch {
    url = null;
  }

  if (!url || !["http:", "https:"].includes(url.protocol) || !url.hostname) {
    const linea = lineaEnElEnv(clave);

    console.error("");
    console.error("  ███  CONFIGURACIÓN INVÁLIDA  ███");
    console.error("");
    console.error(`  ${clave} no es una URL válida:`);
    console.error("");
    console.error(`      ${clave}=${limpio || "(vacío)"}`);
    console.error("");

    if (linea) {
      console.error(`  Está en la línea ${linea} de:`);
      console.error(`      ${ARCHIVO_ENV}`);
    } else {
      console.error("  Viene de config.json o de una variable de entorno.");
    }

    console.error("");
    console.error("  Tiene que ser algo así, con UN solo dos puntos antes del puerto:");
    console.error("");
    console.error("      URL_SITIO=http://localhost:8000");
    console.error("      URL_PAGO=http://localhost:3000");
    console.error("      URL_PANEL=http://localhost:3100");
    console.error("");
    console.error("  Si las querés tomar de config.json, dejalas vacías.");
    console.error("");
    process.exit(1);
  }

  return limpio;
}

const archivo = JSON.parse(readFileSync(join(RAIZ, "config.json"), "utf8"));

const entorno = env("ENTORNO", archivo.entornoPorDefecto);
const base = archivo.entornos[entorno];

if (!base) {
  const validos = Object.keys(archivo.entornos).join(", ");
  throw new Error(`ENTORNO="${entorno}" no existe en config.json. Válidos: ${validos}.`);
}

export const config = {
  entorno,

  urls: {
    sitio: exigirUrlValida("URL_SITIO", env("URL_SITIO", base.sitio)),
    pago: exigirUrlValida("URL_PAGO", env("URL_PAGO", base.pago)),
    panel: exigirUrlValida("URL_PANEL", env("URL_PANEL", base.panel)),
  },

  permitirEscritura: env("PERMITIR_ESCRITURA", "0") === "1",
  codigoDelPanel: env("PANEL_CODIGO", delPanel.PANEL_CODIGO || null),
  refDePrueba: env("REF_DE_PRUEBA", null),

  monitoreo: {
    umbralMs: numero(env("MONITOREO_UMBRAL_MS"), archivo.monitoreo.umbralMs),
    timeoutMs: numero(env("MONITOREO_TIMEOUT_MS"), archivo.monitoreo.timeoutMs),
    intervaloSegundos: numero(
      env("MONITOREO_INTERVALO"),
      archivo.monitoreo.intervaloSegundos,
    ),
  },

  carga: {
    usuarios: numero(env("CARGA_USUARIOS"), archivo.carga.usuarios),
    rampUp: env("CARGA_RAMP_UP", archivo.carga.rampUp),
    duracion: env("CARGA_DURACION", archivo.carga.duracion),
    bajada: env("CARGA_BAJADA", archivo.carga.bajada),
    p95Ms: numero(env("CARGA_P95_MS"), archivo.carga.p95Ms),
    maxFallos: numero(env("CARGA_MAX_FALLOS"), archivo.carga.maxFallos),
  },

  fuzzing: {
    timeoutMs: numero(env("FUZZING_TIMEOUT_MS"), archivo.fuzzing.timeoutMs),
    pausaMs: numero(env("FUZZING_PAUSA_MS"), archivo.fuzzing.pausaMs),
  },

  rateLimit: {
    rafaga: numero(env("RATE_RAFAGA"), archivo.rateLimit.rafaga),
    pausaMs: numero(env("RATE_PAUSA_MS"), archivo.rateLimit.pausaMs),
    topesEsperados: archivo.rateLimit.topesEsperados,
  },

  vulnerabilidades: {
    imagenZap: env("ZAP_IMAGEN", archivo.vulnerabilidades.imagenZap),
    minutosMaximos: numero(
      env("ZAP_MINUTOS"),
      archivo.vulnerabilidades.minutosMaximos,
    ),
  },
};

export function urlDeApp(app) {
  const url = config.urls[app];
  if (!url) throw new Error(`No conozco la app "${app}". Usá: sitio, pago o panel.`);
  return url;
}
