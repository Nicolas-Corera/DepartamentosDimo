/**
 * dashboard/scripts.js
 * ---------------------------------------------------------------------------
 * El panel de administración.
 *
 * Tres pestañas, tres orígenes de datos, todos detrás de la cookie de sesión:
 *
 *   TARIFAS      GET/PUT /api/tarifas    temporadas, medios de pago, cuotas y
 *                                        fechas especiales. Un solo guardado.
 *   ALQUILERES   GET     /api/alquileres las reservas pagas
 *                POST    /api/cancelar   cancelar y (si se pide) devolver
 *   RESEÑAS      GET/PATCH/DELETE /api/resenas
 *
 * Nada de esto se valida solo en el navegador: cada endpoint revalida todo del
 * lado del servidor. Lo de acá es para que la pantalla sea usable, no para que
 * sea segura.
 */

/* ===========================================================================
   Utilidades
   =========================================================================== */

const $ = (id) => document.getElementById(id);

// Un decimal fijo y coma como separador: "4,3". Fijo y no "el mínimo
// necesario" para que el número del chip no cambie de ancho entre recargas.
const puntajes = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const pesos = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

const UN_DIA = 24 * 60 * 60 * 1000;

/** "2027-01-15" -> ms UTC. Sin `new Date(iso)`, que resta un día por zona horaria. */
function aUTC(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
}

