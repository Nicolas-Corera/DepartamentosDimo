# Recibo en PDF y facturación ARCA — parkeado

Esto **no está conectado**. Es código que funcionó y se sacó del build en agosto
de 2026, porque los dueños decidieron no emitir comprobantes por ahora. Está
acá entero para poder volver a enchufarlo sin reescribirlo.

**Nada de esto tiene que ver con el comprobante de transferencia que sube el
huésped.** Eso sigue funcionando igual: se sube en el checkout, se aprueba en el
panel y se adjunta al mail que reciben los dueños.

## Qué hay acá

| Archivo | Qué es |
| --- | --- |
| `recibo.js` | Genera el PDF con `pdf-lib`: A4, datos del emisor, detalle de la estadía, forma de pago y estado de la reserva. Ya trae el pie que imprime el CAE si viene cargado. |
| `recibos.sql` | La tabla `recibos`, con numeración correlativa y las columnas `cae`, `cae_vence`, `punto_venta` y `tipo_comprobante`. |

## Qué se sacó al parkearlo

- `apps/pago/api/_lib/recibo.js` y `apps/dashboard/api/_lib/recibo.js` (movidos acá).
- La dependencia `pdf-lib` de `apps/pago` y `apps/dashboard`.
- `crearRecibo()` de los dos `api/_lib/supabase.js`.
- El bloque `emisor` de los dos `api/_lib/env.js`, y las variables `EMISOR_NOMBRE`,
  `EMISOR_MARCA`, `EMISOR_CUIT`, `EMISOR_CONDICION_IVA`, `EMISOR_DOMICILIO`,
  `EMISOR_EMAIL`, `EMISOR_SITIO` y `EMISOR_PUNTO_VENTA` de los `.env.example` y
  de los tres proyectos de Vercel.
- La fila "Recibo N°" y el párrafo del PDF adjunto en `plantillas.js`.
- La tabla `recibos` de Supabase, que estaba vacía.

## Cómo volver a conectarlo

1. Copiar `recibo.js` a `apps/pago/api/_lib/` y a `apps/dashboard/api/_lib/`.
2. `npm --prefix apps/pago install pdf-lib` y lo mismo en `apps/dashboard`.
3. Correr `recibos.sql` en el SQL Editor de Supabase.
4. Volver a poner `crearRecibo()` en los dos `api/_lib/supabase.js`. Busca por
   `mp_payment_id` o `transfer_receipt_id`, y si ya existe devuelve la fila en
   vez de insertar: eso es lo que impide que un reintento del webhook emita dos
   números para el mismo pago.
5. Volver a poner el bloque `emisor` en los dos `api/_lib/env.js` y cargar las
   variables `EMISOR_*` en Vercel.
6. En `avisarPagoCompletado()` (pago) y `avisarTransferenciaConfirmada()`
   (dashboard): crear el recibo, generar el PDF y sumarlo a `adjuntos`.
7. En `plantillas.js`, volver a recibir `recibo` en `pagoInquilino` y `pagoDuenos`
   y agregar la fila `{ etiqueta: "Recibo N°", valor: recibo?.numeroTexto }`.

El commit que lo sacó tiene todo el detalle en el diff, por si conviene
revertirlo en vez de rehacerlo a mano.

## Lo que falta para que sea una factura de verdad

El PDF **no es un comprobante fiscal**. Para que lo sea hay que pedir el CAE
contra el web service de facturación electrónica de ARCA (WSFE), que necesita:

- CUIT del emisor y punto de venta habilitado para factura electrónica.
- Certificado digital (`.crt`) y clave privada, generados en el portal de ARCA.
- Un ticket de acceso del WSAA, que se renueva cada 12 horas.

Con eso resuelto, el trabajo del lado de este código es corto: pedir el CAE
antes de generar el PDF, guardarlo en las columnas `cae` y `cae_vence` de la
tabla, y agregar el QR de AFIP. `recibo.js` ya imprime el CAE en el pie cuando
`recibo.cae` viene cargado; hoy, sin CAE, imprime la leyenda de que no es una
factura electrónica.
