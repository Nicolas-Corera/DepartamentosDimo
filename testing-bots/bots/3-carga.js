import http from "k6/http";
import { check, group, sleep } from "k6";
import { Trend } from "k6/metrics";

const SITIO = (__ENV.URL_SITIO || "").replace(/\/+$/, "");
const PAGO = (__ENV.URL_PAGO || "").replace(/\/+$/, "");
const REF = __ENV.REF_DE_PRUEBA || "";

const USUARIOS = Number(__ENV.CARGA_USUARIOS || 10);
const RAMP_UP = __ENV.CARGA_RAMP_UP || "15s";
const DURACION = __ENV.CARGA_DURACION || "45s";
const BAJADA = __ENV.CARGA_BAJADA || "10s";
const P95 = Number(__ENV.CARGA_P95_MS || 1500);
const MAX_FALLOS = Number(__ENV.CARGA_MAX_FALLOS || 0.02);
const SELLO = __ENV.SELLO || "corrida";

const HOSTS_LOCALES = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];

function esLocal(url) {
  if (!url) return false;
  const sinEsquema = url.replace(/^https?:\/\//, "");
  const host = sinEsquema.split("/")[0].split(":")[0].toLowerCase();
  if (HOSTS_LOCALES.indexOf(host) !== -1) return true;
  return host.length > 10 && host.slice(-10) === ".localhost";
}

for (const objetivo of [SITIO, PAGO]) {
  if (!esLocal(objetivo)) {
    throw new Error(
      "\n\n  ███  BOT DE CARGA ABORTADO  ███\n\n" +
        `  URL fuera de localhost: ${objetivo || "(vacía)"}\n` +
        "  El bot de carga solo puede correr contra los dev servers locales.\n" +
        "  Cambiá ENTORNO=local en testing-bots/.env.\n",
    );
  }
}

const portada = new Trend("dimo_portada_ms", true);
const ocupacion = new Trend("dimo_ocupacion_ms", true);
const validacion = new Trend("dimo_validacion_consulta_ms", true);
const checkout = new Trend("dimo_checkout_reserva_ms", true);

export const options = {
  scenarios: {
    flujo_principal: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: RAMP_UP, target: USUARIOS },
        { duration: DURACION, target: USUARIOS },
        { duration: BAJADA, target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    http_req_failed: [`rate<${MAX_FALLOS}`],
    http_req_duration: [`p(95)<${P95}`],
    checks: ["rate>0.98"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

const ESPERADOS_CONSULTA = http.expectedStatuses(400, 409, 429);
const ESPERADOS_RESERVA = http.expectedStatuses(200, 400, 404);

function ipSimulada() {
  return `172.16.${__VU % 250}.${(__ITER % 250) + 1}`;
}

export default function () {
  const cabeceras = {
    "User-Agent": "DimoTestingBot/1.0 (carga)",
    "X-Forwarded-For": ipSimulada(),
  };

  group("sitio · huésped que mira", function () {
    const home = http.get(`${SITIO}/`, { headers: cabeceras, tags: { paso: "portada" } });
    portada.add(home.timings.duration);

    check(home, {
      "portada 200": (r) => r.status === 200,
      "portada trae el formulario": (r) => r.body.indexOf("bookingForm") !== -1,
    });

    http.batch([
      ["GET", `${SITIO}/style.css`, null, { headers: cabeceras, tags: { paso: "css" } }],
      ["GET", `${SITIO}/script.js`, null, { headers: cabeceras, tags: { paso: "js" } }],
      ["GET", `${SITIO}/botones.js`, null, { headers: cabeceras, tags: { paso: "js" } }],
    ]);
  });

  group("sitio · calendario de disponibilidad", function () {
    const fechas = http.get(`${SITIO}/api/ocupacion`, {
      headers: cabeceras,
      tags: { paso: "ocupacion" },
    });
    ocupacion.add(fechas.timings.duration);

    check(fechas, {
      "ocupacion 200": (r) => r.status === 200,
      "ocupacion devuelve fechas": (r) => {
        try {
          return Array.isArray(r.json("fechas"));
        } catch (e) {
          return false;
        }
      },
    });
  });

  group("sitio · validación de la consulta", function () {
    const cuerpo = JSON.stringify({
      nombre: `CARGA ${__VU}-${__ITER}`,
      email: `carga.${__VU}.${__ITER}@example.com`,
      dni: "",
      telefono: "1159367822",
      telefonoPais: "54",
      check_in: "2020-01-01",
      check_out: "2020-01-04",
      personas: 2,
      adultos: 2,
      ninos: 0,
      edades_ninos: [],
      vehiculo: false,
    });

    const respuesta = http.post(`${SITIO}/api/consulta`, cuerpo, {
      headers: Object.assign({ "Content-Type": "application/json" }, cabeceras),
      responseCallback: ESPERADOS_CONSULTA,
      tags: { paso: "consulta" },
    });
    validacion.add(respuesta.timings.duration);

    check(respuesta, {
      "consulta rechaza el payload inválido": (r) => r.status === 400 || r.status === 429,
      "consulta responde con mensaje": (r) => {
        try {
          return typeof r.json("error") === "string";
        } catch (e) {
          return false;
        }
      },
    });
  });

  group("pago · checkout", function () {
    const home = http.get(`${PAGO}/`, { headers: cabeceras, tags: { paso: "checkout" } });
    check(home, { "checkout 200": (r) => r.status === 200 });

    const url = REF
      ? `${PAGO}/api/reserva?ref=${REF}&modo=reserva`
      : `${PAGO}/api/reserva`;

    const reserva = http.get(url, {
      headers: cabeceras,
      responseCallback: ESPERADOS_RESERVA,
      tags: { paso: "reserva" },
    });
    checkout.add(reserva.timings.duration);

    check(reserva, {
      "reserva responde": (r) => r.status === 200 || r.status === 400 || r.status === 404,
    });
  });

  sleep(1 + Math.random());
}

export function handleSummary(datos) {
  const salida = {};
  salida[`reportes/carga-${SELLO}.json`] = JSON.stringify(datos, null, 2);
  salida.stdout = resumenLegible(datos);
  return salida;
}

function ms(valor) {
  return valor === undefined ? "—" : `${Math.round(valor)}ms`;
}

function resumenLegible(datos) {
  const m = datos.metrics;
  const pedidos = m.http_reqs ? m.http_reqs.values.count : 0;
  const fallos = m.http_req_failed ? m.http_req_failed.values.rate : 0;
  const checks = m.checks ? m.checks.values.rate : 1;

  const filas = [
    ["Pedidos totales", String(pedidos)],
    ["Fallos", `${(fallos * 100).toFixed(2)}%`],
    ["Checks OK", `${(checks * 100).toFixed(2)}%`],
    ["Duración p95", ms(m.http_req_duration && m.http_req_duration.values["p(95)"])],
    ["Duración máx", ms(m.http_req_duration && m.http_req_duration.values.max)],
    ["Portada p95", ms(m.dimo_portada_ms && m.dimo_portada_ms.values["p(95)"])],
    ["Ocupación p95", ms(m.dimo_ocupacion_ms && m.dimo_ocupacion_ms.values["p(95)"])],
    ["Validación p95", ms(m.dimo_validacion_consulta_ms && m.dimo_validacion_consulta_ms.values["p(95)"])],
    ["Checkout p95", ms(m.dimo_checkout_reserva_ms && m.dimo_checkout_reserva_ms.values["p(95)"])],
  ];

  let texto = "\n  ── Resumen de la corrida ─────────────────────────────\n";
  for (const fila of filas) texto += `  ${fila[0].padEnd(20)} ${fila[1]}\n`;
  texto += `\n  Reporte JSON: reportes/carga-${SELLO}.json\n\n`;

  return texto;
}
