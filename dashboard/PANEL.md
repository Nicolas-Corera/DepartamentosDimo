# Panel de administración

Tres pestañas: **Tarifas**, **Alquileres** y **Reseñas**. Vive en su propio
proyecto de Vercel (`dash.departamentosdimo.com.ar`), con su propio `api/` y sus
propias variables de entorno.

---

## 0. Estado

### Funcionando

| | |
| --- | --- |
| Acceso con código de 6 dígitos + cookie de sesión firmada | ✅ |
| Tarifas: temporadas, medios de pago, cuotas y fechas especiales | ✅ |
| Aviso de fechas sin temporada asignada | ✅ |
| Calculadora de precios con los valores en pantalla | ✅ |
| Alquileres: listado, totales y reporte en PDF | ✅ |
| Cancelación de reserva con devolución total o parcial en MercadoPago | ✅ |
| Reseñas: aprobar y eliminar | ✅ |

### Falta

- Avisos por mail con Resend cuando entra una reseña nueva.

---

## 1. El acceso

### Cómo funciona

`login_panel.html` pide seis dígitos y los manda a `POST /api/login`. El
servidor los compara contra `PANEL_CODIGO` **en tiempo constante** y, si dan,
devuelve una cookie firmada:

```
panel_sesion = <payload en base64url>.<HMAC-SHA256 del payload>
```

El payload solo lleva cuándo vence (12 horas). No hay usuarios ni roles que
guardar: o tenés el código o no lo tenés. La firma con `PANEL_SESION_SECRET` es
lo que impide fabricar la cookie a mano.

La cookie va **HttpOnly** (el JavaScript de la página no la puede leer, así que
un XSS no se la lleva), **Secure** (no viaja por HTTP) y **SameSite=Strict** (no
se manda en pedidos que nacen en otro sitio — eso es lo que frena el CSRF: sin
eso, cualquier página podría hacerle POST al endpoint de devolución con tu cookie
puesta).

### Por qué la comprobación es del lado del servidor

La tentación obvia es comparar el código en el JavaScript del login y, si da,
mostrar el panel. **Eso no protege nada**: el código quedaría escrito en un
archivo que cualquiera descarga, y aunque no estuviera, el panel se abre igual
salteando el `if` desde la consola.

Lo que hay que proteger no es la pantalla: son los **endpoints**. Del otro lado
hay datos personales de los huéspedes, la lista de pagos y un botón que mueve
plata de verdad. Por eso cada endpoint llama a `exigirSesion(req)` antes de hacer
nada, y sin cookie válida responde **401**.

### Freno a la fuerza bruta

Seis dígitos es un millón de combinaciones: a mil intentos por segundo se prueba
entero en veinte minutos. Hay dos frenos:

- **8 intentos fallidos por IP cada 10 minutos** → 429.
- **Media segundo de demora fija** en cada intento fallido.

El contador es en memoria, así que en serverless cada instancia lleva la suya y
un atacante con suerte cae en instancias distintas. Aun así sube el costo del
ataque un par de órdenes de magnitud, y la alternativa seria (una tabla en
Supabase, con su latencia en cada intento) no la vale para un panel de una sola
persona. Si algún día hace falta más, el lugar es `api/_lib/sesion.js`.

---

## 2. Variables de entorno

En Vercel → proyecto del dashboard (*Root Directory* = `dashboard`) → Settings →
Environment Variables. **No las hereda del proyecto del checkout.**

| Variable | Qué es |
| --- | --- |
| `PANEL_CODIGO` | Los 6 dígitos del login. |
| `PANEL_SESION_SECRET` | Con qué se firma la cookie. Mínimo 32 caracteres, al azar. |
| `SUPABASE_URL` | La misma que el checkout. |
| `SUPABASE_SERVICE_ROLE_KEY` | La **service_role**, no la anon. |
| `MP_ACCESS_TOKEN` | El mismo del checkout. Solo para las devoluciones. |

Para generar el secreto:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Verificar que la configuración cierra, sin imprimir ninguna credencial:

```bash
cd dashboard
npm run env:check
```

> `MP_ACCESS_TOKEN` se lee **lazy**: si falta, el panel funciona igual y lo único
> que no se puede hacer es devolver plata. Exigirlo al arrancar haría que no se
> pudieran ni ver las tarifas por no poder hacer una devolución.

---

## 3. Tarifas

Un solo botón de *Guardar Cambios* para las cuatro tablas, porque la pantalla es
una sola. `PUT /api/tarifas` recibe todo junto, **valida todo antes de escribir
la primera fila** y devuelve el estado ya releído de la base.

