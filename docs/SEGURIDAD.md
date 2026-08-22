# Seguridad

Auditoría de la Fase 6. Este archivo es el registro de qué se revisó, qué se
encontró y qué quedó configurado. Se actualiza al cerrar cada parte.

| Parte | Alcance | Estado |
| --- | --- | --- |
| **A** | Supabase: RLS, políticas, claves, storage, red y Auth | ✅ cerrada |
| **B** | Vercel: variables, previews, sesión en las rutas y fugas de error | ✅ cerrada |
| C | — | pendiente |
| D | — | pendiente |
| E | — | pendiente |

---

## Parte A — Supabase

Proyecto `aiytevmxalwwbxxbgtwe`, Postgres 17.6, región `us-west-2`.

Todo se verificó **contra la base de producción**, no leyendo los `.sql`: las
consultas salieron por la Management API y los intentos de acceso se hicieron
con la clave pública real, desde afuera, como lo haría cualquiera.

### A.1 — RLS en todas las tablas

Las diez tablas de `public` tienen RLS activo:

| Tabla | RLS | Políticas |
| --- | --- | --- |
| `booking_requests` | ✅ | 0 |
| `configuracion_pagos` | ✅ | 0 |
| `emails_enviados` | ✅ | 0 |
| `medios_pago` | ✅ | 0 |
| `payments` | ✅ | 0 |
| `planes_cuotas` | ✅ | 0 |
| `reviews` | ✅ | 2 |
| `tarifas_especiales` | ✅ | 0 |
| `temporadas` | ✅ | 0 |
| `transfer_receipts` | ✅ | 0 |

**Cero políticas no es un descuido, es el diseño.** RLS activo sin ninguna
política deniega todo salvo a `service_role`, que la saltea. Las nueve tablas
sensibles son inaccesibles desde el navegador por definición: solo entra el
backend. La única con políticas es `reviews`, que es la única que el sitio
público toca directo.

Encima hay una segunda barrera: `anon` y `authenticated` **no tienen ni el
`GRANT`** sobre esas nueve tablas. Aunque mañana alguien agregue una política
por error, el permiso de Postgres sigue faltando.

Y hay una tercera: el event trigger `ensure_rls` corre en cada `ddl_command_end`
y activa RLS solo en cualquier tabla nueva. Una tabla creada de apuro no nace
expuesta.

### A.2 — Ninguna política con `USING (true)`

Las dos políticas de `reviews` están acotadas:

| Política | Cmd | `USING` | `WITH CHECK` |
| --- | --- | --- | --- |
| lectura pública de reseñas aprobadas | `SELECT` | `approved = true` | — |
| alta pública de reseñas sin aprobar | `INSERT` | — | `approved = false AND created_at <= now()` |

Se lee solo lo aprobado. No hay política de `UPDATE` ni de `DELETE`, así que
nadie desde afuera puede editar ni borrar reseñas: eso pasa por el panel, con
`service_role`.

### A.3 — `WITH CHECK` en las escrituras

La política de `INSERT` usa `WITH CHECK`, que es lo correcto: `USING` no filtra
filas nuevas. La condición `approved = false` es la que impide que alguien se
publique una reseña de cinco estrellas sin pasar por moderación.

Verificado a mano — insertar con `approved: true` desde afuera devuelve:

```
new row violates row-level security policy for table "reviews"
```

### A.4 — La `service_role` no está en el navegador

No aparece en ningún archivo que llegue al cliente. Solo se nombra en
`apps/*/api/_lib/`, que es código de servidor, y en la documentación.

`apps/sitio/supabase-config.js` —el único archivo con una clave embebida— tiene
la `sb_publishable_`, que es pública por diseño.

Además `apps/sitio/tools/build-config.mjs` aborta el build si detecta que en el
lugar de la anon key se pegó una `service_role` o una `sb_secret_`. El error se
comete una vez y el script lo frena.

Los `.env` están en `.gitignore` y ninguno está commiteado — solo los
`.env.example`.

