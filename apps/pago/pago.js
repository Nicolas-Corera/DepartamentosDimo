const $ = (id) => document.getElementById(id);

const pesos = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

const MESES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function partes(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

function fechaCorta(iso) {
  const p = partes(iso);
  return p ? `${p.d} ${MESES[p.m - 1]}` : String(iso);
}

function fechaLarga(iso) {
  const p = partes(iso);
  return p ? `${p.d} ${MESES[p.m - 1]}, ${p.y}` : String(iso);
}

function fechaConDia(iso) {
  const p = partes(iso);
  if (!p) return String(iso);
  const dia = DIAS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
  return `${dia} ${p.d} ${MESES[p.m - 1]}`;
}

function anunciar(texto) {
  $("anuncio").textContent = texto;
}

function mostrarPantalla(cual) {
  for (const id of ["pantalla-carga", "pantalla-error", "checkout", "pantalla-resultado"]) {
    $(id).hidden = id !== cual;
  }
}

const estado = {
  ref: null,
  datos: null,
  brick: null,
  brickFallo: false,
  procesando: false,

  metodo: "credito",
  cuotas: 1,

  comprobante: null,
};

function medioActual() {
  return (estado.datos?.medios || []).find((m) => m.clave === estado.metodo) || null;
}

function cobroActual() {
  const medio = medioActual();
  const base = estado.datos?.precio?.total || 0;

  if (!medio) {
    return { total: base, recargo: 0, recargoPorcentaje: 0, cuotas: 1, valorCuota: base };
  }

  const plan = (medio.planes || []).find((p) => p.cuotas === estado.cuotas);
  if (plan) {
    return {
      total: plan.total,
      recargo: plan.recargo,
      recargoPorcentaje: plan.recargoPorcentaje,
      cuotas: plan.cuotas,
      valorCuota: plan.valorCuota,
    };
  }

  return {
    total: medio.total,
    recargo: medio.recargo,
    recargoPorcentaje: medio.recargoPorcentaje,
    cuotas: 1,
    valorCuota: medio.total,
  };
}

function leerRefDeLaUrl() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("reserva") || params.get("ref") || "").trim();
}

function mostrarErrorDeCarga(titulo, detalle, { reintentar = true } = {}) {
  $("error-titulo").textContent = titulo;
  $("error-detalle").textContent = detalle;
  $("error-reintentar").hidden = !reintentar;
  mostrarPantalla("pantalla-error");
  anunciar(`${titulo}. ${detalle}`);
}

async function cargarReserva() {
  mostrarPantalla("pantalla-carga");

  estado.ref = leerRefDeLaUrl();
  if (!estado.ref) {
    mostrarErrorDeCarga(
      "Falta el código de reserva",
      "Entrá con el link que te enviamos por mail: incluye el código de tu reserva. Si lo perdiste, escribinos y te lo reenviamos.",
      { reintentar: false },
    );
    return;
  }

  let respuesta;
  try {
    respuesta = await fetch(`/api/reserva?ref=${encodeURIComponent(estado.ref)}`, {
      headers: { Accept: "application/json" },
    });
  } catch {
    mostrarErrorDeCarga(
      "No pudimos conectarnos",
      "Revisá tu conexión a internet y volvé a intentar.",
    );
    return;
  }

  const cuerpo = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok) {
    mostrarErrorDeCarga(
      "No pudimos abrir tu reserva",
      cuerpo.error || "Volvé a intentar en unos minutos.",
      { reintentar: cuerpo.codigo !== "reserva_inexistente" && cuerpo.codigo !== "ref_invalida" },
    );
    return;
  }

  estado.datos = cuerpo;
  aplicarMediosHabilitados();
  pintarResumen(cuerpo);

  if (cuerpo.pago?.yaPagada) {
    mostrarResultado({
      grupo: "aprobado",
      titulo: "Esta reserva ya está paga",
      detalle:
        "Ya registramos el pago de esta reserva. Si necesitás el comprobante, escribinos.",
      accion: "ninguna",
    });
    return;
  }

  const enCurso = cuerpo.transferencia;
  if (enCurso && !fueDescartado(enCurso)) {
    mostrarEstadoDeTransferencia(enCurso);
    return;
  }

  mostrarPantalla("checkout");
  await aplicarMetodo("credito");
}

