const FIRMAS = [
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
];

const CABECERA_PDF = "%PDF-";

const MARGEN_PDF = 1024;

function empiezaCon(buffer, bytes) {
  if (buffer.length < bytes.length) return false;
  return bytes.every((b, i) => buffer[i] === b);
}

export function tipoRealDeArchivo(buffer) {
  if (!buffer || buffer.length < 3) return null;

  for (const firma of FIRMAS) {
    if (empiezaCon(buffer, firma.bytes)) return firma.mime;
  }

  const inicio = buffer.subarray(0, MARGEN_PDF).toString("latin1");
  if (inicio.indexOf(CABECERA_PDF) !== -1) return "application/pdf";

  return null;
}
