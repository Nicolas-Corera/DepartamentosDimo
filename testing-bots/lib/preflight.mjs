import { connect } from "node:net";

import { config } from "./config.mjs";
import { esLocal } from "./guardia.mjs";

const COMANDOS = {
  sitio: "npm run dev",
  pago: "npm run dev:pago",
  panel: "npm run dev:dashboard",
};

const NOMBRES = {
  sitio: "sitio público",
  pago: "checkout",
  panel: "panel",
};

function responde(url) {
  const { hostname, port, protocol } = new URL(url);
  const puerto = Number(port || (protocol === "https:" ? 443 : 80));

  return new Promise((resolver) => {
    const socket = connect({ host: hostname, port: puerto });
    let listo = false;

    function terminar(motivo) {
      if (listo) return;
      listo = true;
      socket.destroy();
      resolver({ vivo: motivo === null, motivo });
    }

    socket.setTimeout(4000);
    socket.once("connect", () => terminar(null));
    socket.once("timeout", () => terminar("no contestó en 4s"));
    socket.once("error", (error) => terminar(error.code || error.message));
  });
}

export async function servidoresListos(bot, apps) {
  const aRevisar = apps.filter((app) => esLocal(config.urls[app]));
  if (!aRevisar.length) return true;

  const caidos = [];

  for (const app of aRevisar) {
    const { vivo, motivo } = await responde(`${config.urls[app]}/`);
    if (!vivo) caidos.push({ app, url: config.urls[app], motivo });
  }

  if (!caidos.length) return true;

  console.log("");
  console.log("  ███  FALTAN DEV SERVERS  ███");
  console.log("");
  console.log(`  Bot: ${bot}`);
  console.log("");
  console.log(`  ${caidos.length === 1 ? "No responde" : "No responden"}:`);
  console.log("");

  for (const caido of caidos) {
    console.log(`    ✖ ${NOMBRES[caido.app].padEnd(16)} ${caido.url}   (${caido.motivo})`);
  }

  console.log("");
  console.log("  Abrí una ventana por cada uno, desde la raíz del repo, y dejalas abiertas:");
  console.log("");
  for (const caido of caidos) console.log(`      ${COMANDOS[caido.app]}`);
  console.log("");
  console.log("  Después volvé a correr este bot.");
  console.log("");
  console.log("  Si los tenés levantados en otros puertos, corregí URL_SITIO / URL_PAGO /");
  console.log("  URL_PANEL en testing-bots/.env.");
  console.log("");

  return false;
}
