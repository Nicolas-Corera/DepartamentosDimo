-- ===========================================================================
-- Configuración de tarifas editable desde el dashboard
--
--   1. public.temporadas      — rango de fechas + precio por noche
--   2. public.medios_pago     — recargo por medio (transferencia / débito / crédito)
--   3. public.planes_cuotas   — recargo por cantidad de cuotas
--   4. booking_requests.estado — se agrega 'cancelada'
--
-- Correr en: Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede correr dos veces sin romper nada ni pisar valores
-- que ya hayas editado desde el dashboard.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ ESTO ESTÁ EN LA BASE Y NO EN VARIABLES DE ENTORNO
--
-- Hasta ahora los precios por temporada vivían en `PRECIO_TEMPORADA_*_ARS` en
-- Vercel: para cambiar un precio había que entrar al panel de Vercel, editar la
-- variable y esperar un redeploy. Acá se editan desde el dashboard y tienen
-- efecto en el próximo pago.
--
-- Ninguna de estas tablas la toca el navegador. Las lee el backend de `pago/`
-- (con service_role, para calcular el monto) y las escribe el backend del
-- dashboard (también con service_role, detrás del código de acceso). Por eso
-- RLS queda activo y sin políticas: sin política, RLS niega todo.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. TEMPORADAS
--
-- Rangos ABSOLUTOS, con año. Cada fila es "del 15/12/2026 al 31/01/2027 la
-- noche sale $90.000". No se repiten solas todos los años: cuando termina un
-- ciclo hay que correr las fechas desde el dashboard.
--
-- Qué pasa con una noche que no cae en NINGÚN rango: se cobra al precio de la
-- temporada baja. Es el fallback, y el dashboard avisa en pantalla cuáles son
-- los huecos para que no se cobre barato por olvido.
--
-- Qué pasa si dos rangos se solapan: gana el más caro. Es el mismo criterio
-- conservador que ya usa `tarifas_especiales` — mejor cobrar de más y que el
-- cliente reclame, que cobrar de menos y comerse la diferencia.
--
-- Las excepciones puntuales (fines de semana largo, feriados, eventos) NO van
-- acá: van en `tarifas_especiales`, que pisa a la temporada.
-- ---------------------------------------------------------------------------

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

-- Los valores iniciales son los que estaban en las variables de entorno, con
-- los rangos que estaban escritos en precios.js llevados al ciclo que viene.
-- `on conflict do nothing`: si ya editaste los precios desde el dashboard,
-- volver a correr este script no te los pisa.
insert into public.temporadas (clave, nombre, fecha_desde, fecha_hasta, precio_por_noche, orden)
values
  ('alta',  'Temporada Alta',  date '2026-12-15', date '2027-01-31', 90000, 1),
  ('media', 'Temporada Media', date '2027-02-01', date '2027-02-15', 85000, 2),
  ('baja',  'Temporada Baja',  date '2026-08-01', date '2026-12-14', 80000, 3)
on conflict (clave) do nothing;

alter table public.temporadas enable row level security;
revoke all on table public.temporadas from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. MEDIOS DE PAGO
--
-- El precio por noche de `temporadas` es el precio de TRANSFERENCIA: el de
-- contado, sin recargo. Sobre ese total se aplica el recargo del medio elegido.
--
--   transferencia   +0%    (es la base)
--   débito          +N%
--   crédito         +N%    (y encima el recargo por cuotas, ver más abajo)
--
-- `habilitado = false` esconde la pestaña de ese medio en el checkout.
-- ---------------------------------------------------------------------------

create table if not exists public.medios_pago (
  clave  text primary key check (clave in ('transferencia', 'debito', 'credito')),
  nombre text not null,

  habilitado boolean not null default true,

  -- Porcentaje que se suma al total. 0 = sin recargo. Se permite un decimal
  -- por si alguna vez hace falta un 7,5%.
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


-- ---------------------------------------------------------------------------
-- 3. PLANES DE CUOTAS
--
-- Una fila por cantidad de cuotas. El recargo es ADICIONAL al del medio de
-- pago: 3 cuotas sobre un crédito con +8% y un plan de +15% termina en +23%
-- sobre el precio base.
--
-- El máximo de cuotas que se ofrece es la mayor cantidad habilitada. Para
-- ofrecer hasta 6, habilitá 1 a 6 y dejá el resto en false.
-- ---------------------------------------------------------------------------

create table if not exists public.planes_cuotas (
  cuotas smallint primary key check (cuotas between 1 and 24),

  habilitado boolean not null default false,

  recargo_porcentaje numeric(5, 2) not null default 0
    check (recargo_porcentaje >= 0 and recargo_porcentaje <= 100),

  actualizado_en timestamptz not null default now()
);

comment on table public.planes_cuotas is
  'Recargo por cantidad de cuotas, adicional al del medio de pago. El máximo ofrecido es la mayor cantidad habilitada.';

-- Se siembran las 24 filas para que el dashboard pueda habilitarlas sin tener
-- que crear nada. Arrancan las primeras 3 habilitadas y sin recargo, que es lo
-- que estaba configurado en MP_MAX_CUOTAS.
insert into public.planes_cuotas (cuotas, habilitado, recargo_porcentaje)
select n, n <= 3, 0
  from generate_series(1, 24) as n
on conflict (cuotas) do nothing;

alter table public.planes_cuotas enable row level security;
revoke all on table public.planes_cuotas from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. ESTADO 'cancelada' EN booking_requests
--
-- Cuando desde el dashboard se cancela una reserva ya paga (con o sin
-- devolución), la reserva pasa a 'cancelada'. No se usa 'descartada' porque esa
-- es para las consultas que nunca llegaron a nada: mezclarlas haría imposible
-- distinguir "no contestó el mail" de "pagó y le devolvimos la plata".
--
-- Efecto colateral buscado: `fechas_ocupadas()` solo cuenta 'confirmada', así
-- que cancelar libera las noches en el calendario del sitio sin tocar nada más.
-- ---------------------------------------------------------------------------

alter table public.booking_requests
  drop constraint if exists booking_requests_estado_check;

alter table public.booking_requests
  add constraint booking_requests_estado_check
  check (estado in ('nueva', 'contactada', 'confirmada', 'descartada', 'cancelada'));


-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
-- select * from public.temporadas order by orden;
-- select * from public.medios_pago order by orden;
-- select * from public.planes_cuotas where habilitado order by cuotas;
--
-- Y desde la consola del sitio publicado, las tres tienen que FALLAR con
-- permission denied:
--   await db.from('temporadas').select('*')
--   await db.from('medios_pago').select('*')
--   await db.from('planes_cuotas').select('*')


-- ---------------------------------------------------------------------------
-- 5. DEVOLUCIONES EN payments
--
-- Cuando desde el dashboard se cancela una reserva se puede devolver todo o una
-- parte (por ejemplo, reteniendo la seña). MercadoPago admite varias
-- devoluciones parciales sobre el mismo pago, así que `devuelto` es acumulativo
-- y no un booleano: es lo que permite mostrar "se devolvieron $40.000 de
-- $560.000" y lo que impide devolver más de lo cobrado.
-- ---------------------------------------------------------------------------

alter table public.payments
  add column if not exists devuelto numeric(12, 2) not null default 0 check (devuelto >= 0);

alter table public.payments
  add column if not exists devuelto_en timestamptz;

comment on column public.payments.devuelto is
  'Total devuelto hasta ahora, acumulado entre devoluciones parciales. 0 = no se devolvió nada.';
