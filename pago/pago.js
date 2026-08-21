/**
 * pago.js
 * ---------------------------------------------------------------------------
 * Frontend del checkout. Hace tres cosas:
 *
 *   1. Pide la reserva a /api/reserva?ref=<uuid> (resumen, monto y Public Key).
 *   2. Monta el Card Payment Brick de MercadoPago con esa Public Key.
 *   3. Manda lo que arma el Brick a /api/pagos y muestra el resultado.
 *
 * Lo que este archivo NUNCA ve: el número de tarjeta, el vencimiento y el CVV.
 * Esos campos son iframes de MercadoPago; el SDK los cambia por un token de un
 * solo uso. Por eso acá no hay ni un `input` de tarjeta ni validación de Luhn:
 * si los tuviera, el sitio entraría en alcance PCI y no queremos eso.
 *
 * Tampoco viaja el monto: el backend lo recalcula solo. El `amount` que se le
 * pasa al Brick es para mostrar, nada más.
 */

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

/** "2026-01-15" -> {y, m, d}. Sin `new Date(iso)`, que resta un día por zona horaria. */
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

/** "2027-01-15" -> "Vie 15 Ene". El día de la semana ayuda a leer el desglose. */
function fechaConDia(iso) {
  const p = partes(iso);
  if (!p) return String(iso);
  const dia = DIAS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
  return `${dia} ${p.d} ${MESES[p.m - 1]}`;
}

function anunciar(texto) {
  $("anuncio").textContent = texto;
}

/** Solo una pantalla visible por vez. */
function mostrarPantalla(cual) {
  for (const id of ["pantalla-carga", "pantalla-error", "checkout", "pantalla-resultado"]) {
    $(id).hidden = id !== cual;
  }
}

/* ===========================================================================
   Estado
   =========================================================================== */

const estado = {
  ref: null,
  datos: null, // respuesta de /api/reserva
  brick: null, // controller del Brick, para desmontarlo y para getFormData()
  brickFallo: false,
  procesando: false,

  metodo: "credito", // credito | debito | transferencia

  // Planes de cuotas que devuelve MercadoPago para la tarjeta que se está
  // tipeando. Se piden en onBinChange y sirven para mostrar los importes en el
  // resumen.
  planes: [],
  cuotas: 1,
  textoCuotas: "", // lo que dice la opción elegida en el formulario del Brick
};

/* ===========================================================================
   1. Cargar la reserva
   =========================================================================== */

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
  pintarResumen(cuerpo);

  // Reserva ya paga: no se monta el Brick. Es el freno más importante contra
  // el doble cobro, porque actúa antes de que la persona cargue la tarjeta.
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

  mostrarPantalla("checkout");
  await aplicarMetodo("credito");
}

/* ===========================================================================
   2. Resumen
   =========================================================================== */

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

  // Cuando todas las noches valen igual alcanza con "N noches x $precio".
  // Cuando no (temporadas distintas, un fin de semana largo en el medio), el
  // encabezado solo puede decir el total: el detalle va en el desplegable.
  $("resumen-alojamiento-label").textContent = precio.tarifaUniforme
    ? `${n} ${n === 1 ? "noche" : "noches"} x ${pesos.format(precio.precioMinimo)}`
    : `Alojamiento (${n} ${n === 1 ? "noche" : "noches"})`;
  $("resumen-alojamiento").textContent = pesos.format(precio.alojamiento);

  pintarDetalleDeNoches(precio);

  $("resumen-checkin").textContent = fechaLarga(reserva.checkIn);
  $("resumen-checkout").textContent = fechaLarga(reserva.checkOut);
  $("resumen-total").textContent = pesos.format(precio.total);
  $("transfer-monto").textContent = pesos.format(precio.aCobrar);
  $("btn-pagar-texto").textContent = `Pagar ${pesos.format(precio.aCobrar)}`;
}

