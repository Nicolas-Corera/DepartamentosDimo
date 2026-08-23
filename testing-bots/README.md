# Bots de testing

Seis bots para probar la web entera: los flujos que hace un huésped, que las
páginas sigan de pie, cuánto aguanta, si hay agujeros de seguridad, si la
validación de inputs se rompe con basura, y si los frenos contra el abuso
están puestos.

Cada bot tiene su `.bat`: doble click y anda. El `.bat` revisa que las
dependencias estén antes de arrancar y, si falta algo, te dice cómo instalarlo.

| Bot | Qué hace | Contra qué | Necesita |
| --- | --- | --- | --- |
| [1 · Funcional](#bot-1--funcional-e2e) | Recorre los flujos core con un navegador real | localhost | Node + Playwright |
| [2 · Monitoreo](#bot-2--monitoreo-sintético) | Chequea que las páginas y las APIs respondan | localhost **o producción** | Node |
| [3 · Carga](#bot-3--carga) | Usuarios concurrentes sobre el flujo principal | solo localhost | Node + k6 |
| [4 · Vulnerabilidades](#bot-4--vulnerabilidades) | OWASP ZAP baseline scan, reporte HTML | solo localhost | Node + Docker |
| [5 · Fuzzing](#bot-5--fuzzing) | ~1000 inputs límite contra todos los endpoints | solo localhost | Node |
| [6 · Rate limiting](#bot-6--rate-limiting) | Ráfagas para ver si los frenos saltan | solo localhost | Node |

---

## Lo primero que tenés que saber

**Los dev servers locales usan la Supabase y el Resend de producción.**

`npm run dev` levanta el sitio con el `.env` de `apps/sitio`, que apunta a la
base real. No hay una base de staging. Entonces:

- Una consulta que se inserta desde `localhost` es una **fila real** en
  `booking_requests` y un **mail real** a `DUENOS_EMAILS`.
- Lo mismo con las reseñas, los comprobantes y los pagos.

Por eso **todos los bots arrancan en modo seco** (`PERMITIR_ESCRITURA=0`):

- El bot funcional completa el formulario entero en el navegador y frena el
  `POST` justo antes de que salga, con `page.route`. Verifica el payload que
  armó el front sin que llegue al servidor.
- El fuzzer manda payloads que la API rechaza **antes** del insert (ver
  [Cómo el fuzzer no escribe](#cómo-el-fuzzer-no-escribe)).
- El bot de carga nunca escribe, ni siquiera con `PERMITIR_ESCRITURA=1`.
- El bot de rate limiting aprovecha que el cupo se descuenta antes de validar.

Para probar el camino completo de verdad, poné `PERMITIR_ESCRITURA=1` en el
`.env` y después limpiá ([abajo](#limpiar-los-datos-de-prueba)).

**Producción está bloqueada por código.** Los bots 3, 4, 5 y 6 abortan con
exit 1 si la URL objetivo no es `localhost`. No hay flag para forzarlo. El bot
2 sí puede correr contra producción, pero solo hace `GET`.

---

## Puesta en marcha

```bash
cd testing-bots
copy .env.example .env
npm install
npx playwright install chromium
```

El `.env` es opcional: sin él, los bots usan el entorno `local` de
`config.json`. El `.env` está cubierto por el `.gitignore` de la raíz.

### Si algo está mal, el bot te lo dice antes de arrancar

Antes de mandar el primer pedido, cada bot revisa dos cosas y corta con un
mensaje concreto en vez de tirar una lista de errores:

- **URLs mal escritas.** Un `URL_PAGO=http://localhost::3000` (dos veces los dos
  puntos) da: *"URL_PAGO no es una URL válida — está en la línea 23 de
  `testing-bots/.env`"*, con el formato correcto al lado.
- **Dev servers caídos.** Dice cuál no responde, con qué error y con qué
  comando levantarlo. Nada más: si el panel está caído, te nombra el panel.

Para casi todos los bots necesitás los tres dev servers levantados. Desde la
raíz del repo, en tres ventanas:

```bash
npm run dev
```

```bash
npm run dev:pago
```

```bash
npm run dev:dashboard
```

Quedan en `http://localhost:8000` (sitio), `:3000` (checkout) y `:3100` (panel).

### Dos variables que conviene completar

| Variable | Para qué | De dónde sale |
| --- | --- | --- |
| `PANEL_CODIGO` | Que el bot funcional entre al panel | Si lo dejás vacío, se lee solo de `apps/dashboard/.env` |
| `REF_DE_PRUEBA` | Que el bot funcional abra el checkout | UUID de una fila de `booking_requests`: panel → Alquileres, o la tabla en Supabase |

Sin `REF_DE_PRUEBA`, los dos tests del checkout quedan en *skipped* con el
motivo escrito. No fallan.

---

## Configuración

Todo sale de `config.json` (versionado, sin secretos) y se puede pisar con
variables del `.env` (no versionado). Nada está hardcodeado en los scripts.

`config.json` define los dos entornos y los parámetros de cada bot:

```json
"entornos": {
  "local":      { "sitio": "http://localhost:8000", "pago": "http://localhost:3000", "panel": "http://localhost:3100" },
  "produccion": { "sitio": "https://departamentosdimo.com.ar", "...": "..." }
}
```

| Variable del `.env` | Pisa a | Por defecto |
| --- | --- | --- |
| `ENTORNO` | qué bloque de `entornos` se usa | `local` |
| `URL_SITIO` / `URL_PAGO` / `URL_PANEL` | las URLs del entorno | las de `config.json` |
| `PERMITIR_ESCRITURA` | modo seco / escritura real | `0` |
| `PANEL_CODIGO` | el código del panel | el de `apps/dashboard/.env` |
| `REF_DE_PRUEBA` | reserva para el checkout | vacío |
| `CARGA_USUARIOS`, `CARGA_DURACION`, `CARGA_RAMP_UP` | parámetros de carga | 10 / 45s / 15s |
| `MONITOREO_UMBRAL_MS`, `MONITOREO_INTERVALO` | monitoreo | 2500ms / 300s |

---

## Bot 1 · Funcional (E2E)

```
1-funcional.bat
```

Playwright con Chromium. Once tests sobre las tres apps.

**Sitio**

- La portada carga: hero, galería, formulario, y **cero errores de JS**
  (escucha `pageerror`).
- El calendario de disponibilidad abre y consume `/api/ocupacion`.
- Un email inválido no sale del navegador: verifica que el `POST` nunca se
  dispare y que `checkValidity()` dé `false`.
- El formulario de reserva se completa entero —nombre, email, DNI, teléfono,
  procedencia, dos días seguidos del calendario, personas/adultos/niños,
  mensaje— y se compara el payload que armó el front contra lo esperado:
  fechas en ISO, `check_out > check_in`, `adultos + niños === personas`.
- La reseña: abre el modal, elige 5 estrellas, escribe, y valida el payload.

**Checkout** *(los dos últimos necesitan `REF_DE_PRUEBA`)*

- Sin `ref` muestra la pantalla de error y **no** el formulario de pago.
- Con una reserva real: aparece el resumen, el DNI viene enmascarado, los tres
  medios de pago están, y el tab de transferencia muestra el monto y el input
  de comprobante.
- El monto nunca viaja desde el navegador: revisa que `pago.js` no lo mande en
  el body de `/api/pagos`.

**Panel**

- Un código incorrecto no abre sesión y `/api/sesion` sigue dando 401.
- Con el código correcto entra, `/api/tarifas` devuelve temporadas y medios, y
  las tres pestañas cambian.
- Los cuatro endpoints del panel dan 401 sin cookie.

**Si algo falla**, el exit code es distinto de 0 y quedan en
`reportes/funcional/<nombre-del-test>/`:

- `test-failed-1.png` — captura del momento exacto
- `video.webm` — el video del test
- `trace.zip` — traza navegable

```bash
npx playwright show-report reportes/funcional-html
```

Corre con `workers: 1` a propósito: los tests comparten los topes por IP del
sitio, y en paralelo se pisarían.

---

## Bot 2 · Monitoreo sintético

```
2-monitoreo.bat
```

Una pasada, o en bucle:

```
2-monitoreo.bat --bucle
2-monitoreo.bat --bucle --intervalo=60
```

Quince chequeos livianos. Además del status y el tiempo, mira que el contenido
esperado esté y que las APIs sigan **vivas**, no solo que devuelvan 200:

- `/api/ocupacion` devuelve el array `fechas`
- `GET /api/consulta` devuelve 405 con mensaje
- `/api/reserva` sin `ref` devuelve 400 con `codigo: "sin_ref"`
- `/api/webhook` sin firma devuelve 401
- `/api/sesion` devuelve 401 con `codigo: "sin_sesion"`
- `/api/alquileres` y `/api/tarifas` devuelven 401

Todo eso son lecturas (el único `POST` es al webhook sin firma, que se rechaza
sin efecto), así que **este bot puede correr contra producción**:

```
ENTORNO=produccion
```

Contra producción también revisa las cabeceras de seguridad (CSP,
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`). En local no:
esas las pone Vercel, no el dev server, y avisar por eso sería ruido.

Cada línea queda con timestamp ISO en `logs/2-monitoreo.log`. Exit 1 si algún
chequeo falla — sirve para engancharlo a una tarea programada de Windows.

---

## Bot 3 · Carga

```
3-carga.bat
```

k6 con un escenario `ramping-vus`: sube, se queda en meseta, baja.

Cada usuario virtual hace la vuelta completa del huésped: portada → CSS/JS →
`/api/ocupacion` → validación de `/api/consulta` → checkout → `/api/reserva`.
Las dos llamadas pesadas para Supabase (`/api/ocupacion` y `/api/reserva`) son
las que más se miden.

Umbrales (fallan la corrida con exit 99 si se pasan):

- `http_req_duration` p95 < 1500ms
- `http_req_failed` < 2%
- `checks` > 98%

Métricas propias por paso: `dimo_portada_ms`, `dimo_ocupacion_ms`,
`dimo_validacion_consulta_ms`, `dimo_checkout_reserva_ms`.

Se configura en `config.json` o con `CARGA_USUARIOS`, `CARGA_DURACION`,
`CARGA_RAMP_UP`, `CARGA_BAJADA`, `CARGA_P95_MS`, `CARGA_MAX_FALLOS`.

**Nunca escribe**, ni con `PERMITIR_ESCRITURA=1`: el `POST /api/consulta` lleva
un payload inválido a propósito, así mide el camino de validación sin insertar
nada. Un test de carga que inserta 500 filas y manda 500 mails no es un test,
es un incidente.

**Doble candado contra producción**: el lanzador de Node valida las URLs antes
de invocar a k6, y el propio script de k6 vuelve a validarlas en el init
context y tira si no son locales.

Reporte JSON completo en `reportes/carga-<fecha>.json`.

---

## Bot 4 · Vulnerabilidades

```
4-vulnerabilidades.bat            solo el sitio
4-vulnerabilidades.bat pago       solo el checkout
4-vulnerabilidades.bat panel      solo el panel
4-vulnerabilidades.bat --todo     los tres
```

Corre `zap-baseline.py` de OWASP ZAP en un contenedor. Es **pasivo**: spider y
reglas pasivas, sin ataques activos. No borra nada ni ensucia la base.

Genera `reportes/zap-<app>-<fecha>.html` y el `.json` equivalente.

Como ZAP corre adentro del contenedor, `localhost` ahí no es tu máquina: el bot
traduce el objetivo a `host.docker.internal` y agrega `--add-host` para que
funcione en Docker Desktop.

Exit code: 0 sin FAILs, aviso si hay WARNs, 1 si ZAP falló.

**Falsos positivos que vas a ver.** ZAP marca la falta de token anti-CSRF en
los formularios, pero acá la API es JSON sin cookies de sesión; la única cookie
es la del panel, con `SameSite=Strict`. También suele marcar cabeceras que sí
están en producción pero no en el dev server, porque las pone `vercel.json`.

La primera corrida baja la imagen de ZAP: alrededor de 1,5 GB.

---

## Bot 5 · Fuzzing

```
5-fuzzing.bat
```

Alrededor de **1000 pedidos**. Toma cada campo de cada endpoint y lo reemplaza,
de a uno, por 29 mutaciones: strings de 10k y 120k, vacíos, `null`, números
donde va texto, negativos, booleanos, arrays, objetos anidados, XSS,
inyección SQL, inyección de PostgREST (`*,payments(*)`), template injection,
path traversal, byte nulo, CRLF, unicode invertido, fechas imposibles, UUIDs
falsos. Y prueba el campo ausente.

También fuzzea el cuerpo entero (JSON roto, array en la raíz, 200 niveles de
anidación, prototype pollution, `Content-Type` de formulario, XXE con XML,
sin `Content-Type`) y los métodos HTTP no permitidos.

Cubre:

- Sitio: `/api/consulta` (16 campos), `/api/resena`, `/api/ocupacion`
- Pago: `/api/reserva`, `/api/pagos`, `/api/comprobante`, `/api/webhook`
- Panel: los seis endpoints sin sesión, y cinco cookies de sesión falsificadas

Además prueba que la subida de comprobantes no se pueda apuntar a otra reserva
(`../otra-reserva/`, `/etc/passwd`, un UUID ajeno).

**Qué marca como hallazgo**

| Severidad | Qué |
| --- | --- |
| Alta | 5xx, stack trace de Node, ruta de `/var/task/` o de Windows, error crudo de Postgres o PostgREST, clave de Supabase o token de MercadoPago en la respuesta, cadena de conexión, error de red sin envolver |
| Media | `Content-Type` que no es JSON, un 4xx sin campo `error` legible, el payload devuelto sin escapar, un status fuera de lo esperado |

Exit 1 si hay alguna alta. Reporte en `reportes/fuzzing-<fecha>.json`.

### Cómo el fuzzer no escribe

En modo seco la base de cada payload tiene **dos campos inválidos a propósito**:

- `/api/consulta`: `dni` vacío y `check_in` en el pasado
- `/api/resena`: `name` vacío y `rating` en 0

El fuzzer muta **un campo por vez**. Aunque una mutación arregle uno de los dos
por casualidad, el otro sigue haciendo fallar la validación antes de llegar al
`insert`. Los dos campos están en puntos distintos del `validar()`, así que
siempre corta alguno.

Para los endpoints de pago no hace falta el truco: usan un `ref` que no existe,
y `buscarReserva()` corta antes de que se llame a MercadoPago o se mande un mail.

### Por qué rota el `X-Forwarded-For`

`/api/consulta` corta a las 5 por IP por hora. Sin rotar la IP, el fuzzing se
terminaría en el sexto pedido. Cada pedido va con un `X-Forwarded-For` distinto
para que el tope no tape el resto de las pruebas. **El tope en sí lo verifica el
bot 6**, que justamente no rota.

### Una cosa que no se puede probar desde acá

El `fetch` de Node (undici) se niega a mandar `TRACE`, así que ese método no
está en la lista. Si te importa, lo cubre ZAP.

---

## Bot 6 · Rate limiting

```
6-rate-limit.bat
```

Ráfaga de 12 pedidos seguidos contra cada endpoint sensible, y reporta en cuál
saltó el freno.

| Endpoint | Tope en el código | Dónde |
| --- | --- | --- |
| `POST /api/consulta` | 5 por IP por hora | `apps/sitio/api/_lib/limite.js` |
| `POST /api/resena` | 3 por IP por hora | `apps/sitio/api/_lib/limite.js` |
| `POST /api/login` | 8 intentos fallidos en 10 min | `apps/dashboard/api/_lib/sesion.js` |
| `POST /api/pagos` | — | sin tope propio |
| `POST /api/comprobante` | — | sin tope propio |
| `GET /api/reserva` | — | sin tope propio |

Los tres primeros tienen que frenar; si no frenan, **exit 1**. Los otros tres
se reportan como aviso: es el hueco que ya está anotado en `docs/SEGURIDAD.md`,
parte B ("nadie limita los endpoints que mandan mails"). El bot lo mide en vez
de darlo por sabido.

También busca CAPTCHA en las respuestas. Hoy no hay: el freno es solo por cupo.

**Cada endpoint usa una IP simulada distinta, nueva en cada corrida.** Así el
cupo arranca limpio y no te bloqueás tu propia IP por una hora cada vez que
corrés el bot. Los payloads son inválidos porque el cupo se descuenta *antes*
de validar: se mide el freno sin insertar una sola fila.

Dos cosas a tener en cuenta:

- Los contadores viven **en memoria del proceso**. Si reiniciaste el dev server,
  arrancan de cero.
- Por eso mismo, en Vercel el tope es **por instancia de lambda**, no global.
  Con varias instancias calientes, el límite real es más alto que el del código.
  El tope global (20 consultas/hora contando filas en Supabase) es el que sí
  aplica de verdad en producción.

Reporte en `reportes/rate-limit-<fecha>.json`, con el status de cada intento.

---

## Limpiar los datos de prueba

Solo hace falta si corriste algo con `PERMITIR_ESCRITURA=1`. Todo lo que
generan los bots lleva el prefijo `TEST-BOT` en el nombre.

En el SQL editor de Supabase:

```sql
select id, nombre, email, check_in, check_out, created_at
from booking_requests
where nombre like 'TEST-BOT%';

select id, name, rating, created_at
from reviews
where name like 'TEST-BOT%';
```

Revisá qué sale, y recién ahí borrá:

```sql
delete from booking_requests where nombre like 'TEST-BOT%';
delete from reviews where name like 'TEST-BOT%';
```

Las reseñas nacen con `approved = false`, así que nunca se ven en el sitio
aunque te olvides de borrarlas.

---

## Estructura

```
testing-bots/
├── config.json              parámetros, sin secretos, versionado
├── .env.example             plantilla; el .env real no se commitea
├── package.json
├── playwright.config.mjs
├── lib/
│   ├── config.mjs           lee config.json + .env, valida las URLs
│   ├── guardia.mjs          el candado contra producción
│   ├── preflight.mjs        avisa qué dev server falta antes de arrancar
│   ├── registro.mjs         log con timestamp a consola y archivo
│   ├── http.mjs             fetch con timeout y medición
│   └── datos.mjs            payloads válidos y los de modo seco
├── bots/
│   ├── 1-funcional.spec.mjs
│   ├── 2-monitoreo.mjs
│   ├── 3-carga.js           script de k6
│   ├── 3-carga-lanzar.mjs   valida y lanza k6
│   ├── 4-vulnerabilidades.mjs
│   ├── 5-fuzzing.mjs
│   └── 6-rate-limit.mjs
├── logs/                    ignorado por git
├── reportes/                ignorado por git
└── *.bat                    uno por bot
```

## Exit codes

| Código | Qué significa |
| --- | --- |
| 0 | todo bien |
| 1 | algo falló, o el bot abortó por apuntar fuera de localhost |
| 99 | solo el bot de carga: la app respondió, pero se pasó de un umbral |
