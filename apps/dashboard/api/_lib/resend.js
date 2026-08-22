const ENDPOINT = "https://api.resend.com/emails";

const TIEMPO_LIMITE_MS = 15_000;

export class ErrorDeMail extends Error {
  constructor(mensaje, status, pista) {
    super(pista ? `${mensaje}\n  → ${pista}` : mensaje);
    this.name = "ErrorDeMail";
    this.status = status;
    this.pista = pista;
  }
}

function pistaDe(status, detalle) {
  if (status === 401) {
    return "RESEND_API_KEY es inválida o fue revocada. Resend → API Keys → crear una nueva con permiso de envío.";
  }
  if (status === 403 && /domain|verif/i.test(detalle)) {
    return (
      "El dominio del remitente no está verificado en Resend. " +
      "Resend → Domains → departamentosdimo.com.ar → cargar los registros SPF y DKIM en el DNS."
    );
  }
  if (status === 422) {
    return "Resend rechazó el mensaje: revisá que el `from` use un dominio verificado y que los destinatarios tengan formato válido.";
  }
  if (status === 429) {
    return "Se pasó el límite de envíos por segundo de Resend. El reintento se hace solo en el próximo evento.";
  }
  return "";
}

export async function despachar(apiKey, mensaje) {
  const destinatarios = (Array.isArray(mensaje.to) ? mensaje.to : [mensaje.to])
    .map((d) => String(d || "").trim())
    .filter(Boolean);

  if (!destinatarios.length) {
    throw new ErrorDeMail("No hay a quién mandarle el mail.", 0);
  }

  const cuerpo = {
    from: mensaje.from,
    to: destinatarios,
    subject: mensaje.subject,
    html: mensaje.html,
  };

  if (mensaje.texto) cuerpo.text = mensaje.texto;
  if (mensaje.replyTo) cuerpo.reply_to = mensaje.replyTo;

  if (mensaje.adjuntos?.length) {
    cuerpo.attachments = mensaje.adjuntos.map((a) => ({
      filename: a.nombre,
      content: a.contenido,
    }));
  }

  let respuesta;
  try {
    respuesta = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
    });
  } catch (error) {
    throw new ErrorDeMail(`No se pudo contactar a Resend: ${error.message}`, 0);
  }

  const texto = await respuesta.text();

  let datos = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    datos = null;
  }

  if (!respuesta.ok) {
    const detalle = datos?.message || datos?.error?.message || datos?.name || texto.slice(0, 300);
    throw new ErrorDeMail(
      `Resend (${respuesta.status}): ${detalle}`,
      respuesta.status,
      pistaDe(respuesta.status, String(detalle)),
    );
  }

  return datos?.id || null;
}
