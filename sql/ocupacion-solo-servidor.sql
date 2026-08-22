create or replace function public.fechas_ocupadas()
returns table (check_in date, check_out date)
language sql
stable
security invoker
set search_path = ''
as $$
  select b.check_in, b.check_out
    from public.booking_requests b
   where b.estado in ('confirmada')
$$;

comment on function public.fechas_ocupadas() is
  'Fechas de las reservas confirmadas, sin datos personales. La llama /api/ocupacion del sitio con la service_role. NO exponerla a anon: booking_requests tiene los datos personales del huesped.';

revoke all on function public.fechas_ocupadas() from public, anon, authenticated;
grant execute on function public.fechas_ocupadas() to service_role;
