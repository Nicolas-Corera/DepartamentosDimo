-- ===========================================================================
-- 1. public.tarifas_especiales  — fines de semana largo y cualquier excepción
-- 2. public.fechas_ocupadas     — vista de días ya reservados, para el calendario
--
-- Correr en: Supabase → SQL Editor → New query → Run.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. TARIFAS ESPECIALES
--
-- El precio base por noche sale de la temporada (está en el código, en
-- pago/api/_lib/precios.js):
--
--     15/12 al 31/01  ->  temporada alta
--     01/02 al 15/02  ->  temporada media
--     16/02 al 14/12  ->  temporada baja
--
-- Esta tabla es la EXCEPCIÓN: cualquier noche que caiga en uno de estos
-- rangos se cobra al precio de acá, sin importar la temporada. Se usa para los
-- fines de semana largo, pero sirve para cualquier cosa (un evento, una fecha
-- puntual, una promoción).
--
-- Por qué una tabla y no una lista en el código: los feriados cambian todos
-- los años y los "feriados con fines turísticos" (los puentes) los decreta el
-- gobierno cuando quiere. Acá los editás desde Table Editor y tienen efecto en
-- el próximo pago, sin tocar código ni esperar un deploy.
-- ---------------------------------------------------------------------------

create table if not exists public.tarifas_especiales (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),

  -- El rango es INCLUSIVO en las dos puntas, y cada fecha representa una NOCHE.
  -- Un fin de semana largo de sábado a lunes en el que querés cobrar caras las
  -- noches del viernes, sábado y domingo se carga como 2027-10-08 a 2027-10-10.
  fecha_desde date not null,
  fecha_hasta date not null,

  precio_por_noche integer not null check (precio_por_noche > 0),

  -- Para saber después por qué esa noche salió distinto. Aparece en los logs.
  motivo text not null check (char_length(btrim(motivo)) between 2 and 80),

  constraint tarifas_especiales_rango_ok check (fecha_hasta >= fecha_desde)
);

comment on table public.tarifas_especiales is
  'Precios por noche que pisan a la temporada. Fines de semana largo, feriados, eventos.';

-- El cálculo del precio pregunta "¿qué tarifas especiales tocan este rango?".
create index if not exists tarifas_especiales_rango_idx
  on public.tarifas_especiales (fecha_desde, fecha_hasta);

-- Solo la lee el backend con service_role. No hay razón para exponerla.
alter table public.tarifas_especiales enable row level security;
revoke all on table public.tarifas_especiales from anon, authenticated;


-- ---------------------------------------------------------------------------
-- FINES DE SEMANA LARGO 2027
--
-- ⚠️  REVISAR ANTES DE CONFIRMAR. Están derivados de los feriados nacionales
--     2027 (Ley 27.399), pero:
--       - los "feriados con fines turísticos" (puentes) se decretan cada año y
--         todavía pueden agregarse;
--       - qué NOCHES cobrás caras en cada fin de semana largo es decisión
--         comercial tuya, no del calendario. Lo que está acá es el criterio
--         "las noches desde la víspera hasta el último día del feriado".
--
--     Si algo no te cierra, es un UPDATE en Table Editor.
-- ---------------------------------------------------------------------------

insert into public.tarifas_especiales (fecha_desde, fecha_hasta, precio_por_noche, motivo)
select * from (values
  -- Carnaval: lunes 8 y martes 9 de febrero
  (date '2027-02-05', date '2027-02-09', 90000, 'Carnaval'),

  -- Semana Santa + Memoria: miércoles 24 (Memoria), jueves 25 y viernes 26
  -- (Santo) — el fin de semana XL de 5 días
  (date '2027-03-24', date '2027-03-28', 90000, 'Semana Santa y Memoria'),

  -- Malvinas: viernes 2 de abril
  (date '2027-04-01', date '2027-04-04', 90000, 'Malvinas'),

  -- Güemes: lunes 21 de junio (trasladado)
  (date '2027-06-18', date '2027-06-21', 90000, 'Güemes'),

  -- Independencia: viernes 9 de julio
  (date '2027-07-08', date '2027-07-11', 90000, 'Independencia'),

  -- San Martín: lunes 16 de agosto (trasladado)
  (date '2027-08-13', date '2027-08-16', 90000, 'San Martín'),

  -- Diversidad Cultural: lunes 11 de octubre (trasladado)
  (date '2027-10-08', date '2027-10-11', 90000, 'Diversidad Cultural')
) as nuevas(fecha_desde, fecha_hasta, precio_por_noche, motivo)
where not exists (
  -- Idempotente: correr el script dos veces no duplica nada.
  select 1 from public.tarifas_especiales t
   where t.fecha_desde = nuevas.fecha_desde and t.motivo = nuevas.motivo
);


