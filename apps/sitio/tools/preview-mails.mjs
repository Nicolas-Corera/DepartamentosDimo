import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as p from "../api/_lib/plantillas.js";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DESTINO = join(RAIZ, ".mails-preview");

const reserva = {
  id: "17f1032b-46a1-4490-9f6c-49345c62ba71",
  nombre: "María Ñáñez Gómez",
  email: "maria@example.com",
  dni: "30123456",
  telefono: "+54 9 223 555-1234",
  procedencia: "CABA",
  checkIn: "2026-12-20",
  checkOut: "2026-12-27",
  personas: 3,
  adultos: 2,
  ninos: 1,
  edadesNinos: [8],
  vehiculo: true,
  vehiculoMarca: "Toyota",
  vehiculoModelo: "Corolla",
  vehiculoTipo: "auto",
  vehiculoAnio: 2020,
  mensaje:
    "Hola! Consulto si el depto tiene cochera cubierta y si aceptan llegar tarde el primer día.",
};

const precio = { total: 630000, cantidadNoches: 7 };
const links = p.linksDePago("https://pago.departamentosdimo.com.ar", reserva.id);

const sinPagar = { porcentajeReserva: 30, montoTotal: 630000, montoReserva: 189000, pagado: 0, saldo: 630000, aCobrarBase: 189000 };
const conSenia = { porcentajeReserva: 30, montoTotal: 630000, montoReserva: 189000, pagado: 189000, saldo: 441000, aCobrarBase: 441000 };
const saldada = { porcentajeReserva: 30, montoTotal: 630000, montoReserva: 189000, pagado: 630000, saldo: 0, aCobrarBase: 0 };

const pagoSenia = {
  concepto: "reserva",
  monto: 207900,
  montoBase: 189000,
  recargo: 18900,
  medio: "credito",
  medioTexto: "Tarjeta de crédito",
  cuotas: 1,
  ultimosCuatro: "4242",
  referencia: "1234567890",
  fecha: "2026-08-22T14:30:00Z",
};

const pagoSaldo = {
  concepto: "saldo",
  monto: 485100,
  montoBase: 441000,
  recargo: 44100,
  medio: "credito",
  medioTexto: "Tarjeta de crédito · 3 cuotas",
  cuotas: 3,
  ultimosCuatro: "4242",
  referencia: "9876543210",
  fecha: "2026-09-01T10:15:00Z",
};

const comprobante = { id: "abc", concepto: "reserva", monto: 189000, subidoEn: "2026-08-22T14:30:00Z" };

const MAILS = {
  "consulta-inquilino": () => p.consultaInquilino({ reserva }),
  "consulta-duenos": () => p.consultaDuenos({ reserva, precio, cobro: sinPagar, links }),
  "reserva-inquilino": () => p.reservaInquilino({ reserva, pago: pagoSenia, cobro: conSenia, links }),
  "reserva-dueno": () => p.reservaDueno({ reserva, pago: pagoSenia, cobro: conSenia, links }),
  "pago-inquilino": () => p.pagoInquilino({ reserva, pago: pagoSaldo, cobro: saldada }),
  "pago-duenos": () =>
    p.pagoDuenos({ reserva, pago: pagoSaldo, cobro: saldada, comprobanteAdjunto: true }),
  "comprobante-inquilino": () => p.comprobanteInquilino({ reserva, comprobante, cobro: sinPagar }),
  "comprobante-duenos": () =>
    p.comprobanteDuenos({
      reserva,
      comprobante,
      cobro: sinPagar,
      panelUrl: "https://dash.departamentosdimo.com.ar/#alquileres",
    }),
};

await mkdir(DESTINO, { recursive: true });

const indice = [];

for (const [nombre, armar] of Object.entries(MAILS)) {
  const mail = armar();
  await writeFile(join(DESTINO, `${nombre}.html`), mail.html, "utf8");
  indice.push(
    `<li><a href="${nombre}.html">${nombre}</a><span>${mail.subject}</span></li>`,
  );
  console.log(`  ${nombre.padEnd(24)} ${mail.subject}`);
}

await writeFile(
  join(DESTINO, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>Mails de Departamentos Dimo</title>
<body style="font-family:system-ui,sans-serif;background:#f6eedf;color:#163238;padding:40px;margin:0">
<h1 style="margin:0 0 6px">Mails transaccionales</h1>
<p style="color:#5b7076;margin:0 0 28px">Vista previa con datos de ejemplo. Regenerar con <code>npm run mails:preview</code>.</p>
<ul style="list-style:none;padding:0;margin:0;max-width:620px">${indice
    .join("")
    .replaceAll(
      "<li>",
      '<li style="background:#fffdf8;border-radius:12px;padding:14px 18px;margin-bottom:10px">',
    )
    .replaceAll("<span>", '<br><span style="color:#5b7076;font-size:14px">')}</ul>`,
  "utf8",
);

console.log(`\n  Listo → ${join(DESTINO, "index.html")}\n`);
