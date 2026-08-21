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
| RLS | activo — lectura e inserción públicas, `update`/`delete` bloqueados |
| Security Advisor | **0 avisos** (ver sección 2) |
| Modo de publicación | **automática**, sin moderación (ver sección 2) |
| `.env` local | completo, fuera del repo |
| Variables en Vercel | `SUPABASE_URL` y `SUPABASE_ANON_KEY` |
| `index.html` / `script.js` | cableados contra Supabase |

Verificado de punta a punta contra la base real: alta de reseña desde el
navegador, aparición inmediata en el carrusel, rechazo de duplicados, y
confirmación de que un visitante **no** puede editar ni borrar filas ajenas.

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

### Qué implica esto

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
| *RLS Policy Always True* | La política de `insert` era `with check (true)` | Se acotó a `approved = true and created_at <= now()` (arriba) |
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

### Publicación automática — ⚠️ ESTA ES LA CONFIGURACIÓN ACTIVA HOY

**El proyecto está corriendo con esta variante, no con la moderada de arriba.**
Es una decisión tomada a propósito: las reseñas se publican solas, sin revisión.

Lo que implica, para que no sorprenda:

- Cualquiera que entre al sitio puede publicar una reseña y aparece al instante.
- No hay filtro de spam. La defensa que hay hoy es el índice `reviews_dedupe_idx`
  (impide repetir exactamente el mismo nombre + comentario) y nada más.
- **Cómo bajar una reseña:** en Supabase → Table Editor → `reviews`, destildá
  `approved` en esa fila. `fetchReviews()` mantiene el `.eq("approved", true)`
  justo para esto: es el interruptor manual para ocultar algo sin borrarlo.
- Si aparece spam, la vuelta a moderación es correr el bloque de la sección
  anterior (default `false` + políticas restrictivas).

El SQL que produce esta configuración:

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
    });

    if (error) throw error;
    return review;
  }
```

### Detalle importante sobre `createReview`

Con moderación activada (`approved = false` por defecto), la reseña recién enviada
**no se va a ver en el carrusel** — eso es lo correcto, pero conviene avisarle a la
persona. En [index.html](index.html), cambiá el texto del cartel de éxito
(`#resenaSuccess`) por algo como:

```html
<p class="form-success" id="resenaSuccess" hidden>
  <svg class="ic-sm"><use href="#ic-check" /></svg> ¡Gracias! Tu reseña se
  publica apenas la revisemos.
</p>
```

Si además querés que el carrusel se refresque después de enviar (útil solo en modo
sin moderación), reemplazá la línea `renderReviews();` del handler del formulario
por `await loadReviews();`.

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
| `new row violates row-level security policy` | Falta la política de `insert`, o se está mandando `approved: true` en el insert. |
| Error de CORS | Se abrió el `index.html` con `file://`. Usá un servidor local. |
| `db is not defined` | Falta el `<script src="supabase-config.js">` en el HTML, o el archivo nunca se generó. Corré `npm run config`. |
| `ERROR Falta la variable SUPABASE_URL` | El `.env` no existe o la variable quedó vacía. `cp .env.example .env` y completá los dos valores. |
| Cambiaste el `.env` y el sitio sigue igual | El `.env` no se lee en vivo. Hay que volver a correr `npm run config` y recargar con Ctrl+F5. |
| `SUPABASE_ANON_KEY contiene una clave SECRETA` | Copiaste la `service_role` / `sb_secret_` en vez de la anon / publishable. Volvé a Project Settings → API. |
| `Invalid API key` / `401` | La clave está incompleta (se cortó al copiar) o es de otro proyecto. Verificá con `npm run config:check`. |
| `Failed to fetch` contra `supabase.co` | La `SUPABASE_URL` está mal escrita, tiene barra final o le sobra `/rest/v1`. |
| La sección queda vacía y hay error en consola | El `catch` de `loadReviews()` deja el estado vacío a propósito para no romper la página. El detalle está en la consola. |
