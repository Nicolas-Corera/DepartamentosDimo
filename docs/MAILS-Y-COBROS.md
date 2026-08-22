# Mails, seña y saldo

Lo que agregó la Fase 4: el cobro dejó de ser "todo o nada" y el sistema
empezó a mandar mails solo. Este documento explica las tres cosas juntas
porque son la misma máquina: **una consulta genera dos links de cobro, cada
cobro dispara un mail, y cada mail dice cuánto falta.**

| Parte | Dónde vive |
| --- | --- |
| Alta de la consulta y mail de `consultas@` | [apps/sitio/api/consulta.js](../apps/sitio/api/consulta.js) |
| Alta de la reseña y mail de `resenas@` | [apps/sitio/api/resena.js](../apps/sitio/api/resena.js) |
| Cálculo de seña / saldo / total | [apps/pago/api/_lib/cobro.js](../apps/pago/api/_lib/cobro.js) |
| Cobro y mails de `reservas@` / `pagos@` | [apps/pago/api/pagos.js](../apps/pago/api/pagos.js), [apps/pago/api/webhook.js](../apps/pago/api/webhook.js) |
| Mail al aprobar una transferencia | [apps/dashboard/api/comprobantes.js](../apps/dashboard/api/comprobantes.js) |
| Plantillas HTML de los mails | `apps/*/api/_lib/plantillas.js` |

Antes de nada hay que correr [sql/fase4-pagos-y-mails.sql](../sql/fase4-pagos-y-mails.sql)
en el SQL Editor de Supabase. Es idempotente: se puede correr de nuevo sin
romper nada.

---

## 1. La lógica de cobro

El precio de la estadía se calcula noche por noche contra las tablas
`temporadas` y `tarifas_especiales`. Eso no cambió. Lo que cambió es **cuánto
de ese precio se cobra en cada pago**.

El link de pago acepta un parámetro `modo`:

```
https://pago.departamentosdimo.com.ar/?ref=<uuid>&modo=reserva
https://pago.departamentosdimo.com.ar/?ref=<uuid>&modo=total
```

`configuracion_pagos.porcentaje_reserva` define qué porcentaje del total es la
seña. Se edita en el panel, pestaña **Tarifas → Seña**.

Con un total de $ 630.000 y una seña del 30%:

| Situación | `modo=reserva` cobra | `modo=total` cobra |
| --- | --- | --- |
| No pagó nada | $ 189.000 (seña) | $ 630.000 (todo) |
| Ya pagó la seña | $ 441.000 (saldo) | $ 441.000 (saldo) |
| Pagó $ 50.000 sueltos | $ 139.000 (completa la seña) | $ 580.000 (saldo) |
| Ya pagó todo | nada — "reserva paga" | nada — "reserva paga" |

**Los dos links convergen.** Una vez cubierta la seña, `modo=reserva` cae solo
en el saldo. Por eso al dueño le alcanza con mandar el del total: el sistema
resuelve qué corresponde cobrar. Los dos links son la misma reserva y no
llevan ningún monto adentro — el backend recalcula todo contra las fechas.

### Por qué existe `monto_base`

Cada pago guarda dos números:

- `monto` — lo que se le cobró a la tarjeta, **con** el recargo del medio de pago.
- `monto_base` — la parte que descuenta del precio del alojamiento.

El saldo se calcula sumando los `monto_base`, no los `monto`. Si se usara
`monto`, el recargo de la tarjeta le estaría pagando noches al huésped: alguien
que seña $ 189.000 + 10% de recargo aparecería habiendo pagado $ 207.900 de una
estadía de $ 630.000, y terminaría debiendo $ 18.900 menos de lo que debe.

Las transferencias confirmadas entran en la misma cuenta, con las mismas dos
columnas en `transfer_receipts`. Una transferencia **pendiente no cuenta**:
recién suma cuando se aprueba en el panel.

### El concepto de cada pago

Cada fila de `payments` y de `transfer_receipts` guarda un `concepto`:

- `reserva` — es una seña.
- `saldo` — es lo que faltaba después de una seña.
- `total` — es el total completo, pagado de una.

De eso depende qué mail sale: `reserva` manda el de `reservas@`, los otros dos
mandan el de `pagos@`.

---

## 2. Los mails

Cuatro remitentes, nueve mails.

### `consultas@departamentosdimo.com.ar`

Sale cuando alguien manda el formulario del index.

