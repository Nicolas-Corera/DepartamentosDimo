import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATRONES = [
  ["clave secreta de Supabase", /sb_secret_[A-Za-z0-9_-]{10,}/],
  ["token de administración de Supabase", /sbp_[a-f0-9]{40}/],
  ["JWT de Supabase (service_role o anon viejo)", /eyJhbGciOi[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/],
  ["token de GitHub", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/],
  ["token de GitHub (fine-grained)", /\bgithub_pat_[A-Za-z0-9_]{30,}/],
  ["token de Vercel", /\bvcp_[A-Za-z0-9]{20,}/],
  ["clave de Resend", /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/],
  ["access token de MercadoPago (producción)", /APP_USR-[0-9]{8,}-[0-9]{6}-[a-f0-9]{32}/],
  ["access token de MercadoPago (prueba)", /TEST-[0-9]{10,}-[0-9]{6}-[a-f0-9]{32}/],
  ["clave privada", /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
];

const PLACEHOLDER =
  /0{7,}|x{7,}|X{7,}|\.\.\.\.|tu[-_]|TU_|ejemplo|example|<[^>]{3,}>|abc123|aqui|AQUI|pega|PEGA/;

const SALTEAR = /^(node_modules\/|\.git\/|package-lock\.json$)|\.(png|jpe?g|gif|webp|avif|ico|pdf|woff2?|ttf|mp4|zip)$/i;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
}

function revisar(texto, origen, hallazgos) {
  const lineas = texto.split("\n");

  for (const [nombre, patron] of PATRONES) {
    const global = new RegExp(patron.source, "g");
    let m;
    while ((m = global.exec(texto)) !== null) {
      if (PLACEHOLDER.test(m[0])) continue;

      let nro = 1;
      let acumulado = 0;
      for (const l of lineas) {
        if (acumulado + l.length + 1 > m.index) break;
        acumulado += l.length + 1;
        nro += 1;
      }

      hallazgos.push({
        origen,
        linea: nro,
        nombre,
        muestra: `${m[0].slice(0, 12)}…${m[0].slice(-4)}`,
      });
    }
  }
}

function archivosEnStage() {
  return git(["diff", "--cached", "--name-only", "--diff-filter=ACM"])
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s && !SALTEAR.test(s));
}

function contenidoEnStage(ruta) {
  try {
    return git(["show", `:${ruta}`]);
  } catch {
    return "";
  }
}

function blobsDelHistorial() {
  const salida = git(["cat-file", "--batch-check", "--batch-all-objects"]);
  return salida
    .split("\n")
    .map((l) => l.split(" "))
    .filter((x) => x.length >= 2 && x[1] === "blob")
    .map((x) => x[0]);
}

const modo = process.argv[2] || "--stage";
const hallazgos = [];

if (modo === "--historial") {
  const blobs = blobsDelHistorial();
  console.log(`Revisando ${blobs.length} blobs de todo el historial…`);
  for (const sha of blobs) {
    let texto;
    try {
      texto = execFileSync("git", ["cat-file", "blob", sha], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
    } catch {
      continue;
    }
    if (texto.includes("\0")) continue;
    revisar(texto, `blob ${sha.slice(0, 8)}`, hallazgos);
  }
} else if (modo === "--todo") {
  const rutas = git(["ls-files"]).split("\n").map((s) => s.trim()).filter((s) => s && !SALTEAR.test(s));
  console.log(`Revisando ${rutas.length} archivos del repo…`);
  for (const ruta of rutas) {
    try {
      revisar(readFileSync(ruta, "utf8"), ruta, hallazgos);
    } catch {
      // binario o ilegible
    }
  }
} else {
  for (const ruta of archivosEnStage()) {
    revisar(contenidoEnStage(ruta), ruta, hallazgos);
  }
}

if (hallazgos.length === 0) {
  if (modo !== "--stage") console.log("Sin credenciales. Todo limpio.");
  process.exit(0);
}

const vistos = new Set();
console.error("\n  Se encontraron credenciales:\n");
for (const h of hallazgos) {
  const clave = `${h.origen}:${h.linea}:${h.muestra}`;
  if (vistos.has(clave)) continue;
  vistos.add(clave);
  console.error(`    ${h.origen}:${h.linea}`);
  console.error(`      ${h.nombre} — ${h.muestra}\n`);
}

if (modo === "--stage") {
  console.error("  El commit se cortó. Sacá la credencial del archivo y volvé a intentar.");
  console.error("  Si es un placeholder y no una clave real, cambiá el valor por uno");
  console.error("  obviamente falso (ceros, xxxx, tu-clave-aca).\n");
  console.error("  Para saltear el hook en un caso puntual:  git commit --no-verify\n");
} else {
  console.error("  Si alguna es real, hay que ROTARLA. Borrarla del repo no alcanza:");
  console.error("  ya está en el historial y cualquiera con acceso la puede recuperar.\n");
}

process.exit(1);
