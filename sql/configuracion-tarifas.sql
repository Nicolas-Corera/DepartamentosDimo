create table if not exists public.temporadas (
  clave       text primary key check (clave in ('alta', 'media', 'baja')),
  nombre      text not null,

  fecha_desde date not null,
  fecha_hasta date not null,

  precio_por_noche integer not null check (precio_por_noche > 0),

  orden          smallint    not null default 0,
  actualizado_en timestamptz not null default now(),

  constraint temporadas_rango_ok check (fecha_hasta >= fecha_desde)
);

comment on table public.temporadas is
  'Precio por noche según el rango de fechas. Se edita desde el dashboard. El fallback de una noche sin temporada es el precio de la temporada baja.';

insert into public.temporadas (clave, nombre, fecha_desde, fecha_hasta, precio_por_noche, orden)
values
  ('alta',  'Temporada Alta',  date '2026-12-15', date '2027-01-31', 90000, 1),
  ('media', 'Temporada Media', date '2027-02-01', date '2027-02-15', 85000, 2),
  ('baja',  'Temporada Baja',  date '2026-08-01', date '2026-12-14', 80000, 3)
on conflict (clave) do nothing;

alter table public.temporadas enable row level security;
revoke all on table public.temporadas from anon, authenticated;

create table if not exists public.medios_pago (
  clave  text primary key check (clave in ('transferencia', 'debito', 'credito')),
  nombre text not null,

  habilitado boolean not null default true,

  recargo_porcentaje numeric(5, 2) not null default 0
    check (recargo_porcentaje >= 0 and recargo_porcentaje <= 100),

  orden          smallint    not null default 0,
  actualizado_en timestamptz not null default now()
);

comment on table public.medios_pago is
  'Recargo por medio de pago sobre el precio base (que es el de transferencia). Se edita desde el dashboard.';

insert into public.medios_pago (clave, nombre, habilitado, recargo_porcentaje, orden)
values
  ('transferencia', 'Transferencia',      true, 0, 1),
  ('debito',        'Tarjeta de débito',  true, 0, 2),
  ('credito',       'Tarjeta de crédito', true, 0, 3)
on conflict (clave) do nothing;

alter table public.medios_pago enable row level security;
revoke all on table public.medios_pago from anon, authenticated;

create table if not exists public.planes_cuotas (
  cuotas smallint primary key check (cuotas between 1 and 24),

  habilitado boolean not null default false,

  recargo_porcentaje numeric(5, 2) not null default 0
    check (recargo_porcentaje >= 0 and recargo_porcentaje <= 100),

  actualizado_en timestamptz not null default now()
);

comment on table public.planes_cuotas is
  'Recargo por cantidad de cuotas, adicional al del medio de pago. El máximo ofrecido es la mayor cantidad habilitada.';

insert into public.planes_cuotas (cuotas, habilitado, recargo_porcentaje)
select n, n <= 3, 0
  from generate_series(1, 24) as n
on conflict (cuotas) do nothing;

alter table public.planes_cuotas enable row level security;
revoke all on table public.planes_cuotas from anon, authenticated;

alter table public.booking_requests
  drop constraint if exists booking_requests_estado_check;

alter table public.booking_requests
  add constraint booking_requests_estado_check
  check (estado in ('nueva', 'contactada', 'confirmada', 'descartada', 'cancelada'));

alter table public.payments
  add column if not exists devuelto numeric(12, 2) not null default 0 check (devuelto >= 0);

alter table public.payments
  add column if not exists devuelto_en timestamptz;

comment on column public.payments.devuelto is
  'Total devuelto hasta ahora, acumulado entre devoluciones parciales. 0 = no se devolvió nada.';
