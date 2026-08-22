create table if not exists public.transfer_receipts (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  booking_id uuid not null references public.booking_requests(id) on delete cascade,

  path       text not null unique,

  mime       text not null check (mime in ('image/png', 'image/jpeg', 'application/pdf')),
  bytes      integer not null check (bytes > 0),

  monto_declarado numeric(12,2) check (monto_declarado is null or monto_declarado >= 0),

  estado     text not null default 'pendiente'
             check (estado in ('pendiente', 'confirmado', 'rechazado')),
  revisado_en timestamptz,
  nota        text
);

comment on table public.transfer_receipts is
  'Comprobantes de transferencia subidos desde la página de pago. Bandeja de entrada, no pagos confirmados. Solo escribe el backend con service_role.';

create index if not exists transfer_receipts_estado_idx
  on public.transfer_receipts (estado, created_at desc);

create index if not exists transfer_receipts_booking_idx
  on public.transfer_receipts (booking_id);

alter table public.transfer_receipts enable row level security;
revoke all on table public.transfer_receipts from anon, authenticated;

alter table public.transfer_receipts
  add column if not exists devuelto numeric(12,2) not null default 0
    check (devuelto >= 0);

alter table public.transfer_receipts
  add column if not exists devuelto_en timestamptz;

comment on column public.transfer_receipts.devuelto is
  'Cuánto se devolvió de esta transferencia. Lo anota el panel; la devolución la hace una persona a mano desde MercadoPago.';
