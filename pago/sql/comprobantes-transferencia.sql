-- ===========================================================================
-- Comprobantes de pago por transferencia
--
--   1. public.transfer_receipts  — un registro por comprobante subido
--   2. bucket privado `comprobantes` en Storage — el archivo en sí
--
-- Correr en: Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede correr dos veces sin romper nada.
--
-- Por qué una tabla aparte y no una fila en `payments`
-- ---------------------------------------------------
-- Un comprobante subido NO es un pago. Es alguien diciendo "ya transferí", y
-- hasta que no se mira el extracto bancario no hay plata confirmada. Meterlo en
-- `payments` obligaría a inventarle un `mp_payment_id` que no existe y a que
-- todo lo que lee esa tabla (el listado de alquileres del panel, los reportes,
-- las devoluciones) aprenda a convivir con filas que no son de MercadoPago.
--
-- Cuando la transferencia se confirma de verdad, el pago se registra donde va.
-- Esta tabla es la bandeja de entrada, no el libro mayor.
--
-- Criterio de seguridad, el mismo que `booking_requests` y `payments`: esto NO
-- lo toca el navegador. La página manda el archivo a /api/comprobante y es el
-- backend, con service_role, el que escribe acá y sube a Storage. Por eso se
-- activa RLS y no se crea ninguna política: sin política, RLS niega todo.
-- ===========================================================================

create table if not exists public.transfer_receipts (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- La reserva que se está pagando. Sale del link de pago.
  booking_id uuid not null references public.booking_requests(id) on delete cascade,

  -- Ruta dentro del bucket `comprobantes`. No es una URL: el bucket es privado
  -- y para ver el archivo hay que firmar una URL temporal con service_role.
  path       text not null unique,

  -- Metadatos del archivo, para poder mostrarlo sin bajarlo primero.
  mime       text not null check (mime in ('image/png', 'image/jpeg', 'application/pdf')),
  bytes      integer not null check (bytes > 0),

  -- Lo que la persona dice que transfirió, en pesos. Es declarativo: sirve para
  -- comparar contra el extracto, no para dar por cobrado nada.
  monto_declarado numeric(12,2) check (monto_declarado is null or monto_declarado >= 0),

  -- pendiente  — subido, nadie lo miró todavía
  -- confirmado — se vio la plata en la cuenta
  -- rechazado  — el comprobante no corresponde
  estado     text not null default 'pendiente'
             check (estado in ('pendiente', 'confirmado', 'rechazado')),
  revisado_en timestamptz,
  nota        text
);

comment on table public.transfer_receipts is
  'Comprobantes de transferencia subidos desde la página de pago. Bandeja de entrada, no pagos confirmados. Solo escribe el backend con service_role.';

-- Los pendientes primero es lo que se va a querer listar en el panel.
create index if not exists transfer_receipts_estado_idx
  on public.transfer_receipts (estado, created_at desc);

-- Todos los comprobantes de una reserva.
create index if not exists transfer_receipts_booking_idx
  on public.transfer_receipts (booking_id);

-- ---------------------------------------------------------------------------
-- Cierre: RLS activo y sin políticas = nadie entra, salvo service_role.
-- Cinturón y tiradores, igual que payments: además se revocan los permisos de
-- tabla, así una política creada por error mañana no alcanza para entrar.
-- ---------------------------------------------------------------------------
alter table public.transfer_receipts enable row level security;
revoke all on table public.transfer_receipts from anon, authenticated;

-- ===========================================================================
-- El bucket de Storage
-- ===========================================================================
-- Se crea desde la API de Storage (o Panel → Storage → New bucket) así:
--
--   nombre              comprobantes
--   público             NO
--   límite de tamaño    5 MB
--   MIME permitidos     image/png, image/jpeg, application/pdf
--
-- NO lleva políticas de RLS sobre storage.objects, y es a propósito: sin
-- política, `anon` no puede ni subir ni leer. Sube el backend con service_role,
-- que las saltea. Darle a `anon` permiso de INSERT sobre el bucket sería
-- abrirle a cualquiera un disco gratis contra nuestra cuenta.
--
-- Para mirar un comprobante hay que firmar una URL temporal con service_role:
--
--   select storage.filename(name) from storage.objects where bucket_id = 'comprobantes';
--
-- Verificación de que el bucket quedó cerrado (desde la consola del sitio,
-- con la clave anon — tiene que fallar):
--
--   await db.storage.from('comprobantes').list()
-- ===========================================================================

-- ===========================================================================
-- AMPLIACIÓN: registrar la devolución de una transferencia
-- ===========================================================================
-- Cancelar un alquiler pagado por transferencia no puede devolver la plata:
-- esa plata nunca pasó por la API de MercadoPago, así que no hay `refund` que
-- pedir. La devolución la hace una persona, a mano, desde la cuenta.
--
-- Pero si no queda registrada en ningún lado, el registro de alquileres sigue
-- diciendo que se cobraron $480.000 para siempre, aunque se hayan devuelto.
-- Estas dos columnas son para eso: no mueven plata, la anotan.
--
-- Es el mismo par que ya tiene `payments`, y por eso el panel puede tratar a
-- las dos igual — la única diferencia es quién ejecuta la devolución.
-- ===========================================================================

alter table public.transfer_receipts
  add column if not exists devuelto numeric(12,2) not null default 0
    check (devuelto >= 0);

alter table public.transfer_receipts
  add column if not exists devuelto_en timestamptz;

comment on column public.transfer_receipts.devuelto is
  'Cuánto se devolvió de esta transferencia. Lo anota el panel; la devolución la hace una persona a mano desde MercadoPago.';