| Para | Qué lleva |
| --- | --- |
| El inquilino | Sus datos del formulario y el aviso de que le respondemos a la brevedad |
| Los dueños | Los datos de contacto del inquilino, el detalle de la estadía, el total, y **los dos links de cobro** (seña y total) con la URL visible abajo de cada botón para copiarla |

Los links van como botón **y** como texto plano. Los clientes de mail no
ejecutan JavaScript, así que un botón de "copiar al portapapeles" no
funcionaría: la URL escrita es lo que se puede seleccionar y pegar en WhatsApp.

### `reservas@departamentosdimo.com.ar`

Sale cuando se aprueba un pago con `concepto = reserva`.

| Para | Qué lleva |
| --- | --- |
| El inquilino | Confirmación de la seña, cuánto falta, y el link para saldar el resto |
| Los dueños | Los datos del huésped, cuánto entró, cuánto falta, y el link del saldo |

También sale desde acá el aviso de **comprobante de transferencia recibido**
(al inquilino: "lo estamos verificando"; a los dueños: "hay algo para aprobar",
con el archivo adjunto). No estaba en el pedido original, pero sin ese mail
nadie se entera de que subieron un comprobante hasta que alguien entra al panel.

### `pagos@departamentosdimo.com.ar`

Sale cuando se completa el pago: el saldo, o el total de una.

| Para | Qué lleva |
| --- | --- |
| El inquilino | El detalle del pago: concepto, monto, medio, N° de operación y saldo |
| Los dueños | Lo mismo + el **comprobante de transferencia** que subió el huésped, si el pago fue por transferencia |

El mail **es** el comprobante: no hay ningún archivo adjunto más que el
comprobante del huésped.

### `resenas@departamentosdimo.com.ar`

Sale cuando alguien publica una reseña desde el sitio.

| Para | Qué lleva |
| --- | --- |
| Los dueños | El nombre, el puntaje, el comentario completo y el link al panel para aprobarla |

El visitante no recibe nada: el formulario de reseñas no pide mail. La reseña
entra **sin aprobar** y no se ve en el carrusel hasta que se apruebe en el
panel, así que este mail es lo que avisa que hay algo esperando.

Igual que el de consultas, el alta pasó del navegador a
[apps/sitio/api/resena.js](../apps/sitio/api/resena.js): sin eso no hay id de
la fila recién creada con el que armar la clave de idempotencia.

---

## 3. No se emiten facturas ni recibos en PDF

Se implementó y después se sacó: los dueños decidieron no emitir comprobantes
por ahora. El código quedó entero y funcionando en
[futuro/facturacion-arca/](../futuro/facturacion-arca/), con las instrucciones
para volver a conectarlo y lo que faltaría para que el PDF sea una factura
electrónica válida (CAE de ARCA, certificado, punto de venta).

**Esto no toca el comprobante de transferencia que sube el huésped**, que sigue
funcionando igual: se sube en el checkout, se aprueba en el panel y se adjunta
al mail de los dueños.

---

## 3 bis. Contacto en el pie de cada mail

Todos los mails cierran con una vía de contacto, distinta según quién lo recibe:

| Quién lo recibe | Qué ve |
| --- | --- |
| El inquilino | `MAIL_DE_CONTACTO` y `WHATSAPP_CONTACTO`. El link de WhatsApp viene con un mensaje precargado que dice de qué reserva se trata, con las fechas y el código |
| Los dueños | El mail y el teléfono **del huésped**. El número abre WhatsApp directo, sin mensaje precargado |

### El teléfono del huésped

El formulario pide el **código de país en un desplegable aparte** (Argentina por
default, más los limítrofes y una opción "Otro"), y guarda el número ya
normalizado en formato E.164: `+5492235551234`.

La normalización vive en `apps/*/api/_lib/telefono.js` y corre en los dos lados:
en el navegador para mostrarle al huésped el número que va a quedar
(*"Te vamos a escribir al +54 9 223 555 1234"*), y de nuevo en el servidor, que
es el que manda.

Para Argentina no alcanza con pegar el código de país. Hay que sacar el `0` de
la característica y el `15` del celular, y agregar el `9` que pide WhatsApp. Los
cuatro se resuelven al mismo número:

```
0223 15 555-1234   ->  +5492235551234
0223 155 551234    ->  +5492235551234
223 555 1234       ->  +5492235551234
+54 223 555 1234   ->  +5492235551234
```

