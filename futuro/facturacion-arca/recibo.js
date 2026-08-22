import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const A4 = [595.28, 841.89];

const MARGEN = 48;

const TINTA = rgb(0.086, 0.196, 0.22);
const SUAVE = rgb(0.357, 0.44, 0.463);
const CELESTE = rgb(0.122, 0.435, 0.529);
const ARENA = rgb(0.965, 0.945, 0.902);
const BORDE = rgb(0.894, 0.824, 0.659);
const VERDE = rgb(0.184, 0.49, 0.373);

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const PESOS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2,
});

const REEMPLAZOS = {
  "→": "->",
  "←": "<-",
  "—": "-",
  "–": "-",
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "…": "...",
  "·": "-",
  "•": "-",
  " ": " ",
  " ": " ",
};

function sanear(valor) {
  let texto = String(valor == null ? "" : valor);
  for (const [de, a] of Object.entries(REEMPLAZOS)) texto = texto.split(de).join(a);
  return texto.replace(/[^\x20-\xFF\n]/g, "");
}

function plata(n) {
  return sanear(PESOS.format(Number(n) || 0));
}

function fechaLarga(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return String(iso || "");
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}

function fechaHora(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  const partes = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const v = (t) => partes.find((p) => p.type === t)?.value || "";
  return `${v("day")}/${v("month")}/${v("year")} ${v("hour")}:${v("minute")} hs`;
}

function noches(checkIn, checkOut) {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(checkIn || ""));
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(checkOut || ""));
  if (!a || !b) return 0;
  const ms =
    Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3])) -
    Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  return Math.max(0, Math.round(ms / 86_400_000));
}

const CONCEPTOS = {
  reserva: "Sena / anticipo de reserva",
  saldo: "Saldo de la estadia",
  total: "Total de la estadia",
};

const MEDIOS = {
  transferencia: "Transferencia bancaria",
  debito: "Tarjeta de debito",
  credito: "Tarjeta de credito",
};

export function numeroDeRecibo(numero, puntoVenta) {
  const pv = String(puntoVenta || 1).padStart(4, "0");
  return `${pv}-${String(numero || 0).padStart(8, "0")}`;
}

