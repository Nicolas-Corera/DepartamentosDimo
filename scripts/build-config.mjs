/**
 * scripts/build-config.mjs
 * ---------------------------------------------------------------------------
 * Genera `supabase-config.js` (el archivo que carga el navegador) a partir de
 * las variables guardadas en `.env`.
 *
 *   node scripts/build-config.mjs        -> genera el archivo
 *   node scripts/build-config.mjs --check -> solo valida, no escribe nada
 *
 * Por qué existe: el sitio es HTML/CSS/JS plano, no hay bundler que lea el
 * `.env` por vos. Este script hace ese trabajo: lee el `.env`, valida que las
 * claves tengan sentido y escribe el archivo final.
 *
 * Regla de oro: SOLO las variables listadas en PUBLIC_VARS llegan al navegador.
 * Si alguna vez guardás una `service_role` / `sb_secret_...` en el `.env`, este
 * script la ignora, y si la pusiste por error en SUPABASE_ANON_KEY, aborta.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = resolve(ROOT, ".env");
const OUT_FILE = resolve(ROOT, "supabase-config.js");
const CHECK_ONLY = process.argv.includes("--check");

// Las únicas variables que se copian al archivo público.
const PUBLIC_VARS = ["SUPABASE_URL", "SUPABASE_ANON_KEY"];

/* --------------------------------------------------------------------------
   Parseo del .env (sin dependencias: no hace falta instalar nada)
   -------------------------------------------------------------------------- */

function parseEnv(raw) {
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = trimmed.slice(eq + 1).trim();

    // Saca comillas envolventes si las hay: FOO="bar" -> bar
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);

    out[key] = value;
  }
  return out;
}

/* --------------------------------------------------------------------------
   Validaciones
   -------------------------------------------------------------------------- */

function fail(msg, hint) {
  console.error(`\n  ERROR  ${msg}`);
  if (hint) console.error(`         ${hint}`);
  console.error("");
  process.exit(1);
}

function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Clasifica la clave para no publicar nunca una secreta.
 * Supabase tiene dos formatos vigentes:
 *   - clave publicable nueva: sb_publishable_...   (secreta: sb_secret_...)
 *   - clave anon legacy: un JWT eyJ... con el claim role = "anon"
 *                        (la secreta es el mismo formato con role="service_role")
 */
function classifyKey(key) {
  if (key.startsWith("sb_secret_")) return "secret";
  if (key.startsWith("sb_publishable_")) return "public";

  if (key.startsWith("eyJ")) {
    const payload = decodeJwtPayload(key);
    if (!payload) return "unknown";
    if (payload.role === "service_role") return "secret";
    if (payload.role === "anon") return "public";
    return "unknown";
  }
  return "unknown";
}

function maskKey(key) {
  if (key.length <= 20) return `${key.slice(0, 4)}…`;
  return `${key.slice(0, 12)}…${key.slice(-4)}`;
}

/* --------------------------------------------------------------------------
   Main
   -------------------------------------------------------------------------- */

if (!existsSync(ENV_FILE)) {
  fail(
    "No existe el archivo .env en la raíz del proyecto.",
    "Copiá la plantilla:  cp .env.example .env   (en PowerShell: copy .env.example .env)",
  );
}

const env = parseEnv(readFileSync(ENV_FILE, "utf8"));

for (const name of PUBLIC_VARS) {
  if (!env[name]) {
    fail(
      `Falta la variable ${name} en el .env (o está vacía).`,
      "Está en Supabase → Project Settings → API. Ver SUPABASE.md, sección 3.",
    );
  }
}

const url = env.SUPABASE_URL.replace(/\/+$/, ""); // saca la barra final si la pegaste
const anonKey = env.SUPABASE_ANON_KEY;

if (!/^https:\/\//.test(url)) {
  fail(
    `SUPABASE_URL tiene que empezar con https:// (recibí: "${url}")`,
    'Formato esperado: https://xxxxxxxxxxxx.supabase.co  — sin barra al final y sin "/rest/v1".',
  );
}
if (/\/(rest|auth|storage)\b/.test(url)) {
  fail(
    "SUPABASE_URL trae un path de más.",
    "Tiene que ser solo el origen: https://xxxxxxxxxxxx.supabase.co",
  );
}
if (url.includes("xxxxxxxx")) {
  fail(
    "SUPABASE_URL todavía tiene el valor de ejemplo.",
    "Pegá la Project URL real de tu proyecto de Supabase.",
  );
}

const kind = classifyKey(anonKey);
if (kind === "secret") {
  fail(
    "SUPABASE_ANON_KEY contiene una clave SECRETA (service_role / sb_secret_).",
    "Esa clave saltea RLS y NUNCA puede ir al navegador. Usá la anon / publishable.",
  );
}
if (kind === "unknown") {
  fail(
    "SUPABASE_ANON_KEY no parece una clave válida de Supabase.",
    'Tiene que empezar con "sb_publishable_" o ser un JWT que empieza con "eyJ".',
  );
}

/* --------------------------------------------------------------------------
   Salida
   -------------------------------------------------------------------------- */

const banner = [
  "/* =========================================================================",
  "   ARCHIVO GENERADO — NO LO EDITES A MANO.",
  "",
  "   Se genera con `npm run config` a partir de las variables del .env.",
  "   Si tenés que cambiar la URL o la clave, editá el .env y volvé a correrlo.",
  "",
  "   La clave anon/publishable es pública por diseño: queda visible en el",
  "   código del sitio y está bien. La seguridad real la dan las políticas RLS",
  "   de la tabla. Ver SUPABASE.md.",
  "   ========================================================================= */",
].join("\n");

const body = `
(function () {
  "use strict";

  var SUPABASE_URL = ${JSON.stringify(url)};
  var SUPABASE_ANON_KEY = ${JSON.stringify(anonKey)};

  // El build UMD del CDN expone el namespace global \`supabase\`. Por eso el
  // cliente se guarda en \`db\`: si lo llamáramos \`supabase\` pisaríamos el
  // namespace y el próximo createClient() rompería.
  if (typeof supabase === "undefined" || typeof supabase.createClient !== "function") {
    console.error(
      "[supabase] El SDK no está cargado. En index.html el <script> del CDN " +
        "tiene que ir ANTES de supabase-config.js."
    );
    return;
  }

  window.db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
})();
`;

const output = `${banner}\n${body}`;

if (CHECK_ONLY) {
  console.log("\n  OK  .env válido");
  console.log(`      SUPABASE_URL       ${url}`);
  console.log(`      SUPABASE_ANON_KEY  ${maskKey(anonKey)}  (clave pública)`);
  console.log("      (--check: no se escribió ningún archivo)\n");
  process.exit(0);
}

writeFileSync(OUT_FILE, output, "utf8");

console.log("\n  OK  supabase-config.js generado");
console.log(`      desde              ${relative(ROOT, ENV_FILE)}`);
console.log(`      hacia              ${relative(ROOT, OUT_FILE)}`);
console.log(`      SUPABASE_URL       ${url}`);
console.log(`      SUPABASE_ANON_KEY  ${maskKey(anonKey)}  (clave pública)\n`);