No es atómico — PostgREST no da transacciones entre tablas — pero al validar
todo primero, un error de carga nunca deja las temporadas nuevas con los
recargos viejos.

### Las cuatro tablas

| Tabla | Qué guarda |
| --- | --- |
| `temporadas` | Tres filas fijas (alta / media / baja): rango de fechas + precio por noche. |
| `medios_pago` | Tres filas fijas: habilitado y recargo %. |
| `planes_cuotas` | 24 filas; las de arriba del máximo quedan deshabilitadas. |
| `tarifas_especiales` | Largo variable: se agregan y se borran desde el carrusel. |

El esquema completo está en
[`pago/sql/configuracion-tarifas.sql`](../pago/sql/configuracion-tarifas.sql).
Las cuatro tienen RLS activo **sin ninguna política**: el navegador no las toca
ni para leer. Las lee el backend del checkout y las escribe el del panel, los dos
con service_role.

### Fechas absolutas y el aviso de huecos

Los rangos de temporada llevan año (`2026-12-15` al `2027-01-31`), así que **no
se renuevan solos**. Cuando se termina el ciclo cargado, las noches que quedan
afuera se cobran al precio de temporada baja — el fallback — y eso pasa en
silencio.

Por eso arriba de todo hay un aviso que recorre los próximos 365 días y lista los
tramos sin cubrir. Es lo único que evita cobrar barato durante meses sin
enterarse.

### La calculadora

Usa los valores que están **en pantalla**, guardados o no. Es lo que permite
cambiar un precio, ver cuánto queda la estadía y recién después decidir si se
guarda.

Repite la lógica de [`pago/api/_lib/precios.js`](../pago/api/_lib/precios.js) del
lado del navegador. Está duplicada a propósito y no compartida: son dos proyectos
de Vercel separados, y lo del panel es una previsualización, no lo que se cobra.
Si algún día divergen, **el que manda es `precios.js`**.

---

## 4. Alquileres

### Qué entra en el listado

Un pago que **movió plata**: `approved`, `refunded` o `charged_back`. Los
rechazados no entran — son intentos fallidos, quedan en `payments` para
diagnóstico y no representan una reserva.

El orden (del más nuevo al más viejo) lo pone la base, no el navegador. Es lo que
garantiza que la web y el PDF muestren exactamente lo mismo: si ordenara cada uno
por su cuenta, dos criterios distintos darían dos listados distintos.

Puede aparecer una fila **sin datos de huésped**: es una notificación de
MercadoPago que no corresponde a ninguna reserva nuestra (una devolución hecha a
mano desde el panel de MP, por ejemplo). Se muestra igual, porque esconderla haría
que el total del reporte no cerrara con lo que dice MercadoPago.

### Cancelar y devolver

El botón abre un diálogo con tres opciones: devolver todo, devolver una parte
(reteniendo la seña, por ejemplo) o solo cancelar sin tocar la plata.

**Esto mueve plata de verdad y no se puede deshacer.** Una devolución en
MercadoPago no tiene botón de revertir. Por eso:

- **El monto máximo lo calcula el servidor** (cobrado − ya devuelto). Aunque el
  panel muestre otra cosa, `POST /api/cancelar` no deja devolver más de lo que
  entró.
- **Se devuelve primero y se escribe en la base después.** Al revés, si
  MercadoPago fallara quedaría una reserva marcada como devuelta con la plata
  todavía en la cuenta — el peor error posible, porque nadie lo nota hasta que el
  huésped reclama.
- **Si la devolución sale bien pero la base falla**, se responde OK igual, con un
  aviso en pantalla y un grito en el log. La plata ya salió: decir "falló"
  invitaría a devolver de nuevo.
- La clave de idempotencia lleva el monto adentro, así un doble clic sobre la
  misma devolución no devuelve dos veces, pero dos devoluciones parciales
  distintas sí pueden convivir.

La reserva pasa a `estado = 'cancelada'`. Como `fechas_ocupadas()` solo cuenta
las `confirmada`, **las noches se liberan solas** en el calendario del sitio.

### El reporte en PDF

Sale de lo que ya está en pantalla, con jsPDF + autotable en el navegador. Se
hace del lado del cliente porque los datos ya están cargados: generarlo en el
servidor sería volver a pedir todo, montar una función serverless con una
dependencia pesada y devolver un archivo — para producir la misma tabla que ya se
está viendo.

---

## 5. Reseñas