const CLAVE_DESCARTE = "dimo:transferencia-descartada:";

function fueDescartado(transferencia) {
  if (transferencia.estado !== "rechazado") return false;
  try {
    return localStorage.getItem(CLAVE_DESCARTE + transferencia.id) === "1";
  } catch {
    return false;
  }
}

function marcarDescartado(transferencia) {
  try {
    localStorage.setItem(CLAVE_DESCARTE + transferencia.id, "1");
  } catch {
  }
}

function mostrarEstadoDeTransferencia(transferencia) {
  const monto = pesos.format(transferencia.monto || 0);

  if (transferencia.estado === "confirmado") {
    mostrarResultado({
      grupo: "aprobado",
      titulo: "¡Listo! Tu pago fue aprobado",
      detalle:
        `Verificamos la transferencia de ${monto} y tu reserva quedó confirmada. ` +
        "Te va a llegar el comprobante por mail. Ya podés cerrar esta página.",
      accion: "ninguna",
    });
    return;
  }

  if (transferencia.estado === "rechazado") {
    mostrarResultado({
      grupo: "rechazado",
      titulo: "No pudimos validar tu transferencia",
      detalle:
        `No encontramos la transferencia de ${monto} en nuestra cuenta. ` +
        "Puede ser que el comprobante no corresponda o que la transferencia no " +
        "haya salido. Podés pagar con otro medio acá abajo, o escribirnos si " +
        "creés que es un error.",
      accion: "otro_medio",
    });
    return;
  }

  mostrarResultado({
    grupo: "pendiente",
    titulo: "Recibimos tu comprobante",
    detalle:
      `Vamos a verificar la transferencia de ${monto} contra nuestra cuenta y ` +
      "te confirmamos por mail dentro de las 24 horas hábiles. Podés cerrar " +
      "esta página: cuando vuelvas con este mismo link vas a ver cómo salió.",
    accion: "ninguna",
  });
}

function pintarResumen({ reserva, precio }) {
  $("dato-nombre").textContent = reserva.nombre;
  $("dato-email").textContent = reserva.email;
  $("dato-dni").textContent = reserva.dni;

  const partesGrupo = [
    `${reserva.personas} ${reserva.personas === 1 ? "persona" : "personas"}`,
  ];
  if (reserva.ninos > 0) {
    partesGrupo.push(
      `${reserva.adultos} ad. · ${reserva.ninos} ${reserva.ninos === 1 ? "niño" : "niños"}`,
    );
  }
  $("dato-huespedes").textContent = partesGrupo.join(" — ");

  const n = precio.cantidadNoches;
  $("resumen-fechas").textContent =
    `${fechaCorta(reserva.checkIn)} - ${fechaCorta(reserva.checkOut)} ` +
    `(${n} ${n === 1 ? "noche" : "noches"})`;

  $("resumen-alojamiento-label").textContent = precio.tarifaUniforme
    ? `${n} ${n === 1 ? "noche" : "noches"} x ${pesos.format(precio.precioMinimo)}`
    : `Alojamiento (${n} ${n === 1 ? "noche" : "noches"})`;
  $("resumen-alojamiento").textContent = pesos.format(precio.alojamiento);

  pintarDetalleDeNoches(precio);

  $("resumen-checkin").textContent = fechaLarga(reserva.checkIn);
  $("resumen-checkout").textContent = fechaLarga(reserva.checkOut);

  actualizarTotales();
}

