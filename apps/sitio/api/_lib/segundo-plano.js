const CONTEXTO = Symbol.for("@vercel/request-context");

function waitUntilDelHost() {
  const fn = globalThis[CONTEXTO]?.get?.()?.waitUntil;
  return typeof fn === "function" ? fn : null;
}

export function enSegundoPlano(nombre, tarea, alFallar) {
  const correr = async () => {
    try {
      await tarea();
    } catch (error) {
      alFallar?.(error, nombre);
    }
  };

  const waitUntil = waitUntilDelHost();
  if (!waitUntil) return correr();

  waitUntil(correr());
  return Promise.resolve();
}
