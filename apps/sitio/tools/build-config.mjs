import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ENV_CANDIDATOS = [resolve(ROOT, ".env"), resolve(ROOT, "..", "..", ".env")];
const ENV_FILE = ENV_CANDIDATOS.find((ruta) => existsSync(ruta)) || ENV_CANDIDATOS[0];
const OUT_FILE = resolve(ROOT, "supabase-config.js");
const CHECK_ONLY = process.argv.includes("--check");

const PUBLIC_VARS = ["SUPABASE_URL", "SUPABASE_ANON_KEY"];

function parseEnv(raw) {
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = trimmed.slice(eq + 1).trim();

    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);

    out[key] = value;
  }
  return out;
}

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

const fileEnv = existsSync(ENV_FILE)
  ? parseEnv(readFileSync(ENV_FILE, "utf8"))
  : {};
const origen = existsSync(ENV_FILE) ? ".env" : "process.env";

const env = {};
for (const name of PUBLIC_VARS) {
  env[name] = fileEnv[name] || process.env[name] || "";
}

for (const name of PUBLIC_VARS) {
  if (!env[name]) {
    fail(
      `Falta la variable ${name} (no está ni en el .env ni en el entorno).`,
      existsSync(ENV_FILE)
        ? "Completala en el .env. El valor está en Supabase → Project Settings → API."
        : "En local: cp .env.example .env y completalo. " +
          "En Vercel: Settings → Environment Variables. Ver SUPABASE.md, sección 3.",
    );
  }
}

const url = env.SUPABASE_URL.replace(/\/+$/, "");
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

const banner = "";

const body = `
(function () {
  "use strict";

  var SUPABASE_URL = ${JSON.stringify(url)};
  var SUPABASE_ANON_KEY = ${JSON.stringify(anonKey)};

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

const output = `${banner}${body}`;

if (CHECK_ONLY) {
  console.log(`
  OK  configuración válida (origen: ${origen})`);
  console.log(`      SUPABASE_URL       ${url}`);
  console.log(`      SUPABASE_ANON_KEY  ${maskKey(anonKey)}  (clave pública)`);
  console.log("      (--check: no se escribió ningún archivo)\n");
  process.exit(0);
}

writeFileSync(OUT_FILE, output, "utf8");

console.log("\n  OK  supabase-config.js generado");
console.log(`      desde              ${origen}`);
console.log(`      hacia              ${relative(ROOT, OUT_FILE)}`);
console.log(`      SUPABASE_URL       ${url}`);
console.log(`      SUPABASE_ANON_KEY  ${maskKey(anonKey)}  (clave pública)\n`);
