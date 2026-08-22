create table if not exists public.recibos (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  numero bigint generated always as identity,

  booking_id uuid references public.booking_requests(id) on delete set null,

  origen text not null check (origen in ('mercadopago', 'transferencia')),

  mp_payment_id       text,
  transfer_receipt_id uuid references public.transfer_receipts(id) on delete set null,

  concepto text not null check (concepto in ('reserva', 'saldo', 'total')),

  monto      numeric(12, 2) not null check (monto >= 0),
  monto_base numeric(12, 2) not null check (monto_base >= 0),
  recargo    numeric(12, 2) not null default 0 check (recargo >= 0),
  moneda     text not null default 'ARS',

  cae              text,
  cae_vence        date,
  punto_venta      smallint,
  tipo_comprobante text
);

comment on table public.recibos is
  'Recibos de pago emitidos. numero es correlativo interno. Las columnas cae / cae_vence / punto_venta / tipo_comprobante quedan vacías hasta que se conecte ARCA.';

create unique index if not exists recibos_numero_idx
  on public.recibos (numero);

create unique index if not exists recibos_pago_idx
  on public.recibos (mp_payment_id) where mp_payment_id is not null;

create unique index if not exists recibos_transfer_idx
  on public.recibos (transfer_receipt_id) where transfer_receipt_id is not null;

create index if not exists recibos_booking_idx
  on public.recibos (booking_id, created_at desc);

alter table public.recibos enable row level security;
revoke all on table public.recibos from anon, authenticated;
