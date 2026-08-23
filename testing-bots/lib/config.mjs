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
    sitio: env("URL_SITIO", base.sitio).replace(/\/+$/, ""),
    pago: env("URL_PAGO", base.pago).replace(/\/+$/, ""),
    panel: env("URL_PANEL", base.panel).replace(/\/+$/, ""),
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
