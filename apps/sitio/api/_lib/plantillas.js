const COLOR = {
  fondo: "#f6eedf",
  tarjeta: "#fffdf8",
  tinta: "#163238",
  suave: "#5b7076",
  borde: "#e4d2a8",
  celeste: "#1f6f87",
  coral: "#e8623a",
  verde: "#2f7d5f",
  madera: "#b98953",
};

const FUENTE =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const PESOS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

export function pesos(n) {
  return PESOS.format(Number(n) || 0);
}

function partes(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return null;
  return { anio: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) };
}

export function fechaLarga(iso) {
  const p = partes(iso);
  if (!p) return String(iso || "");
  return `${p.dia} de ${MESES[p.mes - 1]} de ${p.anio}`;
}

export function fechaCorta(iso) {
  const p = partes(iso);
  if (!p) return String(iso || "");
  return `${String(p.dia).padStart(2, "0")}/${String(p.mes).padStart(2, "0")}/${p.anio}`;
}

export function noches(checkIn, checkOut) {
  const a = partes(checkIn);
  const b = partes(checkOut);
  if (!a || !b) return 0;
  const ms = Date.UTC(b.anio, b.mes - 1, b.dia) - Date.UTC(a.anio, a.mes - 1, a.dia);
  return Math.max(0, Math.round(ms / 86_400_000));
}

