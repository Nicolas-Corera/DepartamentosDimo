-- ===========================================================================
-- public.reviews — volver al modo MODERADO
--
-- Correr en: Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede correr dos veces sin romper nada.
--
-- Qué arregla
-- -----------
-- La tabla venía configurada en modo "publicación automática": `approved`
-- tenía DEFAULT true y la política de INSERT exigía `approved = true`. El
-- efecto colateral era que la pestaña Reseñas del panel nunca tenía nada para
-- aprobar — no porque el panel estuviera roto, sino porque toda reseña nacía
-- publicada. De paso, la política de SELECT era `using (true)`, así que
-- cualquiera con la clave anon podía leer también las reseñas sin aprobar.
--
-- Después de esto:
--   - una reseña nueva entra con approved = false y NO se ve en el sitio;
--   - el sitio público solo puede leer las aprobadas;
--   - nadie puede auto-aprobarse mandando approved = true desde la consola;
--   - la publica el panel, que usa service_role y saltea RLS.
--
-- Nota sobre los nombres de las políticas: van sin `ñ` a propósito. Los
-- nombres con acentos se corrompen al viajar por la API de administración, y
-- un `drop policy` que no matchea deja la política vieja viva y crea una
-- segunda al lado. Como las políticas se suman con OR, alcanza con que
-- sobreviva una permisiva para que la restrictiva no sirva de nada.
-- ===========================================================================

alter table public.reviews alter column approved set default false;

-- ---------------------------------------------------------------- SELECT
-- Se dropean los dos nombres, el viejo y el nuevo, para que correr esto dos
-- veces no deje dos políticas de SELECT sumándose con OR.
drop policy if exists "lectura publica de resenas"           on public.reviews;
drop policy if exists "lectura publica de resenas aprobadas" on public.reviews;

create policy "lectura publica de resenas aprobadas"
  on public.reviews
  for select
  to anon, authenticated
  using (approved = true);

-- ---------------------------------------------------------------- INSERT
drop policy if exists "alta publica de resenas"             on public.reviews;
drop policy if exists "alta publica de resenas sin aprobar" on public.reviews;

-- El `created_at <= now()` no es decorativo: el carrusel ordena por
-- created_at desc y PostgREST deja mandar la columna explícita, así que sin
-- esa condición alguien podía insertar con created_at = '2099-01-01' y
-- clavarse en la primera tarjeta para siempre.
create policy "alta publica de resenas sin aprobar"
  on public.reviews
  for insert
  to anon, authenticated
  with check (
    approved = false
    and created_at <= now()
  );
