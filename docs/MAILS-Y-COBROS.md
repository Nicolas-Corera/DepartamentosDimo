# Mails, seña y saldo

Lo que agregó la Fase 4: el cobro dejó de ser "todo o nada" y el sistema
empezó a mandar mails solo. Este documento explica las tres cosas juntas
porque son la misma máquina: **una consulta genera dos links de cobro, cada
cobro dispara un mail, y cada mail dice cuánto falta.**

| Parte | Dónde vive |
| --- | --- |
| Alta de la consulta y mail de `consultas@` | [apps/sitio/api/consulta.js](../apps/sitio/api/consulta.js) |
| Cálculo de seña / saldo / total | [apps/pago/api/_lib/cobro.js](../apps/pago/api/_lib/cobro.js) |
| Cobro y mails de `reservas@` / `pagos@` | [apps/pago/api/pagos.js](../apps/pago/api/pagos.js), [apps/pago/api/webhook.js](../apps/pago/api/webhook.js) |
| Recibo al aprobar una transferencia | [apps/dashboard/api/comprobantes.js](../apps/dashboard/api/comprobantes.js) |
| Plantillas HTML de los mails | `apps/*/api/_lib/plantillas.js` |
| PDF del recibo | `apps/*/api/_lib/recibo.js` |

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
mandan el recibo de `pagos@`.

---

## 2. Los mails

Tres remitentes, ocho mails.

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
| El inquilino | Recibo del pago + **PDF del recibo** |
| Los dueños | Lo mismo + el **comprobante de transferencia** que subió el huésped, si el pago fue por transferencia |

---

## 3. El recibo en PDF

Lo genera [recibo.js](../apps/pago/api/_lib/recibo.js) con `pdf-lib`, en A4, a
nombre de **Diego Corera | DepartamentosDIMO**. Los datos del emisor salen de
variables de entorno (`EMISOR_*`).

Cada recibo se anota en la tabla `recibos` con un número correlativo:
`0001-00000042`, donde `0001` es `EMISOR_PUNTO_VENTA`.

> **No es una factura fiscal.** Una factura electrónica válida en Argentina
> necesita un CAE de ARCA, que se pide contra el web service WSFE con
> certificado, CUIT y punto de venta habilitado. Eso no está implementado: el
> PDF dice explícitamente que es un recibo de pago y no un comprobante fiscal.
>
> La tabla `recibos` ya tiene las columnas `cae`, `cae_vence`, `punto_venta` y
> `tipo_comprobante` vacías, y el PDF las imprime en el pie si `cae` viene
> cargado. Cuando se conecte ARCA, el trabajo es pedir el CAE, guardarlo en esas
> columnas y agregar el QR: el resto del PDF ya está.

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
```

Antes de armar el mail, el código intenta insertar esa clave. Si el insert
choca contra la primary key, alguien más ya lo mandó y no se hace nada. Si el
envío falla, la fila se borra para que el próximo intento lo reintente.

Los recibos usan el mismo criterio: `recibos` tiene índices únicos sobre
`mp_payment_id` y `transfer_receipt_id`, así que un pago no puede tener dos
números de recibo.

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

Ya están creadas en los tres proyectos de Vercel. Estas cinco están en
`COMPLETAR` y hay que cargarlas a mano:

| Variable | Proyectos | Qué va |
| --- | --- | --- |
| `DUENOS_EMAILS` | los tres | Los Gmail de los dueños, separados por coma |
| `EMISOR_CUIT` | pago, dashboard | El CUIT que va impreso en el recibo |
| `EMISOR_CONDICION_IVA` | pago, dashboard | Ej. `Responsable Monotributo` |
| `EMISOR_DOMICILIO` | pago, dashboard | El domicilio fiscal |

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
idénticos** en las tres apps, y `recibo.js` en dos.

No es un descuido: cada app es un proyecto de Vercel con su propio
`Root Directory`, y al desplegar solo ve los archivos de su carpeta. Un
`packages/` compartido en la raíz no se subiría con ninguna de las tres.

**Si tocás uno, copialo a las otras.** Para chequear que no se desincronizaron:

```bash
md5sum apps/*/api/_lib/plantillas.js
```
