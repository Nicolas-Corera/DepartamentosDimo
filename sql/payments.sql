create table if not exists public.payments (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  mp_payment_id text not null unique,

  booking_id uuid references public.booking_requests(id) on delete set null,

  external_reference text,

  status        text not null,
  status_detail text,

  monto  numeric(12,2) not null check (monto >= 0),
  moneda text not null default 'ARS',

  metodo text,
  tipo   text,
  cuotas smallint check (cuotas is null or cuotas between 1 and 24),

  ultimos_cuatro text check (ultimos_cuatro is null or ultimos_cuatro ~ '^[0-9]{4}$'),

  payer_email text,
  aprobado_en timestamptz
);

comment on table public.payments is
  'Pagos de MercadoPago. Solo escribe el backend con service_role; el navegador no tiene acceso.';

create index if not exists payments_booking_idx on public.payments (booking_id);

create index if not exists payments_status_idx on public.payments (status, created_at desc);

alter table public.payments enable row level security;

revoke all on table public.payments from anon, authenticated;