### A.5 — Storage

Un solo bucket, `comprobantes`, donde se suben los comprobantes de
transferencia:

| | |
| --- | --- |
| Público | ❌ no |
| Límite por archivo | 5 MB |
| Tipos permitidos | `image/png`, `image/jpeg`, `application/pdf` |
| Políticas sobre `storage.objects` | 0 → nadie salvo `service_role` |

Probado desde afuera con la clave pública: listar devuelve vacío, la URL pública
da 400 y subir un PNG válido devuelve `403 new row violates row-level security
policy`.

> Un detalle que confunde: si subís un archivo con un tipo **no permitido**, la
> respuesta es `415 invalid_mime_type` en vez de un 403. Parece que el permiso
> pasó y solo falló el formato, pero no: Storage valida el MIME antes de
> consultar RLS. Con un tipo permitido, el 403 aparece igual.

### A.6 — Red y cuenta

Acá estaban los dos agujeros reales de la Parte A.

| | Antes | Ahora |
| --- | --- | --- |
| SSL enforcement | ❌ apagado | ✅ activo |
| IPs con acceso directo a Postgres | `0.0.0.0/0` y `::/0` — todo internet | ✅ ninguna |

Con SSL enforcement apagado, una conexión directa a la base podía viajar sin
cifrar. Con `0.0.0.0/0`, cualquiera en internet podía al menos *intentar*
conectarse y probar contraseñas.

Cerrar el acceso directo no rompe nada porque **las tres apps no usan conexión
directa**: van todas por la REST API (PostgREST) con sus claves. El SQL Editor
de la web tampoco pasa por ahí. Lo único que se pierde es conectarse con `psql`,
DBeaver o TablePlus.

> **Si algún día necesitás un cliente de escritorio:** Supabase → Project
> Settings → Database → Network Restrictions, y agregás tu IP. Es reversible en
> el momento.

### A.7 — Auth

El hallazgo importante: **Supabase Auth no se usa en ninguna de las tres apps.**
El panel tiene su propio login con código de seis dígitos y cookie firmada, el
sitio y el checkout no autentican a nadie. `auth.users` tiene cero filas.

Pero las altas por mail estaban **abiertas**. Cualquiera con la clave pública
—que es visible en el sitio— podía crear cuentas contra el proyecto. No servían
para leer nada (el rol `authenticated` tiene los mismos permisos que `anon`),
pero ensuciaban la base y gastaban la cuota de mails.

| | Antes | Ahora |
| --- | --- | --- |
| Altas de usuarios | ❌ abiertas | ✅ cerradas |
| Confirmación de mail | ✅ ya estaba activa | ✅ activa |
| `site_url` | `http://localhost:3000` | `https://departamentosdimo.com.ar` |

La confirmación de mail (`mailer_autoconfirm = false`) ya venía bien: sin ella
se podían dar de alta cuentas con mails inventados.

Un intento de alta hoy devuelve:

```
{"code":422,"error_code":"signup_disabled","msg":"Signups not allowed for this instance"}
```

> Si más adelante el panel migra a Supabase Auth, hay que volver a abrir las
> altas **y** endurecer la contraseña: hoy el mínimo son 6 caracteres, sin
> requisitos de composición y sin chequeo contra HIBP. Mientras Auth no se use,
> no importa.

---

## Parte B — Vercel

Tres proyectos, todos en el equipo `departamentos-dimo`, sin framework (JS
plano + funciones en `api/`):

| Proyecto | Root | Dominio |
| --- | --- | --- |
| `departamentosdimoweb` | `apps/sitio` | departamentosdimo.com.ar |
| `departamentosdimopagoweb` | `apps/pago` | pago.departamentosdimo.com.ar |
| `dashboarddepartamentosdimo` | `apps/dashboard` | dash.departamentosdimo.com.ar |

Igual que en la Parte A, todo se verificó contra los proyectos reales: la
configuración por la API de Vercel y los endpoints llamados desde afuera contra
producción.

