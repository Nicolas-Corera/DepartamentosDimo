# Cobros con MercadoPago — guía de la integración

Checkout API + Card Payment Brick. Sin Checkout Pro y sin redirect: la persona
paga sin salir de `/pago/`.

Este archivo cubre cómo funciona, qué hay que configurar y cómo probarlo.

> **El monto ya no es siempre el total.** Desde la Fase 4 el link de pago acepta
> `?modo=reserva|total`: cobra una seña, el saldo que falta o el total completo,
> según lo que la reserva ya tenga pago. La lógica y los mails que salen de cada
> cobro están en [MAILS-Y-COBROS.md](MAILS-Y-COBROS.md).

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
- Variables cargadas en el proyecto `departamentosdimopagoweb` (Root Directory `apps/pago`),
  en Production, Preview y Development.
- `apps/pago/.env` local generado (gitignoreado).

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
> (ver [SUPABASE.md](SUPABASE.md), sección 8). La `anon` puede insertar pero
> no leer. Para leer la reserva y calcular el monto hay que saltear RLS, y eso
> solo lo hace la `service_role`. Esa clave vive **exclusivamente** en el
> backend: no se manda al navegador, no se loguea y no se commitea.

### Dónde se cargan

**Local:** el `apps/pago/.env` **ya existe**, con la parte de Supabase completa. Los
precios ya no van acá (están en la base, ver la sección 4). Faltan solo las tres
variables de MercadoPago, que están al principio del archivo y vacías. Abrilo,
pegá los valores del panel y verificá:

```bash
cd pago
npm run env:check     # valida que la configuración cierre, sin imprimir claves
```

(Si alguna vez hay que rehacerlo desde cero, la plantilla completa está en
[`.env.example`](../apps/pago/.env.example): `cp .env.example .env`.)

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

- Escribir una credencial en un archivo que se commitea. `apps/pago/.env` está
  cubierto por el `.gitignore` de la raíz (`.env` y `.env.*`, con
  `!.env.example`).
- Mandar el `MP_ACCESS_TOKEN` o la `service_role` al navegador. Solo sale al
  front la `MP_PUBLIC_KEY`, y sale por `/api/reserva`.

---

## 3. Base de datos

**Ya está creada.** El script quedó en [`sql/payments.sql`](../sql/payments.sql) por
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

En dos etapas: primero el precio base de la estadía, después el recargo del medio
de pago.

