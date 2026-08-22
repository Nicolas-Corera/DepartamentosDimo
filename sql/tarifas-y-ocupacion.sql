create table if not exists public.tarifas_especiales (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),

  fecha_desde date not null,
  fecha_hasta date not null,

  precio_por_noche integer not null check (precio_por_noche > 0),

  motivo text not null check (char_length(btrim(motivo)) between 2 and 80),

  constraint tarifas_especiales_rango_ok check (fecha_hasta >= fecha_desde)
);

comment on table public.tarifas_especiales is
  'Precios por noche que pisan a la temporada. Fines de semana largo, feriados, eventos.';

create index if not exists tarifas_especiales_rango_idx
  on public.tarifas_especiales (fecha_desde, fecha_hasta);

alter table public.tarifas_especiales enable row level security;
revoke all on table public.tarifas_especiales from anon, authenticated;

insert into public.tarifas_especiales (fecha_desde, fecha_hasta, precio_por_noche, motivo)
select * from (values

  (date '2027-02-05', date '2027-02-09', 90000, 'Carnaval'),

  (date '2027-03-24', date '2027-03-28', 90000, 'Semana Santa y Memoria'),

  (date '2027-04-01', date '2027-04-04', 90000, 'Malvinas'),

  (date '2027-06-18', date '2027-06-21', 90000, 'Güemes'),

  (date '2027-07-08', date '2027-07-11', 90000, 'Independencia'),

  (date '2027-08-13', date '2027-08-16', 90000, 'San Martín'),

  (date '2027-10-08', date '2027-10-11', 90000, 'Diversidad Cultural')
) as nuevas(fecha_desde, fecha_hasta, precio_por_noche, motivo)
where not exists (

  select 1 from public.tarifas_especiales t
   where t.fecha_desde = nuevas.fecha_desde and t.motivo = nuevas.motivo
);

drop view if exists public.fechas_ocupadas;

create or replace function public.fechas_ocupadas()
returns table (check_in date, check_out date)
language sql
stable
security definer

set search_path = ''
as $$
  select b.check_in, b.check_out
    from public.booking_requests b
   where b.estado in ('confirmada')
$$;

comment on function public.fechas_ocupadas() is
  'Fechas de las reservas confirmadas, sin datos personales. La llama el calendario del sitio con la clave anon.';

revoke all on function public.fechas_ocupadas() from public;
grant execute on function public.fechas_ocupadas() to anon, authenticated;