/**
 * El desglose noche por noche. Solo se ofrece cuando las noches no valen todas
 * lo mismo — si son todas iguales, el encabezado ya lo dice y desplegar una
 * lista de cinco filas idénticas es ruido.
 */
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

      // El motivo ("Carnaval", "Semana Santa") explica por qué esa noche sale
      // más: sin eso, un precio distinto en el medio de la lista parece un error.
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

/* ===========================================================================
   3. Métodos de pago
   =========================================================================== */

/**
 * Lo que cambia entre una pestaña y otra.
 *
 * `excluidos` se lo pasamos al Brick para que no acepte el tipo de tarjeta que
 * no corresponde: en la pestaña de débito, una tarjeta de crédito no entra.
 */
const METODOS = {
  credito: {
    excluidos: ["debit_card"],
    nota: "Con tarjeta de crédito podés pagar en cuotas. Elegí la cantidad en el formulario y vas a ver el detalle en el resumen.",
    conCuotas: true,
  },
  debito: {
    excluidos: ["credit_card"],
    nota: "Con tarjeta de débito el cobro es siempre en un solo pago. Si querés cuotas, usá la pestaña de crédito.",
    conCuotas: false,
  },
  transferencia: {
    nota: null,
    conCuotas: false,
  },
};

async function aplicarMetodo(metodo) {
  estado.metodo = metodo;
  estado.planes = [];
  estado.cuotas = 1;
  estado.textoCuotas = "";

  const esTarjeta = metodo === "credito" || metodo === "debito";

  $("form-card").classList.toggle("active", esTarjeta);
  $("form-transfer").classList.toggle("active", !esTarjeta);

  // En transferencia no hay nada que enviar: el botón de pago no aplica.
  $("btn-pagar").hidden = !esTarjeta;
  $("nota-metodo").textContent = METODOS[metodo].nota || "";
  $("nota-metodo").hidden = !METODOS[metodo].nota;

  actualizarFilaDeCuotas();

  if (esTarjeta) {
    await montarBrick();
  } else {
    await desmontarBrick();
  }
}

/* ===========================================================================
   4. El Brick
   =========================================================================== */

let mp = null;

function instanciarMercadoPago(publicKey) {
  if (mp) return mp;
  if (typeof window.MercadoPago !== "function") {
    throw new Error("El SDK de MercadoPago no cargó");
  }
  mp = new window.MercadoPago(publicKey, { locale: "es-AR" });
  return mp;
}

