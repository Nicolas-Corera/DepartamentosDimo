# Cobros con MercadoPago — guía de la integración

Checkout API + Card Payment Brick. Sin Checkout Pro y sin redirect: la persona
paga sin salir de `/pago/`.

Este archivo cubre cómo funciona, qué hay que configurar y cómo probarlo.

---

## 0. Estado

### Funcionando y probado de punta a punta

Se hizo un deploy de **preview** en Vercel y se ejecutaron cobros reales contra el
ambiente de prueba de MercadoPago. Resultados:

| Prueba | Resultado |
| --- | --- |
| Pago aprobado (titular `APRO`) | `approved` / `accredited`, pago `1350682609`, $160.000. Fila en `payments`, reserva pasada a `confirmada` |
| Se mandó `transaction_amount: 1` desde el cliente | Se cobraron **$160.000**: el servidor ignoró el importe del navegador |
| Rechazos (`FUND`, `SECU`, `CALL`) | Cada uno con su mensaje y su acción: "no tiene fondos" → otra tarjeta, "revisá el código" → reintentar, "tu banco tiene que autorizar" → contactar |
| Pendiente (`CONT`) | `in_process` / `pending_contingency`, pantalla de espera |
| Segundo cobro sobre una reserva ya paga | 409, no llega a MercadoPago |
| Doble clic (dos requests simultáneos) | **Un solo cobro.** El segundo recibe "ya recibimos tu pago, no vuelvas a pagar" |
| Webhook sin firma / con firma falsa | 401 los dos |
| Webhook con firma válida pero payload mintiendo `"approved"` | No escribió nada: fue a consultar la API en vez de creerle |
| `payments` desde el navegador (clave `anon`) | `401 permission denied` en lectura y en escritura |

Infraestructura lista:

- Tabla `payments` creada en `departamentosDimo DataBase` (`aiytevmxalwwbxxbgtwe`).
- Variables cargadas en el proyecto `departamentosdimopagoweb` (Root Directory `pago`),
  en Production, Preview y Development.
- `pago/.env` local generado (gitignoreado).

### Reservas de prueba

Quedaron en `booking_requests` para poder probar desde el navegador. Son
borrables cuando no hagan falta.

| Reserva | uuid | Estado |
| --- | --- | --- |
| Reserva de Prueba | `798445ee-eed5-466a-90ed-3a04c90ea36b` | pagada ($160.000) |
| Prueba Idempotencia | `a72b593c-404f-4484-a77b-c6fdf2a9005c` | pagada |
| Prueba Idempotencia 2 | `d51ca9bc-7488-4463-b6e5-49cf44703d91` | pagada |
| **Prueba Rechazo** | `592b2e1a-f10a-44c9-b8f4-a4e2cbaca15f` | **sin pagar** — usá esta para probar |

### Falta

1. **Configurar el webhook en el panel de MercadoPago** (sección 7). Es lo único
   que no se pudo hacer por API: URL `https://pago.departamentosdimo.com.ar/api/webhook`
   y la clave secreta tiene que coincidir con `MP_WEBHOOK_SECRET`.
2. **Pasar a producción**: commitear, pushear a `main` y Vercel deploya solo.
   Hasta que eso pase, `pago.departamentosdimo.com.ar` sigue sirviendo la página
   vieja.

---

## 1. Cómo funciona

```
  Navegador (/pago/)                    Backend (Vercel)              MercadoPago
  ────────────────────                  ────────────────              ───────────
  1. GET /?reserva=<uuid>
  2. fetch /api/reserva?ref=…  ───────► lee booking_requests
                                        calcula el monto
                               ◄─────── { resumen, monto, publicKey }
  3. monta el Card Payment Brick ─────────────────────────────────►  (iframes)
  4. la persona carga la tarjeta ────────────────────────────────►  tokeniza
                                                                ◄──  card_token
  5. POST /api/pagos           ───────► RECALCULA el monto
     { ref, formData }                  POST /v1/payments  ──────►  cobra
                                        + X-Idempotency-Key   ◄───  { status }
                                        guarda en payments
                               ◄─────── { status, mensaje }
  6. muestra el resultado

  … más tarde, si el estado cambia:
                                        POST /api/webhook   ◄──────  notifica
                                        valida x-signature
                                        GET /v1/payments/{id} ─────►
                                        actualiza payments   ◄─────  { status }
```

