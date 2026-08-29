-- Un pago (o un comprobante de transferencia) puede no tener reserva asociada:
-- cobros sueltos, pruebas, o pagos que entraron sin pasar por el formulario.
-- Hasta ahora "cancelar" desde el panel solo sabia marcar la reserva como
-- cancelada, asi que en esos casos no anotaba nada en ningun lado: el pago
-- seguia figurando como activo para siempre.

alter table public.payments
  add column if not exists cancelado_en timestamptz;

comment on column public.payments.cancelado_en is
  'Cuando se cancelo el pago desde el panel. Importa sobre todo cuando booking_id es null: ahi no hay reserva que marcar como cancelada.';

alter table public.transfer_receipts
  add column if not exists cancelado_en timestamptz;

comment on column public.transfer_receipts.cancelado_en is
  'Cuando se cancelo la transferencia desde el panel. Importa sobre todo cuando booking_id es null.';
