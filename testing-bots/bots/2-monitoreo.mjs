import { config } from "../lib/config.mjs";
import { esProduccion, exigirSoloLectura } from "../lib/guardia.mjs";
import { crearRegistro } from "../lib/registro.mjs";
import { servidoresListos } from "../lib/preflight.mjs";
import { pedir, dormir } from "../lib/http.mjs";

const BOT = "2-monitoreo";

const registro = crearRegistro(BOT);
const urls = [config.urls.sitio, config.urls.pago, config.urls.panel];

exigirSoloLectura(BOT, urls);
if (!(await servidoresListos(BOT, ["sitio", "pago", "panel"]))) process.exit(1);

const argumentos = process.argv.slice(2);
const bucle = argumentos.includes("--bucle") || argumentos.includes("--loop");

const intervaloArg = argumentos.find((a) => a.startsWith("--intervalo="));
const intervaloSegundos = intervaloArg
  ? Number(intervaloArg.split("=")[1])
  : config.monitoreo.intervaloSegundos;

const CABECERAS_ESPERADAS = [
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
];

const CHEQUEOS = [
  {
    app: "sitio",
    nombre: "portada",
    ruta: "/",
    status: [200],
    contiene: ["bookingForm", "DepartamentosDimo"],
    cabeceras: true,
  },
  { app: "sitio", nombre: "hoja de estilos", ruta: "/style.css", status: [200], contiene: [":root"] },
  { app: "sitio", nombre: "script principal", ruta: "/script.js", status: [200], contiene: ["/api/consulta"] },
  { app: "sitio", nombre: "freno de botones", ruta: "/botones.js", status: [200] },
  {
    app: "sitio",
    nombre: "API de ocupación",
    ruta: "/api/ocupacion",
    status: [200],
    json: (cuerpo) => (Array.isArray(cuerpo?.fechas) ? null : "no devolvió el array \"fechas\""),
  },
  {
    app: "sitio",
    nombre: "API de consulta viva",
    ruta: "/api/consulta",
    status: [405],
    json: (cuerpo) => (cuerpo?.error ? null : "un GET a /api/consulta debería dar 405 con mensaje"),
  },

  {
    app: "pago",
    nombre: "checkout",
    ruta: "/",
    status: [200],
    contiene: ["cardPaymentBrick_container", "pantalla-carga"],
    cabeceras: true,
  },
  { app: "pago", nombre: "script del checkout", ruta: "/pago.js", status: [200], contiene: ["/api/reserva"] },
  {
    app: "pago",
    nombre: "API de reserva viva",
    ruta: "/api/reserva",
    status: [400],
    json: (cuerpo) =>
      cuerpo?.codigo === "sin_ref" ? null : `esperaba codigo "sin_ref", vino "${cuerpo?.codigo}"`,
  },
  {
    app: "pago",
    nombre: "webhook cerrado sin firma",
    ruta: "/api/webhook?type=payment&data.id=1",
    metodo: "POST",
    cuerpo: { type: "payment", data: { id: "1" } },
    status: [401],
  },

  {
    app: "panel",
    nombre: "pantalla de acceso",
    ruta: "/login_panel.html",
    status: [200],
    contiene: ["otp-form"],
    cabeceras: true,
  },
  {
    app: "panel",
    nombre: "sesión cerrada por defecto",
    ruta: "/api/sesion",
    status: [401],
    json: (cuerpo) =>
      cuerpo?.codigo === "sin_sesion" ? null : `esperaba codigo "sin_sesion", vino "${cuerpo?.codigo}"`,
  },
  { app: "panel", nombre: "alquileres protegido", ruta: "/api/alquileres", status: [401] },
  { app: "panel", nombre: "tarifas protegido", ruta: "/api/tarifas", status: [401] },
];

async function correrChequeo(chequeo) {
  const url = `${config.urls[chequeo.app]}${chequeo.ruta}`;

  const respuesta = await pedir(url, {
    metodo: chequeo.metodo || "GET",
    cuerpo: chequeo.cuerpo ?? null,
    timeoutMs: config.monitoreo.timeoutMs,
  });

  const etiqueta = `${chequeo.app} · ${chequeo.nombre}`;
  const fallas = [];

  if (respuesta.fallo) {
    registro.error(`${etiqueta} — sin respuesta: ${respuesta.fallo}`, { url });
    return false;
  }

  if (!chequeo.status.includes(respuesta.status)) {
    fallas.push(`status ${respuesta.status} (esperaba ${chequeo.status.join(" o ")})`);
  }

  for (const texto of chequeo.contiene || []) {
    if (!respuesta.texto.includes(texto)) fallas.push(`no contiene "${texto}"`);
  }

  if (chequeo.json) {
    const problema = chequeo.json(respuesta.json);
    if (problema) fallas.push(problema);
  }

  if (fallas.length) {
    registro.error(`${etiqueta} — ${fallas.join("; ")}`, { url, ms: respuesta.ms });
    return false;
  }

  if (chequeo.cabeceras && esProduccion(url)) {
    const faltantes = CABECERAS_ESPERADAS.filter((c) => !respuesta.cabeceras[c]);
    if (faltantes.length) {
      registro.aviso(`${etiqueta} — sin cabeceras: ${faltantes.join(", ")}`, { url });
    }
  }

  if (respuesta.ms > config.monitoreo.umbralMs) {
    registro.aviso(`${etiqueta} — lento: ${respuesta.ms}ms (umbral ${config.monitoreo.umbralMs}ms)`, {
      url,
    });
    return true;
  }

  registro.ok(`${etiqueta}`, { status: respuesta.status, ms: respuesta.ms });
  return true;
}

async function unaVuelta() {
  let caidos = 0;

  for (const chequeo of CHEQUEOS) {
    const bien = await correrChequeo(chequeo);
    if (!bien) caidos += 1;
  }

  return caidos;
}

async function main() {
  const enProduccion = urls.filter((u) => esProduccion(u));

  registro.titulo("BOT 2 · Monitoreo sintético", [
    `Entorno: ${config.entorno}`,
    `Sitio: ${config.urls.sitio}`,
    `Pago:  ${config.urls.pago}`,
    `Panel: ${config.urls.panel}`,
    enProduccion.length
      ? "Contra PRODUCCIÓN: solo GET y un POST al webhook sin firma (que se rechaza sin efecto)."
      : "Contra local. Las cabeceras de seguridad no se revisan: las pone Vercel, no el dev server.",
    bucle ? `En bucle cada ${intervaloSegundos}s. Ctrl+C para cortar.` : "Una sola pasada.",
  ]);

  if (!bucle) {
    const caidos = await unaVuelta();

    if (caidos) registro.error(`${caidos} chequeos fallaron`);
    else registro.ok("Todos los chequeos pasaron");

    process.exit(registro.cierre());
  }

  for (;;) {
    registro.seccion(`Pasada de las ${new Date().toLocaleTimeString("es-AR")}`);
    const caidos = await unaVuelta();

    if (caidos) registro.error(`${caidos} chequeos fallaron en esta pasada`);
    else registro.ok("Pasada limpia");

    await dormir(intervaloSegundos * 1000);
  }
}

main().catch((error) => {
  registro.error(`el bot se cayó: ${error.stack || error.message}`);
  registro.cierre();
  process.exit(1);
});
