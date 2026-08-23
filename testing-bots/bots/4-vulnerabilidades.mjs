import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { config, CARPETA_REPORTES } from "../lib/config.mjs";
import { exigirSoloLocal, hostDe } from "../lib/guardia.mjs";
import { crearRegistro } from "../lib/registro.mjs";
import { servidoresListos } from "../lib/preflight.mjs";

const BOT = "4-vulnerabilidades";

const registro = crearRegistro(BOT);

const argumentos = process.argv.slice(2);
const sueltas = argumentos.filter((a) => !a.startsWith("--"));

const APPS = { sitio: config.urls.sitio, pago: config.urls.pago, panel: config.urls.panel };

function objetivosPedidos() {
  if (sueltas.length) {
    return sueltas.map((valor) => {
      if (APPS[valor]) return { nombre: valor, url: APPS[valor] };
      return { nombre: hostDe(valor) || "objetivo", url: valor.replace(/\/+$/, "") };
    });
  }

  if (argumentos.includes("--todo")) {
    return Object.entries(APPS).map(([nombre, url]) => ({ nombre, url }));
  }

  return [{ nombre: "sitio", url: APPS.sitio }];
}

const objetivos = objetivosPedidos();

exigirSoloLocal(BOT, objetivos.map((o) => o.url));
const apps = objetivos
  .map((o) => o.nombre)
  .filter((n) => ["sitio", "pago", "panel"].includes(n));

if (!(await servidoresListos(BOT, apps))) process.exit(1);

function hayDocker() {
  const prueba = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    encoding: "utf8",
    shell: true,
  });
  return prueba.status === 0 ? (prueba.stdout || "").trim() : null;
}

function paraElContenedor(url) {
  const destino = new URL(url);
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(destino.hostname)) {
    destino.hostname = "host.docker.internal";
  }
  return destino.toString().replace(/\/+$/, "");
}

const version = hayDocker();

if (!version) {
  registro.error("Docker no está corriendo (o no está instalado).");
  console.log("");
  console.log("  El baseline scan de OWASP ZAP corre dentro de un contenedor.");
  console.log("");
  console.log("  1. Instalá Docker Desktop:  winget install Docker.DockerDesktop");
  console.log("  2. Abrilo y esperá a que el ícono diga \"Engine running\".");
  console.log("  3. Volvé a correr este bot.");
  console.log("");
  console.log("  Si no querés instalar Docker, el bot 5 (fuzzing) y el 6 (rate limiting)");
  console.log("  ya cubren buena parte de lo que ZAP marcaría en estos endpoints.");
  console.log("");
  registro.cierre();
  process.exit(1);
}

registro.titulo("BOT 4 · Escaneo de vulnerabilidades (OWASP ZAP baseline)", [
  `Docker engine ${version}`,
  `Imagen: ${config.vulnerabilidades.imagenZap}`,
  `Objetivos: ${objetivos.map((o) => `${o.nombre} (${o.url})`).join(", ")}`,
  "",
  "Baseline scan: solo spider pasivo y reglas pasivas. No manda ataques activos,",
  "no borra nada y no llena la base de basura.",
]);

mkdirSync(CARPETA_REPORTES, { recursive: true });

const fecha = new Date().toISOString().slice(0, 10);
let peorSalida = 0;

for (const objetivo of objetivos) {
  const destino = paraElContenedor(objetivo.url);
  const nombreReporte = `zap-${objetivo.nombre}-${fecha}.html`;

  registro.seccion(`${objetivo.nombre} → ${destino}`);
  registro.info(`Reporte: ${join(CARPETA_REPORTES, nombreReporte)}`);

  const argumentosDocker = [
    "run",
    "--rm",
    "--add-host=host.docker.internal:host-gateway",
    "-v",
    `${CARPETA_REPORTES}:/zap/wrk/:rw`,
    "-t",
    config.vulnerabilidades.imagenZap,
    "zap-baseline.py",
    "-t",
    destino,
    "-r",
    nombreReporte,
    "-J",
    nombreReporte.replace(/\.html$/, ".json"),
    "-m",
    String(config.vulnerabilidades.minutosMaximos),
    "-I",
  ];

  const corrida = spawnSync("docker", argumentosDocker, { stdio: "inherit", shell: false });

  if (corrida.error) {
    registro.error(`no se pudo lanzar docker: ${corrida.error.message}`);
    peorSalida = 1;
    continue;
  }

  if (corrida.status === 0) {
    registro.ok(`${objetivo.nombre}: sin hallazgos de nivel FAIL`);
  } else if (corrida.status === 2) {
    registro.aviso(`${objetivo.nombre}: hay WARN en el reporte. Abrilo y revisá cuáles aplican.`);
  } else {
    registro.error(`${objetivo.nombre}: ZAP terminó con código ${corrida.status}`);
    peorSalida = 1;
  }
}

registro.seccion("Resultado");
registro.info(`Reportes HTML y JSON en ${CARPETA_REPORTES}`);
registro.info(
  "Ojo con los falsos positivos típicos de este proyecto: ZAP suele marcar la falta de " +
    "anti-CSRF token en los formularios, pero acá la API es JSON sin cookies de sesión " +
    "(salvo el panel, que usa SameSite=Strict).",
);

const salida = registro.cierre();
process.exit(peorSalida || salida);
