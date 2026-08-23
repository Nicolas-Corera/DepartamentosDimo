import crypto from "node:crypto";
import { validarFirmaWebhook } from "../api/_lib/mercadopago.js";

const SECRETO = "clave-de-prueba-para-el-chequeo";
const DATA_ID = "123456";
const REQUEST_ID = "1a2b3c4d-0000-0000-0000-abcdefabcdef";

function firmar(ts, { secreto = SECRETO, dataId = DATA_ID, requestId = REQUEST_ID } = {}) {
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac("sha256", secreto).update(manifest).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

const AHORA = 1_772_000_000_000;
const SEGUNDOS = Math.floor(AHORA / 1000);

const casos = [
  {
    nombre: "ts en segundos, recién emitida",
    header: firmar(SEGUNDOS),
    espera: true,
  },
  {
    nombre: "ts en milisegundos, recién emitida",
    header: firmar(AHORA),
    espera: true,
  },
  {
    nombre: "ts en segundos, 14 minutos atrás",
    header: firmar(SEGUNDOS - 14 * 60),
    espera: true,
  },
  {
    nombre: "ts en segundos, 16 minutos atrás",
    header: firmar(SEGUNDOS - 16 * 60),
    espera: false,
    motivo: "TimestampOutOfTolerance",
  },
  {
    nombre: "ts en segundos, 16 minutos en el futuro",
    header: firmar(SEGUNDOS + 16 * 60),
    espera: false,
    motivo: "TimestampOutOfTolerance",
  },
  {
    nombre: "firmada con otro secreto",
    header: firmar(SEGUNDOS, { secreto: "otra-clave" }),
    espera: false,
    motivo: "SignatureMismatch",
  },
  {
    nombre: "firmada para otro data.id",
    header: firmar(SEGUNDOS, { dataId: "999999" }),
    espera: false,
    motivo: "SignatureMismatch",
  },
  {
    nombre: "sin header x-signature",
    header: undefined,
    espera: false,
    motivo: "MissingSignatureHeader",
  },
];

let fallaron = 0;

for (const caso of casos) {
  const r = validarFirmaWebhook({
    signatureHeader: caso.header,
    requestId: REQUEST_ID,
    dataId: DATA_ID,
    secreto: SECRETO,
    ahora: AHORA,
  });

  const okValido = r.valido === caso.espera;
  const okMotivo = caso.espera || !caso.motivo || r.motivo === caso.motivo;

  if (okValido && okMotivo) {
    console.log(`  ok    ${caso.nombre}`);
  } else {
    fallaron += 1;
    console.error(
      `  FALLA ${caso.nombre}\n        esperaba ${
        caso.espera ? "válida" : `rechazo por ${caso.motivo}`
      }, obtuve ${r.valido ? "válida" : `rechazo por ${r.motivo}`}`,
    );
  }
}

console.log("");
if (fallaron) {
  console.error(`  ${fallaron} caso(s) fallaron\n`);
  process.exit(1);
}
console.log(`  ${casos.length} casos OK — la firma del webhook valida como corresponde\n`);
