# Reseñas con Supabase — guía de implementación

Estado actual del front: la sección de reseñas ya **no tiene datos hardcodeados**.
Arranca vacía, muestra el cartel *"Todavía no hay reseñas"* con el botón *"Dejá tu
reseña"*, y todo el acoplamiento con el backend está aislado en **dos funciones**
dentro de [script.js](script.js):

| Función | Qué hace hoy | Qué tiene que hacer con Supabase |
| --- | --- | --- |
| `fetchReviews()` | devuelve `[]` | `SELECT` de las reseñas aprobadas |
| `createReview(review)` | agrega la reseña solo en memoria | `INSERT` de la reseña nueva |

Reemplazando esas dos funciones, el resto (carrusel, estado vacío, dots, modal,
validaciones, escapado de HTML) ya funciona sin tocar nada más.

El formato de cada reseña que espera el front es:

```js
{ name: "Marina G.", rating: 5, text: "El depto es hermoso..." }
```

Los límites que aplica el formulario (y que replican los `check` del SQL):
**nombre** hasta 40 caracteres, **comentario** hasta 180 caracteres y 35 palabras.
No son arbitrarios: es lo que entra en la tarjeta cuadrada sin que se corte el
texto. Si los cambiás, ajustá también `REVIEW_MAX_CHARS` / `REVIEW_MAX_WORDS` en
[script.js](script.js), el `maxlength` del textarea en [index.html](index.html) y
el `min-height` de `.review-card` en [style.css](style.css).

---

## Estado actual — todo funcionando

La integración está **terminada y verificada**. Este documento pasa a ser la
referencia de cómo está armado y cómo tocarlo, no una lista de pendientes.

| Pieza | Estado |
| --- | --- |
| Proyecto Supabase | `aiytevmxalwwbxxbgtwe` (región `us-west-2`) |
| Tabla `reviews` + índices + checks | creada |
| Tabla `booking_requests` (formulario de reserva) | creada — ver sección 8 |
| RLS | activo — lectura e inserción públicas, `update`/`delete` bloqueados |
| Security Advisor | **0 avisos** (ver sección 2) |
| Modo de publicación | **moderada** — nada sale al sitio sin aprobarlo en el panel (ver sección 2) |
| `.env` local | completo, fuera del repo |
| Variables en Vercel | `SUPABASE_URL` y `SUPABASE_ANON_KEY` |
| `index.html` / `script.js` | cableados contra Supabase |

Verificado de punta a punta contra la base real: alta de reseña desde el
navegador, la reseña queda pendiente y **no** aparece en el carrusel, se ve en el
panel para aprobar, aparece en el sitio recién después de aprobarla, rechazo de
duplicados, y confirmación de que un visitante **no** puede leer las pendientes,
auto-aprobarse, ni editar o borrar filas ajenas.

