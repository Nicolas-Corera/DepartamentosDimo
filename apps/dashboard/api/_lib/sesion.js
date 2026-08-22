import crypto from "node:crypto";
import { leerConfig, HORAS_DE_SESION } from "./env.js";
import { ErrorVisible } from "./http.js";

const COOKIE = "panel_sesion";

function firmar(datos, secreto) {
  return crypto.createHmac("sha256", secreto).update(datos).digest("base64url");
}

export function codigoEsCorrecto(codigoRecibido) {
  const { codigo } = leerConfig();
  const a = crypto.createHash("sha256").update(String(codigoRecibido || "")).digest();
  const b = crypto.createHash("sha256").update(codigo).digest();
  return crypto.timingSafeEqual(a, b);
}

export function abrirSesion(res) {
  const { secreto, entorno } = leerConfig();

  const vence = Date.now() + HORAS_DE_SESION * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ exp: vence })).toString("base64url");
  const valor = `${payload}.${firmar(payload, secreto)}`;

  const partes = [
    `${COOKIE}=${valor}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${HORAS_DE_SESION * 60 * 60}`,
  ];

  if (entorno !== "development") partes.push("Secure");

  res.setHeader("Set-Cookie", partes.join("; "));
  return vence;
}

export function cerrarSesion(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

function leerCookie(req, nombre) {
  const crudo = req.headers?.cookie || "";
  for (const parte of crudo.split(";")) {
    const i = parte.indexOf("=");
    if (i === -1) continue;
    if (parte.slice(0, i).trim() === nombre) return parte.slice(i + 1).trim();
  }
  return null;
}

export function haySesion(req) {
  const valor = leerCookie(req, COOKIE);
  if (!valor) return false;

  const punto = valor.lastIndexOf(".");
  if (punto === -1) return false;

  const payload = valor.slice(0, punto);
  const firma = valor.slice(punto + 1);

  const { secreto } = leerConfig();
  const esperada = firmar(payload, secreto);

  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof exp === "number" && Date.now() < exp;
  } catch {
    return false;
  }
}

export function exigirSesion(req) {
  if (!haySesion(req)) {
    throw new ErrorVisible(401, "Tu sesión venció. Volvé a entrar con el código.", "sin_sesion");
  }
}

const MAX_INTENTOS = 8;
const VENTANA_MS = 10 * 60 * 1000;
const intentos = new Map();

function ipDe(req) {
  const reenviada = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return reenviada || req.socket?.remoteAddress || "desconocida";
}

export function registrarIntentoFallido(req) {
  const ip = ipDe(req);
  const ahora = Date.now();
  const previos = (intentos.get(ip) || []).filter((t) => ahora - t < VENTANA_MS);
  previos.push(ahora);
  intentos.set(ip, previos);
}

export function limpiarIntentos(req) {
  intentos.delete(ipDe(req));
}

export function estaBloqueado(req) {
  const ahora = Date.now();
  const previos = (intentos.get(ipDe(req)) || []).filter((t) => ahora - t < VENTANA_MS);
  return previos.length >= MAX_INTENTOS;
}
