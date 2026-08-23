import { servidoresListos } from "./preflight.mjs";

export default async function preparar() {
  if (await servidoresListos("1-funcional", ["sitio", "pago", "panel"])) return;

  throw new Error(
    "Faltan dev servers. Arriba está cuál y con qué comando levantarlo.",
  );
}
