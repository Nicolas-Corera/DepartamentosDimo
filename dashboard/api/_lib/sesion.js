/**
 * api/_lib/sesion.js
 * ---------------------------------------------------------------------------
 * El código de acceso y la cookie de sesión.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ LA VERIFICACIÓN ES DEL LADO DEL SERVIDOR
 *
 * La tentación obvia es comparar el código en el JavaScript del login y, si da,
 * mostrar el panel. Eso no protege nada: el código quedaría escrito en un
 * archivo que cualquiera descarga, y aunque no estuviera, el panel se abre
 * igual salteando la comprobación desde la consola.
 *
 * Lo que de verdad hay que proteger no es la pantalla: son los ENDPOINTS. Del
 * otro lado hay datos personales de los huéspedes, la lista de pagos y un botón
 * que mueve plata de verdad. Por eso el código viaja al servidor, se compara
 * acá contra `PANEL_CODIGO`, y lo que vuelve es una cookie firmada que cada
 * endpoint exige antes de hacer nada.
 *
 * ---------------------------------------------------------------------------
 * LA COOKIE
 *
 *     <payload en base64url>.<HMAC-SHA256 del payload>
 *
 * El payload solo lleva cuándo vence. No hay usuarios ni roles que guardar: o
 * tenés el código o no lo tenés. La firma es lo que impide fabricarla a mano —
 * sin `PANEL_SESION_SECRET` no se puede calcular el HMAC.
 *
 * Va HttpOnly (el JavaScript de la página no la puede leer, así que un XSS no
 * se la lleva), Secure (no viaja por HTTP) y SameSite=Strict (no se manda en
 * pedidos que nacen en otro sitio, que es lo que frena el CSRF: sin eso, una
 * página cualquiera podría hacerle POST al endpoint de devolución con tu cookie
 * puesta).
 */

import crypto from "node:crypto";
import { leerConfig, HORAS_DE_SESION } from "./env.js";
import { ErrorVisible } from "./http.js";

const COOKIE = "panel_sesion";

function firmar(datos, secreto) {
  return crypto.createHmac("sha256", secreto).update(datos).digest("base64url");
}

/**
 * Compara el código en tiempo constante.
 *
 * Con un `===` común, el tiempo que tarda la comparación depende de cuántos
 * caracteres coinciden desde el principio. Sobre 6 dígitos eso alcanza para
 * adivinarlo dígito por dígito midiendo la demora de las respuestas, en vez de
 * probar el millón de combinaciones. `timingSafeEqual` siempre tarda lo mismo.
 *
 * Se comparan los hashes y no los valores crudos porque timingSafeEqual exige
 * que los dos buffers midan igual, y filtrar el largo del código por la vía de
 * un error sería regalar la mitad del trabajo.
 */
export function codigoEsCorrecto(codigoRecibido) {
  const { codigo } = leerConfig();
  const a = crypto.createHash("sha256").update(String(codigoRecibido || "")).digest();
  const b = crypto.createHash("sha256").update(codigo).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Arma la cookie firmada y la pone en la respuesta. */
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
  // En `vercel dev` y en localhost no hay HTTPS: con Secure la cookie no se
  // guardaría y el panel sería imposible de probar en local.
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

/** ¿La cookie es nuestra y sigue vigente? */
export function haySesion(req) {
  const valor = leerCookie(req, COOKIE);
  if (!valor) return false;

  const punto = valor.lastIndexOf(".");
  if (punto === -1) return false;

  const payload = valor.slice(0, punto);
  const firma = valor.slice(punto + 1);

  const { secreto } = leerConfig();
  const esperada = firmar(payload, secreto);

  // Los dos son base64url del mismo largo, así que acá timingSafeEqual no
  // necesita hashear nada antes.
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

/**
 * El portero de todos los endpoints salvo el login. Tirar en vez de devolver
 * un booleano es a propósito: un `if (!exigirSesion(req)) return;` que alguien
 * se olvida de escribir deja el endpoint abierto, y un `throw` no se olvida.
 */
export function exigirSesion(req) {
  if (!haySesion(req)) {
    throw new ErrorVisible(401, "Tu sesión venció. Volvé a entrar con el código.", "sin_sesion");
  }
}

/* ---------------------------------------------------------------------------
   Freno a la fuerza bruta

   Un código de 6 dígitos es un millón de combinaciones: a mil intentos por
   segundo se prueba entero en veinte minutos. Esto lo hace inviable.

   Es en memoria, así que en serverless cada instancia lleva su propia cuenta y
   un atacante con suerte cae en instancias distintas. Aun así sube el costo del
   ataque un par de órdenes de magnitud, y la alternativa seria (una tabla en
   Supabase, con su latencia en cada intento) no la vale para un panel de una
   sola persona. Si algún día hace falta más, el lugar es este.
   --------------------------------------------------------------------------- */

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