function actualizarTotales() {
  const base = estado.datos?.precio?.total || 0;
  const cobro = cobroActual();
  const medio = medioActual();

  const filaRecargo = $("fila-recargo");
  if (cobro.recargo > 0) {
    const nombre = medio?.nombre || "";
    const detalle = cobro.cuotas > 1 ? `${nombre}, ${cobro.cuotas} cuotas` : nombre;
    $("resumen-recargo-label").textContent =
      `Recargo (${detalle} +${formatearPorcentaje(cobro.recargoPorcentaje)}%)`;
    $("resumen-recargo").textContent = pesos.format(cobro.recargo);
    filaRecargo.hidden = false;
  } else {
    filaRecargo.hidden = true;
  }

  const filaCuotas = $("fila-cuotas");
  if (cobro.cuotas > 1) {
    $("resumen-cuotas").textContent =
      `${cobro.cuotas} x ${pesos.format(cobro.valorCuota)}`;
    filaCuotas.hidden = false;
  } else {
    filaCuotas.hidden = true;
  }

  $("resumen-total").textContent = pesos.format(cobro.total);

  $("btn-pagar-texto").textContent =
    estado.metodo === "transferencia"
      ? "Enviar comprobante"
      : `Pagar ${pesos.format(cobro.total)}`;

  const transferencia = (estado.datos?.medios || []).find((m) => m.clave === "transferencia");
  $("transfer-monto").textContent = pesos.format(transferencia?.total ?? base);

  const nota = $("nota-total");
  if (cobro.recargo > 0) {
    nota.textContent =
      `El precio de la estadía es ${pesos.format(base)}. ` +
      `El total incluye el recargo por pagar con ${(medio?.nombre || "este medio").toLowerCase()}.`;
    nota.hidden = false;
  } else {
    nota.hidden = true;
  }
}

function formatearPorcentaje(n) {
  const num = Number(n) || 0;
  return Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/0+$/, "").replace(".", ",");
}

function pintarDetalleDeNoches(precio) {
  const detalle = $("detalle-noches");
  if (precio.tarifaUniforme) {
    detalle.hidden = true;
    return;
  }

  const lista = $("detalle-noches-lista");
  lista.className = "detalle-noches-lista";
  lista.replaceChildren(
    ...precio.noches.map((noche) => {
      const fila = document.createElement("div");
      fila.className = "noche-row";

      const izq = document.createElement("span");
      izq.textContent = fechaConDia(noche.fecha);

      if (noche.motivo) {
        const etiqueta = document.createElement("span");
        etiqueta.className = "noche-motivo";
        etiqueta.textContent = noche.motivo;
        izq.appendChild(etiqueta);
      }

      const der = document.createElement("span");
      der.textContent = pesos.format(noche.precio);

      fila.append(izq, der);
      return fila;
    }),
  );
  detalle.hidden = false;
}

const METODOS = {
  credito: {
    excluidos: ["debit_card"],
    nota: "Con tarjeta de crédito podés pagar en hasta 3 cuotas.",
  },
  debito: {
    excluidos: ["credit_card"],
    nota: "Para poder pagar en hasta 3 cuotas utilizar una tarjeta de crédito (en el apartado de tarjeta de crédito).",
  },
  transferencia: {
    nota: null,
  },
};

async function aplicarMetodo(metodo) {
  estado.metodo = metodo;
  estado.cuotas = 1;

  const esTarjeta = metodo === "credito" || metodo === "debito";

  $("form-card").classList.toggle("active", esTarjeta);
  $("form-transfer").classList.toggle("active", !esTarjeta);

  $("btn-pagar").hidden = false;
  $("nota-metodo").textContent = METODOS[metodo].nota || "";
  $("nota-metodo").hidden = !METODOS[metodo].nota;

  construirSelectorDeCuotas();
  actualizarTotales();
  sincronizarBotonDePago();

  if (esTarjeta) {
    await montarBrick();
  } else {
    await desmontarBrick();
  }
}

function aplicarMediosHabilitados() {
  const habilitados = new Set((estado.datos?.medios || []).map((m) => m.clave));
  let primera = null;

  for (const boton of document.querySelectorAll(".tab-btn[data-metodo]")) {
    const clave = boton.dataset.metodo;
    const ok = habilitados.has(clave);
    boton.hidden = !ok;
    if (ok && !primera) primera = clave;
  }

  if (!habilitados.has(estado.metodo) && primera) {
    estado.metodo = primera;
    for (const boton of document.querySelectorAll(".tab-btn[data-metodo]")) {
      boton.classList.toggle("active", boton.dataset.metodo === primera);
    }
  }
}

let mp = null;

function instanciarMercadoPago(publicKey) {
  if (mp) return mp;
  if (typeof window.MercadoPago !== "function") {
    throw new Error("El SDK de MercadoPago no cargó");
  }
  mp = new window.MercadoPago(publicKey, { locale: "es-AR" });
  return mp;
}