`reviews` tiene RLS: el sitio público solo puede **leer las aprobadas** e
**insertar con `approved = false`**. No hay política de UPDATE ni de DELETE, así
que moderar desde el navegador es imposible por diseño. El panel lo hace con
service_role, que saltea RLS.

- **Aprobar** pone `approved = true` y la publica en el sitio. El botón
  desaparece: una vez aprobada solo queda el de eliminar.
- **Eliminar** la borra de la base. Es definitivo y no hay papelera, así que
  pregunta antes.
- Las pendientes se listan primero, y arriba a la derecha aparece cuántas hay
  esperando.

El panel **no edita** el nombre, el puntaje ni el texto: son de quien los
escribió. Modera, no reescribe.

---

## 6. Los endpoints

Todos en `dashboard/api/`. Todos exigen la cookie salvo `login`.

| Endpoint | Qué hace |
| --- | --- |
| `POST /api/login` | Verifica el código y abre la sesión. |
| `GET/DELETE /api/sesion` | Consulta si la cookie vale / la cierra. |
| `GET/PUT /api/tarifas` | Lee y guarda las cuatro tablas de tarifas. |
| `GET /api/alquileres` | Pagos con plata movida + datos de la reserva. |
| `POST /api/cancelar` | Cancela la reserva y (si se pide) devuelve. |
| `GET/PATCH/DELETE /api/resenas` | Lista, aprueba y elimina reseñas. |

### Sin dependencias

`dashboard/package.json` no tiene ninguna. Supabase se consulta por PostgREST con
`fetch` (`api/_lib/supabase.js`, unas 40 líneas) y MercadoPago igual. El SDK
`@supabase/supabase-js` entero, con sus dependencias de realtime y storage que acá
no se usan, es lo único que obligaría a este proyecto a tener `node_modules`.

---

## 7. Desarrollo local

```bash
cd dashboard
cp .env.example .env       # y completar
npm run env:check          # valida sin imprimir credenciales
npm run dev                # http://localhost:3100/login_panel.html
```

`scripts/dev-server.mjs` sirve los archivos estáticos y ejecuta las funciones de
`api/` igual que lo haría Vercel (query, body, `res.status()`, ruteo
`/api/<archivo>`). **Solo para desarrollo**: en producción quien ejecuta los
handlers es Vercel y este archivo no interviene.

En local la cookie sale **sin `Secure`**, porque no hay HTTPS y el navegador no la
guardaría. En Vercel siempre lleva `Secure`.

---

## 8. Problemas frecuentes

| Síntoma | Causa probable |
| --- | --- |
| Todo responde 401 y vuelve al login | La cookie venció (12 h) o cambió `PANEL_SESION_SECRET`. |
| "El panel no está configurado correctamente" | Falta una variable en Vercel. Correr `npm run env:check` en local con el mismo `.env`. |
| El botón de cancelar dice que MercadoPago rechazó | El pago es muy viejo, ya tenía contracargo, o el `MP_ACCESS_TOKEN` es de otro ambiente que el pago. |
| Guardo tarifas y el checkout sigue mostrando lo viejo | El navegador del checkout tiene la respuesta anterior en pantalla: recargar. El backend no cachea la config. |
| El PDF no se descarga | Los scripts de jsPDF vienen de cdnjs: sin internet no cargan. El toast lo dice. |
| Aparece el aviso de "fechas sin temporada" | Los rangos llevan año y se venció el ciclo. Corregir las fechas de las tres temporadas. |

---

## 9. Archivos

```
dashboard/
├── login_panel.html        el código de acceso
├── index.html              el panel (tres pestañas)
├── scripts.js              toda la lógica del panel
├── styles.css              estilos
├── package.json            sin dependencias
├── vercel.json             config del proyecto (Root Directory = dashboard)
├── .env.example            plantilla — el .env real no se commitea
├── PANEL.md                este archivo
├── scripts/
│   └── dev-server.mjs      servidor local (no se despliega)
└── api/
    ├── login.js            POST   — verifica el código, abre sesión
    ├── sesion.js           GET/DELETE — estado de la sesión
    ├── tarifas.js          GET/PUT — las cuatro tablas de tarifas
    ├── alquileres.js       GET    — pagos + reservas
    ├── cancelar.js         POST   — cancelación y devolución
    ├── resenas.js          GET/PATCH/DELETE — moderación
    └── _lib/
        ├── env.js          variables de entorno
        ├── http.js         respuestas JSON, validadores y errores
        ├── sesion.js       código, cookie firmada y freno a la fuerza bruta
        ├── supabase.js     PostgREST con fetch, sin SDK
        └── mercadopago.js  devoluciones
```