### Las tres decisiones que sostienen todo

**1. El monto lo calcula el servidor, siempre.**
El navegador manda el código de reserva y nada más. `POST /api/pagos` vuelve a
leer las fechas de `booking_requests` y recalcula el importe noche por noche
(ver sección 3). El `transaction_amount` que viene en el `formData` del Brick se
**descarta**. Si el front pudiera elegir el importe, cualquiera abre la consola,
lo cambia por `1` y se lleva la estadía por un peso.

**2. Los datos de tarjeta nunca tocan este sitio.**
Los campos del Brick son iframes servidos por MercadoPago. El SDK los cambia por
un `card_token` de un solo uso. Nuestro backend ve el token, el medio de pago y
las cuotas — nunca el número, el vencimiento ni el CVV. Por eso el sitio queda
fuera del alcance de PCI-DSS.

**3. Al webhook no se le cree el payload.**
La notificación dice *"pasó algo con el pago 123"*. Con ese id se consulta
`GET /v1/payments/123` con nuestro Access Token y se guarda **lo que responde la
API**. Si tomáramos el estado del cuerpo del POST, cualquiera que conozca la URL
podría mandarnos "aprobado" y quedarse con una estadía gratis.

---

## 2. Credenciales

### De dónde salen

Panel de MercadoPago → [Tus integraciones](https://www.mercadopago.com.ar/developers/panel/app)
→ tu aplicación:

| Variable | Dónde está en el panel | Secreta |
| --- | --- | --- |
| `MP_PUBLIC_KEY` | Credenciales de prueba → Public Key | No — la sirve la API al navegador |
| `MP_ACCESS_TOKEN` | Credenciales de prueba → Access Token | **Sí** |
| `MP_WEBHOOK_SECRET` | Webhooks → Configurar notificaciones → Generar clave secreta | **Sí** |

De Supabase (Project Settings → API):

| Variable | Cuál | Secreta |
| --- | --- | --- |
| `SUPABASE_URL` | Project URL — la misma del sitio principal | No |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` / `sb_secret_…` | **Sí** |

> **Por qué la `service_role` y no la `anon`:** `booking_requests` es solo-alta
> (ver [SUPABASE.md](../SUPABASE.md), sección 8). La `anon` puede insertar pero
> no leer. Para leer la reserva y calcular el monto hay que saltear RLS, y eso
> solo lo hace la `service_role`. Esa clave vive **exclusivamente** en el
> backend: no se manda al navegador, no se loguea y no se commitea.

### Dónde se cargan

**Local:** el `pago/.env` **ya existe**, con la parte de Supabase y los precios
completos. Faltan solo las tres variables de MercadoPago, que están al principio
del archivo y vacías. Abrilo, pegá los valores del panel y verificá:

```bash
cd pago
npm run env:check     # valida que la configuración cierre, sin imprimir claves
```

(Si alguna vez hay que rehacerlo desde cero, la plantilla completa está en
[`.env.example`](.env.example): `cp .env.example .env`.)

**Vercel** — proyecto con *Root Directory* = `pago`, en
Settings → Environment Variables. Cargá cada variable **dos veces**, con distinto
alcance:

| Alcance | Credenciales |
| --- | --- |
| Development + Preview | Las de **prueba** (`TEST-…`) |
| Production | Las de **producción** (`APP_USR-…`) |

Así una prueba en un preview nunca cobra plata real, y producción nunca queda con
credenciales de test.

El backend valida esto solo al arrancar:

- si `MP_PUBLIC_KEY` y `MP_ACCESS_TOKEN` son de ambientes distintos, **aborta**
  con un mensaje claro (es el error clásico: da un críptico
  `invalid card_token_id` que no menciona ambientes);
- si hay credenciales de test en producción, o reales fuera de producción, deja
  un warning bien visible en el log.

### Lo que nunca hay que hacer

- Escribir una credencial en un archivo que se commitea. `pago/.env` está
  cubierto por el `.gitignore` de la raíz (`.env` y `.env.*`, con
  `!.env.example`).
- Mandar el `MP_ACCESS_TOKEN` o la `service_role` al navegador. Solo sale al
  front la `MP_PUBLIC_KEY`, y sale por `/api/reserva`.

---

## 3. Base de datos

**Ya está creada.** El script quedó en [`sql/payments.sql`](sql/payments.sql) por
si hay que rehacerla en otro proyecto — es idempotente (`create table if not
exists`), así que volver a correrlo no rompe nada.

Crea `public.payments` con **RLS activo y sin políticas**, más un `revoke` de los
permisos de tabla para `anon` y `authenticated`: el navegador no puede leerla ni
escribirla. Solo entra el backend con la `service_role`, que saltea RLS. Es el
mismo doble candado que ya tiene `booking_requests`.

Se guarda **un registro por intento**, aprobado o rechazado. El historial de
rechazos es lo que después explica un *"yo pagué y no me figura"*.

**Si la escritura falla, el cobro se informa igual.** Una vez que MercadoPago
cobró, guardar en la base es problema nuestro: devolverle un error a alguien a
quien ya le cobramos es la forma más rápida de que pague dos veces. Así que el
fallo se loguea como `pago.no_se_pudo_registrar` y la respuesta sale igual. El
webhook resincroniza ese pago después — para eso está.

**Nota sobre `ultimos_cuatro`:** en los pagos rechazados MercadoPago manda
`card.last_four_digits` como string vacío, no ausente. Se normaliza a `null`
antes de guardar; sin eso, el `check` de la tabla rechazaba el INSERT y el
rechazo no quedaba registrado.

### Relación con `booking_requests`

Cuando un pago se aprueba, la reserva pasa a `estado = 'confirmada'`.
Si preferís confirmarlas a mano desde el panel, poné
`CONFIRMAR_RESERVA_AL_APROBAR=false`.

---

## 4. Cómo se arma el precio

El precio se calcula **noche por noche**, no con una tarifa única por estadía.
Una estadía del 10 al 14 son las noches del 10, 11, 12 y 13: la del 14 no se
cobra porque esa mañana se van.

### Paso 1 — la temporada

| Período | Temporada | Variable |
| --- | --- | --- |
| 15/12 al 31/01 | alta | `PRECIO_TEMPORADA_ALTA_ARS` |
| 01/02 al 15/02 | media | `PRECIO_TEMPORADA_MEDIA_ARS` |
| 16/02 al 14/12 | baja | `PRECIO_TEMPORADA_BAJA_ARS` |

Se mira solo el día y el mes, así que valen para cualquier año. La temporada
alta cruza el año (arranca el 15/12 y termina el 31/01), por eso en el código
son dos condiciones y no un rango.

### Paso 2 — las tarifas especiales

Cualquier noche que caiga dentro de un rango de la tabla
**`tarifas_especiales`** se cobra a ese precio, sin importar la temporada. Ahí
viven los fines de semana largo.

Es una tabla y no una lista en el código a propósito: los feriados cambian todos
los años y los *feriados con fines turísticos* (los puentes) los decreta el
gobierno cuando quiere. Se editan desde **Supabase → Table Editor →
`tarifas_especiales`** y tienen efecto en el próximo pago, sin tocar código ni
esperar un deploy.

| Columna | Qué es |
| --- | --- |
| `fecha_desde` / `fecha_hasta` | Rango inclusivo. Cada fecha es una **noche** que se cobra a ese precio |
| `precio_por_noche` | El importe |
| `motivo` | "Carnaval", "Semana Santa"… Se le muestra al cliente en el desglose |

> ⚠️ **Los fines de semana largo cargados hay que revisarlos.** Están derivados
> de los feriados nacionales 2027, pero qué noches cobrás caras en cada uno es
> una decisión comercial, no del calendario — y los puentes turísticos de 2027
> todavía pueden agregarse. Es un `UPDATE` en Table Editor.

### Ejemplo real

Una estadía del 16 al 23 de junio de 2027, que cruza el fin de semana largo de
Güemes:

```
  Mié 16 Jun   $ 80.000     baja
  Jue 17 Jun   $ 80.000     baja
  Vie 18 Jun   $ 90.000     [Güemes]
  Sáb 19 Jun   $ 90.000     [Güemes]
  Dom 20 Jun   $ 90.000     [Güemes]
  Lun 21 Jun   $ 90.000     [Güemes]
  Mar 22 Jun   $ 80.000     baja
  ─────────────────────────
  Alojamiento  $ 600.000
  Limpieza     $  10.000
  TOTAL        $ 610.000
```

Cuando las noches no valen todas lo mismo, el resumen del checkout muestra un
desplegable con este detalle. Sin eso, un total que no es "noches × precio" se
lee como un error de cálculo.

---

## 5. El calendario y los días ocupados

El calendario del sitio principal marca como ocupados los días ya reservados. Los
pide con `db.rpc("fechas_ocupadas")`, una función que devuelve *únicamente*
`check_in` y `check_out`. Ni nombre, ni mail, ni DNI: `booking_requests` sigue
siendo ilegible desde el navegador (401), y `anon` no tiene ni un permiso sobre
esa tabla.

> **Por qué una función y no una vista.** La primera versión era una vista. El
> Security Advisor de Supabase la marcó como *security definer view* y le activó
> `security_invoker=on`; con esa opción la vista pasa a correr con los permisos
> de quien la llama —  el navegador — y el calendario empezó a fallar con
> `permission denied for table booking_requests`. Volver a ponerla en `off` es
> pelearse con el advisor: la marca de nuevo y el próximo que entre al panel la
> "arregla" otra vez. Una función `security definer` con `search_path` fijado es
> el patrón que Supabase sí recomienda, y encima es más ajustado: la única
> puerta a la tabla es esa función.

**Qué cuenta como ocupado:** solo las reservas en estado `confirmada`.

Es a propósito. Si contaran también las consultas en estado `nueva`, cualquiera
podría bloquear el calendario entero mandando el formulario con fechas
inventadas — sin pagar y sin dar un dato real. `confirmada` la ponés vos, o la
pone un pago aprobado. Si preferís que las consultas sin pagar también bloqueen,
es agregar el estado al `where` de la vista en
[`sql/tarifas-y-ocupacion.sql`](sql/tarifas-y-ocupacion.sql) y volver a correrlo.

**El día de salida queda libre:** una reserva del 10 al 14 ocupa las noches 10,
11, 12 y 13. El 14 puede ser el check-in de otra persona. Si querés margen de
limpieza, está marcado en el código dónde cambiarlo.

Además, el calendario no deja elegir un rango que *cruce* días ocupados: sin eso
se puede pedir del 8 al 16 con el 12 ya reservado, que es una reserva imposible.

---

## 6. Los endpoints

Los tres viven en `pago/api/`. La lógica compartida está en `pago/api/_lib/`
(Vercel ignora las carpetas que empiezan con `_`, así que no se publican como
endpoints).

### `GET /api/reserva?ref=<uuid>`

Lo primero que pide la página. Devuelve el resumen de la reserva, el monto ya
calculado y la Public Key para montar el Brick.

El DNI sale **enmascarado** (`•••••789`). El mail sale entero, para precargar el
formulario: el uuid del link ya es la credencial de acceso a esa reserva.

### `POST /api/pagos`

```json
{ "ref": "<uuid>", "formData": { "…lo que entrega el onSubmit del Brick…" } }
```

Del `formData` se usan **solo** `token`, `payment_method_id`, `issuer_id`,
`installments`, `payer.email` y `payer.identification`. El
`transaction_amount` se ignora a propósito.

**Idempotencia.** Se manda `X-Idempotency-Key` derivada de
`sha256(reserva + card_token)`. No es un UUID al azar, y eso es deliberado: un
UUID nuevo por request no protegería de nada, porque el caso a cubrir es
justamente el reintento — doble clic, F5, un timeout de red que en realidad sí
llegó. Con esta clave, esos tres casos devuelven **el mismo pago** en vez de
cobrar dos veces. Y como el token de tarjeta es de un solo uso, dos intentos
legítimos distintos (reintentar con otra tarjeta) tienen claves distintas y no
se pisan.

Además, antes de cobrar se consulta si la reserva ya tiene un pago aprobado. Si
lo tiene, responde `409` y no llama a MercadoPago.

**Qué hace MercadoPago con una clave repetida.** No devuelve el pago original,
como uno esperaría: responde `HTTP 423 resource_already_locked`, código 2001,
*"Already posted the same request in the last minute"*. O sea que la clave evita
el doble cobro, pero deja al segundo request sin respuesta. Eso se detecta
(`esPedidoDuplicado`) y se resuelve buscando el pago por `external_reference` en
`GET /v1/payments/search`; si todavía no aparece porque el gemelo sigue en vuelo,
se responde 409 `pago_en_curso` con el texto *"ya recibimos tu pago, no vuelvas a
pagar"*. Nunca un error genérico: a alguien que acaba de pagar bien, un "volvé a
intentar" lo empuja a pagar dos veces.

### `POST /api/webhook`

Recibe las notificaciones. En orden:

1. valida la firma `x-signature` (HMAC-SHA256) — si no valida, **401** y afuera;
2. consulta `GET /v1/payments/{id}` a la API;
3. hace `upsert` en `payments` por `mp_payment_id`;
4. si quedó aprobado, confirma la reserva.

Todo el camino es idempotente: procesar la misma notificación diez veces deja
exactamente el mismo resultado. Por eso ante un error interno devuelve **500** a
propósito — MercadoPago reintenta y el reintento arregla el problema solo.

#### Cómo se valida la firma

MercadoPago firma un *manifest* armado con tres datos:

```
id:<data.id>;request-id:<x-request-id>;ts:<ts>;
```

`data.id` viene en el query string, `x-request-id` es un header, y `ts` sale del
propio `x-signature` (que llega como `ts=1704908010,v1=618c85…`). Se calcula el
HMAC-SHA256 de ese string con `MP_WEBHOOK_SECRET` y se compara con `v1` en
tiempo constante.

El cálculo lo hace **`WebhookSignatureValidator`, que viene en el propio SDK**
(`mercadopago`), no una implementación nuestra. Hacerlo a mano son quince líneas
y funciona, pero deja el formato congelado en `v1`: el día que MercadoPago
publique `v2`, la versión oficial lo soporta con actualizar el paquete y la
artesanal empieza a rechazar todo. Además ya contempla los dos detalles que se
pasan por alto siempre: si no viene `x-request-id` ese tramo del manifest se
omite entero, y el id va en minúsculas.

Si en los logs aparece el motivo `MissingHash`, es exactamente eso: MercadoPago
migró a una versión de firma nueva y hay que actualizar `mercadopago`.

---

## 7. Configurar el webhook en el panel

Panel de MercadoPago → tu aplicación → **Webhooks** → Configurar notificaciones:

1. **URL de producción:**
   `https://pago.departamentosdimo.com.ar/api/webhook`
2. **Eventos:** tildar solo **Pagos** (`payment`).
   El endpoint responde 200 e ignora el resto, pero no tiene sentido recibirlos.
3. **Generar clave secreta** → copiala a `MP_WEBHOOK_SECRET`, en el `.env` y en
   Vercel.
4. **Simular notificación** (mismo panel) para probar sin hacer un pago real.

> ⚠️ Si cambiás la clave secreta en el panel, hay que actualizarla en Vercel y
> **volver a deployar**. Con la clave vieja, el webhook rechaza todo con 401 y
> los estados dejan de sincronizarse en silencio.

En local, MercadoPago no puede llegar a `localhost`. Para probar el webhook de
verdad hace falta exponer el puerto (`ngrok http 3000`) y cargar esa URL en el
panel — o directamente probar contra un preview de Vercel.

---

## 8. Probar

### Con la página

1. Insertá una consulta desde el formulario del sitio principal (o cargá una
   fila a mano en `booking_requests` desde el panel de Supabase).
2. Copiá el `id` (uuid) de esa fila.
3. Abrí `https://pago.departamentosdimo.com.ar/?reserva=<uuid>`.
4. Pagá con una tarjeta de prueba.

### Tarjetas de prueba (Argentina)

| Tipo | Tarjeta | Número | CVV | Vencimiento |
| --- | --- | --- | --- | --- |
| Crédito | Mastercard | 5031 7557 3453 0604 | 123 | 11/30 |
| Crédito | Visa | 4509 9535 6623 3704 | 123 | 11/30 |
| Crédito | American Express | 3711 803032 57522 | 1234 | 11/30 |
| Débito | Mastercard | 5287 3383 1025 3304 | 123 | 11/30 |
| Débito | Visa | 4002 7686 9439 5619 | 123 | 11/30 |

**El resultado lo decide el nombre del titular**, no la tarjeta:

| Nombre del titular | Resultado |
| --- | --- |
| `APRO` | aprobado |
| `OTHE` | rechazado por error general |
| `FUND` | rechazado por fondos insuficientes |
| `SECU` | rechazado por código de seguridad inválido |
| `EXPI` | rechazado por fecha de vencimiento |
| `FORM` | rechazado por error de formulario |
| `CALL` | rechazado, con validación para autorizar |
| `CONT` | pendiente de pago |

Como DNI de prueba: `12345678`.

> Estos valores los define MercadoPago y los puede cambiar. Si alguno deja de
> comportarse como dice la tabla, la fuente es la documentación de
> [tarjetas de prueba](https://www.mercadopago.com.ar/developers/es/docs/checkout-api/additional-content/your-integrations/test/cards).

### Qué mirar en cada caso

| Probás con | Tiene que pasar |
| --- | --- |
| `APRO` | pantalla verde con Nº de operación; fila en `payments` con `status = approved`; reserva en `confirmada` |
| `FUND` | aviso naranja *"La tarjeta no tiene fondos suficientes"*, **el formulario sigue cargado** para probar otra tarjeta; fila en `payments` con `status = rejected` |
| `SECU` | aviso *"Revisá el código de seguridad"* |
| `CONT` | pantalla amarilla de pendiente; `status = in_process` |
| Recargar y volver a pagar una reserva ya paga | pantalla *"Esta reserva ya está paga"*, sin formulario |
| Entrar sin `?reserva=` | *"Falta el código de reserva"* |
| Entrar con un uuid inventado | *"No encontramos esa reserva"* |

### Los logs

Todo sale por `console` con el prefijo `[pagos]` y en una línea JSON por evento.
En Vercel: proyecto → Logs, filtrando por `[pagos]`.

Eventos: `reserva.consultada`, `pago.intento`, `pago.resultado`,
`mp.crearPago.inicio` / `.ok`, `webhook.procesado`, `webhook.firma_invalida`,
`pago.rechazado_por_api`.

**Nunca** se loguea el token de tarjeta, el número, el CVV, el DNI, el Access
Token ni la `service_role`: todo pasa por una función de redacción que los
reemplaza por `[oculto]` aunque estén anidados. Los mails se ofuscan
(`ma***@ejemplo.com`).

---

## 9. Desarrollo local

```bash
cd pago
npm install
npm run dev
```

Levanta [`scripts/dev-server.mjs`](scripts/dev-server.mjs) en
`http://localhost:3000`: sirve los archivos estáticos y ejecuta las funciones de
`api/` igual que Vercel (emula `req.query` — incluida la clave `data.id` con
punto que manda el webhook —, `req.body` y los helpers `res.status()/.send()`).

Para probar, entrá con el uuid de una fila de `booking_requests`:

    http://localhost:3000/?reserva=798445ee-eed5-466a-90ed-3a04c90ea36b

También está `npm run dev:vercel` (`vercel dev`), que es lo más fiel al entorno
real, pero obliga a estar logueado en Vercel y a linkear el proyecto. El
servidor propio arranca con `node` y nada más.

Lo que **no** se puede probar en local es el webhook de verdad: MercadoPago no
puede llegar a `localhost`. Para eso hace falta exponer el puerto
(`ngrok http 3000`) y cargar esa URL en el panel, o probar contra un preview de
Vercel.

Para chequear el `.env` sin levantar nada:

```bash
npm run env:check
```

---

## 10. Problemas frecuentes

| Síntoma | Causa casi segura |
| --- | --- |
| `invalid card_token_id` | `MP_PUBLIC_KEY` y `MP_ACCESS_TOKEN` de ambientes distintos. El backend ahora lo detecta al arrancar y aborta con un mensaje explícito |
| La página se queda en *"Cargando el formulario seguro…"* | Public Key inválida o un bloqueador de anuncios. A los 12 segundos aparece el aviso; mirá la consola del navegador |
| El webhook devuelve 401 siempre | `MP_WEBHOOK_SECRET` no coincide con la clave del panel, o se cambió en el panel y no se volvió a deployar |
| Los pagos se cobran pero `payments` queda vacía | Falta correr `sql/payments.sql`, o `SUPABASE_SERVICE_ROLE_KEY` tiene la clave `anon` |
| *"No encontramos esa reserva"* con un uuid que existe | El backend está apuntando a otro proyecto de Supabase (`SUPABASE_URL`), o la clave no es `service_role` |
| El monto que se cobra no es el que se muestra | `PRECIO_NOCHE_ARS` / `TASA_LIMPIEZA_ARS` distintos entre ambientes de Vercel |
| El pago sale $0 o falla con `transaction_amount` | Las fechas de la reserva no cierran (`check_out` <= `check_in`) |

---

## 11. Archivos

```
pago/
├── index.html              la página (el Brick se monta en #cardPaymentBrick_container)
├── pago.js                 front: pide la reserva, monta el Brick, muestra el resultado
├── package.json            deps: mercadopago, @supabase/supabase-js
├── vercel.json             config del proyecto (Root Directory = pago)
├── .env.example            plantilla de variables — el .env real no se commitea
├── MERCADOPAGO.md          este archivo
├── scripts/
│   └── dev-server.mjs      servidor local (solo desarrollo, no se despliega)
├── sql/
│   ├── payments.sql             la tabla de pagos, con RLS cerrado
│   └── tarifas-y-ocupacion.sql  tarifas especiales + vista fechas_ocupadas
└── api/
    ├── reserva.js          GET  — resumen + monto + public key
    ├── pagos.js            POST — crea el pago (Checkout API)
    ├── webhook.js          POST — notificaciones, con validación de firma
    └── _lib/
        ├── env.js          lee y valida las variables de entorno
        ├── http.js         respuestas JSON y política de errores
        ├── log.js          logs con redacción de datos sensibles
        ├── mercadopago.js  SDK, idempotencia y firma del webhook
        ├── mensajes.js     status_detail -> mensaje para una persona
        ├── precios.js      cálculo del monto (fuente de verdad)
        └── supabase.js     cliente service_role y queries
```