const ESTILO_BRICK = {
  theme: "default",
  customVariables: {
    baseColor: "#163238",
    baseColorFirstVariant: "#00566b",
    textPrimaryColor: "#1e1b12",
    textSecondaryColor: "#3f484c",
    inputBackgroundColor: "#fffdf8",
    formBackgroundColor: "#fbf3e4",
    buttonTextColor: "#fffdf8",
    successColor: "#1f6b47",
    errorColor: "#942700",
    outlinePrimaryColor: "#6fcfc0",
    borderRadiusMedium: "8px",
    borderRadiusLarge: "12px",
    fontSizeSmall: "14px",
  },
};

async function montarBrick() {
  const { publicKey, reserva } = estado.datos;
  const config = METODOS[estado.metodo];
  const cobro = cobroActual();

  await desmontarBrick();

  estado.brickFallo = false;
  $("brick-cargando").hidden = false;

  let bricks;
  try {
    bricks = instanciarMercadoPago(publicKey).bricks();
  } catch (error) {
    fallaAlCargarElBrick(error);
    return;
  }

  const vigia = setTimeout(() => {
    fallaAlCargarElBrick(new Error("el Brick no respondió en 12 segundos"));
  }, 12_000);

  const settings = {
    initialization: {
      amount: cobro.total,
      payer: { email: reserva.email },
    },
    customization: {
      visual: {
        style: ESTILO_BRICK,

        hidePaymentButton: true,

        hideFormTitle: true,
      },
      paymentMethods: {
        minInstallments: 1,
        maxInstallments: 1,
        types: { excluded: config.excluidos },
      },
    },
    callbacks: {
      onReady: () => {
        clearTimeout(vigia);
        $("brick-cargando").hidden = true;
        anunciar("Formulario de pago listo.");
      },

      onSubmit: () => {
        return Promise.resolve();
      },

      onError: (error) => {
        console.error("[brick]", error?.type, error?.cause);
        $("brick-cargando").hidden = true;
      },
    },
  };

  try {
    estado.brick = await bricks.create("cardPayment", "cardPaymentBrick_container", settings);
  } catch (error) {
    clearTimeout(vigia);
    fallaAlCargarElBrick(error);
  }
}

function fallaAlCargarElBrick(error) {
  if (estado.brickFallo) return;
  estado.brickFallo = true;
  console.error("[brick] no se pudo montar:", error?.message || error);
  $("brick-cargando").hidden = true;
  $("cardPaymentBrick_container").innerHTML =
    '<p class="pantalla-detalle" style="text-align:left">' +
    "No pudimos cargar el formulario de tarjeta. Podés pagar por transferencia " +
    "desde la pestaña de al lado, o escribirnos y te ayudamos." +
    "</p>";
  mostrarAvisoDePago({
    titulo: "No pudimos cargar el formulario de pago",
    detalle:
      "Suele ser un bloqueador de anuncios o la conexión. Desactivalo para este sitio y recargá la página.",
    grupo: "rechazado",
  });
}

async function desmontarBrick() {
  if (!estado.brick) return;
  try {
    await estado.brick.unmount();
  } catch {
  }
  estado.brick = null;
  $("cardPaymentBrick_container").innerHTML = "";
}

function construirSelectorDeCuotas() {
  const contenedor = $("cuotas-selector");
  const selector = $("selector-cuotas");
  const medio = medioActual();
  const planes = medio?.planes || [];

  if (planes.length <= 1) {
    contenedor.hidden = true;
    selector.replaceChildren();
    estado.cuotas = 1;
    return;
  }

  selector.replaceChildren(
    ...planes.map((plan) => {
      const opcion = document.createElement("option");
      opcion.value = String(plan.cuotas);
      opcion.textContent =
        plan.cuotas === 1
          ? `1 pago de ${pesos.format(plan.total)}`
          : `${plan.cuotas} cuotas de ${pesos.format(plan.valorCuota)} — total ${pesos.format(plan.total)}`;
      return opcion;
    }),
  );

  const sigueDisponible = planes.some((p) => p.cuotas === estado.cuotas);
  estado.cuotas = sigueDisponible ? estado.cuotas : planes[0].cuotas;
  selector.value = String(estado.cuotas);

  contenedor.hidden = false;
}