export function esc(valor) {
  return String(valor == null ? "" : valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function plural(n, singular, pluralForma) {
  return Number(n) === 1 ? singular : pluralForma;
}

function grupoTexto(reserva) {
  const partesTexto = [];
  const adultos = Number(reserva.adultos || 0);
  const ninos = Number(reserva.ninos || 0);

  if (adultos) partesTexto.push(`${adultos} ${plural(adultos, "adulto", "adultos")}`);
  if (ninos) {
    const edades = (reserva.edadesNinos || []).filter((e) => e != null);
    const detalle = edades.length ? ` (${edades.join(", ")} años)` : "";
    partesTexto.push(`${ninos} ${plural(ninos, "niño", "niños")}${detalle}`);
  }
  return partesTexto.join(" · ") || "—";
}

const VEHICULOS = {
  auto: "Auto",
  suv: "SUV",
  camioneta: "Camioneta",
  moto: "Moto",
  bici: "Bicicleta",
};

function vehiculoTexto(reserva) {
  if (!reserva.vehiculo) return "Sin vehículo";
  const trozos = [
    VEHICULOS[reserva.vehiculoTipo] || reserva.vehiculoTipo,
    reserva.vehiculoMarca,
    reserva.vehiculoModelo,
    reserva.vehiculoAnio,
  ].filter(Boolean);
  return trozos.length ? trozos.join(" ") : "Sí";
}

export function layout({ titulo, preheader, encabezado, cuerpo, pie }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
</head>
<body style="margin:0;padding:0;background:${COLOR.fondo};">
<div style="display:none;font-size:1px;color:${COLOR.fondo};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(preheader || "")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLOR.fondo};padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:${COLOR.tarjeta};border-radius:18px;overflow:hidden;box-shadow:0 12px 30px -14px rgba(22,50,56,0.28);">

<tr><td style="background:${COLOR.celeste};padding:26px 32px;">
<div style="font-family:${FUENTE};font-size:19px;font-weight:700;color:#ffffff;letter-spacing:-0.2px;">Departamentos Dimo</div>
<div style="font-family:${FUENTE};font-size:13px;color:#cfe8f0;margin-top:3px;">${esc(encabezado || "Mar del Plata")}</div>
</td></tr>

<tr><td style="padding:32px;font-family:${FUENTE};font-size:15px;line-height:1.62;color:${COLOR.tinta};">
${cuerpo}
</td></tr>

<tr><td style="background:#f1e7d4;padding:20px 32px;font-family:${FUENTE};font-size:12px;line-height:1.6;color:${COLOR.suave};">
${pie || `Departamentos Dimo · Mar del Plata, Argentina<br>Este mail se generó automáticamente. Podés responderlo si necesitás algo.`}
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

export function titulo(texto) {
  return `<h1 style="margin:0 0 14px;font-family:${FUENTE};font-size:23px;line-height:1.28;font-weight:700;color:${COLOR.tinta};letter-spacing:-0.4px;">${esc(texto)}</h1>`;
}

export function parrafo(html) {
  return `<p style="margin:0 0 14px;font-family:${FUENTE};font-size:15px;line-height:1.62;color:${COLOR.tinta};">${html}</p>`;
}

export function nota(html) {
  return `<p style="margin:0 0 14px;font-family:${FUENTE};font-size:13px;line-height:1.6;color:${COLOR.suave};">${html}</p>`;
}

export function separador() {
  return `<div style="height:1px;background:${COLOR.borde};margin:26px 0;"></div>`;
}

export function bloque({ etiqueta, valor, color }) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f1e6;border-radius:14px;margin:0 0 18px;">
<tr><td style="padding:18px 20px;font-family:${FUENTE};">
<div style="font-size:12px;text-transform:uppercase;letter-spacing:0.6px;color:${COLOR.suave};font-weight:600;">${esc(etiqueta)}</div>
<div style="font-size:27px;font-weight:700;color:${color || COLOR.tinta};margin-top:5px;letter-spacing:-0.5px;">${esc(valor)}</div>
</td></tr></table>`;
}

export function filas(items) {
  const cuerpo = items
    .filter((it) => it && it.valor != null && it.valor !== "")
    .map(
      (it) => `<tr>
<td style="padding:9px 0;border-bottom:1px solid ${COLOR.borde};font-family:${FUENTE};font-size:13px;color:${COLOR.suave};vertical-align:top;width:42%;">${esc(it.etiqueta)}</td>
<td style="padding:9px 0;border-bottom:1px solid ${COLOR.borde};font-family:${FUENTE};font-size:14px;color:${COLOR.tinta};font-weight:600;vertical-align:top;">${it.crudo ? it.valor : esc(it.valor)}</td>
</tr>`,
    )
    .join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">${cuerpo}</table>`;
}

export function boton(url, texto, color) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px;">
<tr><td style="border-radius:12px;background:${color || COLOR.coral};">
<a href="${esc(url)}" style="display:inline-block;padding:14px 26px;font-family:${FUENTE};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">${esc(texto)}</a>
</td></tr></table>`;
}

export function urlCopiable(url) {
  return `<div style="margin:0 0 22px;padding:11px 13px;background:#f1ece1;border:1px dashed ${COLOR.borde};border-radius:9px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;color:${COLOR.suave};word-break:break-all;">${esc(url)}</div>`;
}

function datosDeLaEstadia(reserva) {
  return filas([
    { etiqueta: "Check-in", valor: fechaLarga(reserva.checkIn) },
    { etiqueta: "Check-out", valor: fechaLarga(reserva.checkOut) },
    {
      etiqueta: "Noches",
      valor: String(noches(reserva.checkIn, reserva.checkOut)),
    },
    { etiqueta: "Huéspedes", valor: grupoTexto(reserva) },
    { etiqueta: "Vehículo", valor: vehiculoTexto(reserva) },
  ]);
}

function datosDelHuesped(reserva) {
  return filas([
    { etiqueta: "Nombre", valor: reserva.nombre },
    {
      etiqueta: "Email",
      valor: `<a href="mailto:${esc(reserva.email)}" style="color:${COLOR.celeste};">${esc(reserva.email)}</a>`,
      crudo: true,
    },
    {
      etiqueta: "Teléfono",
      valor: `<a href="tel:${esc(String(reserva.telefono || "").replace(/[^\d+]/g, ""))}" style="color:${COLOR.celeste};">${esc(reserva.telefono)}</a>`,
      crudo: true,
    },
    { etiqueta: "DNI", valor: reserva.dni },
    { etiqueta: "Procedencia", valor: reserva.procedencia },
  ]);
}

function textoPlano(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h1|h2)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
}

export function telefonoParaWhatsapp(crudo) {
  let n = String(crudo || "").replace(/\D/g, "");
  if (!n) return "";

  n = n.replace(/^00/, "");
  if (n.startsWith("54")) return n;

  n = n.replace(/^0/, "");
  return n.startsWith("9") ? `54${n}` : `549${n}`;
}

export function linkDeWhatsapp(telefono, mensaje) {
  const numero = telefonoParaWhatsapp(telefono);
  if (!numero) return "";
  return mensaje
    ? `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`
    : `https://wa.me/${numero}`;
}

export function contactoDelCliente({ contacto, reserva }) {
  const mensaje = reserva
    ? `Hola! Escribo por mi reserva del ${fechaCorta(reserva.checkIn)} al ${fechaCorta(reserva.checkOut)} (código ${String(reserva.id || "").slice(0, 8)}).`
    : "Hola! Escribo por una consulta.";

  return {
    titulo: "¿Necesitás algo?",
    bajada: "Escribinos por donde te quede más cómodo:",
    mail: contacto?.mail || "",
    telefono: contacto?.whatsapp || "",
    whatsapp: linkDeWhatsapp(contacto?.whatsapp, mensaje),
  };
}

export function contactoDelHuesped(reserva) {
  return {
    titulo: "Contacto del huésped",
    bajada: "",
    mail: reserva?.email || "",
    telefono: reserva?.telefono || "",
    whatsapp: linkDeWhatsapp(reserva?.telefono),
  };
}

function pieDeContacto(contacto, pieExtra) {
  if (!contacto || (!contacto.mail && !contacto.whatsapp)) return pieExtra || "";

  const enlaces = [
    contacto.mail
      ? `<a href="mailto:${esc(contacto.mail)}" style="display:inline-block;margin:0 16px 6px 0;font-family:${FUENTE};font-size:13px;font-weight:700;color:${COLOR.celeste};text-decoration:none;">${esc(contacto.mail)}</a>`
      : "",
    contacto.whatsapp
      ? `<a href="${esc(contacto.whatsapp)}" style="display:inline-block;margin:0 0 6px 0;font-family:${FUENTE};font-size:13px;font-weight:700;color:${COLOR.verde};text-decoration:none;">${esc(String(contacto.telefono || ''))} · WhatsApp</a>`
      : "",
  ].join("");

  return `<div style="font-family:${FUENTE};font-size:13px;font-weight:700;color:${COLOR.tinta};margin:0 0 4px;">${esc(contacto.titulo || "Contacto")}</div>
${contacto.bajada ? `<div style="font-family:${FUENTE};font-size:12px;color:${COLOR.suave};margin:0 0 8px;">${esc(contacto.bajada)}</div>` : ""}
<div style="margin:0 0 12px;">${enlaces}</div>
${pieExtra ? `<div style="font-family:${FUENTE};font-size:12px;color:${COLOR.suave};">${pieExtra}</div>` : ""}`;
}

function armar(subject, partesHtml, opciones = {}) {
  const html = layout({
    titulo: subject,
    preheader: opciones.preheader,
    encabezado: opciones.encabezado,
    pie: pieDeContacto(opciones.contacto, opciones.pie),
    cuerpo: partesHtml.filter(Boolean).join("\n"),
  });
  return { subject, html, texto: textoPlano(partesHtml.filter(Boolean).join("\n")) };
}

export function consultaInquilino({ reserva, contacto }) {
  return armar(
    "Recibimos tu consulta — Departamentos Dimo",
    [
      titulo(`¡Gracias, ${reserva.nombre.split(" ")[0]}!`),
      parrafo(
        "Recibimos tu consulta de reserva y la vamos a responder <strong>a la brevedad</strong>. " +
          "Te escribimos a este mismo mail con la disponibilidad y el precio final de tu estadía.",
      ),
      separador(),
      `<div style="font-family:${FUENTE};font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:${COLOR.suave};margin:0 0 12px;">Tu estadía</div>`,
      datosDeLaEstadia(reserva),
      `<div style="font-family:${FUENTE};font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:${COLOR.suave};margin:0 0 12px;">Tus datos</div>`,
      datosDelHuesped(reserva),
      reserva.mensaje
        ? `<div style="font-family:${FUENTE};font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:${COLOR.suave};margin:0 0 12px;">Tu mensaje</div>
<div style="padding:14px 16px;background:#f6f1e6;border-radius:12px;font-family:${FUENTE};font-size:14px;line-height:1.6;color:${COLOR.tinta};margin:0 0 20px;white-space:pre-wrap;">${esc(reserva.mensaje)}</div>`
        : "",
      nota(
        "Si algo de estos datos está mal, respondé este mail o escribinos por WhatsApp y lo corregimos. " +
          "Todavía no reservaste ni pagaste nada: esto es solo la consulta.",
      ),
    ],
    {
      contacto: contactoDelCliente({ contacto, reserva }),
      pie: "Departamentos Dimo · Mar del Plata, Argentina<br>Este mail se generó automáticamente.",
      preheader: `Tu consulta del ${fechaCorta(reserva.checkIn)} al ${fechaCorta(reserva.checkOut)} ya nos llegó.`,
      encabezado: "Consulta de reserva",
    },
  );
}

export function consultaDuenos({ reserva, precio, cobro, links }) {
  const cantidad = noches(reserva.checkIn, reserva.checkOut);

  return armar(
    `Nueva consulta — ${reserva.nombre} — ${fechaCorta(reserva.checkIn)} al ${fechaCorta(reserva.checkOut)}`,
    [
      titulo("Nueva consulta de reserva"),
      parrafo(
        `<strong>${esc(reserva.nombre)}</strong> consultó por ${cantidad} ${plural(cantidad, "noche", "noches")}, ` +
          `del ${esc(fechaLarga(reserva.checkIn))} al ${esc(fechaLarga(reserva.checkOut))}.`,
      ),
      bloque({
        etiqueta: `Total de la estadía · ${cantidad} ${plural(cantidad, "noche", "noches")}`,
        valor: pesos(precio.total),
      }),
      datosDelHuesped(reserva),
      datosDeLaEstadia(reserva),
      reserva.mensaje
        ? `<div style="font-family:${FUENTE};font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:${COLOR.suave};margin:0 0 12px;">Mensaje</div>
<div style="padding:14px 16px;background:#f6f1e6;border-radius:12px;font-family:${FUENTE};font-size:14px;line-height:1.6;color:${COLOR.tinta};margin:0 0 20px;white-space:pre-wrap;">${esc(reserva.mensaje)}</div>`
        : "",
      separador(),
      titulo("Enlaces de cobro"),
      parrafo(
        "Mandale al huésped el que corresponda. Los dos apuntan a la misma reserva: " +
          "el sistema recalcula el monto solo, así que no hay nada que completar a mano.",
      ),
      `<div style="font-family:${FUENTE};font-size:14px;font-weight:700;color:${COLOR.tinta};margin:0 0 8px;">Seña · ${esc(String(cobro.porcentajeReserva))}% — ${esc(pesos(cobro.montoReserva))}</div>`,
      boton(links.reserva, "Abrir link de la seña", COLOR.celeste),
      urlCopiable(links.reserva),
      `<div style="font-family:${FUENTE};font-size:14px;font-weight:700;color:${COLOR.tinta};margin:0 0 8px;">Total — ${esc(pesos(cobro.montoTotal))}</div>`,
      boton(links.total, "Abrir link del total", COLOR.coral),
      urlCopiable(links.total),
      nota(
        "Si el huésped ya pagó la seña con el primer link, el link del total le cobra " +
          "únicamente el saldo que falta. No hace falta que elijas: mandá el del total y el sistema resuelve.",
      ),
      nota(
        "Los montos de arriba son el precio base. Si el huésped paga con tarjeta, " +
          "se le suma el recargo del medio de pago configurado en el panel.",
      ),
    ],
    {
      contacto: contactoDelHuesped(reserva),
      preheader: `${reserva.nombre} · ${cantidad} ${plural(cantidad, "noche", "noches")} · ${pesos(precio.total)}`,
      encabezado: "Aviso para los dueños",
      pie: "Departamentos Dimo · aviso interno<br>Respondé este mail para escribirle directo al huésped, o tocá el número para abrirle el WhatsApp.",
    },
  );
}

export function reservaInquilino({ reserva, pago, cobro, links, contacto }) {
  const faltaAlgo = cobro.saldo > 0;

  return armar(
    "Tu seña está paga — Departamentos Dimo",
    [
      titulo("¡Listo! Recibimos tu seña"),
      parrafo(
        `Gracias, ${esc(reserva.nombre.split(" ")[0])}. Tu reserva del ` +
          `<strong>${esc(fechaLarga(reserva.checkIn))}</strong> al ` +
          `<strong>${esc(fechaLarga(reserva.checkOut))}</strong> quedó tomada.`,
      ),
      bloque({ etiqueta: "Seña pagada", valor: pesos(pago.monto), color: COLOR.verde }),
      filas([
        { etiqueta: "Total de la estadía", valor: pesos(cobro.montoTotal) },
        { etiqueta: "Pagado hasta ahora", valor: pesos(cobro.pagado) },
        {
          etiqueta: "Saldo pendiente",
          valor: `<span style="color:${faltaAlgo ? COLOR.coral : COLOR.verde};">${esc(pesos(cobro.saldo))}</span>`,
          crudo: true,
        },
        { etiqueta: "Medio de pago", valor: pago.medioTexto },
        { etiqueta: "N° de operación", valor: pago.referencia },
      ]),
      faltaAlgo
        ? [
            separador(),
            titulo("Cuando quieras, saldá el resto"),
            parrafo(
              `Te queda pendiente <strong>${esc(pesos(cobro.saldo))}</strong>. ` +
                "Con este link pagás exactamente eso: el sistema ya descontó tu seña.",
            ),
            boton(links.total, `Pagar el saldo · ${pesos(cobro.saldo)}`, COLOR.coral),
            urlCopiable(links.total),
          ].join("\n")
        : parrafo("<strong>Tu estadía ya está paga por completo.</strong> No queda saldo pendiente."),
      separador(),
      datosDeLaEstadia(reserva),
      nota(
        "Guardá este mail: es el comprobante de tu seña. Cualquier cosa, respondelo o escribinos por WhatsApp.",
      ),
    ],
    {
      contacto: contactoDelCliente({ contacto, reserva }),
      pie: "Departamentos Dimo · Mar del Plata, Argentina<br>Este mail se generó automáticamente.",
      preheader: `Seña de ${pesos(pago.monto)} recibida. ${faltaAlgo ? `Saldo pendiente: ${pesos(cobro.saldo)}.` : "Estadía paga por completo."}`,
      encabezado: "Reserva confirmada",
    },
  );
}

export function reservaDueno({ reserva, pago, cobro, links }) {
  return armar(
    `Seña cobrada — ${reserva.nombre} — ${fechaCorta(reserva.checkIn)} al ${fechaCorta(reserva.checkOut)}`,
    [
      titulo("Entró una seña"),
      parrafo(
        `<strong>${esc(reserva.nombre)}</strong> pagó la seña de su reserva del ` +
          `${esc(fechaCorta(reserva.checkIn))} al ${esc(fechaCorta(reserva.checkOut))}.`,
      ),
      bloque({ etiqueta: "Cobrado", valor: pesos(pago.monto), color: COLOR.verde }),
      filas([
        { etiqueta: "Total de la estadía", valor: pesos(cobro.montoTotal) },
        { etiqueta: "Pagado hasta ahora", valor: pesos(cobro.pagado) },
        { etiqueta: "Saldo pendiente", valor: pesos(cobro.saldo) },
        { etiqueta: "Medio de pago", valor: pago.medioTexto },
        { etiqueta: "N° de operación", valor: pago.referencia },
      ]),
      datosDelHuesped(reserva),
      datosDeLaEstadia(reserva),
      cobro.saldo > 0
        ? [
            separador(),
            parrafo(`Link para que salde los <strong>${esc(pesos(cobro.saldo))}</strong> que faltan:`),
            boton(links.total, `Cobrar el saldo · ${pesos(cobro.saldo)}`, COLOR.coral),
            urlCopiable(links.total),
          ].join("\n")
        : parrafo("<strong>La estadía quedó paga por completo.</strong>"),
    ],
    {
      contacto: contactoDelHuesped(reserva),
      preheader: `${reserva.nombre} señó ${pesos(pago.monto)}. Falta ${pesos(cobro.saldo)}.`,
      encabezado: "Aviso para los dueños",
      pie: "Departamentos Dimo · aviso interno",
    },
  );
}

function conceptoTexto(concepto) {
  if (concepto === "reserva") return "Seña";
  if (concepto === "saldo") return "Saldo de la estadía";
  return "Total de la estadía";
}

export function pagoInquilino({ reserva, pago, cobro, contacto }) {
  const completo = cobro.saldo <= 0;

  return armar(
    completo ? "Pago recibido — tu reserva está confirmada" : "Recibimos tu pago — Departamentos Dimo",
    [
      titulo(completo ? "¡Tu estadía está paga!" : "Recibimos tu pago"),
      parrafo(
        `Gracias, ${esc(reserva.nombre.split(" ")[0])}. ` +
          (completo
            ? `Tu reserva del <strong>${esc(fechaLarga(reserva.checkIn))}</strong> al ` +
              `<strong>${esc(fechaLarga(reserva.checkOut))}</strong> quedó <strong>confirmada y paga por completo</strong>.`
            : "Registramos el pago que hiciste."),
      ),
      bloque({ etiqueta: conceptoTexto(pago.concepto), valor: pesos(pago.monto), color: COLOR.verde }),
      filas([
        { etiqueta: "Total de la estadía", valor: pesos(cobro.montoTotal) },
        { etiqueta: "Pagado", valor: pesos(cobro.pagado) },
        { etiqueta: "Saldo pendiente", valor: pesos(cobro.saldo) },
        { etiqueta: "Medio de pago", valor: pago.medioTexto },
        { etiqueta: "N° de operación", valor: pago.referencia },
        { etiqueta: "Fecha", valor: fechaLarga(pago.fecha) },
      ]),
      nota("Guardá este mail: es el comprobante del pago."),
      separador(),
      datosDeLaEstadia(reserva),
      parrafo(
        "Nos vemos en Mar del Plata. Cualquier cosa que necesites antes de llegar, " +
          "respondé este mail o escribinos por WhatsApp.",
      ),
    ],
    {
      contacto: contactoDelCliente({ contacto, reserva }),
      pie: "Departamentos Dimo · Mar del Plata, Argentina<br>Este mail se generó automáticamente.",
      preheader: `${conceptoTexto(pago.concepto)}: ${pesos(pago.monto)}. ${completo ? "Estadía paga." : `Saldo: ${pesos(cobro.saldo)}.`}`,
      encabezado: "Comprobante de pago",
    },
  );
}

export function pagoDuenos({ reserva, pago, cobro, comprobanteAdjunto }) {
  const completo = cobro.saldo <= 0;

  return armar(
    `Pago recibido — ${reserva.nombre} — ${pesos(pago.monto)}`,
    [
      titulo(completo ? "Estadía paga por completo" : "Entró un pago"),
      parrafo(
        `<strong>${esc(reserva.nombre)}</strong> pagó ${esc(conceptoTexto(pago.concepto).toLowerCase())} de su reserva del ` +
          `${esc(fechaCorta(reserva.checkIn))} al ${esc(fechaCorta(reserva.checkOut))}.`,
      ),
      bloque({ etiqueta: "Cobrado", valor: pesos(pago.monto), color: COLOR.verde }),
      filas([
        { etiqueta: "Total de la estadía", valor: pesos(cobro.montoTotal) },
        { etiqueta: "Pagado", valor: pesos(cobro.pagado) },
        { etiqueta: "Saldo pendiente", valor: pesos(cobro.saldo) },
        { etiqueta: "Medio de pago", valor: pago.medioTexto },
        { etiqueta: "N° de operación", valor: pago.referencia },
        { etiqueta: "Neto acreditado", valor: pago.neto ? pesos(pago.neto) : null },
      ]),
      datosDelHuesped(reserva),
      datosDeLaEstadia(reserva),
      comprobanteAdjunto
        ? parrafo("Adjuntamos el <strong>comprobante de transferencia</strong> que subió el huésped.")
        : "",
    ],
    {
      contacto: contactoDelHuesped(reserva),
      preheader: `${reserva.nombre} pagó ${pesos(pago.monto)}. ${completo ? "Estadía paga." : `Falta ${pesos(cobro.saldo)}.`}`,
      encabezado: "Aviso para los dueños",
      pie: "Departamentos Dimo · aviso interno",
    },
  );
}

export function comprobanteInquilino({ reserva, comprobante, cobro, contacto }) {
  return armar(
    "Recibimos tu comprobante de transferencia",
    [
      titulo("Tenemos tu comprobante"),
      parrafo(
        `Gracias, ${esc(reserva.nombre.split(" ")[0])}. Ya nos llegó el comprobante de la transferencia ` +
          "y lo estamos verificando. En cuanto lo confirmemos te llega el recibo definitivo por mail.",
      ),
      bloque({
        etiqueta: `${conceptoTexto(comprobante.concepto)} · a verificar`,
        valor: pesos(comprobante.monto),
        color: COLOR.madera,
      }),
      filas([
        { etiqueta: "Total de la estadía", valor: pesos(cobro.montoTotal) },
        { etiqueta: "Pagado y confirmado", valor: pesos(cobro.pagado) },
        { etiqueta: "Subido el", valor: fechaLarga(comprobante.subidoEn) },
      ]),
      separador(),
      datosDeLaEstadia(reserva),
      nota(
        "La verificación es manual y puede demorar unas horas. " +
          "Hasta que la confirmemos, tu reserva figura como pendiente. No hace falta que vuelvas a transferir.",
      ),
    ],
    {
      contacto: contactoDelCliente({ contacto, reserva }),
      pie: "Departamentos Dimo · Mar del Plata, Argentina<br>Este mail se generó automáticamente.",
      preheader: `Comprobante por ${pesos(comprobante.monto)} recibido. Lo estamos verificando.`,
      encabezado: "Transferencia en revisión",
    },
  );
}

export function comprobanteDuenos({ reserva, comprobante, cobro, panelUrl }) {
  return armar(
    `Comprobante para revisar — ${reserva.nombre} — ${pesos(comprobante.monto)}`,
    [
      titulo("Hay un comprobante esperando"),
      parrafo(
        `<strong>${esc(reserva.nombre)}</strong> subió un comprobante de transferencia por su reserva del ` +
          `${esc(fechaCorta(reserva.checkIn))} al ${esc(fechaCorta(reserva.checkOut))}. ` +
          "Hasta que lo apruebes en el panel, no cuenta como pago.",
      ),
      bloque({
        etiqueta: `${conceptoTexto(comprobante.concepto)} declarada`,
        valor: pesos(comprobante.monto),
        color: COLOR.madera,
      }),
      filas([
        { etiqueta: "Total de la estadía", valor: pesos(cobro.montoTotal) },
        { etiqueta: "Ya confirmado", valor: pesos(cobro.pagado) },
        { etiqueta: "Subido el", valor: fechaLarga(comprobante.subidoEn) },
      ]),
      datosDelHuesped(reserva),
      panelUrl ? boton(panelUrl, "Revisar en el panel", COLOR.celeste) : "",
      panelUrl ? urlCopiable(panelUrl) : "",
      nota("Adjuntamos el archivo tal como lo subió el huésped."),
    ],
    {
      contacto: contactoDelHuesped(reserva),
      preheader: `${reserva.nombre} transfirió ${pesos(comprobante.monto)}. Falta aprobarlo en el panel.`,
      encabezado: "Aviso para los dueños",
      pie: "Departamentos Dimo · aviso interno",
    },
  );
}

export function desdeLaBase(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    nombre: fila.nombre,
    email: fila.email,
    dni: fila.dni,
    telefono: fila.telefono,
    procedencia: fila.procedencia,
    checkIn: fila.check_in,
    checkOut: fila.check_out,
    personas: fila.personas,
    adultos: fila.adultos,
    ninos: fila.ninos,
    edadesNinos: fila.edades_ninos || [],
    vehiculo: Boolean(fila.vehiculo),
    vehiculoMarca: fila.vehiculo_marca,
    vehiculoModelo: fila.vehiculo_modelo,
    vehiculoTipo: fila.vehiculo_tipo,
    vehiculoAnio: fila.vehiculo_anio,
    mensaje: fila.mensaje,
    estado: fila.estado,
  };
}

