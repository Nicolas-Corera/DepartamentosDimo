export const PAISES = [
  { codigo: "54", nombre: "Argentina" },
  { codigo: "598", nombre: "Uruguay" },
  { codigo: "56", nombre: "Chile" },
  { codigo: "55", nombre: "Brasil" },
  { codigo: "595", nombre: "Paraguay" },
  { codigo: "591", nombre: "Bolivia" },
  { codigo: "51", nombre: "Perú" },
];

function soloDigitos(valor) {
  return String(valor == null ? "" : valor).replace(/\D/g, "");
}

function limpiarArgentino(crudo) {
  let n = soloDigitos(crudo).replace(/^0+/, "");

  if (n.length === 12) {
    for (const i of [2, 3, 4]) {
      if (n.slice(i, i + 2) === "15") {
        n = n.slice(0, i) + n.slice(i + 2);
        break;
      }
    }
  }

  return n;
}

export function normalizarTelefono(codigoPais, numero) {
  const pais = soloDigitos(codigoPais);
  let n = soloDigitos(numero).replace(/^00/, "");

  if (pais && n.startsWith(pais)) n = n.slice(pais.length);

  if (pais === "54") {
    if (n.startsWith("9")) n = n.slice(1);
    n = limpiarArgentino(n);
    return n ? `+549${n}` : "";
  }

  n = n.replace(/^0+/, "");
  return n ? `+${pais}${n}` : "";
}

export function telefonoParaWhatsapp(crudo) {
  const texto = String(crudo == null ? "" : crudo).trim();
  let n = soloDigitos(texto).replace(/^00/, "");
  if (!n) return "";

  const tienePais = texto.startsWith("+") || n.startsWith("54");

  if (n.startsWith("54")) {
    const resto = n.slice(2);
    const sinNueve = resto.startsWith("9") ? resto.slice(1) : resto;
    const limpio = limpiarArgentino(sinNueve);
    return limpio.length === 10 ? `549${limpio}` : n;
  }

  if (tienePais) return n;

  const limpio = limpiarArgentino(n);
  return limpio.length === 10 ? `549${limpio}` : `54${limpio}`;
}

const AREAS_DE_TRES = new Set([
  "220", "221", "223", "230", "236", "237", "249", "260", "261", "263", "264",
  "266", "280", "291", "297", "299", "336", "341", "342", "343", "345", "348",
  "351", "353", "358", "362", "364", "370", "376", "379", "380", "381", "383",
  "385", "387", "388",
]);

function largoDelArea(nacional) {
  if (nacional.startsWith("11")) return 2;
  if (AREAS_DE_TRES.has(nacional.slice(0, 3))) return 3;
  return 4;
}

export function formatearTelefono(crudo) {
  const texto = String(crudo == null ? "" : crudo).trim();
  const n = soloDigitos(texto);
  if (!n) return texto;

  if (n.startsWith("549") && n.length === 13) {
    const nacional = n.slice(3);
    const area = largoDelArea(nacional);
    return `+54 9 ${nacional.slice(0, area)} ${nacional.slice(area)}`;
  }

  return texto.startsWith("+") ? texto : `+${n}`;
}
