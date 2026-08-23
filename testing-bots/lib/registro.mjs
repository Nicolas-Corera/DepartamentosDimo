import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CARPETA_LOGS } from "./config.mjs";

const COLORES = {
  info: "\x1b[36m",
  ok: "\x1b[32m",
  aviso: "\x1b[33m",
  error: "\x1b[31m",
  gris: "\x1b[90m",
  fin: "\x1b[0m",
};

const ETIQUETAS = {
  info: "INFO ",
  ok: "OK   ",
  aviso: "AVISO",
  error: "ERROR",
};

function marca() {
  return new Date().toISOString();
}

export function crearRegistro(nombre) {
  mkdirSync(CARPETA_LOGS, { recursive: true });
  const archivo = join(CARPETA_LOGS, `${nombre}.log`);

  const cuenta = { info: 0, ok: 0, aviso: 0, error: 0 };

  function escribir(nivel, mensaje, extra) {
    cuenta[nivel] += 1;

    const cola = extra ? ` ${JSON.stringify(extra)}` : "";
    const linea = `${marca()} [${ETIQUETAS[nivel].trim()}] [${nombre}] ${mensaje}${cola}`;

    try {
      appendFileSync(archivo, `${linea}\n`, "utf8");
    } catch {
      /* si no se puede escribir el log, la consola alcanza */
    }

    const color = COLORES[nivel] || "";
    console.log(
      `${COLORES.gris}${marca().slice(11, 19)}${COLORES.fin} ` +
        `${color}${ETIQUETAS[nivel]}${COLORES.fin} ${mensaje}` +
        (extra ? ` ${COLORES.gris}${JSON.stringify(extra)}${COLORES.fin}` : ""),
    );
  }

  return {
    archivo,
    cuenta,
    info: (m, e) => escribir("info", m, e),
    ok: (m, e) => escribir("ok", m, e),
    aviso: (m, e) => escribir("aviso", m, e),
    error: (m, e) => escribir("error", m, e),

    titulo(texto, lineas = []) {
      const ancho = 74;
      console.log("");
      console.log(`${COLORES.info}${"═".repeat(ancho)}${COLORES.fin}`);
      console.log(`  ${texto}`);
      for (const linea of lineas) console.log(`  ${COLORES.gris}${linea}${COLORES.fin}`);
      console.log(`${COLORES.info}${"═".repeat(ancho)}${COLORES.fin}`);
      console.log("");
      appendFileSync(archivo, `${marca()} [INICIO] [${nombre}] ${texto}\n`, "utf8");
    },

    seccion(texto) {
      console.log("");
      console.log(`  ${COLORES.info}── ${texto} ${"─".repeat(Math.max(0, 66 - texto.length))}${COLORES.fin}`);
    },

    cierre() {
      console.log("");
      console.log(
        `  ${COLORES.ok}${cuenta.ok} ok${COLORES.fin}  ·  ` +
          `${COLORES.aviso}${cuenta.aviso} avisos${COLORES.fin}  ·  ` +
          `${COLORES.error}${cuenta.error} errores${COLORES.fin}`,
      );
      console.log(`  ${COLORES.gris}log: ${archivo}${COLORES.fin}`);
      console.log("");

      appendFileSync(
        archivo,
        `${marca()} [CIERRE] [${nombre}] ok=${cuenta.ok} avisos=${cuenta.aviso} errores=${cuenta.error}\n\n`,
        "utf8",
      );

      return cuenta.error === 0 ? 0 : 1;
    },
  };
}
