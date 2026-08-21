# Cobros con MercadoPago — guía de la integración

Checkout API + Card Payment Brick. Sin Checkout Pro y sin redirect: la persona
paga sin salir de `/pago/`.

Este archivo cubre cómo funciona, qué hay que configurar y cómo probarlo.

---

## 0. Estado

### Ya hecho

| Qué | Detalle |
| --- | --- |
| Tabla `payments` creada | En el proyecto `departamentosDimo DataBase` (`aiytevmxalwwbxxbgtwe`). RLS activo, cero políticas, sin permisos para `anon`. Verificado: la clave pública recibe `401 permission denied` en lectura y en escritura |
| `pago/.env` generado | Con `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (clave `sb_secret_`, sacada de la Management API) y los precios. Está gitignoreado |
| Reserva de prueba | `798445ee-eed5-466a-90ed-3a04c90ea36b` — 15 al 20 de enero de 2027, 2 personas, total $160.000. Se puede borrar cuando no haga falta |
| Endpoints verificados | `/api/reserva` lee la reserva real y calcula el monto; `/api/webhook` rechaza firmas inválidas con 401 y no le cree al payload |

### Falta — las tres son tuyas

Ninguna se puede hacer desde el código: requieren tu cuenta de MercadoPago y el
panel de Vercel.

| # | Qué | Dónde |
| --- | --- | --- |
| 1 | Completar las 3 variables de MercadoPago en `pago/.env` | Panel de MercadoPago → sección 2 |
| 2 | Configurar el webhook (URL + clave secreta) | Panel de MercadoPago → sección 5 |
| 3 | Cargar todas las variables en Vercel | Settings → Environment Variables → sección 2 |

Una vez hecho el punto 1, esto tiene que dar OK:

```bash
cd pago && npm run env:check
```

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
leer las fechas de `booking_requests` y recalcula el importe con
`PRECIO_NOCHE_ARS` y `TASA_LIMPIEZA_ARS`. El `transaction_amount` que viene en
el `formData` del Brick se **descarta**. Si el front pudiera elegir el importe,
cualquiera abre la consola, lo cambia por `1` y se lleva la estadía por un peso.

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

### Relación con `booking_requests`

Cuando un pago se aprueba, la reserva pasa a `estado = 'confirmada'`.
Si preferís confirmarlas a mano desde el panel, poné
`CONFIRMAR_RESERVA_AL_APROBAR=false`.

---

## 4. Los endpoints

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

## 5. Configurar el webhook en el panel

Panel de MercadoPago → tu aplicación → **Webhooks** → Configurar notificaciones:

1. **URL de producción:**
   `https://<tu-dominio-de-pago>/api/webhook`
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

## 6. Probar

### Con la página

1. Insertá una consulta desde el formulario del sitio principal (o cargá una
   fila a mano en `booking_requests` desde el panel de Supabase).
2. Copiá el `id` (uuid) de esa fila.
3. Abrí `https://<tu-dominio-de-pago>/?reserva=<uuid>`.
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

## 7. Desarrollo local

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

## 8. Problemas frecuentes

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

## 9. Archivos

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
│   └── payments.sql        la tabla, con RLS cerrado
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