/** Los colores del sitio, traducidos a las variables que expone el Brick. */
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
  const { publicKey, maxCuotas, reserva, precio } = estado.datos;
  const config = METODOS[estado.metodo];

  // Por si quedó una instancia de un montaje anterior. Dos Bricks sobre el
  // mismo contenedor se pisan y el segundo no dispara onReady.
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

  /**
   * Vigía: si en 12 segundos el Brick no llamó a onReady, damos por perdida la
   * carga y lo decimos.
   *
   * Hace falta porque el SDK no avisa de forma confiable cuando no puede
   * inicializarse: con una public key inválida rechaza una promesa interna
   * (que aparece en la consola como "Uncaught (in promise)") y la promesa que
   * devuelve `create()` se queda colgada para siempre. Sin este timeout, la
   * persona se queda mirando "Cargando el formulario seguro…" sin más.
   * Con una key válida, el Brick monta en 1 o 2 segundos.
   */
  const vigia = setTimeout(() => {
    fallaAlCargarElBrick(new Error("el Brick no respondió en 12 segundos"));
  }, 12_000);

  const settings = {
    initialization: {
      // Solo para mostrar. El backend recalcula el monto y usa el suyo.
      amount: precio.aCobrar,
      payer: { email: reserva.email },
    },
    customization: {
      visual: {
        style: ESTILO_BRICK,
        // El botón de pago vive en el resumen, no acá. Ver `pagar()`.
        hidePaymentButton: true,
        // El Brick titula su formulario "Tarjeta de crédito o débito", que
        // contradice a la pestaña elegida: en la de débito diría que también
        // acepta crédito. Las pestañas ya dicen de qué se trata.
        hideFormTitle: true,
      },
      paymentMethods: {
        minInstallments: 1,
        // En débito, un solo pago. En crédito, hasta el tope configurado.
        maxInstallments: config.conCuotas ? maxCuotas : 1,
        types: { excluded: config.excluidos },
      },
    },
    callbacks: {
      onReady: () => {
        clearTimeout(vigia);
        $("brick-cargando").hidden = true;
        anunciar("Formulario de pago listo.");
      },

      /**
       * Se dispara con cada cambio en los primeros dígitos de la tarjeta. Es el
       * único momento en que sabemos QUÉ tarjeta es, y por lo tanto qué planes
       * de cuotas ofrece y a qué importe.
       */
      onBinChange: (bin) => {
        if (config.conCuotas) cargarPlanesDeCuotas(bin);
      },

      onSubmit: () => {
        // El envío lo dispara el botón del resumen (`pagar()`), no el Brick.
        // Este callback igual tiene que existir: el Brick lo exige.
        return Promise.resolve();
      },

      onError: (error) => {
        // Errores del propio Brick (validación, red, SDK). No traen datos de
        // tarjeta, pero por las dudas solo se loguea el código.
        console.error("[brick]", error?.type, error?.cause);
        $("brick-cargando").hidden = true;
      },
    },
  };

  // `create` devuelve una promesa que RECHAZA si el Brick no puede
  // inicializarse — public key inválida, bloqueador de anuncios, sin red.
  // Sin este catch, la promesa queda sin manejar y la página se queda para
  // siempre en "Cargando el formulario seguro…", sin decir por qué.
  try {
    estado.brick = await bricks.create("cardPayment", "cardPaymentBrick_container", settings);
    vigilarSelectorDeCuotas();
  } catch (error) {
    clearTimeout(vigia);
    fallaAlCargarElBrick(error);
  }
}

/**
 * Única salida para "el formulario de tarjeta no cargó". Es idempotente: la
 * puede llamar el catch, el vigía o las dos, y el resultado es el mismo.
 */
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
    /* si ya estaba desmontado, no hay nada que hacer */
  }
  estado.brick = null;
  $("cardPaymentBrick_container").innerHTML = "";
}

/* ===========================================================================
   5. Cuotas — mantener el resumen en sincronía
   =========================================================================== */

/**
 * Los planes de cuotas de la tarjeta que se está tipeando, con sus importes
 * reales (incluido el interés, si lo hay).
 */
async function cargarPlanesDeCuotas(bin) {
  if (!bin || bin.length < 6) {
    estado.planes = [];
    actualizarFilaDeCuotas();
    return;
  }

  try {
    const respuesta = await mp.getInstallments({
      amount: String(estado.datos.precio.aCobrar),
      bin,
      paymentTypeId: "credit_card",
    });
    estado.planes = respuesta?.[0]?.payer_costs || [];
  } catch (error) {
    // No es grave: sin esto el resumen muestra la cantidad de cuotas sin el
    // importe de cada una. El cobro no depende de esta llamada.
    console.warn("[cuotas] no se pudieron traer los planes:", error?.message || error);
    estado.planes = [];
  }
  actualizarFilaDeCuotas();
}

/**
 * El Brick no avisa cuando cambian las cuotas: no existe un
 * `onInstallmentsChange`.
 *
 * Pero el selector de cuotas SÍ vive en el DOM de esta página (solo el número
 * de tarjeta, el vencimiento y el código de seguridad son iframes de
 * MercadoPago). Así que se lo escucha directamente:
 *
 *   - un listener de `change` delegado en el contenedor, para cuando la persona
 *     elige otra cantidad;
 *   - un MutationObserver, porque el selector no existe hasta que se reconoce
 *     la tarjeta, y cuando aparece ya trae una opción elegida que hay que leer.
 *
 * El selector se identifica por lo que dicen sus opciones ("N cuotas de $X"),
 * no por sus clases ni sus ids: la documentación de MercadoPago pide
 * expresamente no depender de esos nombres porque los cambian.
 *
 * Si algo de esto falla, el resumen simplemente no muestra la fila de cuotas.
 * El cobro sigue funcionando igual: la cantidad de cuotas que se cobra sale de
 * getFormData(), no de acá.
 */
