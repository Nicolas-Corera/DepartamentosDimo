const $ = (id) => document.getElementById(id);

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

function aUTC(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
}

function aISO(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function fechaCorta(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

function fechaHora(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function pct(n) {
  const num = Number(n) || 0;
  return Number.isInteger(num) ? String(num) : String(num).replace(".", ",");
}

function hoyISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const TOAST_MS = { exito: 3000, error: 6000 };

function mostrarToast(mensaje, tipo = "exito") {
  const pila = $("toastStack");
  if (!pila) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${tipo}`;

  toast.setAttribute("role", tipo === "error" ? "alert" : "status");

  const icono = tipo === "error" ? "#ic-alert" : "#ic-check";
  toast.innerHTML = `<svg class="ic-sm" aria-hidden="true"><use href="${icono}"/></svg><span></span>`;

  toast.querySelector("span").textContent = mensaje;

  let cerrando = false;
  const cerrar = () => {
    if (cerrando) return;
    cerrando = true;
    clearTimeout(reloj);
    toast.classList.add("toast-saliendo");
    toast.addEventListener("animationend", () => toast.remove());

    setTimeout(() => toast.remove(), 400);
  };

  toast.addEventListener("click", cerrar);
  const reloj = setTimeout(cerrar, TOAST_MS[tipo] || TOAST_MS.exito);

  pila.appendChild(toast);
}

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

const estado = {
  tarifas: null,
  alquileres: [],
  totales: null,
  resenas: [],
  cancelando: null,
  comprobante: null,
  tarifasEditadas: false,
};

async function cargarTarifas() {
  try {
    estado.tarifas = await api("/tarifas");
    pintarTarifas();
    estado.tarifasEditadas = false;
    $("tarifas-cargando").hidden = true;
    $("tarifas-form").hidden = false;
  } catch (error) {
    $("tarifas-cargando").textContent =
      `No se pudo cargar la configuración: ${error.message}`;
    mostrarToast(error.message, "error");
  }
}

function pintarTarifas() {
  const { temporadas, medios, maxCuotas, planes, especiales, porcentajeReserva } = estado.tarifas;

  for (const t of temporadas) {
    $(`${t.clave}-desde`).value = t.desde;
    $(`${t.clave}-hasta`).value = t.hasta;
    $(`${t.clave}-precio`).value = t.precio;
  }

  pintarMedios(medios);
  $("max-cuotas").value = maxCuotas;
  pintarCuotas(maxCuotas, planes);
  pintarEspeciales(especiales);

  $("porcentaje-reserva").value = porcentajeReserva;
  actualizarEjemploDeSenia();

  actualizarTarifaDeHoy();
  revisarHuecos();
  prepararCalculadora();
}

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
      recargo.setAttribute(
        "aria-label",
        `Recargo de ${m.nombre} en porcentaje`,
      );
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

function pintarCuotas(maxCuotas, planes) {
  const grid = $("cuotas-grid");
  const porCuota = new Map(
    (planes || []).map((p) => [p.cuotas, p.recargoPorcentaje]),
  );

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

function crearTarjetaEspecial(datos = {}) {
  const tarjeta = document.createElement("div");
  tarjeta.className = "carousel-card special-date-card";

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

  gsap.fromTo(
    tarjeta,
    { opacity: 0 },
    { opacity: 1, duration: 0.3, ease: "power2.out" },
  );

  setTimeout(() => {
    irATarjeta(tarjeta);
    tarjeta.querySelector(".date-desde").focus({ preventScroll: true });
  }, 60);
}

function pasoDelCarrusel(carrusel) {
  const tarjetas = carrusel.querySelectorAll(".special-date-card");
  if (tarjetas.length > 1)
    return tarjetas[1].offsetLeft - tarjetas[0].offsetLeft;
  return carrusel.offsetWidth;
}

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

  const paso = pasoDelCarrusel(carrusel);
  if (!paso) return;

  let i = Math.round(carrusel.scrollLeft / paso);
  if (i >= puntos.length) i = puntos.length - 1;
  puntos.forEach((p, j) => p.classList.toggle("active", j === i));
}

function validarRango(desde, hasta) {
  const contenedor = hasta.parentElement;
  let error = contenedor.querySelector(".error-msg");

  const mal = desde.value && hasta.value && hasta.value < desde.value;

  if (mal) {
    hasta.setCustomValidity(
      'La fecha "Hasta" no puede ser anterior a "Desde".',
    );
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

function configEnPantalla() {
  return {
    temporadas: ["alta", "media", "baja"].map((clave) => ({
      clave,
      nombre:
        estado.tarifas?.temporadas.find((t) => t.clave === clave)?.nombre ||
        clave,
      desde: $(`${clave}-desde`).value,
      hasta: $(`${clave}-hasta`).value,
      precio: Number($(`${clave}-precio`).value || 0),
    })),
    medios: leerMedios(),
    maxCuotas: Number($("max-cuotas").value || 1),
    planes: leerPlanes(),
    especiales: leerEspeciales(),
    porcentajeReserva: Number($("porcentaje-reserva").value || 0),
  };
}

function precioDeLaNoche(iso, config) {
  const especial = config.especiales
    .filter(
      (e) =>
        e.desde && e.hasta && iso >= e.desde && iso <= e.hasta && e.precio > 0,
    )
    .sort((a, b) => b.precio - a.precio)[0];

  if (especial) {
    return {
      precio: especial.precio,
      etiqueta: especial.motivo || "Fecha especial",
      especial: true,
    };
  }

  const temporada = config.temporadas
    .filter(
      (t) =>
        t.desde && t.hasta && iso >= t.desde && iso <= t.hasta && t.precio > 0,
    )
    .sort((a, b) => b.precio - a.precio)[0];

  if (temporada)
    return {
      precio: temporada.precio,
      etiqueta: temporada.nombre,
      especial: false,
    };

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

const NOCHES_DE_EJEMPLO = 7;

function actualizarEjemploDeSenia() {
  const nota = $("senia-ejemplo");
  if (!nota) return;

  const pct = Number($("porcentaje-reserva").value || 0);

  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
    nota.textContent = "Poné un porcentaje entre 1 y 100.";
    return;
  }

  const porNoche = precioDeLaNoche(hoyISO(), configEnPantalla()).precio;
  const total = porNoche * NOCHES_DE_EJEMPLO;
  const senia = Math.round((total * pct) / 100);

  nota.textContent =
    `Ejemplo: una estadía de ${NOCHES_DE_EJEMPLO} noches a la tarifa de hoy sale ` +
    `${pesos.format(total)}. La seña sería ${pesos.format(senia)} y quedarían ` +
    `${pesos.format(total - senia)} de saldo.`;
}

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
    .map(([a, b]) =>
      a === b
        ? fechaCorta(aISO(a))
        : `${fechaCorta(aISO(a))} al ${fechaCorta(aISO(b))}`,
    )
    .join(" · ");

  $("aviso-huecos-detalle").textContent =
    `${texto}${huecos.length > 3 ? ` (y ${huecos.length - 3} tramo${huecos.length - 3 === 1 ? "" : "s"} más)` : ""}. ` +
    `Esas noches se cobran a ${pesos.format(baja?.precio || 0)}, el precio de temporada baja. ` +
    "Corré las fechas de las temporadas para cubrirlas.";
  aviso.hidden = false;
}

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
        o.textContent =
          estado.tarifas?.medios.find((x) => x.clave === m.clave)?.nombre ||
          m.clave;
        return o;
      }),
  );
  if (elegido && [...medio.options].some((o) => o.value === elegido))
    medio.value = elegido;

  actualizarSelectorDeCuotasCalc();
  recalcularCalculadora();
}

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
    salida.replaceChildren(
      crearVacio("El check-out tiene que ser posterior al check-in."),
    );
    return;
  }

  const config = configEnPantalla();
  const cantidad = Math.round((aUTC(checkOut) - aUTC(checkIn)) / UN_DIA);

  if (cantidad > 365) {
    salida.replaceChildren(
      crearVacio("Son más de 365 noches: revisá las fechas."),
    );
    return;
  }

  const noches = [];
  for (let i = 0; i < cantidad; i++) {
    const iso = aISO(aUTC(checkIn) + i * UN_DIA);
    noches.push({ iso, ...precioDeLaNoche(iso, config) });
  }

  const base = noches.reduce((s, n) => s + n.precio, 0);
  const claveMedio = $("calc-medio").value;
  const cuotas = Number($("calc-cuotas").value || 1);

  const medio = config.medios.find((m) => m.clave === claveMedio);
  const plan =
    claveMedio === "credito"
      ? config.planes.find((p) => p.cuotas === cuotas)
      : null;

  const recargoMedio = Number(medio?.recargoPorcentaje || 0);
  const recargoCuotas = Number(plan?.recargoPorcentaje || 0);
  const recargoTotal = recargoMedio + recargoCuotas;

  const total = Math.round(base * (1 + recargoTotal / 100));
  const conFallback = noches.filter((n) => n.fallback).length;

  const lineas = [
    linea(
      `${cantidad} ${cantidad === 1 ? "noche" : "noches"}`,
      pesos.format(base),
    ),
  ];

  if (recargoMedio > 0) {
    const nombre =
      estado.tarifas?.medios.find((m) => m.clave === claveMedio)?.nombre ||
      claveMedio;
    lineas.push(
      linea(
        `Recargo ${nombre} (+${pct(recargoMedio)}%)`,
        pesos.format(Math.round((base * recargoMedio) / 100)),
      ),
    );
  }
  if (recargoCuotas > 0) {
    lineas.push(
      linea(
        `Recargo ${cuotas} cuotas (+${pct(recargoCuotas)}%)`,
        pesos.format(Math.round((base * recargoCuotas) / 100)),
      ),
    );
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

  lineas.push(
    linea("Total a cobrar", pesos.format(total), "calc-linea--total"),
  );

  if (cuotas > 1) {
    lineas.push(
      linea(`${cuotas} cuotas de`, pesos.format(Math.round(total / cuotas))),
    );
  }

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

async function guardarTarifas(evento) {
  evento.preventDefault();

  const form = $("tarifas-form");
  const boton = form.querySelector(".save-btn");

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

    pintarTarifas();
    estado.tarifasEditadas = false;

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
    $("alquileres-cargando").textContent =
      `No se pudo cargar el registro: ${error.message}`;
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

  const pendientes = estado.totales.comprobantesPendientes || 0;
  $("total-chip-pendiente").hidden = !pendientes;
  if (pendientes) {
    $("total-pendiente").textContent =
      `${pesos.format(estado.totales.montoPendiente || 0)} · ${pendientes}`;
  }

  $("alquileres-cuerpo").replaceChildren(
    ...estado.alquileres.map(filaDeAlquiler),
  );
}

function estadoDeAlquiler(a) {
  if (a.estadoComprobante === "pendiente") {
    return { texto: "Esperando aprobación", clase: "status-espera" };
  }
  if (a.estadoComprobante === "rechazado") {
    return { texto: "Comprobante rechazado", clase: "status-cancelado" };
  }

  if (a.estadoPago === "charged_back")
    return { texto: "Contracargo", clase: "status-devuelto" };
  if (a.estadoPago === "refunded")
    return { texto: "Devuelto", clase: "status-devuelto" };
  if (a.devuelto > 0)
    return { texto: "Devuelto en parte", clase: "status-parcial" };
  if (a.estadoReserva === "cancelada")
    return { texto: "Cancelada", clase: "status-cancelado" };
  if (a.estadoReserva === "confirmada")
    return { texto: "Confirmada", clase: "status-confirmado" };
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

  tr.appendChild(
    celda(
      fechaHora(a.fecha),
      esTransferencia ? "Transferencia" : `Op. ${a.paymentId}`,
    ),
  );
  tr.appendChild(
    celda(a.huesped.nombre, a.huesped.email || a.huesped.telefono || ""),
  );
  tr.appendChild(
    celda(
      a.checkIn
        ? `Desde: ${fechaCorta(a.checkIn)} Hasta: ${fechaCorta(a.checkOut)}`
        : "—",
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
    celda(
      pesos.format(a.monto),
      a.devuelto > 0 ? `− ${pesos.format(a.devuelto)} devuelto` : "",
    ),
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

function accionesDeAlquiler(a, esTransferencia) {
  const td = document.createElement("td");

  if (esTransferencia) {
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

    if (a.estadoComprobante === "confirmado") {
      const cancelar = document.createElement("button");
      cancelar.className = "btn-cancelar-reserva";
      cancelar.type = "button";

      const sinPendiente = a.neto <= 0 && a.estadoReserva === "cancelada";
      cancelar.textContent = sinPendiente ? "—" : "Cancelar";
      cancelar.disabled = sinPendiente;
      if (!sinPendiente)
        cancelar.addEventListener("click", () => abrirModalCancelar(a));
      grupo.appendChild(cancelar);
    }

    td.appendChild(grupo);
    return td;
  }

  const boton = document.createElement("button");
  boton.className = "btn-cancelar-reserva";
  boton.type = "button";

  const sinPendiente = a.neto <= 0 && a.estadoReserva === "cancelada";
  boton.textContent = sinPendiente ? "—" : "Cancelar";
  boton.disabled = sinPendiente;
  if (!sinPendiente)
    boton.addEventListener("click", () => abrirModalCancelar(a));

  td.appendChild(boton);
  return td;
}

async function abrirModalComprobante(alquiler) {
  estado.comprobante = alquiler;

  const pendiente = alquiler.estadoComprobante === "pendiente";
  $("comprobante-detalle").textContent =
    `${alquiler.huesped.nombre || "Sin nombre"} — ` +
    `${fechaCorta(alquiler.checkIn)} al ${fechaCorta(alquiler.checkOut)}. ` +
    `Dice haber transferido ${pesos.format(alquiler.monto)}.`;

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
    const datos = await api(
      `/comprobantes?id=${encodeURIComponent(alquiler.comprobanteId)}`,
    );

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

function abrirModalCancelar(alquiler) {
  estado.cancelando = alquiler;

  const esTransferencia = alquiler.origen === "transferencia";

  $("modal-label-total").textContent = esTransferencia
    ? "Ya devolví todo"
    : "Devolver todo";
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
    (alquiler.devuelto > 0
      ? `, de los que ya se devolvieron ${pesos.format(alquiler.devuelto)}.`
      : ".");

  $("modal-monto-total").textContent =
    `${pesos.format(alquiler.neto)} — todo lo que queda por devolver.`;

  const monto = $("modal-monto");
  monto.max = String(alquiler.neto);
  monto.value = "";
  monto.placeholder = `Hasta ${alquiler.neto}`;

  document.querySelector(
    'input[name="modo-cancelacion"][value="total"]',
  ).checked = true;
  $("modal-parcial").hidden = true;

  const hayQueDevolver =
    alquiler.neto > 0 && alquiler.estadoPago === "approved";
  for (const radio of document.querySelectorAll(
    'input[name="modo-cancelacion"]',
  )) {
    if (radio.value !== "ninguna") radio.disabled = !hayQueDevolver;
  }
  if (!hayQueDevolver) {
    document.querySelector(
      'input[name="modo-cancelacion"][value="ninguna"]',
    ).checked = true;
  }

  $("modal-cancelar").hidden = false;
  $("modal-volver").focus();
}

function cerrarModal() {
  $("modal-cancelar").hidden = true;
  estado.cancelando = null;
}

function modoElegido() {
  return (
    document.querySelector('input[name="modo-cancelacion"]:checked')?.value ||
    "total"
  );
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
      mostrarToast(
        `No se puede devolver más de ${pesos.format(alquiler.neto)}.`,
        "error",
      );
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
      mostrarToast(
        `Anotados ${pesos.format(respuesta.devolucion.monto)} devueltos. Reserva cancelada.`,
      );
    } else if (respuesta.devolucion) {
      mostrarToast(
        `Devueltos ${pesos.format(respuesta.devolucion.monto)}. Reserva cancelada.`,
      );
    } else {
      mostrarToast("Reserva cancelada. Las fechas quedaron libres.");
    }

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

function descargarReporte() {
  if (!estado.alquileres.length) {
    mostrarToast("No hay alquileres para exportar.", "error");
    return;
  }

  const constructor = window.jspdf?.jsPDF;
  if (!constructor) {
    mostrarToast(
      "No se pudo cargar el generador de PDF. Revisá tu conexión.",
      "error",
    );
    return;
  }

  const doc = new constructor({
    orientation: "landscape",
    unit: "pt",
    format: "a4",
  });
  const ancho = doc.internal.pageSize.getWidth();
  const generado = fechaHora(new Date().toISOString());

  doc.setFontSize(18);
  doc.text("Registro de Alquileres", 40, 44);

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`DepartamentosDimo · generado el ${generado}`, 40, 62);

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
    head: [
      [
        "Pago",
        "Inqulino",
        "Contacto",
        "Fechas",
        "Pers.",
        "Medio",
        "Monto",
        "Estado",
      ],
    ],
    body: estado.alquileres.map((a) => [
      `${fechaHora(a.fecha)}\n${a.paymentId ? `Op. ${a.paymentId}` : "Transferencia"}`,
      [a.huesped.nombre, a.huesped.dni].join("\n") || "—",
      ["Email: " + a.huesped.email, "Tel.: " + a.huesped.telefono]
        .filter(Boolean)
        .join("\n") || "—",
      a.checkIn
        ? `Desde: ${fechaCorta(a.checkIn)}\nHasta: ${fechaCorta(a.checkOut)}`
        : "—",
      a.personas == null ? "—" : String(a.personas),
      (NOMBRE_MEDIO[a.tipo] || a.tipo || "—") +
        (a.cuotas > 1 ? `\n${a.cuotas} cuotas` : ""),
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
      doc.text(
        `Página ${pagina}`,
        ancho - 40,
        doc.internal.pageSize.getHeight() - 20,
        {
          align: "right",
        },
      );
      void datos;
    },
  });

  const hoy = hoyISO();
  doc.save(`alquileres-dimo-${hoy}.pdf`);
  mostrarToast("Reporte descargado.");
}

async function cargarResenas() {
  try {
    const datos = await api("/resenas");
    estado.resenas = datos.resenas;
    pintarResenas(datos.pendientes);
  } catch (error) {
    $("resenas-cargando").textContent =
      `No se pudieron cargar las reseñas: ${error.message}`;
    mostrarToast(error.message, "error");
  }
}

function pintarResenas(pendientes) {
  $("resenas-cargando").hidden = true;

  const hay = estado.resenas.length > 0;
  $("resenas-vacio").hidden = hay;
  $("resenas-pendientes-chip").hidden = !pendientes;
  if (pendientes) $("resenas-pendientes").textContent = pendientes;

  $("resenas-promedio-chip").hidden = !hay;
  if (hay) {
    const suma = estado.resenas.reduce(
      (acc, r) => acc + (Number(r.puntaje) || 0),
      0,
    );
    $("resenas-promedio").textContent = puntajes.format(
      suma / estado.resenas.length,
    );
  }

  $("resenas-grid").replaceChildren(...estado.resenas.map(tarjetaDeResena));
}

function bloqueDePuntaje(valor) {
  const puntaje = Math.min(5, Math.max(0, Math.round(Number(valor) || 0)));

  const bloque = document.createElement("div");
  bloque.className = "review-rating";

  const estrellas = document.createElement("div");
  estrellas.className = "stars";

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

  texto.textContent = `“${r.texto}”`;

  const fecha = document.createElement("p");
  fecha.className = "review-fecha";
  fecha.textContent = fechaHora(r.fecha);

  const acciones = document.createElement("div");
  acciones.className = "review-actions";

  if (!r.aprobada) {
    const aprobar = document.createElement("button");
    aprobar.className = "btn-action btn-action-approve";
    aprobar.type = "button";
    aprobar.title = "Aprobar y publicar";
    aprobar.innerHTML =
      '<span class="material-symbols-outlined">check_circle</span>';
    aprobar.addEventListener("click", () => aprobarResena(r, aprobar));
    acciones.appendChild(aprobar);
  }

  const eliminar = document.createElement("button");
  eliminar.className = "btn-action btn-action-delete";
  eliminar.type = "button";
  eliminar.title = "Eliminar";
  eliminar.innerHTML = '<span class="material-symbols-outlined">delete</span>';
  eliminar.addEventListener("click", () =>
    eliminarResena(r, tarjeta, eliminar),
  );
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
  if (
    !window.confirm(
      `¿Eliminar la reseña de ${resena.nombre}? No se puede deshacer.`,
    )
  )
    return;

  boton.disabled = true;
  try {
    await api("/resenas", {
      method: "DELETE",
      body: JSON.stringify({ id: resena.id }),
    });
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
          refrescarPestanaActiva();
        },
      });
    });
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  activarPestanas();
  gsap.set(".tab-content.active", { opacity: 1, y: 0 });

  try {
    await api("/sesion");
  } catch {
    return;
  }

  $("tarifas-form").addEventListener("submit", guardarTarifas);

  for (const id of ["alta-precio", "media-precio", "baja-precio"]) {
    $(id).addEventListener("input", () => {
      recalcularCalculadora();
      actualizarEjemploDeSenia();
    });
  }

  $("porcentaje-reserva").addEventListener("input", actualizarEjemploDeSenia);

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

  $("btn-reporte").addEventListener("click", descargarReporte);
  $("modal-volver").addEventListener("click", cerrarModal);
  $("modal-confirmar").addEventListener("click", confirmarCancelacion);

  $("comprobante-volver").addEventListener("click", cerrarModalComprobante);
  $("comprobante-aprobar").addEventListener("click", () =>
    resolverComprobante("aprobar"),
  );
  $("comprobante-rechazar").addEventListener("click", () =>
    resolverComprobante("rechazar"),
  );
  $("modal-comprobante").addEventListener("click", (evento) => {
    if (evento.target === $("modal-comprobante")) cerrarModalComprobante();
  });

  for (const radio of document.querySelectorAll(
    'input[name="modo-cancelacion"]',
  )) {
    radio.addEventListener("change", () => {
      $("modal-parcial").hidden = modoElegido() !== "parcial";
      if (modoElegido() === "parcial") $("modal-monto").focus();
    });
  }

  $("modal-cancelar").addEventListener("click", (evento) => {
    if (evento.target === $("modal-cancelar")) cerrarModal();
  });
  document.addEventListener("keydown", (evento) => {
    if (evento.key !== "Escape") return;

    if (!$("modal-comprobante").hidden) return cerrarModalComprobante();
    if (!$("modal-cancelar").hidden) cerrarModal();
  });

  $("tarifas-form").addEventListener("input", () => {
    estado.tarifasEditadas = true;
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refrescarPestanaActiva();
  });

  await Promise.all([cargarTarifas(), cargarAlquileres(), cargarResenas()]);

  arrancarRefresco();
});

const REFRESCO_MS = 30_000;
const REFRESCO_MAX_MS = 5 * 60_000;

const refresco = { timer: null, espera: REFRESCO_MS, corriendo: false };

function hayModalAbierto() {
  return ["modal-cancelar", "modal-comprobante"].some((id) => $(id) && !$(id).hidden);
}

function pestanaActiva() {
  return document.querySelector(".tab-content.active")?.id || null;
}

async function refrescarPestanaActiva() {
  if (refresco.corriendo || document.hidden || hayModalAbierto()) return true;

  refresco.corriendo = true;
  try {
    const pestana = pestanaActiva();

    if (pestana === "tarifas") {
      if (estado.tarifasEditadas) return true;
      await cargarTarifas();
      return true;
    }

    if (pestana === "alquileres") {
      await cargarAlquileres();
      return true;
    }

    if (pestana === "resenas") {
      await cargarResenas();
      return true;
    }

    return true;
  } catch (error) {
    console.warn("[refresco] no se pudo actualizar:", error?.message || error);
    return false;
  } finally {
    refresco.corriendo = false;
  }
}

async function ciclarRefresco() {
  const ok = await refrescarPestanaActiva();
  refresco.espera = ok ? REFRESCO_MS : Math.min(refresco.espera * 2, REFRESCO_MAX_MS);
  refresco.timer = setTimeout(ciclarRefresco, refresco.espera);
}

function arrancarRefresco() {
  clearTimeout(refresco.timer);
  refresco.espera = REFRESCO_MS;
  refresco.timer = setTimeout(ciclarRefresco, refresco.espera);
}
