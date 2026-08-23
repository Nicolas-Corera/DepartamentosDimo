import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { config, RAIZ, CARPETA_REPORTES } from "../lib/config.mjs";
import { exigirSoloLocal } from "../lib/guardia.mjs";
import { crearRegistro } from "../lib/registro.mjs";

const BOT = "3-carga";

const registro = crearRegistro(BOT);
const urls = [config.urls.sitio, config.urls.pago];

exigirSoloLocal(BOT, urls);

function hayK6() {
  const prueba = spawnSync("k6", ["version"], { encoding: "utf8", shell: true });
  return prueba.status === 0 ? (prueba.stdout || "").trim().split("\n")[0] : null;
}

function sello() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

const version = hayK6();

if (!version) {
  registro.error("k6 no está instalado (o no está en el PATH).");
  console.log("");
  console.log("  Instalalo con cualquiera de estas:");
  console.log("");
  console.log("    winget install k6 --source winget");
  console.log("    choco install k6");
  console.log("");
  console.log("  O bajá el .exe de https://github.com/grafana/k6/releases");
  console.log("  y ponelo en una carpeta que esté en el PATH.");
  console.log("");
  registro.cierre();
  process.exit(1);
}

registro.titulo("BOT 3 · Carga (k6)", [
  version,
  `Sitio: ${config.urls.sitio}`,
  `Pago:  ${config.urls.pago}`,
  `Usuarios: ${config.carga.usuarios}   Ramp-up: ${config.carga.rampUp}   Meseta: ${config.carga.duracion}   Bajada: ${config.carga.bajada}`,
  `Umbrales: p95 < ${config.carga.p95Ms}ms, fallos < ${(config.carga.maxFallos * 100).toFixed(1)}%`,
  "",
  "Este bot NUNCA escribe: la consulta que manda lleva un payload inválido a propósito,",
  "así mide el camino de validación sin insertar filas ni disparar mails.",
]);

mkdirSync(CARPETA_REPORTES, { recursive: true });

const guion = join(RAIZ, "bots", "3-carga.js");

const entorno = {
  ...process.env,
  URL_SITIO: config.urls.sitio,
  URL_PAGO: config.urls.pago,
  REF_DE_PRUEBA: config.refDePrueba || "",
  CARGA_USUARIOS: String(config.carga.usuarios),
  CARGA_RAMP_UP: config.carga.rampUp,
  CARGA_DURACION: config.carga.duracion,
  CARGA_BAJADA: config.carga.bajada,
  CARGA_P95_MS: String(config.carga.p95Ms),
  CARGA_MAX_FALLOS: String(config.carga.maxFallos),
  SELLO: sello(),
};

const corrida = spawnSync("k6", ["run", guion], {
  cwd: RAIZ,
  env: entorno,
  stdio: "inherit",
  shell: true,
});

if (corrida.status === 0) {
  registro.ok("La corrida terminó y todos los umbrales se cumplieron.");
} else if (corrida.status === 99) {
  registro.error("Algún umbral no se cumplió (p95 o tasa de fallos). Mirá el resumen de arriba.");
} else {
  registro.error(`k6 terminó con código ${corrida.status}.`);
}

registro.info(`Reportes en ${CARPETA_REPORTES}`);
registro.cierre();

process.exit(corrida.status ?? 1);
