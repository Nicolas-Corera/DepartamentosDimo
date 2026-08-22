# Seguridad

Auditoría de la Fase 6. Este archivo es el registro de qué se revisó, qué se
encontró y qué quedó configurado. Se actualiza al cerrar cada parte.

| Parte | Alcance | Estado |
| --- | --- | --- |
| **A** | Supabase: RLS, políticas, claves, storage, red y Auth | ✅ cerrada |
| B | — | pendiente |
| C | — | pendiente |
| D | — | pendiente |
| E | — | pendiente |

---

## Parte A — Supabase

Proyecto `aiytevmxalwwbxxbgtwe`, Postgres 17.6, región `us-west-2`.

Todo se verificó **contra la base de producción**, no leyendo los `.sql`: las
consultas salieron por la Management API y los intentos de acceso se hicieron
con la clave pública real, desde afuera, como lo haría cualquiera.

### A.1 — RLS en todas las tablas

Las diez tablas de `public` tienen RLS activo:

| Tabla | RLS | Políticas |
| --- | --- | --- |
| `booking_requests` | ✅ | 0 |
| `configuracion_pagos` | ✅ | 0 |
| `emails_enviados` | ✅ | 0 |
| `medios_pago` | ✅ | 0 |
| `payments` | ✅ | 0 |
| `planes_cuotas` | ✅ | 0 |
| `reviews` | ✅ | 2 |
| `tarifas_especiales` | ✅ | 0 |
| `temporadas` | ✅ | 0 |
| `transfer_receipts` | ✅ | 0 |

**Cero políticas no es un descuido, es el diseño.** RLS activo sin ninguna
política deniega todo salvo a `service_role`, que la saltea. Las nueve tablas
sensibles son inaccesibles desde el navegador por definición: solo entra el
backend. La única con políticas es `reviews`, que es la única que el sitio
público toca directo.

Encima hay una segunda barrera: `anon` y `authenticated` **no tienen ni el
`GRANT`** sobre esas nueve tablas. Aunque mañana alguien agregue una política
por error, el permiso de Postgres sigue faltando.

Y hay una tercera: el event trigger `ensure_rls` corre en cada `ddl_command_end`
y activa RLS solo en cualquier tabla nueva. Una tabla creada de apuro no nace
expuesta.

### A.2 — Ninguna política con `USING (true)`

Las dos políticas de `reviews` están acotadas:

| Política | Cmd | `USING` | `WITH CHECK` |
| --- | --- | --- | --- |
| lectura pública de reseñas aprobadas | `SELECT` | `approved = true` | — |
| alta pública de reseñas sin aprobar | `INSERT` | — | `approved = false AND created_at <= now()` |

Se lee solo lo aprobado. No hay política de `UPDATE` ni de `DELETE`, así que
nadie desde afuera puede editar ni borrar reseñas: eso pasa por el panel, con
`service_role`.

### A.3 — `WITH CHECK` en las escrituras

La política de `INSERT` usa `WITH CHECK`, que es lo correcto: `USING` no filtra
filas nuevas. La condición `approved = false` es la que impide que alguien se
publique una reseña de cinco estrellas sin pasar por moderación.

Verificado a mano — insertar con `approved: true` desde afuera devuelve:

```
new row violates row-level security policy for table "reviews"
```

### A.4 — La `service_role` no está en el navegador

No aparece en ningún archivo que llegue al cliente. Solo se nombra en
`apps/*/api/_lib/`, que es código de servidor, y en la documentación.

`apps/sitio/supabase-config.js` —el único archivo con una clave embebida— tiene
la `sb_publishable_`, que es pública por diseño.

Además `apps/sitio/tools/build-config.mjs` aborta el build si detecta que en el
lugar de la anon key se pegó una `service_role` o una `sb_secret_`. El error se
comete una vez y el script lo frena.

Los `.env` están en `.gitignore` y ninguno está commiteado — solo los
`.env.example`.

### A.5 — Storage

Un solo bucket, `comprobantes`, donde se suben los comprobantes de
transferencia:

| | |
| --- | --- |
| Público | ❌ no |
| Límite por archivo | 5 MB |
| Tipos permitidos | `image/png`, `image/jpeg`, `application/pdf` |
| Políticas sobre `storage.objects` | 0 → nadie salvo `service_role` |

Probado desde afuera con la clave pública: listar devuelve vacío, la URL pública
da 400 y subir un PNG válido devuelve `403 new row violates row-level security
policy`.