async function alCambiarLasCuotas(evento) {
  const cuotas = Number(evento.target.value) || 1;
  if (cuotas === estado.cuotas) return;

  estado.cuotas = cuotas;
  actualizarTotales();
  anunciar(`Cuotas actualizadas: ${$("resumen-cuotas").textContent}`);

  if (estado.metodo === "credito" || estado.metodo === "debito") {
    await montarBrick();
  }
}

function mostrarVeloProcesando(visible) {
  const existente = $("velo-procesando");
  if (!visible) {
    existente?.remove();
    return;
  }
  if (existente) return;

  const velo = document.createElement("div");
  velo.className = "procesando-velo";
  velo.id = "velo-procesando";
  velo.innerHTML =
    '<div class="spinner"></div>' +
    "<p>Procesando tu pago…</p>" +
    '<span class="nota">No cierres ni recargues esta página.</span>';
  $("brick-wrapper").appendChild(velo);
}

function mostrarAvisoDePago(mensaje) {
  const aviso = $("aviso-pago");
  aviso.hidden = false;
  aviso.className = `aviso aviso--${mensaje.grupo === "pendiente" ? "espera" : "error"}`;
  $("aviso-pago-titulo").textContent = mensaje.titulo;
  $("aviso-pago-detalle").textContent = mensaje.detalle;
  aviso.scrollIntoView({ behavior: "smooth", block: "center" });
  anunciar(`${mensaje.titulo}. ${mensaje.detalle}`);
}

function ocultarAvisoDePago() {
  $("aviso-pago").hidden = true;
}

const FORMATOS_COMPROBANTE = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/pdf": "pdf",
};
const MAX_BYTES_COMPROBANTE = 5 * 1024 * 1024;

const AYUDA_COMPROBANTE = "PNG, JPG, JPEG o PDF. Hasta 5 MB.";

function tipoDelArchivo(archivo) {
  const declarado = String(archivo.type || "").trim().toLowerCase();
  if (declarado === "image/jpg") return "image/jpeg";
  if (FORMATOS_COMPROBANTE[declarado]) return declarado;

  const extension = (archivo.name.split(".").pop() || "").toLowerCase();
  const porExtension = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", pdf: "application/pdf" };
  return porExtension[extension] || "";
}

function decirDelComprobante(texto, esError) {
  const ayuda = $("comprobante-ayuda");
  ayuda.textContent = texto;
  ayuda.classList.toggle("es-error", Boolean(esError));
}

function sincronizarBotonDePago() {
  if (estado.procesando) return;
  $("btn-pagar").disabled = estado.metodo === "transferencia" && !estado.comprobante;
}

function alElegirComprobante(evento) {
  const archivo = evento.target.files && evento.target.files[0];
  evento.target.classList.remove("tiene-archivo");
  estado.comprobante = null;

  if (!archivo) {
    decirDelComprobante(AYUDA_COMPROBANTE, false);
    sincronizarBotonDePago();
    return;
  }

  const mime = tipoDelArchivo(archivo);
  if (!FORMATOS_COMPROBANTE[mime]) {
    evento.target.value = "";
    decirDelComprobante("Ese formato no sirve. Subí un PNG, JPG, JPEG o PDF.", true);
    anunciar("El archivo no tiene un formato válido.");
    sincronizarBotonDePago();
    return;
  }

  if (archivo.size > MAX_BYTES_COMPROBANTE) {
    evento.target.value = "";
    const mb = (archivo.size / 1024 / 1024).toFixed(1);
    decirDelComprobante(`Ese archivo pesa ${mb} MB y el máximo es 5 MB.`, true);
    anunciar("El archivo es demasiado grande.");
    sincronizarBotonDePago();
    return;
  }

  estado.comprobante = { archivo, mime };
  evento.target.classList.add("tiene-archivo");
  decirDelComprobante(`Listo: ${archivo.name}. Ya podés enviarlo.`, false);
  anunciar("Comprobante cargado. El botón de envío está habilitado.");
  sincronizarBotonDePago();
}

