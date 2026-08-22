alter table public.configuracion_pagos
  add column if not exists tarifa_limpieza numeric(12,2) not null default 0;

alter table public.configuracion_pagos
  drop constraint if exists configuracion_pagos_tarifa_limpieza_check;

alter table public.configuracion_pagos
  add constraint configuracion_pagos_tarifa_limpieza_check
  check (tarifa_limpieza >= 0 and tarifa_limpieza <= 100000000);

comment on column public.configuracion_pagos.tarifa_limpieza is
  'Importe fijo que se suma una sola vez al total de la estadia, no por noche. En 0 queda desactivada y no se muestra en ningun lado.';

update public.configuracion_pagos set tarifa_limpieza = 0 where id = 1 and tarifa_limpieza is null;
