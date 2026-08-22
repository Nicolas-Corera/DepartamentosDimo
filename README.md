# DepartamentosDimo

Monorepo de [departamentosdimo.com.ar](https://departamentosdimo.com.ar). Tres
aplicaciones que comparten una sola base de datos en Supabase, cada una con su
propio proyecto de Vercel.

## Estructura

```
apps/
  sitio/        el sitio público: galería, calendario, reseñas, formulario de reserva
  pago/         el checkout: MercadoPago + comprobantes de transferencia
  dashboard/    el panel: tarifas, registro de alquileres, moderación de reseñas
docs/           la documentación larga de cada parte
sql/            los scripts que se corren a mano en el SQL Editor de Supabase
```

Cada app es **autocontenida**: su `package.json`, su `vercel.json` y su
`tools/`. Es lo que exige el `Root Directory` de Vercel — al desplegar, cada
proyecto solo ve los archivos de su propia carpeta, así que nada de lo que una
app necesita para construirse puede vivir afuera.

`docs/` y `sql/` sí van en la raíz: no se despliegan. Los `.sql` se corren a
mano en Supabase y la documentación se lee en GitHub.

## Los tres proyectos de Vercel

| App | Root Directory | Dominio |
| --- | --- | --- |
| `apps/sitio` | `apps/sitio` | departamentosdimo.com.ar |
| `apps/pago` | `apps/pago` | pago.departamentosdimo.com.ar |
| `apps/dashboard` | `apps/dashboard` | dash.departamentosdimo.com.ar |

**Si movés una app de lugar, hay que cambiarle el Root Directory al proyecto en
Vercel.** Sin eso el deploy queda apuntando a una carpeta que ya no existe.

## Desarrollo

```bash
npm run dev             # el sitio          -> http://localhost:8000
npm run dev:pago        # el checkout       -> http://localhost:3000
npm run dev:dashboard   # el panel          -> http://localhost:3100
npm run config          # regenera apps/sitio/supabase-config.js desde el .env
```

Los tres levantan sin instalar nada: el sitio con `serve`, y el checkout y el
panel con un servidor propio (`apps/*/tools/dev-server.mjs`) que emula el ruteo
de Vercel para las funciones de `api/`.

El checkout y el panel necesitan su `.env` — `cp .env.example .env` dentro de
cada app. El sitio lee el de la raíz del monorepo o el suyo, el que encuentre
primero.

## Documentación

| Archivo | De qué habla |
| --- | --- |
| [docs/SUPABASE.md](docs/SUPABASE.md) | La base: tablas, RLS, claves, reseñas y consultas de reserva |
| [docs/MERCADOPAGO.md](docs/MERCADOPAGO.md) | El checkout: cobro con tarjeta, cuotas, webhook y transferencias |
| [docs/PANEL.md](docs/PANEL.md) | El panel: sesión, tarifas, alquileres, devoluciones y comprobantes |

## Las claves

Ningún `.env` se commitea. En Vercel las variables se cargan en el panel de cada
proyecto; en local viven en archivos `.env` que están en `.gitignore`.

La única clave que llega al navegador es la **publishable/anon** de Supabase, y
llega a través de `apps/sitio/supabase-config.js`, que se genera con
`npm run config` y tampoco se commitea: lo regenera Vercel en cada build.