export function linksDePago(baseUrl, bookingId) {
  const base = `${String(baseUrl || "").replace(/\/+$/, "")}/?ref=${encodeURIComponent(bookingId)}`;
  return {
    reserva: `${base}&modo=reserva`,
    total: `${base}&modo=total`,
  };
}

function estrellas(rating) {
  const n = Math.max(0, Math.min(5, Number(rating) || 0));
  return "★".repeat(n) + "☆".repeat(5 - n);
}

export function resenaNueva({ resena, panelUrl }) {
  const puntaje = Math.max(0, Math.min(5, Number(resena.rating) || 0));

  return armar(
    `Nueva reseña — ${resena.name} — ${puntaje}/5`,
    [
      titulo("Alguien dejó una reseña"),
      parrafo(
        `<strong>${esc(resena.name)}</strong> publicó una reseña de ${puntaje} ${puntaje === 1 ? "estrella" : "estrellas"}. ` +
          "Queda <strong>pendiente de aprobación</strong>: no se ve en el sitio hasta que la apruebes en el panel.",
      ),
      bloque({ etiqueta: "Puntaje", valor: `${estrellas(puntaje)}   ${puntaje}/5` }),
      `<div style="font-family:${FUENTE};font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:${COLOR.suave};margin:0 0 12px;">Comentario</div>
<div style="padding:16px 18px;background:#f6f1e6;border-radius:12px;font-family:${FUENTE};font-size:15px;line-height:1.6;color:${COLOR.tinta};margin:0 0 20px;white-space:pre-wrap;">${esc(resena.text)}</div>`,
      filas([
        { etiqueta: "Nombre", valor: resena.name },
        { etiqueta: "Puntaje", valor: `${puntaje} de 5` },
        { etiqueta: "Recibida", valor: fechaLarga(resena.createdAt) },
      ]),
      panelUrl ? boton(panelUrl, "Revisar en el panel", COLOR.celeste) : "",
      panelUrl ? urlCopiable(panelUrl) : "",
      nota(
        "Desde el panel podés aprobarla, para que salga en el carrusel del sitio, o eliminarla.",
      ),
    ],
    {
      preheader: `${resena.name} dejó una reseña de ${puntaje}/5. Falta aprobarla.`,
      encabezado: "Aviso para los dueños",
      pie: "Departamentos Dimo · aviso interno",
    },
  );
}
