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

## 1. Crear el proyecto en Supabase

1. Entrá a <https://supabase.com> → **New project**.
2. Elegí nombre (ej. `departamentos-dimo`), una contraseña de base de datos y la
   región más cercana (`South America (São Paulo)`).
3. Cuando termine de provisionarse, andá a **Project Settings → API** y copiá:
   - **Project URL** → algo como `https://xxxxxxxxxxxx.supabase.co`
   - **anon public key** → un JWT largo que empieza con `eyJ...`

> **Sobre la clave `anon`:** es pública por diseño y va a quedar visible en el
> código del sitio. Eso es correcto y esperado — la seguridad no la da la clave,
> la dan las políticas RLS del paso 2. Lo que **nunca** hay que poner en el front
> es la `service_role` key.

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

## 3. Cargar el SDK en el sitio

El sitio es HTML/CSS/JS estático, sin bundler, así que se usa el build UMD por CDN.

En [index.html](index.html), **justo antes** de `<script src="script.js"></script>`
(al final del `<body>`), agregá:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="supabase-config.js"></script>
<script src="script.js"></script>
```

El orden importa: el SDK primero, después la configuración, y `script.js` último.

Creá el archivo `supabase-config.js` en la raíz del proyecto:

```js
// supabase-config.js
// La clave anon es pública: la protección real está en las políticas RLS.
const SUPABASE_URL = "https://xxxxxxxxxxxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....";

// OJO: el UMD del CDN expone el objeto global `supabase` (el namespace del SDK).
// Por eso el cliente se guarda en otra variable, `db`. Si lo llamás `supabase`
// pisás el namespace y el segundo createClient() rompe.
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

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

1. Levantá el sitio con un servidor local (no con `file://`, porque el SDK
   necesita un origen HTTP):

```bash
python -m http.server 8000
```

2. Abrí <http://localhost:8000> y andá a la sección **Reseñas**.
   - Sin filas aprobadas, tiene que verse *"Todavía no hay reseñas"*.
3. Mandá una reseña desde el modal. En Supabase → **Table Editor → `reviews`**
   tiene que aparecer la fila con `approved = false`.
4. Aprobala, recargá la página, y tiene que aparecer en el carrusel.
5. Revisá la consola del navegador: no debería haber errores.

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
| La sección queda vacía y hay error en consola | El `catch` de `loadReviews()` deja el estado vacío a propósito para no romper la página. El detalle está en la consola. |