function aISO(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** "2027-01-15" -> "15/01/2027". Vacío si no es una fecha. */
function fechaCorta(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

/** Un timestamptz -> "15/01/2027 14:32". */
function fechaHora(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 15 -> "15", 7.5 -> "7,5". */
function pct(n) {
  const num = Number(n) || 0;
  return Number.isInteger(num) ? String(num) : String(num).replace(".", ",");
}

/** Hoy, en la zona local, como ISO. Para comparar contra rangos de fechas. */
function hoyISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ---------------------------------------------------------------------------
   Avisos
   --------------------------------------------------------------------------- */

const TOAST_MS = { exito: 3000, error: 6000 };

function mostrarToast(mensaje, tipo = "exito") {
  const pila = $("toastStack");
  if (!pila) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${tipo}`;
  // Los errores interrumpen al lector de pantalla; los avisos de éxito no.
  toast.setAttribute("role", tipo === "error" ? "alert" : "status");

  const icono = tipo === "error" ? "#ic-alert" : "#ic-check";
  toast.innerHTML = `<svg class="ic-sm" aria-hidden="true"><use href="${icono}"/></svg><span></span>`;
  // textContent y no innerHTML: el mensaje puede venir de un error de la base y
  // no tiene por qué terminar interpretado como HTML.
  toast.querySelector("span").textContent = mensaje;

  let cerrando = false;
  const cerrar = () => {
    if (cerrando) return;
    cerrando = true;
    clearTimeout(reloj);
    toast.classList.add("toast-saliendo");
    toast.addEventListener("animationend", () => toast.remove());
    // Red de seguridad: con animaciones desactivadas (reduced motion)
    // animationend no llega nunca y el toast se quedaría pegado.
    setTimeout(() => toast.remove(), 400);
  };

  toast.addEventListener("click", cerrar);
  const reloj = setTimeout(cerrar, TOAST_MS[tipo] || TOAST_MS.exito);

  pila.appendChild(toast);
}

/* ---------------------------------------------------------------------------
   Llamadas a la API
   --------------------------------------------------------------------------- */

/**
 * Un 401 significa que la cookie venció: se manda al login en vez de mostrar
 * un error que no se puede resolver desde acá. El `?volver=` es para no perder
 * la pestaña en la que estaba.
 */
async function api(ruta, opciones = {}) {
  const respuesta = await fetch(`/api${ruta}`, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    ...opciones,
  });

  if (respuesta.status === 401) {
    window.location.href = "/login_panel.html";
    throw new Error("sesión vencida");
  }

  const cuerpo = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw new Error(cuerpo.error || `Error ${respuesta.status}`);
  }
  return cuerpo;
}

/* ===========================================================================
   Estado
   =========================================================================== */

const estado = {
  tarifas: null,     // lo último que devolvió GET /api/tarifas
  alquileres: [],
  totales: null,
  resenas: [],
  cancelando: null,  // el alquiler que está abierto en el modal de cancelación
  comprobante: null, // la transferencia abierta en el visor de comprobante
};

/* ===========================================================================
   1. TARIFAS
   =========================================================================== */

async function cargarTarifas() {
  try {
    estado.tarifas = await api("/tarifas");
    pintarTarifas();
    $("tarifas-cargando").hidden = true;
    $("tarifas-form").hidden = false;
  } catch (error) {
    $("tarifas-cargando").textContent = `No se pudo cargar la configuración: ${error.message}`;
    mostrarToast(error.message, "error");
  }
}

function pintarTarifas() {
  const { temporadas, medios, maxCuotas, planes, especiales } = estado.tarifas;

  for (const t of temporadas) {
    $(`${t.clave}-desde`).value = t.desde;
    $(`${t.clave}-hasta`).value = t.hasta;
    $(`${t.clave}-precio`).value = t.precio;
  }

  pintarMedios(medios);
  $("max-cuotas").value = maxCuotas;
  pintarCuotas(maxCuotas, planes);
  pintarEspeciales(especiales);

  actualizarTarifaDeHoy();
  revisarHuecos();
  prepararCalculadora();
}

/* --- Medios de pago -------------------------------------------------------- */

function pintarMedios(medios) {
  const grid = $("medios-grid");

  grid.replaceChildren(
    ...medios.map((m) => {
      const fila = document.createElement("div");
      fila.className = "medio-fila";
      fila.dataset.medio = m.clave;
      fila.dataset.habilitado = String(m.habilitado);

      const izq = document.createElement("div");
      const nombre = document.createElement("span");
      nombre.className = "medio-nombre";
      nombre.textContent = m.nombre;
      const detalle = document.createElement("span");
      detalle.className = "medio-detalle";
      detalle.textContent =
        m.clave === "transferencia"
          ? "Es la base del precio. Un recargo acá sube todo lo demás."
          : m.clave === "credito"
            ? "Se le suma además el recargo del plan de cuotas."
            : "Siempre en un solo pago.";
      izq.append(nombre, detalle);

      const der = document.createElement("div");
      der.className = "medio-controles";

      const interruptor = document.createElement("label");
      interruptor.className = "interruptor";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "medio-habilitado";
      check.checked = m.habilitado;
      check.addEventListener("change", () => {
        fila.dataset.habilitado = String(check.checked);
        recalcularCalculadora();
      });
      const textoInterruptor = document.createElement("span");
      textoInterruptor.textContent = "Habilitado";
      interruptor.append(check, textoInterruptor);

      const recargo = document.createElement("input");
      recargo.type = "number";
      recargo.className = "medio-recargo";
      recargo.min = "0";
      recargo.max = "100";
      recargo.step = "0.5";
      recargo.value = m.recargoPorcentaje;
      recargo.setAttribute("aria-label", `Recargo de ${m.nombre} en porcentaje`);
      recargo.addEventListener("input", recalcularCalculadora);

      const sufijo = document.createElement("span");
      sufijo.className = "sufijo-porcentaje";
      sufijo.textContent = "% de recargo";

      der.append(interruptor, recargo, sufijo);
      fila.append(izq, der);
      return fila;
    }),
  );
}

function leerMedios() {
  return [...document.querySelectorAll(".medio-fila")].map((fila) => ({
    clave: fila.dataset.medio,
    habilitado: fila.querySelector(".medio-habilitado").checked,
    recargoPorcentaje: Number(fila.querySelector(".medio-recargo").value || 0),
  }));
}

/* --- Cuotas ---------------------------------------------------------------- */

/**
 * Una fila por cuota, de 1 hasta el máximo. Cambiar el máximo redibuja la
 * grilla conservando los porcentajes que ya estaban cargados: bajar de 6 a 3 y
 * volver a subir no debería borrar lo que habías escrito en 4, 5 y 6.
 */
function pintarCuotas(maxCuotas, planes) {
  const grid = $("cuotas-grid");
  const porCuota = new Map((planes || []).map((p) => [p.cuotas, p.recargoPorcentaje]));

  // Lo que ya esté escrito en pantalla gana sobre lo que vino de la base: es lo
  // que la persona acaba de tipear y todavía no guardó.
  for (const entrada of grid.querySelectorAll(".cuota-recargo")) {
    porCuota.set(Number(entrada.dataset.cuotas), Number(entrada.value || 0));
  }

  const filas = [];
  for (let n = 1; n <= maxCuotas; n++) {
    const fila = document.createElement("div");
    fila.className = "cuota-fila";

    const etiqueta = document.createElement("label");
    etiqueta.className = "cuota-etiqueta";
    etiqueta.textContent = n === 1 ? "1 pago" : `${n} cuotas`;
    etiqueta.htmlFor = `cuota-${n}`;

    const caja = document.createElement("div");
    caja.className = "cuota-entrada";

    const entrada = document.createElement("input");
    entrada.type = "number";
    entrada.id = `cuota-${n}`;
    entrada.className = "cuota-recargo";
    entrada.dataset.cuotas = String(n);
    entrada.min = "0";
    entrada.max = "100";
    entrada.step = "0.5";
    entrada.value = porCuota.get(n) ?? 0;
    entrada.addEventListener("input", recalcularCalculadora);

    const sufijo = document.createElement("span");
    sufijo.className = "sufijo-porcentaje";
    sufijo.textContent = "%";

    caja.append(entrada, sufijo);
    fila.append(etiqueta, caja);
    filas.push(fila);
  }

  grid.replaceChildren(...filas);
}

function leerPlanes() {
  return [...document.querySelectorAll(".cuota-recargo")].map((e) => ({
    cuotas: Number(e.dataset.cuotas),
    recargoPorcentaje: Number(e.value || 0),
  }));
}

/* --- Fechas especiales ----------------------------------------------------- */

function crearTarjetaEspecial(datos = {}) {
  const tarjeta = document.createElement("div");
  tarjeta.className = "carousel-card special-date-card";
  // El id de la base viaja en el DOM: es lo que permite que guardar actualice
  // la fila existente en vez de crear una nueva cada vez.
  if (datos.id) tarjeta.dataset.id = String(datos.id);

  tarjeta.innerHTML = `
    <div class="input-row">
      <div>
        <label class="label-md">Desde</label>
        <input class="date-desde" required type="date" />
      </div>
      <div>
        <label class="label-md">Hasta</label>
        <input class="date-hasta" required type="date" />
      </div>
    </div>
    <div class="input-group">
      <label class="label-md">Motivo</label>
      <input class="motivo-especial" maxlength="80" placeholder="Ej: Semana Santa" required type="text" />
    </div>
    <div class="input-group" style="margin-bottom: 0">
      <label class="label-md">Precio por noche ($)</label>
      <div class="price-input-wrapper">
        <input class="precio-especial" min="1" placeholder="Ej: 90000" required type="number" />
        <button class="btn-delete delete-special-date-btn" type="button" title="Eliminar">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>
    </div>
  `;

  tarjeta.querySelector(".date-desde").value = datos.desde || "";
  tarjeta.querySelector(".date-hasta").value = datos.hasta || "";
  tarjeta.querySelector(".motivo-especial").value = datos.motivo || "";
  tarjeta.querySelector(".precio-especial").value = datos.precio ?? "";

  engancharValidacionDeFechas(tarjeta);
  tarjeta.addEventListener("input", recalcularCalculadora);
  return tarjeta;
}

function pintarEspeciales(especiales) {
  const carrusel = document.querySelector(".special-dates-carousel");
  carrusel.replaceChildren(...especiales.map(crearTarjetaEspecial));
  actualizarPuntos();
  $("especiales-vacio").hidden = especiales.length > 0;
}

function leerEspeciales() {
  return [...document.querySelectorAll(".special-date-card")].map((t) => ({
    id: t.dataset.id ? Number(t.dataset.id) : null,
    desde: t.querySelector(".date-desde").value,
    hasta: t.querySelector(".date-hasta").value,
    motivo: t.querySelector(".motivo-especial").value.trim(),
    precio: Number(t.querySelector(".precio-especial").value || 0),
  }));
}

function agregarEspecial() {
  const carrusel = document.querySelector(".special-dates-carousel");
  const tarjeta = crearTarjetaEspecial();
  carrusel.appendChild(tarjeta);
  $("especiales-vacio").hidden = true;
  actualizarPuntos();

  // Solo opacidad, sin `x`. Un transform sobre una tarjeta que vive DENTRO del
  // contenedor con scroll-snap le mueve la geometría al scroller mientras dura
  // la animación, y el navegador vuelve a snapear en el medio del scroll que
  // acabamos de pedir.
  gsap.fromTo(tarjeta, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power2.out" });

  // Primero el scroll, y el foco SIN scroll automático: si se le deja hacer el
  // suyo, el navegador acomoda el input con el mínimo desplazamiento posible y
  // pisa el scrollTo de arriba — que es lo que dejaba el carrusel frenado entre
  // dos tarjetas.
  setTimeout(() => {
    irATarjeta(tarjeta);
    tarjeta.querySelector(".date-desde").focus({ preventScroll: true });
  }, 60);
}

/**
 * El paso real del carrusel.
 *
 * NO es `carrusel.offsetWidth`: el contenedor es un flex con `gap: 16px`, así
 * que entre el borde de una tarjeta y el de la siguiente hay ancho + gap. Usar
 * el ancho pelado acumula 16px de error por tarjeta, y a partir de la tercera o
 * cuarta el carrusel queda parado en el medio de dos.
 */
function pasoDelCarrusel(carrusel) {
  const tarjetas = carrusel.querySelectorAll(".special-date-card");
  if (tarjetas.length > 1) return tarjetas[1].offsetLeft - tarjetas[0].offsetLeft;
  return carrusel.offsetWidth;
}

/**
 * Deja una tarjeta encuadrada, sin restos de la anterior.
 *
 * Se mide con getBoundingClientRect y no con `indice * paso`: los anchos reales
 * son fraccionarios (418,33px y no 418), así que multiplicar un paso entero por
 * el índice acumula el redondeo y deja el carrusel un pixel corrido en cada
 * tarjeta. Restar rectángulos da la posición exacta de ESTA tarjeta, sin
 * arrastrar el error de las anteriores.
 */
function irATarjeta(tarjeta, comportamiento = "smooth") {
  const carrusel = tarjeta.parentElement;
  if (!carrusel) return;
  const izquierda =
    tarjeta.getBoundingClientRect().left -
    carrusel.getBoundingClientRect().left +
    carrusel.scrollLeft;
  carrusel.scrollTo({ left: izquierda, behavior: comportamiento });
}

function eliminarEspecial(tarjeta) {
  gsap.to(tarjeta, {
    opacity: 0,
    duration: 0.25,
    ease: "power2.out",
    onComplete: () => {
      tarjeta.remove();
      actualizarPuntos();
      $("especiales-vacio").hidden =
        document.querySelectorAll(".special-date-card").length > 0;
      recalcularCalculadora();
    },
  });
}

/* --- Puntos del carrusel --------------------------------------------------- */

function actualizarPuntos() {
  const carrusel = document.querySelector(".special-dates-carousel");
  const contenedor = document.querySelector(".carousel-dots");
  if (!carrusel || !contenedor) return;

  const tarjetas = [...carrusel.querySelectorAll(".special-date-card")];
  contenedor.replaceChildren(
    ...tarjetas.map((tarjeta, i) => {
      const punto = document.createElement("div");
      punto.className = "dot";
      if (i === 0) punto.classList.add("active");
      // En escritorio no hay swipe: el punto navega con un clic. En mobile el
      // swipe sigue funcionando igual y el clic no molesta.
      punto.addEventListener("click", () => irATarjeta(tarjeta));
      return punto;
    }),
  );
  marcarPuntoActivo();
}

function marcarPuntoActivo() {
  const carrusel = document.querySelector(".special-dates-carousel");
  const puntos = document.querySelectorAll(".carousel-dots .dot");
  if (!carrusel || !puntos.length) return;

  let i = Math.round(carrusel.scrollLeft / pasoDelCarrusel(carrusel));
  if (i >= puntos.length) i = puntos.length - 1;
  puntos.forEach((p, j) => p.classList.toggle("active", j === i));
}

/* --- Validación de rangos -------------------------------------------------- */

function validarRango(desde, hasta) {
  const contenedor = hasta.parentElement;
  let error = contenedor.querySelector(".error-msg");

  const mal = desde.value && hasta.value && hasta.value < desde.value;

  if (mal) {
    hasta.setCustomValidity('La fecha "Hasta" no puede ser anterior a "Desde".');
    hasta.classList.add("input-error");
    if (!error) {
      error = document.createElement("span");
      error.className = "error-msg";
      error.textContent = 'No puede ser anterior a "Desde"';
      contenedor.appendChild(error);
    }
  } else {
    hasta.setCustomValidity("");
    hasta.classList.remove("input-error");
    error?.remove();
  }
  return !mal;
}

function engancharValidacionDeFechas(raiz) {
  for (const fila of raiz.querySelectorAll(".input-row")) {
    const desde = fila.querySelector(".date-desde");
    const hasta = fila.querySelector(".date-hasta");
    if (!desde || !hasta) continue;
    const revisar = () => {
      validarRango(desde, hasta);
      recalcularCalculadora();
    };
    desde.addEventListener("change", revisar);
    hasta.addEventListener("change", revisar);
  }
}

/* --- Lo que está en pantalla, como si fuera la configuración ---------------- */

/**
 * Lee el formulario entero y lo devuelve con la misma forma que /api/tarifas.
 *
 * Es lo que le permite a la calculadora trabajar con los valores SIN GUARDAR:
 * cambiás un precio, ves cuánto queda, y recién después decidís si lo guardás.
 */
function configEnPantalla() {
  return {
    temporadas: ["alta", "media", "baja"].map((clave) => ({
      clave,
      nombre: estado.tarifas?.temporadas.find((t) => t.clave === clave)?.nombre || clave,
      desde: $(`${clave}-desde`).value,
      hasta: $(`${clave}-hasta`).value,
      precio: Number($(`${clave}-precio`).value || 0),
    })),
    medios: leerMedios(),
    maxCuotas: Number($("max-cuotas").value || 1),
    planes: leerPlanes(),
    especiales: leerEspeciales(),
  };
}

/* --- Tarifa de hoy y huecos ------------------------------------------------ */

/**
 * El mismo criterio que usa el backend en precios.js: primero la tarifa
 * especial, después la temporada que contenga la fecha (si se solapan, la más
 * cara), y si no la cubre ninguna, el precio de la baja.
 *
 * Está duplicado a propósito y no compartido: son dos proyectos separados y lo
 * de acá es una previsualización, no lo que se cobra. Si algún día divergen, el
 * que manda es precios.js — la calculadora avisa el precio, el backend lo cobra.
 */
function precioDeLaNoche(iso, config) {
  const especial = config.especiales
    .filter((e) => e.desde && e.hasta && iso >= e.desde && iso <= e.hasta && e.precio > 0)
    .sort((a, b) => b.precio - a.precio)[0];

  if (especial) {
    return { precio: especial.precio, etiqueta: especial.motivo || "Fecha especial", especial: true };
  }

  const temporada = config.temporadas
    .filter((t) => t.desde && t.hasta && iso >= t.desde && iso <= t.hasta && t.precio > 0)
    .sort((a, b) => b.precio - a.precio)[0];

  if (temporada) return { precio: temporada.precio, etiqueta: temporada.nombre, especial: false };

  const baja = config.temporadas.find((t) => t.clave === "baja");
  return {
    precio: baja?.precio || 0,
    etiqueta: "Sin temporada (precio de baja)",
    especial: false,
    fallback: true,
  };
}

function actualizarTarifaDeHoy() {
  const config = configEnPantalla();
  const hoy = precioDeLaNoche(hoyISO(), config);
  $("tarifa-hoy-precio").textContent = `${pesos.format(hoy.precio)} / noche`;
  $("tarifa-hoy-nota").textContent = `(${hoy.etiqueta})`;
}

/**
 * Los tramos del calendario que no cubre ninguna temporada, mirando desde hoy
 * hasta un año adelante. Es lo único que hace visible el efecto secundario de
 * usar rangos con año: cuando se termina el ciclo cargado, esas noches pasan a
 * cobrarse al precio de temporada baja sin que nadie se entere.
 */
function revisarHuecos() {
  const config = configEnPantalla();
  const rangos = config.temporadas
    .filter((t) => t.desde && t.hasta)
    .map((t) => ({ desde: aUTC(t.desde), hasta: aUTC(t.hasta) }));

  const inicio = aUTC(hoyISO());
  const fin = inicio + 365 * UN_DIA;

  const huecos = [];
  let abierto = null;

  for (let ms = inicio; ms <= fin; ms += UN_DIA) {
    const cubierto = rangos.some((r) => ms >= r.desde && ms <= r.hasta);
    if (!cubierto && !abierto) abierto = ms;
    if (cubierto && abierto) {
      huecos.push([abierto, ms - UN_DIA]);
      abierto = null;
    }
  }
  if (abierto) huecos.push([abierto, fin]);

  const aviso = $("aviso-huecos");
  if (!huecos.length) {
    aviso.hidden = true;
    return;
  }

  const baja = config.temporadas.find((t) => t.clave === "baja");
  const texto = huecos
    .slice(0, 3)
    .map(([a, b]) => (a === b ? fechaCorta(aISO(a)) : `${fechaCorta(aISO(a))} al ${fechaCorta(aISO(b))}`))
    .join(" · ");

  $("aviso-huecos-detalle").textContent =
    `${texto}${huecos.length > 3 ? ` (y ${huecos.length - 3} tramo${huecos.length - 3 === 1 ? "" : "s"} más)` : ""}. ` +
    `Esas noches se cobran a ${pesos.format(baja?.precio || 0)}, el precio de temporada baja. ` +
    "Corré las fechas de las temporadas para cubrirlas.";
  aviso.hidden = false;
}

/* --- Calculadora ----------------------------------------------------------- */

function prepararCalculadora() {
  const config = configEnPantalla();

  const medio = $("calc-medio");
  const elegido = medio.value;
  medio.replaceChildren(
    ...config.medios
      .filter((m) => m.habilitado)
      .map((m) => {
        const o = document.createElement("option");
        o.value = m.clave;
        o.textContent = estado.tarifas?.medios.find((x) => x.clave === m.clave)?.nombre || m.clave;
        return o;
      }),
  );
  if (elegido && [...medio.options].some((o) => o.value === elegido)) medio.value = elegido;

  actualizarSelectorDeCuotasCalc();
  recalcularCalculadora();
}

/** Solo el crédito ofrece cuotas; el resto queda en un pago. */
function actualizarSelectorDeCuotasCalc() {
  const selector = $("calc-cuotas");
  const esCredito = $("calc-medio").value === "credito";
  const max = esCredito ? Number($("max-cuotas").value || 1) : 1;
  const elegido = Number(selector.value || 1);

  const opciones = [];
  for (let n = 1; n <= max; n++) {
    const o = document.createElement("option");
    o.value = String(n);
    o.textContent = n === 1 ? "1 pago" : `${n} cuotas`;
    opciones.push(o);
  }
  selector.replaceChildren(...opciones);
  selector.value = String(elegido <= max ? elegido : 1);
  selector.disabled = !esCredito;
}

function recalcularCalculadora() {
  // El aviso de huecos y la tarifa de hoy dependen de lo mismo que la
  // calculadora, así que se recalculan juntos con cada tecla.
  actualizarTarifaDeHoy();
  revisarHuecos();

  const salida = $("calc-resultado");
  const checkIn = $("calc-checkin").value;
  const checkOut = $("calc-checkout").value;

  if (!checkIn || !checkOut) {
    salida.replaceChildren(crearVacio("Elegí las fechas para ver el cálculo."));
    return;
  }
  if (checkOut <= checkIn) {
    salida.replaceChildren(crearVacio("El check-out tiene que ser posterior al check-in."));
    return;
  }

  const config = configEnPantalla();
  const cantidad = Math.round((aUTC(checkOut) - aUTC(checkIn)) / UN_DIA);

  if (cantidad > 365) {
    salida.replaceChildren(crearVacio("Son más de 365 noches: revisá las fechas."));
    return;
  }

  // Una "noche" es la fecha en la que se duerme: del 10 al 14 son las noches
  // del 10, 11, 12 y 13. La del 14 no se cobra porque esa mañana se van.
  const noches = [];
  for (let i = 0; i < cantidad; i++) {
    const iso = aISO(aUTC(checkIn) + i * UN_DIA);
    noches.push({ iso, ...precioDeLaNoche(iso, config) });
  }

  const base = noches.reduce((s, n) => s + n.precio, 0);
  const claveMedio = $("calc-medio").value;
  const cuotas = Number($("calc-cuotas").value || 1);

  const medio = config.medios.find((m) => m.clave === claveMedio);
  const plan = claveMedio === "credito" ? config.planes.find((p) => p.cuotas === cuotas) : null;

  const recargoMedio = Number(medio?.recargoPorcentaje || 0);
  const recargoCuotas = Number(plan?.recargoPorcentaje || 0);
  const recargoTotal = recargoMedio + recargoCuotas;

  const total = Math.round(base * (1 + recargoTotal / 100));
  const conFallback = noches.filter((n) => n.fallback).length;

  const lineas = [
    linea(`${cantidad} ${cantidad === 1 ? "noche" : "noches"}`, pesos.format(base)),
  ];

  if (recargoMedio > 0) {
    const nombre = estado.tarifas?.medios.find((m) => m.clave === claveMedio)?.nombre || claveMedio;
    lineas.push(linea(`Recargo ${nombre} (+${pct(recargoMedio)}%)`, pesos.format(Math.round(base * recargoMedio / 100))));
  }
  if (recargoCuotas > 0) {
    lineas.push(linea(`Recargo ${cuotas} cuotas (+${pct(recargoCuotas)}%)`, pesos.format(Math.round(base * recargoCuotas / 100))));
  }
  if (conFallback > 0) {
    lineas.push(
      linea(
        `⚠ ${conFallback} ${conFallback === 1 ? "noche" : "noches"} sin temporada`,
        "a precio de baja",
        "calc-linea--fallback",
      ),
    );
  }

  lineas.push(linea("Total a cobrar", pesos.format(total), "calc-linea--total"));

  if (cuotas > 1) {
    lineas.push(linea(`${cuotas} cuotas de`, pesos.format(Math.round(total / cuotas))));
  }

  // El desglose noche por noche: es lo que explica un total que no es
  // "noches × precio" cuando la estadía cruza temporadas o un fin de semana largo.
  const detalle = document.createElement("details");
  detalle.className = "calc-noches";
  const resumen = document.createElement("summary");
  resumen.textContent = "Ver detalle noche por noche";
  detalle.appendChild(resumen);

  for (const n of noches) {
    const fila = document.createElement("div");
    fila.className = "calc-noche";
    const izq = document.createElement("span");
    izq.textContent = fechaCorta(n.iso);
    const der = document.createElement("span");
    der.textContent = pesos.format(n.precio);
    const etiqueta = document.createElement("span");
    etiqueta.className = n.especial ? "calc-motivo" : "";
    etiqueta.textContent = n.etiqueta;
    fila.append(izq, etiqueta, der);
    detalle.appendChild(fila);
  }

  salida.replaceChildren(...lineas, detalle);
}

function linea(etiqueta, valor, clase = "") {
  const div = document.createElement("div");
  div.className = `calc-linea ${clase}`.trim();
  const izq = document.createElement("span");
  izq.textContent = etiqueta;
  const der = document.createElement("strong");
  der.textContent = valor;
  div.append(izq, der);
  return div;
}

function crearVacio(texto) {
  const p = document.createElement("p");
  p.className = "vacio-inline";
  p.textContent = texto;
  return p;
}

/* --- Guardar --------------------------------------------------------------- */

async function guardarTarifas(evento) {
  evento.preventDefault();

  const form = $("tarifas-form");
  const boton = form.querySelector(".save-btn");

  // Los rangos primero: `checkValidity()` no sabe de "hasta anterior a desde",
  // eso lo pone `setCustomValidity` y hay que refrescarlo antes de preguntar.
  let rangosOk = true;
  for (const fila of form.querySelectorAll(".input-row")) {
    const desde = fila.querySelector(".date-desde");
    const hasta = fila.querySelector(".date-hasta");
    if (desde && hasta && !validarRango(desde, hasta)) rangosOk = false;
  }

  if (!rangosOk || !form.checkValidity()) {
    form.reportValidity();
    mostrarToast("Revisá los campos marcados en rojo.", "error");
    return;
  }

  const icono = boton.querySelector(".icon-save");
  const texto = boton.querySelector(".btn-text-content");

  boton.disabled = true;
  icono.textContent = "sync";
  gsap.to(icono, { rotation: 360, duration: 1, repeat: -1, ease: "linear" });
  texto.textContent = "Guardando…";

  try {
    estado.tarifas = await api("/tarifas", {
      method: "PUT",
      body: JSON.stringify(configEnPantalla()),
    });

    // Se repinta con lo que devolvió la base y no con lo que había en pantalla:
    // es lo que hace que las fechas especiales nuevas se queden con su id y el
    // siguiente guardado las actualice en vez de duplicarlas.
    pintarTarifas();

    gsap.killTweensOf(icono);
    gsap.set(icono, { rotation: 0 });
    icono.textContent = "check_circle";
    texto.textContent = "¡Guardado!";
    boton.classList.add("btn-success");
    mostrarToast("Tarifas guardadas. Ya se aplican en el próximo pago.");

    setTimeout(() => {
      icono.textContent = "save";
      texto.textContent = "Guardar Cambios";
      boton.classList.remove("btn-success");
      boton.disabled = false;
    }, 2500);
  } catch (error) {
    gsap.killTweensOf(icono);
    gsap.set(icono, { rotation: 0 });
    icono.textContent = "save";
    texto.textContent = "Guardar Cambios";
    boton.disabled = false;
    mostrarToast(error.message, "error");
  }
}

/* ===========================================================================
   2. ALQUILERES
   =========================================================================== */

const NOMBRE_MEDIO = {
  credit_card: "Crédito",
  debit_card: "Débito",
  prepaid_card: "Prepaga",
  account_money: "Dinero en cuenta",
  bank_transfer: "Transferencia",
  ticket: "Efectivo",
};

async function cargarAlquileres() {
  try {
    const datos = await api("/alquileres");
    estado.alquileres = datos.alquileres;
    estado.totales = datos.totales;
    pintarAlquileres();
  } catch (error) {
    $("alquileres-cargando").textContent = `No se pudo cargar el registro: ${error.message}`;
    mostrarToast(error.message, "error");
  }
}

function pintarAlquileres() {
  $("alquileres-cargando").hidden = true;

  const hay = estado.alquileres.length > 0;
  $("alquileres-tabla").hidden = !hay;
  $("alquileres-vacio").hidden = hay;
  $("alquileres-totales").hidden = !hay;
  $("btn-reporte").disabled = !hay;

  if (!hay) return;

  $("total-cantidad").textContent = estado.totales.cantidad;
  $("total-cobrado").textContent = pesos.format(estado.totales.cobrado);
  $("total-devuelto").textContent = pesos.format(estado.totales.devuelto);
  $("total-neto").textContent = pesos.format(estado.totales.neto);

  // El chip de "por aprobar" solo existe si hay algo que aprobar. Esa plata no
  // está en "Cobrado" — nadie miró todavía el extracto.
  const pendientes = estado.totales.comprobantesPendientes || 0;
  $("total-chip-pendiente").hidden = !pendientes;
  if (pendientes) {
    $("total-pendiente").textContent =
      `${pesos.format(estado.totales.montoPendiente || 0)} · ${pendientes}`;
  }

  $("alquileres-cuerpo").replaceChildren(...estado.alquileres.map(filaDeAlquiler));
}

/** El estado que se muestra: mezcla el del pago con el de la reserva. */
function estadoDeAlquiler(a) {
  // Una transferencia se cuenta por su comprobante, no por un pago: no hay
  // contracargo ni devolución parcial posible, hay alguien que todavía no miró
  // el extracto, alguien que lo miró y dijo que sí, o alguien que dijo que no.
  if (a.estadoComprobante === "pendiente") {
    return { texto: "Esperando aprobación", clase: "status-espera" };
  }
  if (a.estadoComprobante === "rechazado") {
    // "Comprobante rechazado" y no "Cancelada": la reserva sigue viva y quien
    // la hizo puede pagar con otro medio desde el mismo link.
    return { texto: "Comprobante rechazado", clase: "status-cancelado" };
  }

  if (a.estadoPago === "charged_back") return { texto: "Contracargo", clase: "status-devuelto" };
  if (a.estadoPago === "refunded") return { texto: "Devuelto", clase: "status-devuelto" };
  if (a.devuelto > 0) return { texto: "Devuelto en parte", clase: "status-parcial" };
  if (a.estadoReserva === "cancelada") return { texto: "Cancelada", clase: "status-cancelado" };
  if (a.estadoReserva === "confirmada") return { texto: "Confirmada", clase: "status-confirmado" };
  return { texto: "Pagada", clase: "status-pendiente" };
}

function celda(contenido, secundario) {
  const td = document.createElement("td");
  const principal = document.createElement("span");
  principal.className = "celda-principal";
  principal.textContent = contenido ?? "—";
  td.appendChild(principal);
  if (secundario) {
    const extra = document.createElement("span");
    extra.className = "celda-secundaria";
    extra.textContent = secundario;
    td.appendChild(extra);
  }
  return td;
}

function filaDeAlquiler(a) {
  const tr = document.createElement("tr");
  const esTransferencia = a.origen === "transferencia";
  if (a.paymentId) tr.dataset.paymentId = a.paymentId;
  if (a.comprobanteId) tr.dataset.comprobanteId = a.comprobanteId;
  if (esTransferencia) tr.dataset.origen = "transferencia";

  // Una transferencia no tiene número de operación de MercadoPago porque no
  // hubo operación de MercadoPago. Poner "Op. null" sería peor que no poner
  // nada: parecería un pago roto en vez de otra forma de cobrar.
  tr.appendChild(
    celda(fechaHora(a.fecha), esTransferencia ? "Transferencia" : `Op. ${a.paymentId}`),
  );
  tr.appendChild(celda(a.huesped.nombre, a.huesped.email || a.huesped.telefono || ""));
  tr.appendChild(
    celda(
      a.checkIn ? `Desde: ${fechaCorta(a.checkIn)} Hasta: ${fechaCorta(a.checkOut)}` : "—",
      a.huesped.procedencia || "",
    ),
  );
  tr.appendChild(
    celda(
      a.personas == null ? "—" : String(a.personas),
      a.ninos > 0 ? `${a.adultos} ad. · ${a.ninos} niños` : "",
    ),
  );

  const medio = NOMBRE_MEDIO[a.tipo] || a.tipo || "—";
  tr.appendChild(
    celda(
      a.cuotas > 1 ? `${medio} · ${a.cuotas} cuotas` : medio,
      a.ultimosCuatro ? `•••• ${a.ultimosCuatro}` : "",
    ),
  );

  tr.appendChild(
    celda(pesos.format(a.monto), a.devuelto > 0 ? `− ${pesos.format(a.devuelto)} devuelto` : ""),
  );

  const tdEstado = document.createElement("td");
  const { texto, clase } = estadoDeAlquiler(a);
  const badge = document.createElement("span");
  badge.className = `status-badge ${clase}`;
  badge.textContent = texto;
  tdEstado.appendChild(badge);
  tr.appendChild(tdEstado);

  tr.appendChild(accionesDeAlquiler(a, esTransferencia));
  return tr;
}

/**
 * La celda de acciones. Cambia entera según de dónde vino la fila.
 *
 * MercadoPago: cancelar, que devuelve plata de verdad por la API.
 * Transferencia: el ojito para mirar el comprobante y decidir. No hay botón de
 * cancelar porque no hay nada que la API pueda devolver — esa plata entró al
 * banco por fuera de MercadoPago.
 */
function accionesDeAlquiler(a, esTransferencia) {
  const td = document.createElement("td");

  if (esTransferencia) {
    /* Los botones van en un <div> adentro de la celda, no en la celda misma.

       Ponerle `display: flex` a un <td> lo saca del algoritmo de tabla: deja de
       ser `table-cell` y con eso pierde el alto y los bordes de la fila. Se veia
       como la linea divisoria cortada justo en la columna Acciones. */
    const grupo = document.createElement("div");
    grupo.className = "celda-acciones";

    const ver = document.createElement("button");
    ver.className = "btn-action btn-action-ver";
    ver.type = "button";
    ver.title =
      a.estadoComprobante === "pendiente"
        ? "Ver el comprobante y decidir"
        : "Ver el comprobante";
    ver.setAttribute(
      "aria-label",
      `Ver el comprobante de ${a.huesped.nombre || "esta reserva"}`,
    );
    ver.innerHTML = '<span class="material-symbols-outlined">visibility</span>';
    ver.addEventListener("click", () => abrirModalComprobante(a));
    grupo.appendChild(ver);

    /* Una transferencia aprobada es un alquiler cobrado como cualquier otro, y
       se cancela igual que uno de tarjeta. La diferencia está adentro del
       modal: la plata no la puede devolver el panel, solo anotarla.

       Mientras el comprobante está pendiente o rechazado no hay alquiler que
       cancelar, así que el botón ni aparece. */
    if (a.estadoComprobante === "confirmado") {
      const cancelar = document.createElement("button");
      cancelar.className = "btn-cancelar-reserva";
      cancelar.type = "button";

      const sinPendiente = a.neto <= 0 && a.estadoReserva === "cancelada";
      cancelar.textContent = sinPendiente ? "—" : "Cancelar";
      cancelar.disabled = sinPendiente;
      if (!sinPendiente) cancelar.addEventListener("click", () => abrirModalCancelar(a));
      grupo.appendChild(cancelar);
    }

    td.appendChild(grupo);
    return td;
  }

  const boton = document.createElement("button");
  boton.className = "btn-cancelar-reserva";
  boton.type = "button";

  // Ya cancelada y sin plata pendiente de devolver: no queda nada que hacer.
  const sinPendiente = a.neto <= 0 && a.estadoReserva === "cancelada";
  boton.textContent = sinPendiente ? "—" : "Cancelar";
  boton.disabled = sinPendiente;
  if (!sinPendiente) boton.addEventListener("click", () => abrirModalCancelar(a));

  td.appendChild(boton);
  return td;
}

/* --- Visor del comprobante de transferencia ---------------------------------

   Aprobar y rechazar NO mueven plata, y es la diferencia importante con el
   modal de cancelación de al lado. Una transferencia bancaria nunca pasó por
   MercadoPago: no hay `payment` con id, así que no hay `refund` que pedirle a
   la API. Lo único que se decide acá es si la reserva vale o no:

     aprobar   -> comprobante confirmado + reserva 'confirmada' (bloquea fechas)
     rechazar  -> comprobante rechazado  + reserva 'cancelada'  (las libera)

   Si además hay que devolver la plata, se devuelve a mano. El aviso del modal
   lo dice, y el backend lo repite en su respuesta para que no dependa de que
   alguien se acuerde de escribirlo en la pantalla.
   --------------------------------------------------------------------------- */

async function abrirModalComprobante(alquiler) {
  estado.comprobante = alquiler;

  const pendiente = alquiler.estadoComprobante === "pendiente";
  $("comprobante-detalle").textContent =
    `${alquiler.huesped.nombre || "Sin nombre"} — ` +
    `${fechaCorta(alquiler.checkIn)} al ${fechaCorta(alquiler.checkOut)}. ` +
    `Dice haber transferido ${pesos.format(alquiler.monto)}.`;

  // Ya resuelto: queda como visor y nada más. Los botones de decidir no tienen
  // sentido dos veces, y el backend igual los rechazaría con un 409.
  $("comprobante-aprobar").hidden = !pendiente;
  $("comprobante-rechazar").hidden = !pendiente;
  $("comprobante-aprobar").disabled = false;
  $("comprobante-rechazar").disabled = false;
  $("comprobante-aviso").hidden = !pendiente;

  const visor = $("comprobante-visor");
  visor.replaceChildren(cargandoDeComprobante());
  $("comprobante-descargar").removeAttribute("href");
  $("modal-comprobante").hidden = false;

  try {
    // Las URLs son temporales y las firma el servidor recién ahora: el bucket
    // es privado y no hay ninguna URL permanente que se pueda filtrar.
    const datos = await api(`/comprobantes?id=${encodeURIComponent(alquiler.comprobanteId)}`);

    const descargar = $("comprobante-descargar");
    descargar.href = datos.descargar;
    descargar.setAttribute("download", datos.nombreArchivo);

    visor.replaceChildren(vistaDelArchivo(datos));
  } catch (error) {
    const aviso = document.createElement("p");
    aviso.className = "vacio-bloque";
    aviso.textContent = `No se pudo abrir el comprobante: ${error.message}`;
    visor.replaceChildren(aviso);
    mostrarToast(error.message, "error");
  }
}

function cargandoDeComprobante() {
  const bloque = document.createElement("div");
  bloque.className = "cargando-bloque";
  bloque.innerHTML =
    '<span class="material-symbols-outlined spin">progress_activity</span> Abriendo el comprobante…';
  return bloque;
}

/**
 * Una imagen o un PDF, según lo que se haya subido.
 *
 * El PDF va en un <iframe> y no en un <embed>: si el navegador no sabe
 * mostrarlo, el iframe queda vacío pero el botón de Descargar sigue estando,
 * mientras que un <embed> roto se lleva puesto el layout.
 */
function vistaDelArchivo(datos) {
  if (datos.mime === "application/pdf") {
    const marco = document.createElement("iframe");
    marco.className = "comprobante-pdf";
    marco.title = "Comprobante en PDF";
    marco.src = datos.ver;
    return marco;
  }

  const img = document.createElement("img");
  img.className = "comprobante-imagen";
  img.alt = `Comprobante de ${datos.huesped || "la transferencia"}`;
  img.src = datos.ver;
  return img;
}

function cerrarModalComprobante() {
  $("modal-comprobante").hidden = true;
  // Se suelta el archivo: dejar el src apuntando a una URL firmada mantiene la
  // imagen en memoria y el iframe con una request viva detrás del modal.
  $("comprobante-visor").replaceChildren();
  estado.comprobante = null;
}

async function resolverComprobante(accion) {
  const alquiler = estado.comprobante;
  if (!alquiler) return;

  if (
    accion === "rechazar" &&
    !window.confirm(
      `¿Rechazar el comprobante de ${alquiler.huesped.nombre || "esta reserva"}?\n\n` +
        "La reserva NO se cancela: quien la hizo va a ver el aviso en el link de " +
        "pago y va a poder pagar con otro medio.\n\n" +
        "Si ya cobraste la transferencia, la devolución la tenés que hacer a mano " +
        "desde MercadoPago.",
    )
  ) {
    return;
  }

  $("comprobante-aprobar").disabled = true;
  $("comprobante-rechazar").disabled = true;

  try {
    const respuesta = await api("/comprobantes", {
      method: "PATCH",
      body: JSON.stringify({ id: alquiler.comprobanteId, accion }),
    });

    cerrarModalComprobante();
    mostrarToast(
      accion === "aprobar"
        ? "Comprobante aprobado. La reserva quedó confirmada y las fechas bloqueadas."
        : "Comprobante rechazado. En el link de pago ya le aparece para pagar con otro medio.",
      accion === "aprobar" ? "exito" : undefined,
    );

    // El aviso de la devolución manual va en su propio toast y después del
    // primero: es lo único que le queda por hacer al operador.
    if (respuesta.avisoDevolucion) {
      setTimeout(() => mostrarToast(respuesta.avisoDevolucion, "error"), 400);
    }

    await cargarAlquileres();
  } catch (error) {
    $("comprobante-aprobar").disabled = false;
    $("comprobante-rechazar").disabled = false;
    mostrarToast(error.message, "error");
  }
}

/* --- Modal de cancelación --------------------------------------------------- */

function abrirModalCancelar(alquiler) {
  estado.cancelando = alquiler;

  /* El mismo diálogo dice dos cosas distintas según de dónde vino la plata.

     Con tarjeta, "devolver" es una orden: el refund sale por la API y no se
     puede revertir. Con transferencia es una anotación: la plata la mueve una
     persona desde MercadoPago y acá solo queda registrada, para que el registro
     no siga diciendo que se cobró todo. Prometer "Devolver todo" en ese caso
     sería mentir sobre lo que hace el botón. */
  const esTransferencia = alquiler.origen === "transferencia";

  $("modal-label-total").textContent = esTransferencia ? "Ya devolví todo" : "Devolver todo";
  $("modal-label-parcial").textContent = esTransferencia
    ? "Devolví una parte"
    : "Devolver una parte";
  $("modal-label-ninguna").textContent = esTransferencia
    ? "No devolví nada"
    : "No devolver nada";
  $("modal-label-monto").textContent = esTransferencia
    ? "Monto que devolviste ($)"
    : "Monto a devolver ($)";
  $("modal-aviso-texto").textContent = esTransferencia
    ? "Acá solo queda anotado. La transferencia la tenés que devolver vos, a mano, desde MercadoPago."
    : "Una devolución en MercadoPago no se puede revertir.";

  $("modal-detalle").textContent =
    `${alquiler.huesped.nombre || "Sin nombre"} — ` +
    `${fechaCorta(alquiler.checkIn)} al ${fechaCorta(alquiler.checkOut)}. ` +
    `Se cobraron ${pesos.format(alquiler.monto)}` +
    (alquiler.devuelto > 0 ? `, de los que ya se devolvieron ${pesos.format(alquiler.devuelto)}.` : ".");

  $("modal-monto-total").textContent = `${pesos.format(alquiler.neto)} — todo lo que queda por devolver.`;

  const monto = $("modal-monto");
  monto.max = String(alquiler.neto);
  monto.value = "";
  monto.placeholder = `Hasta ${alquiler.neto}`;

  document.querySelector('input[name="modo-cancelacion"][value="total"]').checked = true;
  $("modal-parcial").hidden = true;

  // Sin plata pendiente, devolver no es una opción: solo queda cancelar.
  const hayQueDevolver = alquiler.neto > 0 && alquiler.estadoPago === "approved";
  for (const radio of document.querySelectorAll('input[name="modo-cancelacion"]')) {
    if (radio.value !== "ninguna") radio.disabled = !hayQueDevolver;
  }
  if (!hayQueDevolver) {
    document.querySelector('input[name="modo-cancelacion"][value="ninguna"]').checked = true;
  }

  $("modal-cancelar").hidden = false;
  $("modal-volver").focus();
}

function cerrarModal() {
  $("modal-cancelar").hidden = true;
  estado.cancelando = null;
}

function modoElegido() {
  return document.querySelector('input[name="modo-cancelacion"]:checked')?.value || "total";
}

async function confirmarCancelacion() {
  const alquiler = estado.cancelando;
  if (!alquiler) return;

  const modo = modoElegido();
  let monto = null;

  if (modo === "parcial") {
    monto = Number($("modal-monto").value || 0);
    if (!Number.isFinite(monto) || monto <= 0) {
      mostrarToast("Escribí cuánto querés devolver.", "error");
      $("modal-monto").focus();
      return;
    }
    if (monto > alquiler.neto) {
      mostrarToast(`No se puede devolver más de ${pesos.format(alquiler.neto)}.`, "error");
      $("modal-monto").focus();
      return;
    }
  }

  const boton = $("modal-confirmar");
  const icono = boton.querySelector(".icon-confirmar");
  const texto = boton.querySelector(".btn-text-content");

  boton.disabled = true;
  icono.textContent = "sync";
  gsap.to(icono, { rotation: 360, duration: 1, repeat: -1, ease: "linear" });
  texto.textContent = "Procesando…";

  try {
    const respuesta = await api("/cancelar", {
      method: "POST",
      body: JSON.stringify({
        // Uno de los dos, nunca los dos: el backend elige la rama por cuál
        // viene. Una transferencia no tiene paymentId porque no hubo pago de
        // MercadoPago.
        ...(alquiler.origen === "transferencia"
          ? { comprobanteId: alquiler.comprobanteId }
          : { paymentId: alquiler.paymentId }),
        devolver: modo !== "ninguna",
        monto,
      }),
    });

    cerrarModal();

    if (respuesta.aviso) {
      mostrarToast(respuesta.aviso, "error");
    } else if (respuesta.devolucion?.manual) {
      // Transferencia: la plata no salió de ningún lado, solo quedó anotada.
      mostrarToast(
        `Anotados ${pesos.format(respuesta.devolucion.monto)} devueltos. Reserva cancelada.`,
      );
    } else if (respuesta.devolucion) {
      mostrarToast(`Devueltos ${pesos.format(respuesta.devolucion.monto)}. Reserva cancelada.`);
    } else {
      mostrarToast("Reserva cancelada. Las fechas quedaron libres.");
    }

    // El recordatorio de que la devolución sigue pendiente de hacerse a mano va
    // aparte y después: es lo único que le queda por hacer al operador.
    if (respuesta.avisoDevolucion) {
      setTimeout(() => mostrarToast(respuesta.avisoDevolucion, "error"), 400);
    }

    await cargarAlquileres();
  } catch (error) {
    mostrarToast(error.message, "error");
  } finally {
    gsap.killTweensOf(icono);
    gsap.set(icono, { rotation: 0 });
    icono.textContent = "check";
    texto.textContent = "Confirmar";
    boton.disabled = false;
  }
}

/* --- Reporte en PDF --------------------------------------------------------- */

/**
 * El PDF sale de `estado.alquileres`, que es exactamente lo que se está
 * mostrando en pantalla y ya viene ordenado por la base. Así el papel y la web
 * dicen lo mismo, en el mismo orden, sin dos criterios que puedan divergir.
 */
function descargarReporte() {
  if (!estado.alquileres.length) {
    mostrarToast("No hay alquileres para exportar.", "error");
    return;
  }

  const constructor = window.jspdf?.jsPDF;
  if (!constructor) {
    mostrarToast("No se pudo cargar el generador de PDF. Revisá tu conexión.", "error");
    return;
  }

  // Apaisado: son ocho columnas y en vertical el nombre y el mail se parten.
  const doc = new constructor({ orientation: "landscape", unit: "pt", format: "a4" });
  const ancho = doc.internal.pageSize.getWidth();
  const generado = fechaHora(new Date().toISOString());

  doc.setFontSize(18);
  doc.text("Registro de Alquileres", 40, 44);

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`DepartamentosDimo · generado el ${generado}`, 40, 62);

  // Los pendientes se nombran aparte y no se suman: es plata que todavía nadie
  // verificó contra el extracto, y meterla en "cobrado" haría que el reporte
  // dijera que entró plata que capaz nunca entró.
  const pendientes = estado.totales.comprobantesPendientes || 0;
  doc.text(
    `${estado.totales.cantidad} reservas · cobrado ${pesos.format(estado.totales.cobrado)} · ` +
      `devuelto ${pesos.format(estado.totales.devuelto)} · neto ${pesos.format(estado.totales.neto)}` +
      (pendientes
        ? ` · ${pendientes} transferencia${pendientes > 1 ? "s" : ""} por aprobar ` +
          `(${pesos.format(estado.totales.montoPendiente || 0)}, sin contar)`
        : ""),
    40,
    78,
  );

  doc.autoTable({
    startY: 96,
    head: [["Pago", "Inqulino", "Contacto", "Fechas", "Pers.", "Medio", "Monto", "Estado"]],
    body: estado.alquileres.map((a) => [
      `${fechaHora(a.fecha)}\n${a.paymentId ? `Op. ${a.paymentId}` : "Transferencia"}`,
      [a.huesped.nombre , a.huesped.dni].join("\n") || "—",
      ["Email: " + a.huesped.email, "Tel.: " + a.huesped.telefono].filter(Boolean).join("\n") || "—",
      a.checkIn ? `Desde: ${fechaCorta(a.checkIn)}\nHasta: ${fechaCorta(a.checkOut)}` : "—",
      a.personas == null ? "—" : String(a.personas),
      (NOMBRE_MEDIO[a.tipo] || a.tipo || "—") + (a.cuotas > 1 ? `\n${a.cuotas} cuotas` : ""),
      a.devuelto > 0
        ? `${pesos.format(a.monto)}\n− ${pesos.format(a.devuelto)}`
        : pesos.format(a.monto),
      estadoDeAlquiler(a).texto,
    ]),
    styles: { fontSize: 8, cellPadding: 5, valign: "middle" },
    headStyles: { fillColor: [22, 50, 56], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [251, 243, 228] },
    columnStyles: {
      0: { cellWidth: 92 },
      4: { cellWidth: 34, halign: "center" },
      6: { halign: "right" },
    },
    margin: { left: 40, right: 40 },
    didDrawPage: (datos) => {
      const pagina = doc.internal.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(`Página ${pagina}`, ancho - 40, doc.internal.pageSize.getHeight() - 20, {
        align: "right",
      });
      void datos;
    },
  });

  const hoy = hoyISO();
  doc.save(`alquileres-dimo-${hoy}.pdf`);
  mostrarToast("Reporte descargado.");
}

/* ===========================================================================
   3. RESEÑAS
   =========================================================================== */

async function cargarResenas() {
  try {
    const datos = await api("/resenas");
    estado.resenas = datos.resenas;
    pintarResenas(datos.pendientes);
  } catch (error) {
    $("resenas-cargando").textContent = `No se pudieron cargar las reseñas: ${error.message}`;
    mostrarToast(error.message, "error");
  }
}

function pintarResenas(pendientes) {
  $("resenas-cargando").hidden = true;

  const hay = estado.resenas.length > 0;
  $("resenas-vacio").hidden = hay;
  $("resenas-pendientes-chip").hidden = !pendientes;
  if (pendientes) $("resenas-pendientes").textContent = pendientes;

  // Promedio sobre TODAS las reseñas de la tabla, aprobadas y pendientes: es
  // el panel de moderación, así que interesa el pulso completo de lo que
  // escribe la gente, no solo lo que ya se dejó salir al sitio.
  $("resenas-promedio-chip").hidden = !hay;
  if (hay) {
    const suma = estado.resenas.reduce((acc, r) => acc + (Number(r.puntaje) || 0), 0);
    $("resenas-promedio").textContent = puntajes.format(suma / estado.resenas.length);
  }

  $("resenas-grid").replaceChildren(...estado.resenas.map(tarjetaDeResena));
}

/* Las cinco estrellas de una tarjeta, más el puntaje en texto.

   Las cinco usan SIEMPRE el glifo `star`: lo que distingue una encendida de
   una apagada es el eje FILL de Material Symbols, no el nombre del icono.
   Antes las apagadas pedían `star_outline`, pero `.stars` forzaba
   `font-variation-settings: "FILL" 1` sobre todos los hijos, así que ese glifo
   salía relleno igual y las cinco se veían encendidas con cualquier puntaje.
   Ahora el estado apagado es una clase (`is-off`) que pone FILL en 0.

   El "4/5" al lado no es decorativo: cinco iconos chiquitos se cuentan mal de
   un vistazo, y en el panel el puntaje es justamente el dato que se mira para
   decidir si una reseña se publica. */
function bloqueDePuntaje(valor) {
  // La columna `rating` tiene un check de 1 a 5, pero la tarjeta se pinta con
  // lo que devuelva la API: si algún día llega basura, se recorta acá y no
  // rompe el layout con 40 estrellas.
  const puntaje = Math.min(5, Math.max(0, Math.round(Number(valor) || 0)));

  const bloque = document.createElement("div");
  bloque.className = "review-rating";

  const estrellas = document.createElement("div");
  estrellas.className = "stars";
  // Para un lector de pantalla las cinco estrellas son UNA sola cosa que dice
  // el puntaje, no cinco palabras "star" seguidas.
  estrellas.setAttribute("role", "img");
  estrellas.setAttribute("aria-label", `${puntaje} de 5 estrellas`);

  for (let i = 1; i <= 5; i++) {
    const estrella = document.createElement("span");
    estrella.className = "material-symbols-outlined";
    if (i > puntaje) estrella.classList.add("is-off");
    estrella.setAttribute("aria-hidden", "true");
    estrella.textContent = "star";
    estrellas.appendChild(estrella);
  }

  const texto = document.createElement("span");
  texto.className = "rating-valor";
  texto.setAttribute("aria-hidden", "true");
  texto.textContent = `${puntaje}/5`;

  bloque.append(estrellas, texto);
  return bloque;
}

function tarjetaDeResena(r) {
  const tarjeta = document.createElement("div");
  tarjeta.className = "review-card";
  tarjeta.dataset.aprobada = String(r.aprobada);

  if (!r.aprobada) {
    const estadoTexto = document.createElement("p");
    estadoTexto.className = "review-estado";
    estadoTexto.textContent = "Sin aprobar · no se ve en el sitio";
    tarjeta.appendChild(estadoTexto);
  }

  const cabecera = document.createElement("div");
  cabecera.className = "review-header";

  const nombre = document.createElement("div");
  nombre.className = "reviewer-name";
  nombre.textContent = r.nombre;

  cabecera.append(nombre, bloqueDePuntaje(r.puntaje));

  const texto = document.createElement("p");
  texto.className = "review-text";
  // textContent: la reseña la escribe cualquiera desde el sitio público.
  texto.textContent = `“${r.texto}”`;

  const fecha = document.createElement("p");
  fecha.className = "review-fecha";
  fecha.textContent = fechaHora(r.fecha);

  const acciones = document.createElement("div");
  acciones.className = "review-actions";

  // El botón de aprobar solo existe mientras haga falta: una vez aprobada,
  // desaparece y queda únicamente el de eliminar.
  if (!r.aprobada) {
    const aprobar = document.createElement("button");
    aprobar.className = "btn-action btn-action-approve";
    aprobar.type = "button";
    aprobar.title = "Aprobar y publicar";
    aprobar.innerHTML = '<span class="material-symbols-outlined">check_circle</span>';
    aprobar.addEventListener("click", () => aprobarResena(r, aprobar));
    acciones.appendChild(aprobar);
  }

  const eliminar = document.createElement("button");
  eliminar.className = "btn-action btn-action-delete";
  eliminar.type = "button";
  eliminar.title = "Eliminar";
  eliminar.innerHTML = '<span class="material-symbols-outlined">delete</span>';
  eliminar.addEventListener("click", () => eliminarResena(r, tarjeta, eliminar));
  acciones.appendChild(eliminar);

  tarjeta.append(cabecera, texto, fecha, acciones);
  return tarjeta;
}

async function aprobarResena(resena, boton) {
  boton.disabled = true;
  try {
    await api("/resenas", {
      method: "PATCH",
      body: JSON.stringify({ id: resena.id, aprobada: true }),
    });
    mostrarToast("Reseña aprobada. Ya se ve en el sitio.");
    await cargarResenas();
  } catch (error) {
    boton.disabled = false;
    mostrarToast(error.message, "error");
  }
}

async function eliminarResena(resena, tarjeta, boton) {
  // Borrar es definitivo y no hay papelera: se pregunta, aunque sea con el
  // confirm del navegador. El diálogo lindo se lo lleva la cancelación de
  // reservas, que además mueve plata.
  if (!window.confirm(`¿Eliminar la reseña de ${resena.nombre}? No se puede deshacer.`)) return;

  boton.disabled = true;
  try {
    await api("/resenas", { method: "DELETE", body: JSON.stringify({ id: resena.id }) });
    gsap.to(tarjeta, {
      opacity: 0,
      y: -12,
      duration: 0.25,
      onComplete: () => {
        mostrarToast("Reseña eliminada.");
        cargarResenas();
      },
    });
  } catch (error) {
    boton.disabled = false;
    mostrarToast(error.message, "error");
  }
}

/* ===========================================================================
   Pestañas
   =========================================================================== */

function activarPestanas() {
  const items = document.querySelectorAll(".nav-item, .bottom-nav-item");

  for (const item of items) {
    item.addEventListener("click", () => {
      const destino = item.dataset.target;
      if (item.classList.contains("active")) return;

      for (const nav of items) {
        nav.classList.toggle("active", nav.dataset.target === destino);
      }

      const actual = document.querySelector(".tab-content.active");
      const siguiente = $(destino);
      if (!actual || !siguiente) return;

      gsap.to(actual, {
        opacity: 0,
        y: -20,
        duration: 0.25,
        onComplete: () => {
          actual.classList.remove("active");
          siguiente.classList.add("active");
          gsap.fromTo(
            siguiente,
            { opacity: 0, y: 20 },
            { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" },
          );
        },
      });
    });
  }
}

/* ===========================================================================
   Arranque
   =========================================================================== */

document.addEventListener("DOMContentLoaded", async () => {
  activarPestanas();
  gsap.set(".tab-content.active", { opacity: 1, y: 0 });

  // Si la cookie no vale, esto redirige al login y no se sigue cargando nada.
  try {
    await api("/sesion");
  } catch {
    return;
  }

  // --- Tarifas -------------------------------------------------------------
  $("tarifas-form").addEventListener("submit", guardarTarifas);

  for (const id of ["alta-precio", "media-precio", "baja-precio"]) {
    $(id).addEventListener("input", recalcularCalculadora);
  }

  $("max-cuotas").addEventListener("input", () => {
    const max = Math.min(24, Math.max(1, Number($("max-cuotas").value || 1)));
    pintarCuotas(max, estado.tarifas?.planes || []);
    actualizarSelectorDeCuotasCalc();
    recalcularCalculadora();
  });

  $("calc-checkin").addEventListener("change", recalcularCalculadora);
  $("calc-checkout").addEventListener("change", recalcularCalculadora);
  $("calc-medio").addEventListener("change", () => {
    actualizarSelectorDeCuotasCalc();
    recalcularCalculadora();
  });
  $("calc-cuotas").addEventListener("change", recalcularCalculadora);

  document.addEventListener("click", (evento) => {
    if (evento.target.closest(".add-special-date-btn")) agregarEspecial();

    const borrar = evento.target.closest(".delete-special-date-btn");
    if (borrar) eliminarEspecial(borrar.closest(".special-date-card"));
  });

  document
    .querySelector(".special-dates-carousel")
    ?.addEventListener("scroll", marcarPuntoActivo);

  engancharValidacionDeFechas(document);

  // --- Alquileres ----------------------------------------------------------
  $("btn-reporte").addEventListener("click", descargarReporte);
  $("modal-volver").addEventListener("click", cerrarModal);
  $("modal-confirmar").addEventListener("click", confirmarCancelacion);

  // --- Visor del comprobante ----------------------------------------------
  $("comprobante-volver").addEventListener("click", cerrarModalComprobante);
  $("comprobante-aprobar").addEventListener("click", () => resolverComprobante("aprobar"));
  $("comprobante-rechazar").addEventListener("click", () => resolverComprobante("rechazar"));
  $("modal-comprobante").addEventListener("click", (evento) => {
    if (evento.target === $("modal-comprobante")) cerrarModalComprobante();
  });

  for (const radio of document.querySelectorAll('input[name="modo-cancelacion"]')) {
    radio.addEventListener("change", () => {
      $("modal-parcial").hidden = modoElegido() !== "parcial";
      if (modoElegido() === "parcial") $("modal-monto").focus();
    });
  }

  // Clic en el fondo o Escape cierran el modal. Confirmar no: para eso está
  // el botón, que es la única forma de que salga plata.
  $("modal-cancelar").addEventListener("click", (evento) => {
    if (evento.target === $("modal-cancelar")) cerrarModal();
  });
  document.addEventListener("keydown", (evento) => {
    if (evento.key !== "Escape") return;
    // El de arriba primero: si los dos estuvieran abiertos, Escape cierra el
    // que se abrió último, que es el que está mirando la persona.
    if (!$("modal-comprobante").hidden) return cerrarModalComprobante();
    if (!$("modal-cancelar").hidden) cerrarModal();
  });

  // Las tres pestañas se cargan juntas al arrancar: son tres consultas chicas y
  // así cambiar de pestaña es instantáneo en vez de mostrar un spinner cada vez.
  await Promise.all([cargarTarifas(), cargarAlquileres(), cargarResenas()]);
});