> **Dónde se configura todo esto.** En el
> [dashboard](https://dash.departamentosdimo.com.ar), pestaña *Tarifas*. Los
> precios ya **no** están en variables de entorno de Vercel: viven en cuatro
> tablas de Supabase (`temporadas`, `medios_pago`, `planes_cuotas` y
> `tarifas_especiales`) y tienen efecto en el próximo pago, sin redeploy. Para
> crearlas, correr [`sql/configuracion-tarifas.sql`](../sql/configuracion-tarifas.sql).

### Etapa 1 — el precio base

Se calcula **noche por noche**, no con una tarifa única por estadía. Una estadía
del 10 al 14 son las noches del 10, 11, 12 y 13: la del 14 no se cobra porque esa
mañana se van.

**a. La temporada.** Cada noche cae en el rango de `temporadas` que la contenga.
Son rangos **absolutos, con año** (`2026-12-15` al `2027-01-31`), no día y mes:
cuando se termina un ciclo hay que correr las fechas desde el dashboard.

| Si… | Entonces… |
| --- | --- |
| Dos rangos se solapan | Gana el **más caro**. Mejor cobrar de más y que el cliente reclame, que cobrar de menos y comerse la diferencia. |
| La noche no cae en **ninguno** | Se cobra al precio de la **temporada baja**. Nunca falla el pago por un descuido de configuración. |

El fallback es silencioso, así que el dashboard muestra un aviso arriba de todo
con los tramos del próximo año que quedaron sin cubrir. Es lo único que evita
cobrar barato durante meses sin enterarse.

**b. Las tarifas especiales.** Cualquier noche que caiga dentro de un rango de
`tarifas_especiales` se cobra a ese precio, **pisando** a la temporada. Ahí viven
los fines de semana largo. Mismo criterio ante un solapamiento: gana la más cara.

El total de esta etapa es el **precio de transferencia**: el de contado.

### Etapa 2 — el recargo del medio de pago

Sobre ese total se suma el recargo de `medios_pago` y, si es crédito en cuotas,
el de `planes_cuotas`:

| Medio | Recargo |
| --- | --- |
| Transferencia | Es la base. Normalmente 0%. |
| Débito | El de su fila. Siempre en un pago. |
| Crédito | El de su fila **más** el del plan de cuotas elegido. |

Los dos porcentajes se **suman**, no se componen: un crédito en +8% pagado en 3
cuotas con un plan de +15% termina en **+23%** sobre la base, no en +24,2%. Es la
cuenta que hace cualquiera con una calculadora mirando el resumen, y coincidir
con eso vale más que la precisión financiera de componerlos.

**El medio lo determina el servidor, no el navegador.** Si el front pudiera
elegirlo, alcanzaría con mandar `"debito"` desde la consola y pagar con una
tarjeta de crédito para ahorrarse el recargo. `tipoDeTarjeta()` le pregunta a
MercadoPago qué es el `payment_method_id` que generó el Brick (`GET
/v1/payment_methods`), que sí es confiable.

### Las cuotas se eligen antes de cargar la tarjeta

El selector de cuotas del checkout es **nuestro**, no el del Brick.

El recargo de cada plan lo definimos nosotros, así que la cantidad de cuotas
cambia el importe que se cobra. El Brick recibe el monto al montarse y no lo
recalcula solo: si las cuotas se eligieran adentro de su formulario, mostraría el
importe de otro plan. Por eso el selector va arriba, se elige primero, y cada
cambio remonta el Brick con el monto definitivo.

#### Cómo se apaga el selector de cuotas del Brick

El Brick se monta **siempre** con `minInstallments = maxInstallments = 1`, sin
importar cuántas cuotas se hayan elegido, y la cantidad real la pone `pagar()`
sobre el formData justo antes de mandarlo:

```js
formData.installments = estado.cuotas;
```

Parece un rodeo, pero es lo único que apaga el bloque de cuotas propio del
Brick — ese que aparece abajo del formulario cuando se completa el número de
tarjeta, con el título *"Seleccioná la cantidad de cuotas"* y el cartelito de
**CFTEA / TEA**. Duplicaba nuestro selector y, peor, esas tasas son las de
MercadoPago: no describen nuestro recargo, que es el que se está cobrando.

Antes acá iba `min = max = la elegida`, y el bloque salía igual con una sola
opción. **No hay opción de configuración para esconderlo** — las únicas que
existen son `hideFormTitle`, `hidePaymentButton`, `hideEmail`,
`hideIdentificationTypes` y `hideValueProp`. La regla que usa el Brick para
decidir si lo dibuja es, textual:

```js
1 === opciones.length && 1 === opciones[0].value ? ocultar : mostrar
```

Con `min = max = 3` hay una sola opción, pero vale 3, y por eso se veía. Con 1
se cumplen las dos condiciones y no se dibuja.

**Por qué mandar las cuotas por afuera no es un agujero.** Para el backend ese
número siempre fue entrada del navegador: `/api/pagos` lo valida contra el
máximo configurado y calcula el importe a partir del plan. El monto nunca viaja
desde el front. Un token de tarjeta tampoco lleva cuotas adentro — es solo la
tarjeta —, así que cobrar en 3 con un token generado bajo una configuración de 1
es una operación normal de la API.

**Lo que se pierde:** el Brick ya no valida contra MercadoPago que la tarjeta
acepte esa cantidad de cuotas. Si no las acepta, el rechazo llega igual al
cobrar, con su mensaje de `status_detail`.

### Transferencia: el comprobante

La transferencia no se cobra desde la página: la hace la persona en su banco.
Lo que hace el checkout es **recibir el comprobante** y dejarlo registrado en
`transfer_receipts` para que el equipo lo confirme contra el extracto.

El botón del resumen es el mismo para las tres pestañas. En transferencia dice
*"Enviar comprobante"* y arranca **deshabilitado**: se habilita recién cuando
hay un archivo elegido (PNG, JPG, JPEG o PDF, hasta 5 MB).

**Un comprobante no es un pago.** Es alguien diciendo "ya transferí". Por eso no
toca `payments` ni marca la reserva como paga: entra en `transfer_receipts` con
`estado = 'pendiente'` y ahí espera. Ver
[sql/comprobantes-transferencia.sql](../sql/comprobantes-transferencia.sql).

#### El trámite sobrevive a un F5

`GET /api/reserva` devuelve el **último** comprobante de esa reserva en
`transferencia: { estado, monto, subidoEn, revisadoEn }`, y es lo primero que
mira la página después de `pago.yaPagada`. Sin eso, el estado vivía solo en la
memoria de la pestaña: quien recargaba volvía al formulario de pago como si
nunca hubiera subido nada, y lo razonable era pensar que tenía que transferir de
nuevo.

Con el mismo link, entonces, se ve en qué anda el trámite:

| Estado | Qué se ve | Botón |
| --- | --- | --- |
| `pendiente` | *Recibimos tu comprobante* — se está verificando | ninguno |
| `confirmado` | *¡Listo! Tu pago fue aprobado* — el mismo cartel que un pago con tarjeta | ninguno |
| `rechazado` | *No pudimos validar tu transferencia* | **Pagar con otro medio** |

Los tres los arma `mostrarEstadoDeTransferencia()`, y la usan los dos caminos
—recién subido y recargando la página— para que no se puedan desincronizar los
textos.

**"Pagar con otro medio" no recarga la página**, y esa es toda la diferencia. Un
F5 volvería a pedir la reserva, el backend volvería a contar que el comprobante
está rechazado y la pantalla volvería a ser esa misma: un botón que no lleva a
ningún lado. En vez de eso monta el checkout ahí mismo y limpia el archivo
elegido, que es justamente el que se rechazó.

**El cartel se muestra sin montar el checkout por debajo.** Armarlo primero y
taparlo después hacía que el formulario apareciera un segundo entero y recién
ahí fuera reemplazado — un parpadeo bien visible en cada carga. El checkout se
arma recién cuando hace falta, dentro de `volverAlCheckout()`.

**Y la decisión se recuerda.** Quien ya vio el cartel y apretó "Pagar con otro
medio" no lo tiene que volver a descartar en cada recarga: queda una marca en
`localStorage` con la clave `dimo:transferencia-descartada:<id del
comprobante>`, y `cargarReserva()` la mira antes de decidir qué muestra.

Vive en `localStorage` y no en la base porque no es un dato del negocio: es una
preferencia de quien está mirando la pantalla, en ese navegador. Y lleva el id
del comprobante adentro, así que si sube otro y ese también se rechaza, el
cartel vuelve a aparecer una vez — que es lo correcto, porque es una novedad
distinta.

Un comprobante rechazado deja subir otro: el que manda es el más nuevo.

#### La subida, en dos pasos

El archivo **no pasa por nuestra función**:

| Paso | Quién | Qué |
| --- | --- | --- |
| 1 | `POST /api/comprobante` `{accion:"firmar"}` | Valida la reserva y el tipo, elige la ruta (`<uuid de la reserva>/<generado>.<ext>`) y devuelve una URL firmada de un solo uso |
| 2 | El navegador | `PUT` del archivo directo a Storage con esa firma |
| 3 | `POST /api/comprobante` `{accion:"registrar"}` | Mira el objeto **ya subido**, toma su tamaño y tipo reales, y recién ahí escribe la fila |

Mandar el archivo adentro del body obligaría a codificarlo en base64 (crece un
33%) y a pasarlo por la función, que en Vercel tiene un tope de **4,5 MB** de
body. La foto de un comprobante sacada con el celular lo puede superar, y el
rechazo sería incomprensible para quien la sube.

#### Las cuatro puertas

El bucket `comprobantes` es **privado y sin ninguna política de RLS**: `anon` no
puede ni subir ni leer. Darle INSERT sería regalarle a cualquiera un disco
gratis contra la cuenta. Sube el backend con service_role, y encima:

1. **La firma está atada a la ruta.** Un token robado apuntado a otro path
   devuelve `InvalidSignature`.
2. **La ruta tiene que empezar con el uuid de la reserva.** Sin eso, el paso de
   registrar aceptaría colgar el comprobante de otra persona de una reserva
   propia.
3. **Storage aplica el allowlist de MIME del bucket.** Un `PUT` de un ejecutable
   con un token válido devuelve `415 invalid_mime_type`.
4. **El registro mira el objeto real**, no lo que declaró el navegador. Si el
   tamaño se pasa, borra el archivo y rechaza.

Y antes que todo eso, la misma puerta que tiene el cobro con tarjeta: si la
reserva ya está paga, responde `409 ya_pagada`.

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
  TOTAL        $ 600.000
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
[`sql/tarifas-y-ocupacion.sql`](../sql/tarifas-y-ocupacion.sql) y volver a correrlo.

**El día de salida también se bloquea:** una reserva del 10 al 14 cobra las
noches 10, 11, 12 y 13 —  el precio va por noche y el 14 esa mañana se van— pero
en el calendario se tachan los cinco días. El 14 no puede ser el check-in de
otra persona: queda como margen para limpiar y preparar, y evita el cruce de dos
grupos el mismo día. Está marcado en `apps/sitio/script.js` dónde revertirlo.

Además, el calendario no deja elegir un rango que *cruce* días ocupados: sin eso
se puede pedir del 8 al 16 con el 12 ya reservado, que es una reserva imposible.

---

## 6. Los endpoints

Los tres viven en `apps/pago/api/`. La lógica compartida está en `apps/pago/api/_lib/`
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

Levanta [`apps/pago/tools/dev-server.mjs`](../apps/pago/tools/dev-server.mjs) en
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
| El monto que se cobra no es el que se muestra | El navegador tiene la config vieja en pantalla: recargá. El monto lo recalcula siempre `/api/pagos` con lo que hay en la base |
| El pago sale $0 o falla con `transaction_amount` | Las fechas de la reserva no cierran (`check_out` <= `check_in`) |

---

## 11. Archivos

```
pago/
apps/pago/
├── index.html              el checkout
├── pago.js                 front: pide la reserva, monta el Brick, muestra el resultado
├── package.json            deps: mercadopago, @supabase/supabase-js
├── vercel.json             config del proyecto (Root Directory = apps/pago)
├── .env.example            plantilla de variables — el .env real no se commitea
├── tools/
│   └── dev-server.mjs      servidor local (solo desarrollo, no se despliega)
└── api/
    ├── reserva.js          GET  — resumen + monto + public key
    ├── pagos.js            POST — crea el pago (Checkout API)
    ├── comprobante.js      POST — firma la subida del comprobante y lo registra
    ├── webhook.js          POST — notificaciones, con validación de firma
    └── _lib/
        ├── env.js          lee y valida las variables de entorno
        ├── http.js         respuestas JSON y política de errores
        ├── log.js          logs con redacción de datos sensibles
        ├── mercadopago.js  SDK, idempotencia y firma del webhook
        ├── mensajes.js     status_detail -> mensaje para una persona
        ├── precios.js      cálculo del monto y del recargo (fuente de verdad)
        └── supabase.js     cliente service_role y queries

sql/                        se corren a mano en el SQL Editor de Supabase
├── payments.sql                 la tabla de pagos, con RLS cerrado
├── tarifas-y-ocupacion.sql      tarifas especiales + función fechas_ocupadas
├── configuracion-tarifas.sql    temporadas, medios de pago y planes de cuotas
└── comprobantes-transferencia.sql  transfer_receipts + el bucket privado

docs/MERCADOPAGO.md         este archivo
```
---

## Trampas del código

El código no lleva comentarios. Lo que sigue es lo que no se deduce leyéndolo, y
lo que más de una vez ya se rompió por no saberlo.

### El vigía de 12 segundos del Brick

Con una public key inválida, el SDK de MercadoPago rechaza una promesa interna
y la que devuelve `create()` **se queda colgada para siempre**. Sin el
`setTimeout` de 12 segundos, quien está pagando se queda mirando "Cargando el
formulario seguro…" sin más. Con una key válida el Brick monta en uno o dos
segundos, así que el vigía nunca se dispara de más.

`fallaAlCargarElBrick()` es idempotente por lo mismo: la pueden llamar el
`catch` y el vigía a la vez.

### `mostrarResultado()` desmonta el Brick en el próximo tick

Con `setTimeout(desmontarBrick, 0)`. La función se puede estar ejecutando dentro
de un callback del propio Brick, y desmontarlo en el medio es pedirle que se
saque la silla de abajo.

### El monto del Brick es solo para mostrar

`initialization.amount` es el total del plan elegido, y sirve únicamente para lo
que se ve en pantalla. El importe que se cobra lo recalcula `/api/pagos` del
lado del servidor, a partir de la reserva y de las tarifas. Del navegador nunca
viaja un monto.