async function enviarComprobante() {
  const { archivo, mime } = estado.comprobante;

  estado.procesando = true;
  $("btn-pagar").disabled = true;
  ocultarAvisoDePago();
  mostrarVeloProcesando(true);
  anunciar("Enviando el comprobante.");

  try {
    const firma = await pedirJson("/api/comprobante", {
      ref: estado.ref,
      accion: "firmar",
      mime,
    });

    const destino =
      `${estado.datos.supabaseUrl}/storage/v1/object/upload/sign/comprobantes/` +
      `${firma.path}?token=${encodeURIComponent(firma.token)}`;

    const subida = await fetch(destino, {
      method: "PUT",
      headers: { "Content-Type": mime },
      body: archivo,
    });
    if (!subida.ok) throw new Error(`Storage respondió ${subida.status}`);

    const registro = await pedirJson("/api/comprobante", {
      ref: estado.ref,
      accion: "registrar",
      path: firma.path,
    });

    mostrarVeloProcesando(false);

    mostrarEstadoDeTransferencia({ estado: "pendiente", monto: registro.monto });
  } catch (error) {
    mostrarVeloProcesando(false);
    console.error("[comprobante]", error);
    mostrarAvisoDePago({
      titulo: "No pudimos recibir el comprobante",
      detalle:
        error.mensajeVisible ||
        "Volvé a intentar en unos minutos. Si sigue fallando, escribinos y te lo tomamos por WhatsApp.",
      grupo: "rechazado",
    });
  } finally {
    estado.procesando = false;
    sincronizarBotonDePago();
  }
}

async function pedirJson(url, cuerpo) {
  const respuesta = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });

  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    const error = new Error(datos.error || `HTTP ${respuesta.status}`);
    error.mensajeVisible = datos.error || null;
    error.codigo = datos.codigo || null;
    throw error;
  }
  return datos;
}

async function pagar() {
  if (estado.procesando) return;

  if (estado.metodo === "transferencia") {
    if (!estado.comprobante) return;
    await enviarComprobante();
    return;
  }

  if (!estado.brick) return;

  let formData;
  try {
    formData = await estado.brick.getFormData();
  } catch (error) {
    console.warn("[pago] el formulario todavía no está completo:", error?.message || error);
    anunciar("Revisá los datos de la tarjeta.");
    return;
  }
  if (!formData) return;

  formData.installments = estado.cuotas;

  await enviarPago(formData);
}

async function enviarPago(formData) {
  estado.procesando = true;
  $("btn-pagar").disabled = true;
  ocultarAvisoDePago();
  mostrarVeloProcesando(true);
  anunciar("Procesando el pago. Esperá unos segundos.");

  try {
    const respuesta = await fetch("/api/pagos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ ref: estado.ref, formData }),
    });

    const cuerpo = await respuesta.json().catch(() => ({}));
    mostrarVeloProcesando(false);

    if (!respuesta.ok) {
      if (cuerpo.codigo === "ya_pagada") {
        mostrarResultado({
          grupo: "aprobado",
          titulo: "Esta reserva ya está paga",
          detalle: cuerpo.error || "Ya registramos el pago de esta reserva.",
          accion: "ninguna",
        });
        return;
      }

      if (cuerpo.codigo === "pago_en_curso") {
        mostrarResultado({
          grupo: "pendiente",
          titulo: "Estamos confirmando tu pago",
          detalle: cuerpo.error,
          accion: "esperar",
        });
        return;
      }

      mostrarAvisoDePago(
        cuerpo.mensaje || {
          titulo: "No pudimos procesar el pago",
          detalle: cuerpo.error || "Volvé a intentar en unos minutos.",
          accion: "reintentar",
          grupo: "rechazado",
        },
      );
      return;
    }

    const { mensaje, status } = cuerpo;

    if (mensaje.grupo === "aprobado" || mensaje.grupo === "pendiente") {
      mostrarResultado(mensaje, cuerpo);
      return;
    }

    mostrarAvisoDePago(mensaje);
    console.warn("[pago] rechazado:", status, cuerpo.statusDetail);
  } catch (error) {
    mostrarVeloProcesando(false);
    console.error("[pago] error de red", error?.message);
    mostrarAvisoDePago({
      titulo: "Se cortó la conexión",
      detalle:
        "No pudimos confirmar si el pago se procesó. Revisá tu mail antes de volver a intentar, o escribinos.",
      grupo: "rechazado",
    });
  } finally {
    estado.procesando = false;
    $("btn-pagar").disabled = false;
  }
}