-- ---------------------------------------------------------------------------
-- 2. FECHAS OCUPADAS
--
-- El calendario del sitio necesita saber qué días ya están tomados. Pero
-- `booking_requests` tiene DNI, mail y teléfono, y es solo-alta: el navegador
-- no puede leerla, y está bien que así sea.
--
-- Esta vista expone ÚNICAMENTE las dos fechas. Sin nombre, sin mail, sin DNI,
-- sin id de reserva: nada que permita identificar a nadie. Es la misma
-- información que cualquiera deduce mirando el calendario.
--
-- Qué cuenta como ocupado: solo `confirmada`.
--
--   Es a propósito. Si contáramos también las consultas en estado `nueva`,
--   cualquiera podría bloquearte el calendario entero mandando el formulario
--   con fechas inventadas: no hace falta pagar ni dar un dato real.
--   `confirmada` la ponés vos (o la pone un pago aprobado), así que no se
--   puede falsear desde afuera.
--
--   Si preferís que las consultas sin pagar también bloqueen, agregá el estado
--   a la lista del `where` de abajo y volvé a correr el script.
-- ---------------------------------------------------------------------------

-- Por qué una FUNCIÓN y no una vista:
--
--   La primera versión de esto era una vista. Funcionaba, hasta que el
--   Security Advisor de Supabase la marcó como "security definer view" (un
--   error en su listado) y le activó `security_invoker=on`. Con esa opción la
--   vista deja de correr con los privilegios de su dueño y pasa a correr con
--   los de quien la llama: el navegador, que es `anon` y no puede leer
--   booking_requests. Resultado: el calendario dejó de mostrar la ocupación
--   con un 401 "permission denied for table booking_requests".
--
--   Volver a poner `security_invoker=off` sería pelearse con el advisor: lo
--   marcaría de nuevo y el próximo que entre al panel lo "arregla" otra vez.
--
--   Una función `security definer` con el `search_path` fijado es el patrón
--   que Supabase sí recomienda para esto, y no dispara ninguna advertencia.
--   Además es más ajustado: no hay que darle a `anon` ni un permiso sobre
--   booking_requests. La única puerta es esta función, y devuelve exactamente
--   dos columnas.
drop view if exists public.fechas_ocupadas;

create or replace function public.fechas_ocupadas()
returns table (check_in date, check_out date)
language sql
stable
security definer
-- search_path vacío: con security definer, un search_path heredado deja que
-- alguien anteponga un esquema propio y haga que "booking_requests" apunte a
-- una tabla suya. Por eso adentro todo va calificado con public.
set search_path = ''
as $$
  select b.check_in, b.check_out
    from public.booking_requests b
   where b.estado in ('confirmada')
$$;

comment on function public.fechas_ocupadas() is
  'Fechas de las reservas confirmadas, sin datos personales. La llama el calendario del sitio con la clave anon.';

-- Las funciones son ejecutables por PUBLIC por defecto: se revoca y se da
-- explícitamente, para que quede escrito quién puede llamarla.
revoke all on function public.fechas_ocupadas() from public;
grant execute on function public.fechas_ocupadas() to anon, authenticated;


-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
-- select * from public.tarifas_especiales order by fecha_desde;
-- select * from public.fechas_ocupadas order by check_in;
--
-- Y desde la consola del sitio publicado, que tiene que FUNCIONAR:
--   await db.from('fechas_ocupadas').select('*')
-- mientras que esto tiene que seguir fallando con permission denied:
--   await db.from('booking_requests').select('*')
