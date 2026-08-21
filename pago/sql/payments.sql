-- ===========================================================================
-- Tabla public.payments — registro de pagos de MercadoPago
--
-- Correr una sola vez en: Supabase → SQL Editor → New query → Run.
--
-- Criterio de seguridad, el mismo que booking_requests: esta tabla NO la toca
-- el navegador. Ni lee ni escribe. Solo la escribe el backend con la clave
-- service_role, que saltea RLS. Por eso se activa RLS y no se crea ninguna
-- política: sin política, RLS niega todo para anon y authenticated.
--
-- Se guarda un registro por intento de pago, aprobado o rechazado. El historial
-- de rechazos es lo que después explica un "pagué y no me figura".
-- ===========================================================================

create table if not exists public.payments (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- El id del pago en MercadoPago. Es la clave de idempotencia de esta tabla:
  -- el webhook puede llegar diez veces y siempre actualiza la misma fila.
  mp_payment_id text not null unique,

  -- La reserva que se está pagando. Sale del external_reference del pago.
  -- Puede quedar en null si llega una notificación de un pago que no generamos
  -- desde este sitio (una devolución hecha a mano desde el panel, por ejemplo).
  booking_id uuid references public.booking_requests(id) on delete set null,

  -- El external_reference crudo, tal como vino. Sirve para diagnosticar cuando
  -- no matchea con ninguna reserva.
  external_reference text,

  status        text not null,   -- approved | in_process | pending | rejected | cancelled | refunded | charged_back
  status_detail text,            -- accredited | cc_rejected_insufficient_amount | ...

  monto  numeric(12,2) not null check (monto >= 0),
  moneda text not null default 'ARS',

  metodo text,      -- payment_method_id: visa, master, amex, ...
  tipo   text,      -- payment_type_id: credit_card, debit_card, ...
  cuotas smallint check (cuotas is null or cuotas between 1 and 24),

  -- Los últimos 4 dígitos NO son un dato sensible (PCI los permite almacenar)
  -- y son lo que le permite al cliente reconocer con qué tarjeta pagó.
  -- El número completo, el vencimiento y el CVV nunca llegan a nuestro backend:
  -- el Brick los cambia por un token contra los servidores de MercadoPago.
  ultimos_cuatro text check (ultimos_cuatro is null or ultimos_cuatro ~ '^[0-9]{4}$'),

  payer_email text,
  aprobado_en timestamptz
);

comment on table public.payments is
  'Pagos de MercadoPago. Solo escribe el backend con service_role; el navegador no tiene acceso.';

-- Buscar los pagos de una reserva (lo hace el backend antes de cobrar, para no
-- cobrar dos veces la misma estadía).
create index if not exists payments_booking_idx on public.payments (booking_id);

-- Listar por estado y fecha desde el panel.
create index if not exists payments_status_idx on public.payments (status, created_at desc);

-- ---------------------------------------------------------------------------
-- Cierre: RLS activo y sin políticas = nadie entra, salvo service_role.
-- ---------------------------------------------------------------------------
alter table public.payments enable row level security;

-- Cinturón y tiradores: además de RLS, se revocan los permisos de tabla para
-- los roles del navegador. Es el mismo doble candado que tiene
-- booking_requests. Si mañana alguien crea una política por error, esto sigue
-- bloqueando el acceso.
revoke all on table public.payments from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verificación: correr esto después y confirmar que da 0 filas visibles
-- desde el navegador.
--
--   select * from public.payments;         -- desde el SQL Editor: funciona (sos service_role)
--   await db.from('payments').select('*')  -- desde la consola del sitio: permission denied
-- ---------------------------------------------------------------------------
