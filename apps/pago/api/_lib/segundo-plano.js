// Los mails se mandan DENTRO del pedido, antes de contestarle al navegador.
//
// Antes esto usaba el waitUntil del host (Vercel) para contestar rápido y dejar
// los mails corriendo atrás. En producción no funciona: apenas sale la
// respuesta la función deja de tener red, los fetch a Supabase quedan colgados
// y mueren solos a los 12 s con "The operation was aborted due to timeout".
// Resultado: la consulta se guardaba y el mail no salía nunca.
//
// Los timeouts internos (12 s Supabase, 15 s Resend) acotan lo que puede tardar
// la respuesta, y vercel.json le da a la función margen suficiente.
export async function enSegundoPlano(nombre, tarea, alFallar) {
  try {
    await tarea();
  } catch (error) {
    alFallar?.(error, nombre);
  }
}
