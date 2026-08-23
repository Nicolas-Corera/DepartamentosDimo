import { config } from "./config.mjs";

const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "[::1]"]);

const DOMINIOS_DE_PRODUCCION = [
  "departamentosdimo.com.ar",
  "pago.departamentosdimo.com.ar",
  "dash.departamentosdimo.com.ar",
];

export function hostDe(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function esLocal(url) {
  const host = hostDe(url);
  if (!host) return false;
  if (HOSTS_LOCALES.has(host)) return true;
  return host.endsWith(".localhost");
}

export function esProduccion(url) {
  const host = hostDe(url);
  if (!host) return false;
  return DOMINIOS_DE_PRODUCCION.some((d) => host === d || host.endsWith(`.${d}`));
}

function abortar(bot, lineas) {
  console.error("");
  console.error("  ███  BOT ABORTADO  ███");
  console.error("");
  console.error(`  Bot: ${bot}`);
  for (const linea of lineas) console.error(`  ${linea}`);
  console.error("");
  process.exit(1);
}

export function exigirSoloLocal(bot, urls) {
  const lista = Array.isArray(urls) ? urls : [urls];
  const afuera = lista.filter((u) => !esLocal(u));

  if (!afuera.length) return;

  const enProduccion = afuera.filter((u) => esProduccion(u));

  abortar(bot, [
    "Este bot solo puede correr contra localhost.",
    "",
    ...afuera.map((u) => `  ✖ ${u}`),
    "",
    enProduccion.length
      ? "Una de esas URLs es PRODUCCIÓN. No hay flag para forzarlo: cambiá ENTORNO=local en el .env."
      : "Cambiá ENTORNO=local en el .env, o corregí URL_SITIO / URL_PAGO / URL_PANEL.",
    "",
    "Para levantar los dev servers, desde la raíz del repo:",
    "  npm run dev            (sitio,     http://localhost:8000)",
    "  npm run dev:pago       (checkout,  http://localhost:3000)",
    "  npm run dev:dashboard  (panel,     http://localhost:3100)",
  ]);
}

export function exigirSoloLectura(bot, urls) {
  const lista = Array.isArray(urls) ? urls : [urls];
  const enProduccion = lista.filter((u) => esProduccion(u));

  if (enProduccion.length && config.permitirEscritura) {
    abortar(bot, [
      "PERMITIR_ESCRITURA=1 con URLs de producción. Eso no se hace.",
      "",
      ...enProduccion.map((u) => `  ✖ ${u}`),
      "",
      "Poné PERMITIR_ESCRITURA=0 en el .env, o pasá a ENTORNO=local.",
    ]);
  }

  return enProduccion;
}

export function avisoDeEscritura(bot) {
  if (!config.permitirEscritura) {
    return [
      "MODO SECO (PERMITIR_ESCRITURA=0)",
      "No se inserta nada en Supabase ni se manda ningún mail.",
    ];
  }

  return [
    "⚠️  ESCRITURA HABILITADA (PERMITIR_ESCRITURA=1)",
    "Este bot va a insertar filas reales en Supabase y disparar mails reales.",
    "Los dev servers locales usan las credenciales de PRODUCCIÓN.",
  ];
}