### B.8 — Nada expuesto al cliente por prefijo

Ninguna de las 42 variables de los tres proyectos empieza con `NEXT_PUBLIC_`.
No es casualidad ni suerte: **ninguna app es Next.js**. Son HTML y JS planos con
funciones serverless, así que no existe el paso de build que inyecta esas
variables en el bundle. El riesgo no está mitigado, directamente no aplica.

Lo único que llega al navegador con una clave adentro es
`apps/sitio/supabase-config.js`, que tiene la `sb_publishable_` — pública por
diseño. Ver [A.4](#a4--la-service_role-no-está-en-el-navegador).

### B.9 — Todo secreto real está marcado como *Sensitive*

| Variable | Dónde | Tipo |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | las tres | `sensitive` |
| `RESEND_API_KEY` | las tres | `sensitive` |
| `MP_ACCESS_TOKEN` | pago, dashboard | `sensitive` |
| `MP_WEBHOOK_SECRET` | pago | `sensitive` |
| `PANEL_CODIGO` | dashboard | `sensitive` |
| `PANEL_SESION_SECRET` | dashboard | `sensitive` |

Las que quedaron como `encrypted` en vez de `sensitive` —`PRECIO_TEMPORADA_*`,
`PORCENTAJE_A_COBRAR`, `MP_MAX_CUOTAS`, `TASA_LIMPIEZA_ARS`,
`MP_STATEMENT_DESCRIPTOR`, `CONFIRMAR_RESERVA_AL_APROBAR`— **no son secretos**:
son precios y configuración de negocio. Poder volver a verlas en el dashboard es
una comodidad, no un riesgo.

### B.10 — Preview usa las credenciales de producción

Todas las variables secretas están cargadas con el mismo valor en `production` y
en `preview`. Un deploy de preview de `pago` habla con la base de producción, con
la cuenta de MercadoPago de producción y con el Resend de producción.

El checklist lo marca como problema **porque asume que las URLs de preview son
públicas**. Acá no lo son — ver [B.11](#b11--los-previews-están-detrás-del-sso-de-vercel).
Eso baja el riesgo de "cualquiera en internet" a "cualquiera que tenga acceso al
equipo de Vercel o a quien le pases el link". Con un solo integrante, es acotado.

Queda anotado, no corregido, y a propósito: separarlo de verdad exige un segundo
proyecto de Supabase y credenciales de test de MercadoPago para el entorno
Preview. Es trabajo real, no un flag. **Si algún día se suma alguien más al
equipo de Vercel, esto pasa a ser lo primero a arreglar.**

### B.11 — Los previews están detrás del SSO de Vercel

Los tres proyectos tienen `ssoProtection: all_except_custom_domains`: todo
deploy que no sea un dominio propio pide login de Vercel.

Verificado contra los previews vivos — los tres devuelven `302` hacia
`vercel.com/sso-api`, tanto en la raíz como en las rutas de `api/`. Los dominios
de producción responden normal.

#### El agujero: un bypass que salteaba todo eso

`departamentosdimopagoweb` tenía un **Protection Bypass for Automation** activo.
Es un secreto que, mandado en el header `x-vercel-protection-bypass`, entra a
cualquier deploy del proyecto salteando el SSO por completo.

Confirmado a mano antes de tocarlo: con el secreto, el preview de `pago` —el que
lleva las claves de producción de Supabase y MercadoPago— devolvía `200`.

No lo usaba nadie: no aparece en ningún archivo del repo, ni como
`VERCEL_AUTOMATION_BYPASS_SECRET` ni como header. Era un resto de alguna prueba.

**Revocado.** El mismo pedido con el secreto viejo ahora devuelve `302`, y los
tres dominios de producción siguen respondiendo `200`.

> Si alguna vez hace falta uno de verdad (un monitor externo que chequee un
> preview), se genera en Settings → Deployment Protection → Protection Bypass for
> Automation. Ojo: sirve para *todo* el proyecto, no para un deploy puntual.

### B.12 — Sesión y permisos al inicio de cada ruta

**El panel.** Las cinco rutas que tocan datos llaman `exigirSesion(req)` como
primera línea adentro del `try`, antes de leer el body y antes de cualquier
consulta:

| Ruta | Métodos | `exigirSesion` |
| --- | --- | --- |
| `alquileres.js` | GET | ✅ primera línea |
| `cancelar.js` | POST | ✅ primera línea |
| `comprobantes.js` | GET, PATCH | ✅ primera línea |
| `resenas.js` | GET, PATCH, DELETE | ✅ primera línea |
| `tarifas.js` | GET, PUT | ✅ primera línea |
| `login.js` | POST | — es el login |
| `sesion.js` | GET, DELETE | — chequea con `haySesion` |

Probado en producción, sin cookie, llamando directo por HTTP —incluido el `PUT`
de tarifas, el `DELETE` de reseñas y el `POST` de cancelación con devolución—:
**las siete devuelven `401`**, con `{"error":"Tu sesión venció...","codigo":"sin_sesion"}`.

La sesión en sí está bien armada: cookie firmada con HMAC-SHA256, comparada con
`timingSafeEqual`, con `HttpOnly`, `SameSite=Strict`, `Secure` fuera de
desarrollo y vencimiento adentro del payload firmado. El login compara el código
en tiempo constante, agrega 500 ms de demora al fallar y bloquea la IP a los 8
intentos en 10 minutos.

**El checkout.** `pago` no tiene sesión —es público a propósito, se entra con el
link del mail— así que lo que hay que mirar no es la sesión sino **si el cliente
puede mentir sobre la plata**. No puede:

- El precio sale de `calcularPrecio()` con las fechas guardadas en la reserva y
  las tarifas de la base.
- Lo ya pagado sale de `pagosAprobados()` y `transferenciasConfirmadas()`.
- El recargo por medio y cuotas sale de la configuración de la base.

El navegador manda `ref`, `modo` y el token de la tarjeta. **Ningún monto viaja
desde el cliente.** Además valida que el medio esté habilitado, que el plan de
cuotas exista, y corta con `409` si la reserva ya está paga.

**El webhook de MercadoPago** valida la firma HMAC (`x-signature`) antes de
hacer nada, y —lo importante— no le cree al body: vuelve a pedirle el pago a la
API de MercadoPago con `consultarPago(dataId)`. Firma inválida es `401`.

#### Lo que sí falta: nadie limita los endpoints que mandan mails

`POST /api/consulta` y `POST /api/resena` del sitio son públicos, sin sesión,
sin captcha y **sin rate limit**. Cada llamada escribe una fila en Supabase y
dispara un mail por Resend a los dueños.

El único freno son los `unique` de la base, que cortan el duplicado exacto
(`23505`). Cambiando el DNI o una letra del comentario se esquiva sin esfuerzo.
Un script en un rato llena la casilla, quema la cuota de Resend y ensucia
`booking_requests`.

No hay nada a nivel Vercel que lo cubra: los tres proyectos tienen el firewall
sin reglas y sin OWASP. El único rate limit del repo es el del login del panel
(`sesion.js`), y es en memoria — en serverless cada instancia tiene la suya, así
que es best-effort.

**Queda pendiente**, no es de la Parte B: el checklist pedía validar sesión y
permisos, y eso está. Pero conviene resolverlo antes de que alguien lo
encuentre.

### B.13 — Mensajes de error al cliente

`pago` y `sitio` ya lo hacían bien: `manejarError()` manda el detalle al log y
devuelve un texto genérico.

**El panel no.** Su `manejarError()` devolvía el mensaje interno tal cual:

```js
return json(res, 500, { error: error.message, codigo: "config" });
...
error: error?.message || "Algo falló del lado del servidor.",
```

Con eso, un error de la base llegaba al navegador así:

```
Supabase (401): JWT expired → Revisá SUPABASE_SERVICE_ROLE_KEY en Vercel:
estas tablas tienen RLS activo y sin políticas...
```

Eso cuenta qué backend hay atrás, cómo se llaman las variables de entorno, qué
archivos `.sql` hay que correr y cómo está armado el RLS. Son mensajes escritos
para la consola que terminaban en la respuesta HTTP.

La mayoría de esas rutas están detrás de `exigirSesion`, así que para verlo hay
que tener el código del panel. Pero la rama de `ErrorDeConfig` **se alcanza sin
sesión**: `GET /api/sesion` llama a `haySesion()`, que llama a `leerConfig()`. Si
la configuración está rota, el detalle sale sin autenticar.

Corregido en `apps/dashboard/api/_lib/http.js` — ahora el panel se comporta como
las otras dos apps. Los `ErrorVisible` (los mensajes escritos para que los lea
una persona) siguen pasando tal cual; el resto se va al log:

| Error | Antes, al cliente | Ahora, al cliente |
| --- | --- | --- |
| `ErrorVisible` | el mensaje | el mensaje *(igual)* |
| `ErrorDeConfig` | `SUPABASE_SERVICE_ROLE_KEY tiene una clave PÚBLICA…` | *"El panel no está bien configurado… el detalle está en los logs."* |
| Cualquier otro | `Supabase (401): JWT expired → Revisá…` | *"Algo falló del lado del servidor…"* |

Y el log pasó de guardar `error.message` a guardar el `error` entero, así que en
Vercel ahora se ve el stack completo — no se perdió información, se movió al
lugar donde va.

---

## Los dos frenos contra el abuso

Salieron del hallazgo abierto en [B.12](#lo-que-sí-falta-nadie-limita-los-endpoints-que-mandan-mails).
Son dos capas distintas y hacen falta las dos: una frena al usuario apurado, la
otra al script.

### El freno del navegador — `botones.js`

Un archivo por app (`apps/*/botones.js`), cargado antes del script principal. No
hay que llamarlo ni engancharlo a nada: se activa solo y cubre **todos** los
botones de la página, los que ya existen y los que se creen después.

Qué hace: cuando se clickea un botón, lo bloquea. Si ese click disparó un
pedido a la red, lo mantiene bloqueado hasta que el pedido termina. Si no
disparó ninguno, lo libera a los 120 ms y no se nota.

Cómo bloquea, que es la parte importante: **no toca `.disabled`**. Pone
`data-bloqueado` y con eso aplica `pointer-events:none`, más `aria-disabled` y
`aria-busy` para los lectores de pantalla. La razón es que varios botones ya se
manejan el `.disabled` por su cuenta —`btn-pagar`, los de aprobar y rechazar
comprobantes, el de guardar tarifas— y si la guarda usara el mismo atributo se
pelearían: uno lo pondría y el otro lo sacaría antes de tiempo. Usando un canal
propio, las dos protecciones conviven y la más estricta gana.

Para saber si hay un pedido en curso envuelve `fetch` **y** `XMLHttpRequest`.
Lo segundo no es de más: el SDK de MercadoPago usa XHR, así que sin eso el botón
de pagar quedaría afuera.

Tres agujeros que se cerraron y vale tener presentes:

| Vía | Qué pasaba |
| --- | --- |
| Multi-click | El obvio: tres clicks, tres pedidos |
| `Enter` en un campo | Muchos formularios se envían con Enter sin tocar el botón, así que el bloqueo del botón no alcanzaba |
| `form.requestSubmit()` | Lo mismo, por código |

La guarda ignora el `Enter` dentro de un `<textarea>`: ahí Enter es un salto de
línea, no un envío.

Hay una sutileza que costó encontrar. La guarda bloquea el botón en la fase de
captura del click, **antes** de que el formulario dispare su `submit`. Si al ver
el botón bloqueado cancelara ese `submit`, estaría cancelando el envío que ella
misma acaba de provocar: el formulario no enviaría nunca. Por eso recuerda cuál
fue el botón del click en curso y lo deja pasar; cancela los que vengan después.

Un botón se puede eximir con `data-sin-bloqueo`, y hay un tope de 20 segundos
para que nada quede trabado si un pedido nunca resuelve.

### El freno del servidor — `apps/sitio/api/_lib/limite.js`

El de arriba vive en el navegador, así que a un script no lo frena: no ejecuta
JavaScript, le pega directo al endpoint. Este es el que lo para.

Dos capas sobre `POST /api/consulta` y `POST /api/resena`:

| Capa | Consulta | Reseña | Dónde vive |
| --- | --- | --- | --- |
| Por IP, por hora | 5 | 3 | En memoria |
| Global, por hora | 20 | 15 | En la base |

El chequeo por IP corre **antes de validar el cuerpo**, a propósito: así el que
manda basura repetida también se frena, no solo el que manda datos válidos.

La capa global existe porque la de IP tiene un límite real: en serverless cada
instancia tiene su propia memoria, así que un atacante repartido entre varias
instancias —o entre varias IPs— se le escapa. El tope global cuenta las filas
creadas en la última hora en la tabla de destino y no necesita tabla nueva ni
guardar la IP de nadie. Es el techo de cuántos mails puede llegar a disparar el
sistema en una hora, pase lo que pase.

Si la consulta del tope global falla, **deja pasar**. Es deliberado: un hipo de
la base no puede costar una reserva. La capa por IP sigue puesta igual.

Los números son holgados para un solo departamento. Si alguna vez molestan, se
tocan en `TOPES` dentro de `limite.js`.

Cuando alguna de las dos capas corta, la respuesta es `429` con un texto que
manda a escribir por WhatsApp — no un error técnico.

---

## Lo que queda a mano

### De la Parte B — decisión pendiente

Una sola: **credenciales de test para el entorno Preview**. Ver
[B.10](#b10--preview-usa-las-credenciales-de-producción). Pasa a ser urgente el
día que entre alguien más al equipo de Vercel.

### De la Parte A — en la cuenta de Supabase

Dos cosas que no se pueden hacer por API — las tenés que hacer vos:

1. **MFA en la cuenta de Supabase.** La cuenta `departamentosdimo` es Owner de
   la organización y tiene `mfa_enabled: false`. Es la llave maestra de todo:
   quien entre ahí ve las claves, la base y los backups. Se activa en
   [Account → Security](https://supabase.com/dashboard/account/security).

2. **Revocar el token de administración.** El `SUPABASE_ACCESS_TOKEN` (`sbp_…`)
   del `.env` da control total de la cuenta entera, no solo de este proyecto.
   Se creó para armar la base y ya cumplió. Se revoca en
   [Account → Tokens](https://supabase.com/dashboard/account/tokens) y después
   se borra la línea del `.env`.

---

## Cómo repetir la auditoría

Las consultas de control, para correr en el SQL Editor:

```sql
-- tablas sin RLS: no debería devolver ninguna fila
select tablename from pg_tables
 where schemaname = 'public' and rowsecurity = false;

-- políticas permisivas: revisar cualquiera con USING (true)
select tablename, policyname, cmd, qual, with_check
  from pg_policies where schemaname = 'public';

-- qué puede tocar el navegador
select table_name, grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon', 'authenticated');

-- funciones que saltean RLS
select proname, prosecdef from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef;
```

Sobre la última: `fechas_ocupadas()` es `SECURITY DEFINER` a propósito. Saltea
RLS para leer `booking_requests`, pero devuelve **solo** `check_in` y
`check_out` de las reservas confirmadas — ningún nombre, mail ni teléfono. Es lo
que necesita el calendario del sitio para marcar los días ocupados. Tiene
`search_path = ''`, que es lo que evita que se la pueda secuestrar con una
tabla falsa en otro schema.
