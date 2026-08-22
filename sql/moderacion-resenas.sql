alter table public.reviews alter column approved set default false;

drop policy if exists "lectura publica de resenas"           on public.reviews;
drop policy if exists "lectura publica de resenas aprobadas" on public.reviews;

create policy "lectura publica de resenas aprobadas"
  on public.reviews
  for select
  to anon, authenticated
  using (approved = true);

drop policy if exists "alta publica de resenas"             on public.reviews;
drop policy if exists "alta publica de resenas sin aprobar" on public.reviews;

create policy "alta publica de resenas sin aprobar"
  on public.reviews
  for insert
  to anon, authenticated
  with check (
    approved = false
    and created_at <= now()
  );
