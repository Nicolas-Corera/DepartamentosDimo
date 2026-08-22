create table if not exists public.configuracion_pagos (
  id smallint primary key default 1 check (id = 1),

  porcentaje_reserva numeric(5, 2) not null default 30
    check (porcentaje_reserva > 0 and porcentaje_reserva <= 100),

  actualizado_en timestamptz not null default now()
);

comment on table public.configuracion_pagos is
  'Fila única con la configuración de cobro. porcentaje_reserva es la seña: qué porcentaje del total cobra el link de "reserva". Se edita desde el dashboard.';

insert into public.configuracion_pagos (id, porcentaje_reserva)
values (1, 30)
on conflict (id) do nothing;

alter table public.configuracion_pagos enable row level security;
revoke all on table public.configuracion_pagos from anon, authenticated;

alter table public.payments
  add column if not exists concepto text;

alter table public.payments
  drop constraint if exists payments_concepto_check;

alter table public.payments
  add constraint payments_concepto_check
  check (concepto is null or concepto in ('reserva', 'saldo', 'total'));

alter table public.payments
  add column if not exists monto_base numeric(12, 2)
    check (monto_base is null or monto_base >= 0);

update public.payments
   set monto_base = monto
 where monto_base is null;

comment on column public.payments.concepto is
  'reserva = seña; saldo = lo que faltaba después de la seña; total = el total completo de una.';

comment on column public.payments.monto_base is
  'El monto sin el recargo del medio de pago. Contra este número se calcula cuánto falta pagar: si se usara monto, el recargo de la tarjeta se comería parte de la estadía.';

alter table public.transfer_receipts
  add column if not exists concepto text;

alter table public.transfer_receipts
  drop constraint if exists transfer_receipts_concepto_check;

alter table public.transfer_receipts
  add constraint transfer_receipts_concepto_check
  check (concepto is null or concepto in ('reserva', 'saldo', 'total'));

alter table public.transfer_receipts
  add column if not exists monto_base numeric(12, 2)
    check (monto_base is null or monto_base >= 0);

update public.transfer_receipts
   set monto_base = monto_declarado
 where monto_base is null;

comment on column public.transfer_receipts.monto_base is
  'Lo mismo que payments.monto_base: la parte que descuenta del precio del alojamiento. Solo cuenta cuando estado = confirmado.';

create table if not exists public.emails_enviados (
  clave      text primary key,
  created_at timestamptz not null default now(),

  tipo          text not null,
  destinatarios text[] not null default '{}',
  resend_id     text,
  error         text
);

comment on table public.emails_enviados is
  'Un renglón por mail transaccional ya despachado. La primary key describe el hecho (consulta:<booking_id>, reserva:<payment_id>, pago:<payment_id>, pago:transfer:<receipt_id>) y es lo que impide que un reintento del webhook mande el mismo mail dos veces.';

create index if not exists emails_enviados_tipo_idx
  on public.emails_enviados (tipo, created_at desc);

alter table public.emails_enviados enable row level security;
revoke all on table public.emails_enviados from anon, authenticated;