El `15` puede estar después de una característica de 2, 3 o 4 dígitos, así que
se prueba en esas tres posiciones y gana la primera que deje un número nacional
de 10 dígitos. Puede errarle con formatos raros: por eso el formulario le
muestra al huésped el número final antes de enviar, y el panel muestra el número
guardado y no una reconstrucción.

Las consultas cargadas antes de este cambio tienen el teléfono como lo escribió
la persona. Para esas queda `telefonoParaWhatsapp()`, que aplica las mismas
reglas al vuelo.

`contacto@departamentosdimo.com.ar` **hay que crearla en el proveedor de mail.**
Resend solo envía: una dirección que solo existe como remitente no recibe nada,
y los mensajes que manden ahí rebotan.

El checkout muestra el mismo bloque en las pantallas de error y de resultado, y
lo toma de `/api/reserva`.

---

## 4. Que un mail no se mande dos veces

MercadoPago reintenta el webhook. El huésped recarga la página. Alguien aprieta
dos veces el botón del panel. Sin protección, cada uno de esos casos manda el
mismo mail de nuevo.

La tabla `emails_enviados` tiene una `primary key` que describe **el hecho**,
no el intento:

```
consulta:<booking_id>:inquilino
reserva:<mp_payment_id>:duenos
pago:<mp_payment_id>:inquilino
pago:transfer:<receipt_id>:duenos
resena:<review_id>
```

Antes de armar el mail, el código intenta insertar esa clave. Si el insert
choca contra la primary key, alguien más ya lo mandó y no se hace nada. Si el
envío falla, la fila se borra para que el próximo intento lo reintente.

**Los mails nunca cortan un cobro.** Todo el bloque de envío está en un
`try/catch`: si Resend está caído o el dominio no está verificado, el pago se
registra igual y el error queda en los logs.

---

## 5. Refresco dinámico

Las tres apps releen sus datos solas. Todas usan el mismo criterio: no
refrescan si la pestaña está oculta, refrescan apenas volvés a ella, y si algo
falla espacian los intentos (backoff) en vez de golpear el servidor.

| App | Cada cuánto | Qué relee | Qué NO pisa |
| --- | --- | --- | --- |
| Sitio | 90 s | Fechas ocupadas y reseñas | El calendario si hay un modal abierto; el carrusel si las reseñas no cambiaron |
| Checkout | 25 s | El estado de la reserva | El formulario de tarjeta: si el monto cambió avisa y pide recargar, no lo remonta solo |
| Panel | 30 s | Solo la pestaña activa | Tarifas, si tenés cambios sin guardar |

En el checkout el refresco sirve para algo concreto: si el huésped dejó la
página abierta y mientras tanto se aprobó su transferencia, o pagó desde otro
lado, la pantalla pasa sola a "reserva paga" en vez de dejarlo pagar dos veces.

---

## 6. Variables de entorno

Ya están creadas en los tres proyectos de Vercel. Esta queda en `COMPLETAR` y
hay que cargarla a mano:

| Variable | Proyectos | Qué va |
| --- | --- | --- |
| `DUENOS_EMAILS` | los tres | Los Gmail de los dueños, separados por coma |

Mientras `DUENOS_EMAILS` diga `COMPLETAR`, el código lo descarta por no tener
formato de mail y **los envíos quedan apagados**, con el motivo en los logs. Es
a propósito: mejor no mandar nada que mandarle los datos de un huésped a una
dirección inventada.

Para ver cómo quedó la configuración de cada app:

```bash
npm --prefix apps/pago run env:check
```

---

## 7. Ver los mails sin mandarlos

```bash
npm --prefix apps/sitio run mails:preview
```

Escribe los ocho mails con datos de ejemplo en `apps/sitio/.mails-preview/`
(está en el `.gitignore`). Se abren con cualquier navegador. Sirve para tocar
las plantillas sin gastar envíos ni llenarle la casilla a nadie.

---

## 8. Las copias de las librerías

`resend.js`, `plantillas.js`, `precios.js` y `cobro.js` están **repetidos
idénticos** en las tres apps.

No es un descuido: cada app es un proyecto de Vercel con su propio
`Root Directory`, y al desplegar solo ve los archivos de su carpeta. Un
`packages/` compartido en la raíz no se subiría con ninguna de las tres.

**Si tocás uno, copialo a las otras.** Para chequear que no se desincronizaron:

```bash
md5sum apps/*/api/_lib/plantillas.js
```
