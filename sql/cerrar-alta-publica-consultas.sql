drop policy if exists "alta publica de consultas" on public.booking_requests;

revoke insert on table public.booking_requests from anon, authenticated;

comment on table public.booking_requests is
  'Consultas de reserva. El alta entra por apps/sitio/api/consulta.js con la service_role: el navegador ya no escribe acá. Sigue sin haber política de select para anon.';
