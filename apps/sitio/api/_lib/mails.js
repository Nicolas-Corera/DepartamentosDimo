import { leerConfig } from "./env.js";
import { despachar } from "./resend.js";
import {
  reservarEnvioDeMail,
  anotarResultadoDeMail,
  liberarEnvioDeMail,
} from "./supabase.js";
import {
  desdeLaBase,
  linksDePago,
  consultaInquilino,
  consultaDuenos,
  resenaNueva,
} from "./plantillas.js";

async function enviarUnaVez(clave, tipo, destinatarios, armar) {
  const { mails } = leerConfig();

  if (!mails.habilitados) {
    console.warn(`[mails] desactivados (${mails.motivo}) — no se envía ${tipo}`);
    return false;
  }

  const limpios = (destinatarios || []).filter(Boolean);
  if (!limpios.length) {
    console.warn(`[mails] sin destinatarios para ${tipo}`);
    return false;
  }

  const nuestro = await reservarEnvioDeMail(clave, tipo, limpios);
  if (!nuestro) {
    console.log(`[mails] ${clave} ya se había enviado`);
    return false;
  }

  try {
    const mensaje = await armar();
    const id = await despachar(mails.apiKey, { ...mensaje, to: limpios });
    await anotarResultadoDeMail(clave, { resendId: id });
    console.log(`[mails] enviado ${tipo} (${clave}) → ${limpios.length} destinatario(s)`);
    return true;
  } catch (error) {
    await liberarEnvioDeMail(clave);
    console.error(`[mails] falló ${tipo} (${clave}):`, error.message);
    return false;
  }
}

export async function avisarConsultaNueva({ reserva, precio, cobro }) {
  const config = leerConfig();
  const datos = desdeLaBase(reserva);
  const links = linksDePago(config.urls.pago, reserva.id);
  const clave = `consulta:${reserva.id}`;

  const resultados = await Promise.all([
    enviarUnaVez(`${clave}:inquilino`, "consulta_inquilino", [datos.email], async () => ({
      from: config.mails.de.consultas,
      replyTo: config.mails.duenos[0],
      ...consultaInquilino({ reserva: datos, contacto: config.mails.contacto }),
    })),

    enviarUnaVez(`${clave}:duenos`, "consulta_duenos", config.mails.duenos, async () => ({
      from: config.mails.de.consultas,
      replyTo: datos.email,
      ...consultaDuenos({ reserva: datos, precio, cobro, links }),
    })),
  ]);

  return { inquilino: resultados[0], duenos: resultados[1] };
}

export async function avisarResenaNueva({ resena }) {
  const config = leerConfig();
  const clave = `resena:${resena.id}`;

  return enviarUnaVez(clave, "resena_duenos", config.mails.duenos, async () => ({
    from: config.mails.de.resenas,
    ...resenaNueva({
      resena,
      panelUrl: `${config.urls.panel}/#resenas`,
    }),
  }));
}
