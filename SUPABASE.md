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

## Resumen rápido

Si ya sabés lo que estás haciendo, son cinco comandos y un copy/paste:

```bash
# 1. crear el proyecto en Supabase y correr el SQL de la sección 2
# 2. pegar Project URL + clave pública en el .env (ya está creado en la raíz)
npm run config      # genera supabase-config.js a partir del .env
npm run dev         # levanta el sitio en http://localhost:8000
```

Falta además agregar los tres `<script>` en el `index.html` (sección 3.3) y
reemplazar `fetchReviews()` / `createReview()` en el `script.js` (sección 4).

**Las dos variables del `.env` se llaman:**

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

### Aprobar reseñas

Panel de Supabase → **Table Editor → `reviews`** → tildá la columna `approved` de
la fila que quieras publicar. También podés hacerlo por SQL:

```sql
update public.reviews set approved = true where id = 'PEGAR-EL-UUID';
```

### Si preferís que se publiquen automáticamente

Si no querés moderar (no recomendado en un sitio público), cambiá la política de
lectura y el default:

```sql
alter table public.reviews alter column approved set default true;

drop policy "lectura publica de reseñas aprobadas" on public.reviews;
create policy "lectura publica de reseñas"
  on public.reviews for select to anon, authenticated using (true);

drop policy "alta publica de reseñas sin aprobar" on public.reviews;
create policy "alta publica de reseñas"
  on public.reviews for insert to anon, authenticated with check (true);
```

Y en `fetchReviews()` sacá el `.eq("approved", true)`.

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
| `supabase-config.js` | sí (generado) | Lo que realmente carga el navegador. **No se edita a mano**: se regenera. |

> **¿Por qué `supabase-config.js` sí se commitea?** Porque GitHub Pages sirve los
> archivos tal como están en el repo, sin paso de build: si no está el archivo,
> el sitio publicado se queda sin cliente de Supabase. Y no hay problema en
> commitearlo: solo contiene la URL y la clave pública, que de todas formas
> cualquiera puede ver abriendo el código del sitio.

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

### 3.4 — Si más adelante hacés deploy con build

Si pasás de GitHub Pages plano a un deploy con paso de build (GitHub Actions,
Netlify, Vercel), el patrón cambia un poco: en vez de commitear
`supabase-config.js`, guardás las dos variables como *secrets* del proveedor y
generás el archivo durante el build.

Con GitHub Actions, por ejemplo:

```yaml
- name: Generar configuración
  env:
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
  run: |
    printf 'SUPABASE_URL=%s\nSUPABASE_ANON_KEY=%s\n' "$SUPABASE_URL" "$SUPABASE_ANON_KEY" > .env
    npm run config
```

Y ahí sí descomentás `supabase-config.js` en el [.gitignore](.gitignore) para que
deje de versionarse.

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