function vigilarSelectorDeCuotas() {
  const contenedor = $("cardPaymentBrick_container");

  const observer = new MutationObserver(() => sincronizarCuotasDesdeElFormulario());
  observer.observe(contenedor, { childList: true, subtree: true });

  contenedor.addEventListener("change", (evento) => {
    if (esSelectorDeCuotas(evento.target)) sincronizarCuotasDesdeElFormulario();
  });
}

function esSelectorDeCuotas(elemento) {
  return (
    elemento instanceof HTMLSelectElement &&
    Array.from(elemento.options).some((o) => /cuota/i.test(o.textContent || ""))
  );
}

function sincronizarCuotasDesdeElFormulario() {
  const selector = Array.from(
    $("cardPaymentBrick_container").querySelectorAll("select"),
  ).find(esSelectorDeCuotas);

  const cuotas = selector ? leerCantidadDeCuotas(selector) : 1;

  // El texto de la opción elegida ES el importe que MercadoPago le está
  // mostrando a la persona, ya con el interés y ya formateado. Guardarlo evita
  // tener que recalcularlo — y evita el riesgo de recalcularlo mal.
  const textoOficial = selector
    ? (selector.options[selector.selectedIndex]?.textContent || "").trim()
    : "";

  if (cuotas === estado.cuotas && textoOficial === estado.textoCuotas) return;

  estado.cuotas = cuotas;
  estado.textoCuotas = textoOficial;
  actualizarFilaDeCuotas();
}

/** El `value` suele ser el número; si no, se saca del texto ("3 cuotas de …"). */
function leerCantidadDeCuotas(selector) {
  const porValor = parseInt(selector.value, 10);
  if (Number.isInteger(porValor) && porValor >= 1 && porValor <= 24) return porValor;

  const texto = selector.options[selector.selectedIndex]?.textContent || "";
  const m = /(\d+)\s*cuota/i.exec(texto);
  return m ? Number(m[1]) : 1;
}

function actualizarFilaDeCuotas() {
  const fila = $("fila-cuotas");
  const conCuotas = METODOS[estado.metodo]?.conCuotas;

  if (!conCuotas || estado.cuotas <= 1) {
    fila.hidden = true;
    return;
  }

  const plan = estado.planes.find((p) => p.installments === estado.cuotas);

  /**
   * De dónde sale el importe, en orden de preferencia:
   *
   *   1. `recommended_message` de getInstallments — ya armado y localizado por
   *      MercadoPago: "3 cuotas de $ 23.333,33 ($ 70.000,00)".
   *   2. El texto de la opción elegida en el formulario, que dice exactamente
   *      lo mismo.
   *   3. Solo "N cuotas", sin importe.
   *
   * El paso 3 NO calcula nada. Es tentador dividir el total por la cantidad de
   * cuotas, pero cuando las cuotas tienen interés esa división da MENOS que lo
   * que la persona va a pagar de verdad: le estaríamos mostrando un precio más
   * barato que el real en la pantalla donde decide pagar. Mejor no decir el
   * importe que decirlo mal — el formulario, al lado, lo tiene bien.
   */
  const texto =
    plan?.recommended_message ||
    estado.textoCuotas ||
    `${estado.cuotas} cuotas`;

  $("resumen-cuotas").textContent = texto;
  fila.hidden = false;
  anunciar(`Cuotas actualizadas: ${texto}`);
}