> Un detalle que confunde: si subís un archivo con un tipo **no permitido**, la
> respuesta es `415 invalid_mime_type` en vez de un 403. Parece que el permiso
> pasó y solo falló el formato, pero no: Storage valida el MIME antes de
> consultar RLS. Con un tipo permitido, el 403 aparece igual.

### A.6 — Red y cuenta

Acá estaban los dos agujeros reales de la Parte A.

| | Antes | Ahora |
| --- | --- | --- |
| SSL enforcement | ❌ apagado | ✅ activo |
| IPs con acceso directo a Postgres | `0.0.0.0/0` y `::/0` — todo internet | ✅ ninguna |

Con SSL enforcement apagado, una conexión directa a la base podía viajar sin
cifrar. Con `0.0.0.0/0`, cualquiera en internet podía al menos *intentar*
conectarse y probar contraseñas.

Cerrar el acceso directo no rompe nada porque **las tres apps no usan conexión
directa**: van todas por la REST API (PostgREST) con sus claves. El SQL Editor
de la web tampoco pasa por ahí. Lo único que se pierde es conectarse con `psql`,
DBeaver o TablePlus.

> **Si algún día necesitás un cliente de escritorio:** Supabase → Project
> Settings → Database → Network Restrictions, y agregás tu IP. Es reversible en
> el momento.

### A.7 — Auth

El hallazgo importante: **Supabase Auth no se usa en ninguna de las tres apps.**
El panel tiene su propio login con código de seis dígitos y cookie firmada, el
sitio y el checkout no autentican a nadie. `auth.users` tiene cero filas.

Pero las altas por mail estaban **abiertas**. Cualquiera con la clave pública
—que es visible en el sitio— podía crear cuentas contra el proyecto. No servían
para leer nada (el rol `authenticated` tiene los mismos permisos que `anon`),
pero ensuciaban la base y gastaban la cuota de mails.

| | Antes | Ahora |
| --- | --- | --- |
| Altas de usuarios | ❌ abiertas | ✅ cerradas |
| Confirmación de mail | ✅ ya estaba activa | ✅ activa |
| `site_url` | `http://localhost:3000` | `https://departamentosdimo.com.ar` |

La confirmación de mail (`mailer_autoconfirm = false`) ya venía bien: sin ella
se podían dar de alta cuentas con mails inventados.

Un intento de alta hoy devuelve:

```
{"code":422,"error_code":"signup_disabled","msg":"Signups not allowed for this instance"}
```

> Si más adelante el panel migra a Supabase Auth, hay que volver a abrir las
> altas **y** endurecer la contraseña: hoy el mínimo son 6 caracteres, sin
> requisitos de composición y sin chequeo contra HIBP. Mientras Auth no se use,
> no importa.

---

## Lo que queda a mano

Dos cosas que no se pueden hacer por API — las tenés que hacer vos:

1. **MFA en la cuenta de Supabase.** La cuenta `departamentosdimo` es Owner de
   la organización y tiene `mfa_enabled: false`. Es la llave maestra de todo:
   quien entre ahí ve las claves, la base y los backups. Se activa en
   [Account → Security](https://supabase.com/dashboard/account/security).

2. **Revocar el token de administración.** El `SUPABASE_ACCESS_TOKEN` (`sbp_…`)
   del `.env` da control total de la cuenta entera, no solo de este proyecto.
   Se creó para armar la base y ya cumplió. Se revoca en
   [Account → Tokens](https://supabase.com/dashboard/account/tokens) y después
   se borra la línea del `.env`.

---

## Cómo repetir la auditoría

Las consultas de control, para correr en el SQL Editor:

```sql
-- tablas sin RLS: no debería devolver ninguna fila
select tablename from pg_tables
 where schemaname = 'public' and rowsecurity = false;

-- políticas permisivas: revisar cualquiera con USING (true)
select tablename, policyname, cmd, qual, with_check
  from pg_policies where schemaname = 'public';

-- qué puede tocar el navegador
select table_name, grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon', 'authenticated');

-- funciones que saltean RLS
select proname, prosecdef from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef;
```

Sobre la última: `fechas_ocupadas()` es `SECURITY DEFINER` a propósito. Saltea
RLS para leer `booking_requests`, pero devuelve **solo** `check_in` y
`check_out` de las reservas confirmadas — ningún nombre, mail ni teléfono. Es lo
que necesita el calendario del sitio para marcar los días ocupados. Tiene
`search_path = ''`, que es lo que evita que se la pueda secuestrar con una
tabla falsa en otro schema.