export async function generarRecibo({ emisor, reserva, pago, cobro, recibo }) {
  const pdf = await PDFDocument.create();

  pdf.setTitle(`Recibo ${recibo.numeroTexto}`);
  pdf.setAuthor(sanear(emisor.nombre));
  pdf.setSubject("Recibo de pago");
  pdf.setProducer("Departamentos Dimo");
  pdf.setCreator("Departamentos Dimo");

  const pagina = pdf.addPage(A4);
  const { width, height } = pagina.getSize();

  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);

  const escribir = (texto, x, y, opciones = {}) => {
    pagina.drawText(sanear(texto), {
      x,
      y,
      size: opciones.size || 10,
      font: opciones.bold ? negrita : normal,
      color: opciones.color || TINTA,
    });
  };

  const anchoDe = (texto, size, bold) =>
    (bold ? negrita : normal).widthOfTextAtSize(sanear(texto), size);

  const derecha = (texto, xDerecha, y, opciones = {}) => {
    const size = opciones.size || 10;
    escribir(texto, xDerecha - anchoDe(texto, size, opciones.bold), y, opciones);
  };

  pagina.drawRectangle({ x: 0, y: height - 112, width, height: 112, color: CELESTE });

  escribir("Departamentos Dimo", MARGEN, height - 52, {
    size: 20,
    bold: true,
    color: rgb(1, 1, 1),
  });
  escribir("Alquiler temporario - Mar del Plata", MARGEN, height - 72, {
    size: 10,
    color: rgb(0.812, 0.91, 0.941),
  });

  derecha("RECIBO DE PAGO", width - MARGEN, height - 52, {
    size: 15,
    bold: true,
    color: rgb(1, 1, 1),
  });
  derecha(`N° ${recibo.numeroTexto}`, width - MARGEN, height - 72, {
    size: 11,
    color: rgb(0.812, 0.91, 0.941),
  });
  derecha(`Emitido el ${fechaHora(recibo.emitidoEn)}`, width - MARGEN, height - 88, {
    size: 9,
    color: rgb(0.812, 0.91, 0.941),
  });

  let y = height - 150;

  const columna = (x, ancho, titulo, lineas) => {
    let cursor = y;
    escribir(titulo.toUpperCase(), x, cursor, { size: 8, bold: true, color: SUAVE });
    cursor -= 16;
    for (const linea of lineas.filter(Boolean)) {
      escribir(linea.texto, x, cursor, { size: linea.bold ? 11 : 9.5, bold: linea.bold });
      cursor -= linea.bold ? 15 : 13;
    }
    return cursor;
  };

  const anchoColumna = (width - MARGEN * 2 - 24) / 2;

  const finEmisor = columna(MARGEN, anchoColumna, "Emisor", [
    { texto: emisor.nombre, bold: true },
    { texto: emisor.marca },
    emisor.cuit ? { texto: `CUIT ${emisor.cuit}` } : null,
    emisor.condicionIva ? { texto: emisor.condicionIva } : null,
    emisor.domicilio ? { texto: emisor.domicilio } : null,
    emisor.email ? { texto: emisor.email } : null,
  ]);

  const finReceptor = columna(MARGEN + anchoColumna + 24, anchoColumna, "Recibimos de", [
    { texto: reserva.nombre, bold: true },
    reserva.dni ? { texto: `DNI ${reserva.dni}` } : null,
    reserva.email ? { texto: reserva.email } : null,
    reserva.telefono ? { texto: reserva.telefono } : null,
    reserva.procedencia ? { texto: reserva.procedencia } : null,
  ]);

  y = Math.min(finEmisor, finReceptor) - 18;

  pagina.drawLine({
    start: { x: MARGEN, y },
    end: { x: width - MARGEN, y },
    thickness: 1,
    color: BORDE,
  });

  y -= 30;

  escribir("DETALLE", MARGEN, y, { size: 8, bold: true, color: SUAVE });
  y -= 22;

  const cantidad = noches(reserva.checkIn, reserva.checkOut);

  pagina.drawRectangle({
    x: MARGEN,
    y: y - 8,
    width: width - MARGEN * 2,
    height: 26,
    color: ARENA,
  });

  escribir("Concepto", MARGEN + 12, y, { size: 8.5, bold: true, color: SUAVE });
  derecha("Importe", width - MARGEN - 12, y, { size: 8.5, bold: true, color: SUAVE });

  y -= 30;

  escribir(CONCEPTOS[pago.concepto] || CONCEPTOS.total, MARGEN + 12, y, {
    size: 11,
    bold: true,
  });
  derecha(plata(pago.montoBase), width - MARGEN - 12, y, { size: 11, bold: true });

  y -= 15;
  escribir(
    `Estadia del ${fechaLarga(reserva.checkIn)} al ${fechaLarga(reserva.checkOut)} - ` +
      `${cantidad} ${cantidad === 1 ? "noche" : "noches"}`,
    MARGEN + 12,
    y,
    { size: 9, color: SUAVE },
  );

  y -= 13;
  escribir(
    `${reserva.personas || 1} ${Number(reserva.personas) === 1 ? "huesped" : "huespedes"}` +
      ` - Reserva ${String(reserva.id || "").slice(0, 8)}`,
    MARGEN + 12,
    y,
    { size: 9, color: SUAVE },
  );

  if (Number(pago.recargo) > 0) {
    y -= 24;
    escribir(`Recargo por ${MEDIOS[pago.medio] || pago.medio || "medio de pago"}`, MARGEN + 12, y, {
      size: 10,
    });
    derecha(plata(pago.recargo), width - MARGEN - 12, y, { size: 10 });

    if (Number(pago.cuotas) > 1) {
      y -= 13;
      escribir(`${pago.cuotas} cuotas de ${plata(pago.monto / pago.cuotas)}`, MARGEN + 12, y, {
        size: 9,
        color: SUAVE,
      });
    }
  }

  y -= 26;

  pagina.drawLine({
    start: { x: MARGEN, y },
    end: { x: width - MARGEN, y },
    thickness: 1,
    color: BORDE,
  });

  y -= 30;

  pagina.drawRectangle({
    x: width - MARGEN - 250,
    y: y - 14,
    width: 250,
    height: 40,
    color: ARENA,
  });

  escribir("TOTAL PAGADO", width - MARGEN - 238, y + 2, { size: 9, bold: true, color: SUAVE });
  derecha(plata(pago.monto), width - MARGEN - 12, y - 2, { size: 16, bold: true, color: VERDE });

  y -= 52;

  escribir("FORMA DE PAGO", MARGEN, y, { size: 8, bold: true, color: SUAVE });
  y -= 16;

  const detallePago = [
    { etiqueta: "Medio", valor: MEDIOS[pago.medio] || pago.medio || "-" },
    pago.cuotas > 1 ? { etiqueta: "Cuotas", valor: String(pago.cuotas) } : null,
    pago.ultimosCuatro ? { etiqueta: "Tarjeta", valor: `**** ${pago.ultimosCuatro}` } : null,
    { etiqueta: "N° de operacion", valor: pago.referencia || "-" },
    { etiqueta: "Fecha del pago", valor: fechaHora(pago.fecha) },
  ].filter(Boolean);

  for (const item of detallePago) {
    escribir(item.etiqueta, MARGEN, y, { size: 9.5, color: SUAVE });
    escribir(item.valor, MARGEN + 130, y, { size: 9.5, bold: true });
    y -= 15;
  }

  y -= 14;

  escribir("ESTADO DE LA RESERVA", MARGEN, y, { size: 8, bold: true, color: SUAVE });
  y -= 16;

  const estado = [
    { etiqueta: "Total de la estadia", valor: plata(cobro.montoTotal) },
    { etiqueta: "Pagado a la fecha", valor: plata(cobro.pagado) },
    { etiqueta: "Saldo pendiente", valor: plata(cobro.saldo) },
  ];

  for (const item of estado) {
    escribir(item.etiqueta, MARGEN, y, { size: 9.5, color: SUAVE });
    escribir(item.valor, MARGEN + 130, y, {
      size: 9.5,
      bold: true,
      color: item.etiqueta === "Saldo pendiente" && cobro.saldo <= 0 ? VERDE : TINTA,
    });
    y -= 15;
  }

  if (cobro.saldo <= 0) {
    y -= 6;
    escribir("Estadia paga por completo.", MARGEN, y, { size: 10, bold: true, color: VERDE });
  }

  const pieY = 92;

  pagina.drawLine({
    start: { x: MARGEN, y: pieY + 42 },
    end: { x: width - MARGEN, y: pieY + 42 },
    thickness: 1,
    color: BORDE,
  });

  if (recibo.cae) {
    escribir(`CAE ${recibo.cae}`, MARGEN, pieY + 24, { size: 9, bold: true });
    escribir(`Vencimiento del CAE: ${fechaLarga(recibo.caeVence)}`, MARGEN, pieY + 11, {
      size: 8.5,
      color: SUAVE,
    });
  } else {
    escribir(
      "Recibo de pago. No es una factura electronica: no tiene CAE de ARCA.",
      MARGEN,
      pieY + 24,
      { size: 8.5, bold: true, color: SUAVE },
    );
    escribir(
      "Sirve como constancia del pago recibido. La factura fiscal se emite por separado.",
      MARGEN,
      pieY + 11,
      { size: 8.5, color: SUAVE },
    );
  }

  escribir(
    `${emisor.nombre} - ${emisor.marca}` + (emisor.sitio ? ` - ${emisor.sitio}` : ""),
    MARGEN,
    pieY - 12,
    { size: 8, color: SUAVE },
  );

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

export function nombreDeArchivo(recibo, reserva) {
  const huesped = String(reserva?.nombre || "recibo")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return `recibo-${recibo.numeroTexto}-${huesped}.pdf`;
}