const ICONOS = {
  aprobado: { glifo: "check_circle", clase: "pantalla-icono--exito" },
  pendiente: { glifo: "schedule", clase: "pantalla-icono--espera" },
  rechazado: { glifo: "cancel", clase: "pantalla-icono--error" },
};

function mostrarResultado(mensaje, pago) {
  setTimeout(desmontarBrick, 0);

  const icono = ICONOS[mensaje.grupo] || ICONOS.rechazado;
  $("resultado-icono").className = `pantalla-icono ${icono.clase}`;
  $("resultado-icono-glifo").textContent = icono.glifo;
  $("resultado-titulo").textContent = mensaje.titulo;
  $("resultado-detalle").textContent = mensaje.detalle;

  const datos = $("resultado-datos");
  if (pago?.paymentId) {
    const filas = [
      ["Nº de operación", pago.paymentId],
      ["Importe", pesos.format(pago.monto)],
    ];
    if (pago.cuotas > 1) filas.push(["Cuotas", String(pago.cuotas)]);
    if (pago.ultimosCuatro) filas.push(["Tarjeta", `•••• ${pago.ultimosCuatro}`]);

    datos.replaceChildren(
      ...filas.map(([etiqueta, valor]) => {
        const fila = document.createElement("div");
        fila.className = "price-row";
        const izq = document.createElement("span");
        izq.textContent = etiqueta;
        const der = document.createElement("strong");
        der.textContent = valor;
        const cont = document.createElement("span");
        cont.appendChild(der);
        fila.append(izq, cont);
        return fila;
      }),
    );
    datos.hidden = false;
  } else {
    datos.hidden = true;
  }

  const acciones = $("resultado-acciones");
  acciones.innerHTML = "";

  if (mensaje.accion === "reintentar" || mensaje.accion === "otra_tarjeta") {
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "submit-btn";
    boton.innerHTML =
      '<span class="material-symbols-rounded">refresh</span> Probar de nuevo';
    boton.addEventListener("click", () => window.location.reload());
    acciones.appendChild(boton);
  }

  if (mensaje.accion === "otro_medio") {
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "submit-btn";
    boton.innerHTML =
      '<span class="material-symbols-rounded">credit_card</span> Pagar con otro medio';
    boton.addEventListener("click", volverAlCheckout);
    acciones.appendChild(boton);
  }

  mostrarPantalla("pantalla-resultado");
  anunciar(`${mensaje.titulo}. ${mensaje.detalle}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function volverAlCheckout() {
  if (estado.datos?.transferencia) marcarDescartado(estado.datos.transferencia);

  estado.comprobante = null;
  const input = $("comprobante-archivo");
  if (input) {
    input.value = "";
    input.classList.remove("tiene-archivo");
  }
  decirDelComprobante(AYUDA_COMPROBANTE, false);
  ocultarAvisoDePago();

  mostrarPantalla("checkout");
  window.scrollTo({ top: 0, behavior: "smooth" });

  await aplicarMetodo("credito");
  for (const tab of document.querySelectorAll(".tab-btn")) {
    tab.classList.toggle("active", tab.dataset.metodo === "credito");
  }
  anunciar("Podés elegir otro medio de pago.");
}

function activarTabs() {
  const tabs = document.querySelectorAll(".tab-btn");

  tabs.forEach((tab) => {
    tab.addEventListener("click", async () => {
      if (tab.classList.contains("active") || estado.procesando) return;

      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      ocultarAvisoDePago();

      const metodo = tab.dataset.metodo;
      const destino = metodo === "transferencia" ? $("form-transfer") : $("form-card");

      if (window.gsap) {
        window.gsap.fromTo(destino, { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.25 });
      }

      await aplicarMetodo(metodo);
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  activarTabs();
  $("error-reintentar").addEventListener("click", () => cargarReserva());
  $("btn-pagar").addEventListener("click", pagar);
  $("selector-cuotas").addEventListener("change", alCambiarLasCuotas);
  $("comprobante-archivo").addEventListener("change", alElegirComprobante);
  cargarReserva();
});