El formulario de reserva guarda cada consulta en `booking_requests`, una tabla
de **solo-alta** (tiene DNI, mail y teléfono: el sitio escribe pero no lee).
Está documentada en la [sección 8](#8-consultas-de-reserva--tabla-booking_requests).

**Comandos del día a día:**

```bash
npm run config        # regenera supabase-config.js desde el .env
npm run config:check  # valida el .env sin escribir nada
npm run dev           # levanta el sitio en http://localhost:8000
```

**Las dos variables se llaman:**

| Variable | De dónde sale |
| --- | --- |
| `SUPABASE_URL` | Supabase → Project Settings → API → *Project URL* |
| `SUPABASE_ANON_KEY` | Supabase → Project Settings → API → *Publishable key* (`sb_publishable_...`) o *anon public* (`eyJ...`) |

---

## 1. Crear el proyecto en Supabase

1. Entrá a <https://supabase.com> → **New project**.
2. Elegí nombre (ej. `departamentos-dimo`), una contraseña de base de datos y la
   región más cercana (`South America (São Paulo)`).
3. Cuando termine de provisionarse, andá a **Project Settings → API** y copiá
   estos dos valores (son los que van al `.env` en el paso 3):
   - **Project URL** → algo como `https://xxxxxxxxxxxx.supabase.co`
   - **la clave pública** → según la edad del proyecto vas a ver una de estas dos,
     cualquiera sirve:
     - **Publishable key** → empieza con `sb_publishable_...` (formato nuevo)
     - **anon public** → un JWT largo que empieza con `eyJ...` (formato legacy)

> **Sobre la clave pública:** es pública por diseño y va a quedar visible en el
> código del sitio. Eso es correcto y esperado — la seguridad no la da la clave,
> la dan las políticas RLS del paso 2. Lo que **nunca** hay que poner en el front
> es la clave secreta (`service_role` o `sb_secret_...`): esa saltea todas las
> políticas RLS.

---

## 2. Crear la tabla y las políticas

En el panel de Supabase: **SQL Editor → New query**, pegá esto y ejecutá **Run**.

```sql
-- ============================================================
-- Tabla de reseñas
-- ============================================================
create table public.reviews (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null check (char_length(trim(name)) between 2 and 40),
  rating      smallint    not null check (rating between 1 and 5),
  -- 180 caracteres es el tope que impone el formulario: es el largo que
  -- entra en la tarjeta cuadrada sin que el texto se corte.
  text        text        not null check (char_length(trim(text)) between 5 and 180),
  approved    boolean     not null default false,
  created_at  timestamptz not null default now()
);

-- Índice para el orden que usa el carrusel (más nuevas primero)
create index reviews_approved_created_idx
  on public.reviews (approved, created_at desc);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.reviews enable row level security;

-- Cualquiera puede LEER, pero solo las reseñas aprobadas
create policy "lectura publica de reseñas aprobadas"
  on public.reviews
  for select
  to anon, authenticated
  using (approved = true);

-- Cualquiera puede INSERTAR, pero nunca auto-aprobarse
create policy "alta publica de reseñas sin aprobar"
  on public.reviews
  for insert
  to anon, authenticated
  with check (approved = false);
```

### Qué implica esto — ⚠️ ESTA ES LA CONFIGURACIÓN ACTIVA HOY

- **Las reseñas nuevas no aparecen solas.** Entran con `approved = false` y quedan
  pendientes hasta que las aprobes a mano. Es lo que evita que cualquiera publique
  spam en el sitio.
- Nadie puede hacer `UPDATE` ni `DELETE` desde el front: no hay política para esas
  operaciones, y sin política RLS bloquea.
- El `with check (approved = false)` impide que alguien mande `approved: true` en
  el insert desde la consola del navegador.

### El Security Advisor de Supabase

En el panel, **Advisors → Security**, Supabase corre un linter sobre la base.
Hoy el proyecto está en **cero avisos**. Los tres que aparecieron en su momento
y cómo se cerraron:

| Aviso | Qué era | Cómo se resolvió |
| --- | --- | --- |
| *RLS Policy Always True* | La política de `insert` era `with check (true)` | Se acotó a `approved = false and created_at <= now()` (arriba) |
| *Public Can Execute SECURITY DEFINER Function* | `anon` tenía `EXECUTE` sobre `public.rls_auto_enable()` | `revoke execute ... from anon` |
| *Signed-In Users Can Execute SECURITY DEFINER Function* | Lo mismo para `authenticated` | `revoke execute ... from authenticated` |

Sobre `rls_auto_enable()`: **no la creamos nosotros y conviene dejarla**. Es una
función defensiva colgada del event trigger `ensure_rls`, que activa RLS
automáticamente en cada tabla nueva que se cree en `public` — justo la clase de
olvido que produce una filtración. Devuelve `event_trigger`, así que Postgres ni
siquiera permite invocarla como función normal; el aviso era de higiene, no un
agujero explotable. Igual el permiso no tenía por qué estar:

```sql
revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.rls_auto_enable() from anon;
revoke execute on function public.rls_auto_enable() from authenticated;
```

Revocar el `EXECUTE` **no apaga el event trigger**: los triggers los dispara el
motor, sin chequear los permisos de quien ejecuta el DDL. Verificado después de
aplicarlo — `ensure_rls` sigue activo.

### Aprobar reseñas

Panel de Supabase → **Table Editor → `reviews`** → tildá la columna `approved` de
la fila que quieras publicar. También podés hacerlo por SQL:

```sql
update public.reviews set approved = true where id = 'PEGAR-EL-UUID';
```

### Publicación automática — variante alternativa, HOY NO ESTÁ ACTIVA

**El proyecto NO está corriendo con esta variante.** Estuvo un tiempo, y el
efecto secundario fue que el panel nunca tenía nada para aprobar: la columna
`approved` arrancaba en `true`, así que toda reseña nacía publicada y la pestaña
Reseñas del dash mostraba cero pendientes por diseño. Queda documentada por si
alguna vez se quiere volver, pero la configuración vigente es la moderada.

Lo que implicaría volver a este modo:

- Cualquiera que entre al sitio puede publicar una reseña y aparece al instante.
- No hay filtro de spam. La defensa que hay hoy es el índice `reviews_dedupe_idx`
  (impide repetir exactamente el mismo nombre + comentario) y nada más.
- **Cómo bajar una reseña:** en Supabase → Table Editor → `reviews`, destildá
  `approved` en esa fila. `fetchReviews()` mantiene el `.eq("approved", true)`
  justo para esto: es el interruptor manual para ocultar algo sin borrarlo.
- Si aparece spam, la vuelta a moderación es correr el bloque de la sección
  anterior (default `false` + políticas restrictivas).
- `createReview()` en [script.js](script.js) manda `approved: false` explícito.
  Con estas políticas ese insert sería **rechazado**: habría que sacar esa línea
  antes de correr el SQL de abajo.

El SQL que produciría esta configuración (⚠️ no correrlo si no es lo que querés):

```sql
alter table public.reviews alter column approved set default true;

drop policy if exists "lectura publica de reseñas aprobadas" on public.reviews;
create policy "lectura publica de resenas"
  on public.reviews for select to anon, authenticated
  using (true);

drop policy if exists "alta publica de reseñas sin aprobar" on public.reviews;
create policy "alta publica de resenas"
  on public.reviews for insert to anon, authenticated
  with check (
    approved = true
    and created_at <= now()
  );
```

> **Por qué el `with check` no es un `true` pelado.** La versión obvia sería
> `with check (true)`: "que entre cualquier fila". Pero eso no restringe nada de
> lo que el visitante manda, y habilita dos abusos que no son teóricos:
>
> - **Clavarse primero en el carrusel para siempre.** El orden es
>   `created_at desc`, y PostgREST deja mandar `created_at` explícito. Alguien
>   podía insertar con `created_at = '2099-01-01'` y quedar en la primera
>   tarjeta de forma permanente.
> - **Meter filas invisibles.** Mandando `approved = false` se podía engordar la
>   tabla con filas que no se ven en el sitio.
>
> Las dos condiciones cierran eso sin tocar el uso normal: el formulario solo
> manda `name`, `rating` y `text`, así que las otras dos columnas toman sus
> valores por defecto y pasan el chequeo sin enterarse.
>
> De paso, es lo que saca el aviso **"RLS Policy Always True"** del Security
> Advisor de Supabase.

**Nota sobre los nombres de las políticas:** están escritos sin `ñ` a propósito.
Los nombres con acentos se corrompen al viajar por la API de administración, y
el resultado es peor que feo: un `drop policy` que no matchea deja la política
vieja viva y crea una segunda al lado. Como las políticas se suman con **OR**,
alcanza con que sobreviva una permisiva para que la restrictiva no sirva de nada.

> **Ojo:** aunque en este modo `approved` siempre arranca en `true`, **conviene
> dejar el `.eq("approved", true)` en `fetchReviews()`**. No molesta, y es lo que
> te permite ocultar una reseña puntual destildando la casilla en el panel. Si lo
> sacás, perdés esa posibilidad y la única forma de bajar algo es borrarlo.

---

## 3. Las claves: el archivo `.env`

Las claves no se escriben a mano en el código. Viven en un archivo `.env` en la
raíz del proyecto, y un script las inyecta en el archivo que carga el navegador.

### Por qué un `.env` si la clave es pública

Buena pregunta, porque la clave anon **es** pública. El `.env` no está ahí para
esconderla, está para otras tres cosas:

1. **Un solo lugar para toda la configuración.** Hoy es Supabase; mañana una API
   key de Google Maps o el número de WhatsApp. Todo junto, en un archivo que no
   es código.
2. **Cambiar de proyecto sin tocar código.** Un `.env` para tu Supabase de
   pruebas, otro para el de producción. Cambiás el archivo, corrés un comando y
   listo — no hay que buscar la clave hardcodeada en ningún `.js`.
3. **Que nunca se te escape una clave secreta.** El `.env` está en `.gitignore`,
   y el script que genera la configuración **solo copia `SUPABASE_URL` y
   `SUPABASE_ANON_KEY`**: cualquier otra variable se queda en tu máquina. Si por
   error pegás una `service_role`, el script aborta antes de escribir nada.

### Archivos que componen el sistema

| Archivo | ¿Se sube al repo? | Qué es |
| --- | --- | --- |
| [.env.example](.env.example) | sí | La **plantilla**. Tiene los nombres de las variables y valores de ejemplo, ninguna clave real. Sirve para saber qué hay que completar. |
| `.env` | **no** (está en [.gitignore](.gitignore)) | Tus claves reales. Solo existe en tu máquina. |
| [scripts/build-config.mjs](scripts/build-config.mjs) | sí | El script que lee el `.env`, valida y genera el archivo de abajo. |
| `supabase-config.js` | **no** (generado) | Lo que realmente carga el navegador. **No se edita a mano**: se regenera. En local sale del `.env`; en Vercel lo genera el build. |
| [vercel.json](vercel.json) | sí | Le dice a Vercel que antes de publicar corra el generador. |

> **Sobre "que las claves no queden públicas":** hay que ser preciso, porque son
> dos cosas distintas.
>
> - **Fuera del repo de GitHub:** ✅ resuelto. El `.env` está en `.gitignore` y
>   `supabase-config.js` ya no se versiona. En Vercel las variables se cargan en
>   Settings → Environment Variables y el archivo se genera durante el build.
> - **Invisible para el visitante:** ❌ imposible, y no hace falta. El navegador
>   necesita la clave para hablar con Supabase, así que va a estar en el JS que
>   se descarga: cualquiera la ve con F12 → Network. Eso pasa con **todo** sitio
>   estático que use Supabase, Firebase o similares.
>
> Por eso la clave se llama *publishable* (publicable). No autoriza nada por sí
> sola: solo identifica el proyecto. Quien decide qué se puede leer y escribir
> son las políticas RLS de la sección 2. Por eso lo único verdaderamente secreto
> es la `service_role` / `sb_secret_`, que no toca nunca el navegador.
>
> Si algún día necesitás que el visitante ni siquiera vea la clave, la única vía
> real es no hablarle a Supabase desde el navegador: poner una Serverless
> Function en Vercel que guarde la clave del lado del servidor y que el front le
> pegue a ella. Para una tabla de reseñas protegida con RLS es sobreingeniería.

### 3.1 — Crear el `.env`

El archivo `.env` ya está creado en la raíz con las dos variables vacías, listo
para que pegues los valores. Si en algún momento lo borrás, lo recreás copiando
la plantilla:

```bash
cp .env.example .env
```

En PowerShell:

```bash
copy .env.example .env
```

Abrilo y pegá los dos valores del paso 1. Queda así:

```bash
SUPABASE_URL=https://abcdefghijklmnop.supabase.co
SUPABASE_ANON_KEY=sb_publishable_AbC123...
```

Reglas del formato, que son las que más errores dan:

- **Sin comillas** y **sin espacios** alrededor del `=`.
- La URL va **sin barra final** y **sin `/rest/v1`**: solo el origen.
- Un `#` al principio de la línea es un comentario.
- Nada de esto es case-insensitive: los nombres van tal cual, en mayúsculas.

### 3.2 — Generar `supabase-config.js`

Desde la raíz del proyecto:

```bash
npm run config
```

No hace falta `npm install`: el script no tiene dependencias, usa solo Node
(v18 o superior).

Si todo está bien vas a ver:

```
  OK  supabase-config.js generado
      desde              .env
      hacia              supabase-config.js
      SUPABASE_URL       https://abcdefghijklmnop.supabase.co
      SUPABASE_ANON_KEY  sb_publishab…C123  (clave pública)
```

Si algo está mal, el script aborta y te dice qué: variable faltante, URL con
formato raro, clave que no parece de Supabase, o —lo importante— una clave
secreta donde iba la pública.

Para validar el `.env` **sin** escribir el archivo:

```bash
npm run config:check
```

**Cada vez que cambies el `.env`, volvé a correr `npm run config`.** El `.env` no
se lee en tiempo real: el navegador solo ve el archivo generado.

### 3.3 — Cargar los scripts en el HTML

El sitio es HTML/CSS/JS estático, sin bundler, así que se usa el build UMD del
SDK por CDN.

En [index.html](index.html), **justo antes** de `<script src="script.js"></script>`
(al final del `<body>`), agregá:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="supabase-config.js"></script>
<script src="script.js"></script>
```

El orden importa: el SDK primero, después la configuración, y `script.js` último.

`supabase-config.js` deja el cliente listo en la variable global **`db`**, que es
la que usan las funciones del paso 4:

```js
// esto es lo que el archivo generado hace por vos
window.db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

Se llama `db` y no `supabase` a propósito: el UMD del CDN ya ocupa el nombre
`supabase` con el namespace del SDK, y pisarlo rompe el `createClient`.

### 3.4 — Deploy en Vercel

El sitio se publica con **Vercel**, y ahí no existe el `.env`: las variables se
cargan en el panel del proyecto.

1. En Vercel → tu proyecto → **Settings → Environment Variables**, cargá las dos
   con exactamente los mismos nombres que en el `.env`:

   | Name | Value |
   | --- | --- |
   | `SUPABASE_URL` | `https://aiytevmxalwwbxxbgtwe.supabase.co` |
   | `SUPABASE_ANON_KEY` | la clave `sb_publishable_...` |

   Marcalas para **Production**, **Preview** y **Development**.

2. El [vercel.json](vercel.json) ya está en el repo y le dice a Vercel qué hacer:

   ```json
   {
     "buildCommand": "node scripts/build-config.mjs",
     "outputDirectory": "."
   }
   ```

   En cada deploy, Vercel corre el generador, que esta vez lee las variables
   desde el entorno en lugar del `.env`, y escribe `supabase-config.js` justo
   antes de publicar. Por eso el archivo no necesita estar en el repo.

3. Si falta una variable, **el build falla con un mensaje claro** en vez de
   publicar un sitio roto. Es a propósito: es preferible que no salga el deploy
   a que salga sin cliente de Supabase.

> El generador busca las variables en este orden: primero el `.env` (desarrollo
> local), y si no existe, `process.env` (Vercel, GitHub Actions, cualquier CI).
> El mismo comando funciona en los dos lados sin cambiar nada.

---

## 4. Reemplazar las dos funciones en `script.js`

Buscá el bloque `RESEÑAS: ORIGEN DE DATOS` (arranca con `let reviews = [];`) y
dejá las funciones así:

```js
  // Lista en memoria que consume el carrusel. Cada item: { name, rating, text }
  let reviews = [];

  async function fetchReviews() {
    const { data, error } = await db
      .from("reviews")
      .select("name, rating, text, created_at")
      .eq("approved", true)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) throw error;
    return data;
  }

  async function createReview(review) {
    const { error } = await db.from("reviews").insert({
      name: review.name,
      rating: review.rating,
      text: review.text,
      approved: false,
    });

    if (error) throw error;
    return review;
  }
```

### Detalle importante sobre `createReview`

**`approved: false` va explícito y no es redundante.** El default de la columna ya
es `false`, pero la política de `INSERT` es `with check (approved = false)`: es
mandarlo lo que hace que el insert sea válido, y deja escrito en el único lugar
donde el sitio da de alta reseñas que lo que se guarda nace sin publicar.

**No encadenar `.select()`.** Sin `.select()`, supabase-js manda
`Prefer: return=minimal` y el alta termina en 201. Si pidiera la fila de vuelta,
el `INSERT ... RETURNING` tendría que pasar además por la política de `SELECT`
(`approved = true`) — que la fila recién creada no cumple — y el alta fallaría
con un `42501` / HTTP 401 que parece un problema de credenciales y no lo es.

**No recargar el carrusel después de enviar.** La reseña entra sin aprobar y
`fetchReviews()` filtra por `approved = true`, así que un `await loadReviews()`
devolvería exactamente la misma lista de antes y quien acaba de escribirla vería
que "no se guardó". El handler solo muestra un aviso que dice que quedó
pendiente, y el botón del formulario dice **"Enviar reseña"**, no "Publicar".

---

## 5. Probar

1. Verificá que la configuración esté generada y al día:

```bash
npm run config
```

2. Levantá el sitio con un servidor local (no con `file://`, porque el SDK
   necesita un origen HTTP):

```bash
python -m http.server 8000
```

   (o `npm run dev`, que hace lo mismo en el puerto 8000)

3. Abrí <http://localhost:8000> y andá a la sección **Reseñas**.
   - Sin filas aprobadas, tiene que verse *"Todavía no hay reseñas"*.
4. En la consola del navegador, escribí `db` y apretá Enter: tiene que aparecer
   el objeto del cliente de Supabase, no `undefined`. Si sale `undefined`,
   el problema está en el paso 3.3 (orden de los `<script>`) o en que falta
   correr `npm run config`.
5. Mandá una reseña desde el modal. En Supabase → **Table Editor → `reviews`**
   tiene que aparecer la fila con `approved = false`.
6. Aprobala, recargá la página, y tiene que aparecer en el carrusel.
7. Revisá la consola del navegador: no debería haber errores.

---

## 6. Extras opcionales

### Anti-spam básico (rate limit por IP)

RLS no ve la IP del cliente. Si aparece spam, la vía es una **Edge Function** que
reciba el insert, valide y escriba con la `service_role` key del lado del servidor.
Alternativa más simple: agregar un honeypot (un campo de texto oculto por CSS que
los bots completan y los humanos no) y descartar el envío en el front si viene
lleno.

### Evitar duplicados exactos

```sql
create unique index reviews_dedupe_idx
  on public.reviews (lower(trim(name)), lower(trim(text)));
```

### Promedio de puntuación

Si más adelante querés mostrar "4.8 ★ · 23 reseñas":

```sql
create view public.reviews_stats as
select
  round(avg(rating)::numeric, 1) as promedio,
  count(*)                       as total
from public.reviews
where approved = true;
```

```js
const { data } = await db.from("reviews_stats").select("*").single();
```

### Actualización en vivo (Realtime)

En Supabase → **Database → Replication**, activá la tabla `reviews`. Después:

```js
db.channel("reviews-live")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "reviews" },
    () => loadReviews(),
  )
  .subscribe();
```

---

## 7. Problemas frecuentes

| Síntoma | Causa probable |
| --- | --- |
| `supabase is not defined` | El `<script>` del CDN falta o va después de `supabase-config.js`. |
| `db.from is not a function` | El cliente se llamó `supabase` y pisó el namespace del UMD. Usá otro nombre. |
| El `SELECT` devuelve `[]` sin error | No hay filas con `approved = true`. RLS filtra en silencio, no tira error. |
| `new row violates row-level security policy` (HTTP 401, `42501`) | Falta la política de `insert`, o se está mandando `approved: true` en el insert. También lo tira un `.select()` encadenado al insert: la fila nace con `approved = false` y no pasa la política de `SELECT`. |
| HTTP 400 con código `23514` al publicar una reseña | `check_violation`: el largo quedó fuera de rango. `name` va de 2 a 40 caracteres y `text` de 5 a 180, **contados sobre el valor ya trimmeado**. Pasa con comentarios de prueba tipo `ok` o `test`. El formulario ahora lo valida antes de mandar. |
| HTTP 409 con código `23505` al publicar una reseña | `unique_violation` del índice `reviews_dedupe_idx`: ya existe una reseña con el mismo nombre y el mismo comentario. |
| Error de CORS | Se abrió el `index.html` con `file://`. Usá un servidor local. |
| `db is not defined` | Falta el `<script src="supabase-config.js">` en el HTML, o el archivo nunca se generó. Corré `npm run config`. |
| `ERROR Falta la variable SUPABASE_URL` | El `.env` no existe o la variable quedó vacía. `cp .env.example .env` y completá los dos valores. |
| Cambiaste el `.env` y el sitio sigue igual | El `.env` no se lee en vivo. Hay que volver a correr `npm run config` y recargar con Ctrl+F5. |
| `SUPABASE_ANON_KEY contiene una clave SECRETA` | Copiaste la `service_role` / `sb_secret_` en vez de la anon / publishable. Volvé a Project Settings → API. |
| `Invalid API key` / `401` | La clave está incompleta (se cortó al copiar) o es de otro proyecto. Verificá con `npm run config:check`. |
| `Failed to fetch` contra `supabase.co` | La `SUPABASE_URL` está mal escrita, tiene barra final o le sobra `/rest/v1`. |
| La sección queda vacía y hay error en consola | El `catch` de `loadReviews()` deja el estado vacío a propósito para no romper la página. El detalle está en la consola. |

---

## 8. Consultas de reserva — tabla `booking_requests`

El formulario **"Consultá tu Reserva"** guarda cada envío como una fila en
`public.booking_requests`. No manda mails ni avisa a nadie: **solo persiste los
datos** para poder reutilizarlos después (es la base sobre la que se va a armar
el calendario de ocupación).

### Diferencia clave con `reviews`

`reviews` es pública en las dos direcciones (cualquiera lee, cualquiera escribe).
`booking_requests` **no**: guarda DNI, mail y teléfono de personas reales, así
que es **solo-alta**. El sitio puede insertar y nada más — no hay política de
`SELECT`, y además se revocaron los permisos de `select`, `update`, `delete` y
`truncate` para `anon` y `authenticated`. Las consultas se leen desde el panel
de Supabase (**Table Editor → `booking_requests`**), nunca desde el navegador.

Verificado contra la base real: un visitante que intente leer la tabla desde la
consola recibe `permission denied for table booking_requests` (401), y lo mismo
pasa con un `delete` o con un alta que se auto-marque como `confirmada`
(`42501`).

### Estructura

| Columna | Tipo | De dónde sale |
| --- | --- | --- |
| `id` | `uuid` | generado |
| `created_at` | `timestamptz` | generado |
| `nombre` | `text` | Nombre completo |
| `email` | `text` | Email (se guarda en minúsculas) |
| `dni` | `text` | DNI **solo dígitos**: el front le saca puntos y espacios |
| `telefono` | `text` | Teléfono de contacto |
| `procedencia` | `text` `null` | Procedencia / Localidad |
| `check_in` / `check_out` | `date` | Las dos fechas del calendario, ya partidas |
| `personas` | `smallint` | El **total** de huéspedes que elige el visitante |
| `adultos` | `smallint` | Cuántos de ese total son adultos (mínimo 1) |
| `ninos` | `smallint` | El resto del total. `adultos + ninos = personas` |
| `edades_ninos` | `smallint[]` | Una edad por niño, en el orden de los campos |
| `vehiculo` | `boolean` | El checkbox |
| `vehiculo_marca` / `_modelo` / `_tipo` / `_anio` | `text` / `smallint` | Solo si `vehiculo = true`; si no, van en `null` |
| `mensaje` | `text` `null` | Mensaje (opcional) |
| `estado` | `text` | `nueva` → `contactada` → `confirmada` / `descartada`. El front **solo** puede insertar `nueva`. |

**Por qué las fechas son dos columnas `date` y no el string del formulario:** el
input oculto guarda `"2026-01-10 a 2026-01-17"`, que sirve para mostrar pero no
para consultar. Partido en dos `date` con el índice `booking_requests_fechas_idx`
se puede preguntar "qué hay ocupado entre tal y tal día" — que es exactamente lo
que va a necesitar el calendario.

**Por qué el vehículo no tiene tabla aparte:** la relación es 0..1 (una consulta
tiene un vehículo o ninguno). En una tabla aparte sería un `join` más y un
segundo `insert` sin transacción, para no ganar nada.

### Los `check` de la tabla replican las validaciones del front

Si tocás una validación, tocá las dos: están en `armarConsulta()` dentro de
[script.js](script.js) y en los `constraint` de la tabla.

- La salida tiene que ser posterior a la entrada (`booking_requests_fechas_ok`).
- `adultos + ninos` tiene que dar exactamente `personas` (`booking_requests_grupo_ok`),
  y `personas` va de 1 a 4 — el mismo tope que `MAX_PERSONAS` en el JS.
- Tiene que haber al menos un adulto (`booking_requests_adultos_ok`): nunca puede
  viajar un grupo de solo niños.
- Tiene que haber una edad por niño declarado, entre 0 y 17
  (`booking_requests_edades_ok`).
- O el vehículo viene completo, o no viene nada (`booking_requests_vehiculo_ok`).
- El DNI son 6 a 9 dígitos y el mail tiene forma de mail.

### Cómo se reparte el grupo en el formulario

Primero se elige el **total** de personas (1 a 4). Recién ahí aparecen los dos
selects que lo reparten: **cantidad de adultos** y **cantidad de niños**.

Los dos están atados: al cambiar uno, el otro se recalcula solo para que la suma
dé exactamente el total. Por eso el grupo nunca puede quedar inconsistente, y
por eso el select de niños llega hasta `total - 1` — siempre queda lugar para al
menos un adulto.

En la grilla, el select del total ocupa las dos columnas (`.field-full` en
[style.css](style.css)) y abajo quedan adultos y niños, uno en cada columna.

La lógica está en `renderGrupo()` / `onTotalChange()` / `onAdultosChange()` /
`onNinosChange()` en [script.js](script.js). Las tres funciones terminan
llamando a `renderGrupo()`, que es el único lugar que pinta los dos selects: si
hay que tocar el reparto, se toca ahí y nada más.

### Evitar el doble envío

El índice único `booking_requests_dedupe_idx (dni, check_in, check_out)` impide
que la misma persona cargue dos veces la misma consulta (doble clic, F5). Cuando
salta, el front muestra *"Ya recibimos una consulta con ese DNI para esas
fechas"*. Es el mismo mecanismo que `reviews_dedupe_idx`.

### El SQL, por si hay que rehacerlo

```sql
create table public.booking_requests (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),

  nombre      text not null check (char_length(btrim(nombre)) between 2 and 80),
  email       text not null check (
                email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
                and char_length(email) <= 120),
  dni         text not null check (dni ~ '^[0-9]{6,9}$'),
  telefono    text not null check (char_length(btrim(telefono)) between 6 and 30),
  procedencia text          check (char_length(btrim(procedencia)) between 1 and 80),

  check_in     date       not null,
  check_out    date       not null,
  personas     smallint   not null check (personas between 1 and 4),
  adultos      smallint   not null check (adultos between 1 and 4),
  ninos        smallint   not null default 0 check (ninos between 0 and 3),
  edades_ninos smallint[] not null default '{}',

  vehiculo        boolean not null default false,
  vehiculo_marca  text     check (char_length(btrim(vehiculo_marca)) between 1 and 40),
  vehiculo_modelo text     check (char_length(btrim(vehiculo_modelo)) between 1 and 40),
  vehiculo_tipo   text     check (vehiculo_tipo in ('auto','suv','camioneta','moto','bici')),
  vehiculo_anio   smallint check (vehiculo_anio between 1950 and 2100),

  mensaje text check (char_length(mensaje) <= 500),
  estado  text not null default 'nueva'
          check (estado in ('nueva','contactada','confirmada','descartada')),

  constraint booking_requests_fechas_ok check (check_out > check_in),
  constraint booking_requests_grupo_ok  check (adultos + ninos = personas),
  constraint booking_requests_edades_ok check (
    coalesce(array_length(edades_ninos, 1), 0) = ninos
    and edades_ninos <@ '{0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17}'::smallint[]
  ),
  constraint booking_requests_vehiculo_ok check (
    (vehiculo
       and vehiculo_marca is not null and vehiculo_modelo is not null
       and vehiculo_tipo is not null and vehiculo_anio is not null)
    or
    (not vehiculo
       and vehiculo_marca is null and vehiculo_modelo is null
       and vehiculo_tipo is null and vehiculo_anio is null)
  )
);

create index booking_requests_created_idx on public.booking_requests (created_at desc);
create index booking_requests_fechas_idx  on public.booking_requests (check_in, check_out);
create unique index booking_requests_dedupe_idx
  on public.booking_requests (dni, check_in, check_out);

alter table public.booking_requests enable row level security;

-- Alta publica, y nada mas. Sin politica de select: la tabla no se lee desde
-- el sitio. El "estado = 'nueva'" evita que alguien inserte una consulta ya
-- confirmada desde la consola del navegador, y la ultima condicion repite la
-- regla del calendario: el mismo dia se reserva hasta las 09:00.
create policy "alta publica de consultas"
  on public.booking_requests
  for insert
  to anon, authenticated
  with check (
    estado = 'nueva'
    and check_out > check_in
    and check_in >= case
      when (now() at time zone 'America/Argentina/Buenos_Aires')::time
           < time '09:00'
        then (now() at time zone 'America/Argentina/Buenos_Aires')::date
      else (now() at time zone 'America/Argentina/Buenos_Aires')::date + 1
    end
  );

grant insert on public.booking_requests to anon, authenticated;
revoke select, update, delete, truncate, references, trigger
  on public.booking_requests from anon, authenticated;
```

> Ojo si lo corrés por la Management API: los acentos se corrompen en el camino.
> Por eso los nombres de políticas y los comentarios de ese bloque no llevan
> tildes. Ver la nota del principio de este documento.

Después de crearla, el **Security Advisor sigue en 0 avisos**: la policy de
`insert` no es un `with check (true)`, que es lo que dispara el aviso *RLS Policy
Always True*.

### Hasta cuándo se puede reservar para hoy

**El mismo día se puede reservar hasta las 09:00.** Pasada esa hora, el día
de hoy queda bloqueado en el calendario y la estadía tiene que arrancar al
día siguiente. Antes de las 09:00, hoy sigue disponible.

La hora se mide **siempre en la zona del departamento**
(`America/Argentina/Buenos_Aires`), nunca en la del visitante: si alguien
consulta desde España a las 03:00 de su reloj, lo que decide es qué hora es
en San Bernardo. Eso lo resuelve `ahoraEnDestino()` en [script.js](script.js),
con `Intl.DateTimeFormat` — no hay librería de fechas de por medio.

Cómo se ve, en los dos calendarios (el del formulario y el de *Ver
disponibilidad*):

- El día de hoy queda apagado **igual que un día ya pasado**, sin marca
  propia.
- Debajo de la grilla aparece la aclaración: *"Hoy ya no se puede reservar:
  las reservas para el mismo día cierran a las 09:00"*. Antes de esa hora la
  nota dice lo contrario: *"Podés reservar para hoy mismo hasta las 09:00"*.
  La nota solo se muestra en el mes en curso.

**La hora se recalcula en cada `render()`**, y los dos modales llaman a
`refresh()` al abrirse. Así una pestaña abierta desde las 08:00 se corrige
sola cuando el visitante vuelve: si en el medio pasaron las 09:00, el día de
hoy se bloquea y, si ya lo había elegido, la selección se limpia (calendario,
etiqueta del botón y campo oculto).

**La misma regla está en la policy de `insert`**, no solo en el front. El
reloj del visitante puede estar mal o atrasado, así que la base vuelve a
chequearlo con su propia hora. Va en la policy y no en un `check` porque un
`check` tiene que ser inmutable y `now()` no lo es; las policies, en cambio,
se evalúan fila por fila en el momento del `insert`.

Si ese rechazo llega igual (el caso real: eligió las fechas a las 08:58 y
apretó enviar a las 09:01), el front lo reconoce por el código `42501` y
muestra *"Las reservas para el mismo día cierran a las 09:00. Volvé a elegir
las fechas"* en vez del error genérico.

Para cambiar el horario de corte: `HORA_CIERRE` en [script.js](script.js) y
el `time '09:00'` de la policy. Son los dos únicos lugares.

### Dónde se ven los avisos

Ningún mensaje de "salió bien" / "salió mal" vive ya dentro del formulario
ni del modal que lo dispara: **todos salen por un toast en la esquina
inferior izquierda**, y todos pasan por la misma función,
`mostrarToast(mensaje, tipo)` en [script.js](script.js), con `tipo` en
`"exito"` o `"error"`.

El contenedor es un `<div id="toastStack">` vacío al final del `body`. Está
en `position: fixed` con `z-index: 10000` — por encima del header sticky
(9999) y de los modales (100) —, así que ningún contenedor con `overflow` lo
puede recortar.

Cómo se comportan:

- Se apilan: si caen dos seguidos, el más nuevo queda abajo.
- Se van solos a los 5 segundos si son de éxito y a los 8 si son de error,
  que necesitan más tiempo de lectura.
- Se cierran al tocarlos.
- El texto entra por `textContent`, nunca por `innerHTML`: parte de esos
  mensajes vienen del error que devuelve la base y no tienen por qué
  terminar interpretados como HTML.

Esto arregló de paso dos cosas que estaban rotas: el aviso de la reseña
publicada se perdía al cerrarse el modal, y el de *"Elegí también la fecha
de salida"* se escribía en la etiqueta del botón que abre el modal de
fechas — o sea, tapada detrás del overlay, con el visitante viendo que
*Confirmar fechas* no hacía nada.

### Agregar un campo nuevo al formulario

1. El campo en [index.html](index.html).
2. `alter table public.booking_requests add column <campo> <tipo>;`
3. Una línea más en el objeto que devuelve `armarConsulta()` en [script.js](script.js).

No hace falta tocar nada más: el insert manda el objeto entero.

### Ver y trabajar las consultas

Panel de Supabase → **Table Editor → `booking_requests`**, ordenado por
`created_at desc`. Para marcar una como atendida:

```sql
update public.booking_requests set estado = 'contactada' where id = 'PEGAR-EL-UUID';
```

Las que lleguen a `confirmada` son las que después van a alimentar el calendario
de ocupación.