/* ===========================================================================
   6. Cobrar
   =========================================================================== */

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

/**
 * El botón del resumen. Le pide al Brick los datos del formulario y, con eso,
 * llama al backend.
 *
 * `getFormData()` valida el formulario primero: si falta algo o hay un campo
 * mal, rechaza y el Brick marca los errores solo. Por eso el catch no muestra
 * nada extra — sería un segundo mensaje diciendo lo mismo.
 */
async function pagar() {
  if (estado.procesando || !estado.brick) return;

  let formData;
  try {
    formData = await estado.brick.getFormData();
  } catch (error) {
    console.warn("[pago] el formulario todavía no está completo:", error?.message || error);
    anunciar("Revisá los datos de la tarjeta.");
    return;
  }
  if (!formData) return;

  await enviarPago(formData);
}

/** Manda el formulario al backend y muestra el resultado. */
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
      // Solo el código de reserva y lo que armó el Brick. El monto no viaja:
      // lo pone el servidor.
      body: JSON.stringify({ ref: estado.ref, formData }),
    });

    const cuerpo = await respuesta.json().catch(() => ({}));
    mostrarVeloProcesando(false);

    if (!respuesta.ok) {
      // "Ya pagada" no es un reintento fallido: es una pantalla final, y con
      // su propio texto. El backend responde 409 sin `mensaje`, así que el
      // genérico de abajo no sirve para este caso.
      if (cuerpo.codigo === "ya_pagada") {
        mostrarResultado({
          grupo: "aprobado",
          titulo: "Esta reserva ya está paga",
          detalle: cuerpo.error || "Ya registramos el pago de esta reserva.",
          accion: "ninguna",
        });
        return;
      }

      // Doble clic: el otro request está cobrando en este mismo momento.
      // Pantalla de espera, NO de error — lo último que queremos es sugerirle
      // que lo intente otra vez cuando el pago ya salió.
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

    // Rechazado: el Brick se queda montado y con los datos cargados, así la
    // persona corrige el campo que falló y reenvía. Al reenviar, el SDK genera
    // un token nuevo (el anterior es de un solo uso), así que no hace falta
    // remontar nada — y remontar le borraría todo lo que escribió.
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

/* ===========================================================================
   7. Pantalla final
   =========================================================================== */

const ICONOS = {
  aprobado: { glifo: "check_circle", clase: "pantalla-icono--exito" },
  pendiente: { glifo: "schedule", clase: "pantalla-icono--espera" },
  rechazado: { glifo: "cancel", clase: "pantalla-icono--error" },
};

function mostrarResultado(mensaje, pago) {
  // Fuera del tick actual: esta función puede estar corriendo dentro de un
  // callback del Brick, y desmontarlo en el medio es pedirle que se saque la
  // silla de abajo.
  setTimeout(desmontarBrick, 0);

  const icono = ICONOS[mensaje.grupo] || ICONOS.rechazado;
  $("resultado-icono").className = `pantalla-icono ${icono.clase}`;
  $("resultado-icono-glifo").textContent = icono.glifo;
  $("resultado-titulo").textContent = mensaje.titulo;
  $("resultado-detalle").textContent = mensaje.detalle;

  // Comprobante mínimo: lo que la persona necesita para reclamar si algo falla.
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

  mostrarPantalla("pantalla-resultado");
  anunciar(`${mensaje.titulo}. ${mensaje.detalle}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ===========================================================================
   8. Pestañas
   =========================================================================== */

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

      // GSAP es opcional: si no cargó, el cambio es instantáneo igual.
      if (window.gsap) {
        window.gsap.fromTo(destino, { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.25 });
      }

      await aplicarMetodo(metodo);
    });
  });
}

/* ===========================================================================
   Arranque
   =========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  activarTabs();
  $("error-reintentar").addEventListener("click", () => cargarReserva());
  $("btn-pagar").addEventListener("click", pagar);
  cargarReserva();
});
