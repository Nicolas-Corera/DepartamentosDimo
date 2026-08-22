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
  cuotas: 1,         // la que eligió la persona en NUESTRO selector

  // Transferencia: el archivo elegido, todavía sin subir. Mientras sea null el
  // botón de pago está deshabilitado — es lo único que lo habilita.
  comprobante: null,
};

/* ===========================================================================
   Precios: qué se cobra según la pestaña y las cuotas elegidas
   ---------------------------------------------------------------------------
   `/api/reserva` devuelve el precio base de la estadía y, por cada medio de
   pago habilitado, el total ya con su recargo — y en el crédito, el total de
   cada plan de cuotas. Así el resumen puede cambiar de pestaña sin volver a
   preguntarle nada al servidor.

   Lo que se muestra acá es SOLO para mostrar: el monto que se cobra lo vuelve
   a calcular /api/pagos con los mismos datos, del lado del servidor.
   =========================================================================== */

/** La configuración del medio activo, tal como vino del backend. */
function medioActual() {
  return (estado.datos?.medios || []).find((m) => m.clave === estado.metodo) || null;
}

/** Qué se cobra ahora mismo: total, recargo y cuotas. */
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
  aplicarMediosHabilitados();
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

  actualizarTotales();
}

/**
 * Las filas del resumen que cambian con la pestaña y las cuotas: recargo,
 * cuotas, total y el texto del botón. Se llama cada vez que se toca algo.
 */
function actualizarTotales() {
  const base = estado.datos?.precio?.total || 0;
  const cobro = cobroActual();
  const medio = medioActual();

  // Recargo del medio + el del plan de cuotas, en una sola fila. Sin recargo
  // la fila no aparece: no tiene sentido mostrar "Recargo $0".
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

  // Cuántas cuotas y de cuánto. El importe es el total dividido por la
  // cantidad: como el recargo lo ponemos nosotros y no hay interés de por
  // medio, la división da exacta salvo el redondeo al peso.
  const filaCuotas = $("fila-cuotas");
  if (cobro.cuotas > 1) {
    $("resumen-cuotas").textContent =
      `${cobro.cuotas} x ${pesos.format(cobro.valorCuota)}`;
    filaCuotas.hidden = false;
  } else {
    filaCuotas.hidden = true;
  }

  $("resumen-total").textContent = pesos.format(cobro.total);

  // En transferencia el botón no cobra: manda el comprobante. Prometer "Pagar
  // $945.000" cuando lo que va a pasar es subir un archivo es mentir sobre lo
  // que hace el botón.
  $("btn-pagar-texto").textContent =
    estado.metodo === "transferencia"
      ? "Enviar comprobante"
      : `Pagar ${pesos.format(cobro.total)}`;

  // La transferencia siempre muestra SU total, esté o no en esa pestaña: es el
  // dato que la persona compara para decidir con qué pagar.
  const transferencia = (estado.datos?.medios || []).find((m) => m.clave === "transferencia");
  $("transfer-monto").textContent = pesos.format(transferencia?.total ?? base);

  // Con recargo, el total de arriba deja de ser "lo que sale la estadía".
  // Decirlo explícito evita el reclamo de "me cobraron más que el precio".
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

/** 15 -> "15", 7.5 -> "7,5". Sin decimales de adorno. */
function formatearPorcentaje(n) {
  const num = Number(n) || 0;
  return Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/0+$/, "").replace(".", ",");
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

  /* El botón de pago es el mismo para las tres pestañas y está SIEMPRE
     visible. En transferencia no cobra: manda el comprobante. Lo que cambia es
     que arranca deshabilitado hasta que haya un archivo elegido. */
  $("btn-pagar").hidden = false;
  $("nota-metodo").textContent = METODOS[metodo].nota || "";
  $("nota-metodo").hidden = !METODOS[metodo].nota;

  // El selector primero: fija estado.cuotas, y de eso depende el total que
  // muestra el resumen y el monto con el que se monta el Brick.
  construirSelectorDeCuotas();
  actualizarTotales();
  sincronizarBotonDePago();

  if (esTarjeta) {
    await montarBrick();
  } else {
    await desmontarBrick();
  }
}

/**
 * Esconde las pestañas de los medios que estén deshabilitados en el dashboard,
 * y si la que venía activa es una de esas, se pasa a la primera que quede.
 */
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
  const { publicKey, reserva } = estado.datos;
  const config = METODOS[estado.metodo];
  const cobro = cobroActual();

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
      // Es el total del plan elegido: si acá fuera el precio base, el Brick le
      // mostraría a la persona un importe distinto del que se le va a cobrar.
      amount: cobro.total,
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
        /* SIEMPRE 1, aunque la persona haya elegido 3.

           No es que cobremos en un pago: la cantidad real viaja aparte, la pone
           `pagar()` sobre el formData antes de mandarlo. Esto es lo único que
           apaga el selector de cuotas propio del Brick.

           Antes acá iba `min = max = cobro.cuotas`, y el Brick igual dibujaba
           su bloque "Seleccioná la cantidad de cuotas" abajo del formulario,
           con una sola opción y el cartelito de CFTEA/TEA. Duplicaba nuestro
           selector y, peor, esas tasas son las de MercadoPago: no describen
           nuestro recargo, que es el que se está cobrando.

           No hay opción de configuración para esconderlo. La regla que usa el
           Brick para decidir si lo muestra es, textual, que haya UNA sola
           opción Y que valga 1:

             1 === opciones.length && 1 === opciones[0].value ? ocultar : mostrar

           Con `min = max = 3` hay una sola opción, pero vale 3, y por eso se
           veía. Con 1 se cumplen las dos condiciones y el bloque no se dibuja.

           Lo que se pierde: el Brick ya no valida contra MercadoPago que la
           tarjeta acepte esa cantidad de cuotas. Si no las acepta, el rechazo
           llega igual desde el backend al cobrar, con su mensaje. */
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
   5. Cuotas — nuestro selector, no el del Brick
   ---------------------------------------------------------------------------
   El recargo de cada plan lo definimos nosotros desde el dashboard, así que la
   cantidad de cuotas cambia el importe que se cobra. El Brick recibe el monto
   al montarse y no lo recalcula solo, de modo que si las cuotas se eligieran
   adentro del formulario mostraría el importe de otro plan.

   Por eso el selector vive acá arriba, se elige antes de cargar la tarjeta, y
   cada cambio vuelve a montar el Brick con el monto definitivo y con esa
   cantidad de cuotas fija (min = max = la elegida).

   Esto también saca de encima el hack anterior, que leía el <select> del Brick
   desde el DOM con un MutationObserver y lo identificaba por el texto de sus
   opciones. Funcionaba, pero dependía de que MercadoPago no cambiara nada del
   markup que su propia documentación pide no tocar.
   =========================================================================== */

/** Arma el <select> de cuotas con los planes que devolvió el backend. */
function construirSelectorDeCuotas() {
  const contenedor = $("cuotas-selector");
  const selector = $("selector-cuotas");
  const medio = medioActual();
  const planes = medio?.planes || [];

  // Sin planes (débito, transferencia) o con uno solo, no hay nada que elegir.
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

  // Si la cantidad que estaba elegida ya no existe en este medio, se vuelve a
  // la primera opción en vez de dejar el selector en un estado imposible.
  const sigueDisponible = planes.some((p) => p.cuotas === estado.cuotas);
  estado.cuotas = sigueDisponible ? estado.cuotas : planes[0].cuotas;
  selector.value = String(estado.cuotas);

  contenedor.hidden = false;
}

/**
 * Cambio de cuotas: se actualiza el resumen y se vuelve a montar el Brick con
 * el monto nuevo.
 *
 * Remontar borra lo que haya tipeado en la tarjeta. Es aceptable porque el
 * selector está ARRIBA del formulario: en el orden natural de lectura las
 * cuotas se eligen antes de sacar la tarjeta del bolsillo. Y si alguien vuelve
 * a cambiarlas después, perder los datos es mejor que cobrarle un importe
 * distinto del que está viendo.
 */
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
/* ===========================================================================
   6b. Transferencia: el comprobante
   ---------------------------------------------------------------------------
   La transferencia no se cobra desde acá: la hace la persona en su banco. Lo
   que hace esta página es recibir el comprobante y dejarlo registrado para que
   el equipo lo confirme contra el extracto.

   Por eso el botón del resumen arranca deshabilitado en esta pestaña: sin
   archivo no hay nada que mandar, y un botón que se puede apretar y no hace
   nada es peor que uno apagado.

   La subida NO pasa por nuestra función. `/api/comprobante` firma una
   autorización de un solo uso para una ruta que elige el servidor, y el
   archivo va del navegador a Storage directo. Así no hay tope de 4,5 MB de
   body ni base64 de por medio, y el bucket sigue cerrado para `anon`.
   =========================================================================== */

/** Los cuatro formatos que se aceptan, y la extensión que los delata. */
const FORMATOS_COMPROBANTE = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/pdf": "pdf",
};
const MAX_BYTES_COMPROBANTE = 5 * 1024 * 1024;

/** El texto que muestra el campo cuando no hay nada elegido ni nada que avisar. */
const AYUDA_COMPROBANTE = "PNG, JPG, JPEG o PDF. Hasta 5 MB.";

/**
 * El tipo declarado por el navegador, normalizado.
 *
 * Windows manda a veces "image/jpg" (que no es un MIME real) y, con algunos
 * archivos sin extensión, string vacío. Cuando no dice nada, se cae a la
 * extensión del nombre: es una pista peor, pero es la que hay. Igual esto es
 * solo para no dejar avanzar lo obvio — quien valida en serio es el servidor,
 * sobre el archivo ya subido.
 */
function tipoDelArchivo(archivo) {
  const declarado = String(archivo.type || "").trim().toLowerCase();
  if (declarado === "image/jpg") return "image/jpeg";
  if (FORMATOS_COMPROBANTE[declarado]) return declarado;

  const extension = (archivo.name.split(".").pop() || "").toLowerCase();
  const porExtension = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", pdf: "application/pdf" };
  return porExtension[extension] || "";
}

/** El texto de ayuda debajo del campo, en su versión normal o de error. */
function decirDelComprobante(texto, esError) {
  const ayuda = $("comprobante-ayuda");
  ayuda.textContent = texto;
  ayuda.classList.toggle("es-error", Boolean(esError));
}

/**
 * Deja el botón de pago como corresponde a la pestaña actual.
 *
 * En tarjeta siempre habilitado (el Brick valida lo suyo al enviar). En
 * transferencia, solo con un comprobante elegido.
 */
function sincronizarBotonDePago() {
  if (estado.procesando) return;
  $("btn-pagar").disabled = estado.metodo === "transferencia" && !estado.comprobante;
}

/** Alguien eligió un archivo (o lo sacó). Valida y habilita o no el botón. */
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
    // Se limpia el input: si quedara el archivo elegido, el mensaje de error
    // conviviría con un nombre de archivo en pantalla y parecería aceptado.
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

/** Sube el comprobante y lo registra. Dos pasos, como los espera el backend. */
async function enviarComprobante() {
  const { archivo, mime } = estado.comprobante;

  estado.procesando = true;
  $("btn-pagar").disabled = true;
  ocultarAvisoDePago();
  mostrarVeloProcesando(true);
  anunciar("Enviando el comprobante.");

  try {
    // 1. La autorización de subida. La ruta la elige el servidor.
    const firma = await pedirJson("/api/comprobante", {
      ref: estado.ref,
      accion: "firmar",
      mime,
    });

    // 2. El archivo, del navegador a Storage. Sin pasar por nuestra función.
    const destino =
      `${estado.datos.supabaseUrl}/storage/v1/object/upload/sign/comprobantes/` +
      `${firma.path}?token=${encodeURIComponent(firma.token)}`;

    const subida = await fetch(destino, {
      method: "PUT",
      headers: { "Content-Type": mime },
      body: archivo,
    });
    if (!subida.ok) throw new Error(`Storage respondió ${subida.status}`);

    // 3. Recién con el archivo arriba se deja constancia. El backend mira el
    //    objeto real —tamaño y tipo— antes de escribir la fila.
    const registro = await pedirJson("/api/comprobante", {
      ref: estado.ref,
      accion: "registrar",
      path: firma.path,
    });

    mostrarVeloProcesando(false);
    mostrarResultado({
      grupo: "pendiente",
      titulo: "Recibimos tu comprobante",
      detalle:
        `Vamos a verificar la transferencia de ${pesos.format(registro.monto)} contra ` +
        "nuestra cuenta y te confirmamos por mail dentro de las 24 horas hábiles.",
      accion: "ninguna",
    });
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

/**
 * POST con JSON a nuestra API. Si el backend devuelve un error con mensaje
 * propio, lo cuelga del Error para que el catch lo pueda mostrar tal cual:
 * "Esta reserva ya está paga" explica mucho más que el genérico.
 */
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

  // En transferencia el botón no cobra: manda el comprobante. Sin archivo no
  // llega acá (el botón está deshabilitado), pero el chequeo es barato.
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

  /* Las cuotas las pone NUESTRO selector, no el del Brick.

     El Brick se monta con min = max = 1 para que no dibuje su propio selector
     (ver `montarBrick()`), así que el formData vuelve siempre con
     `installments: 1`. La cantidad que la persona eligió está en
     `estado.cuotas`, y es la que tiene que viajar.

     No es un agujero: para el backend este número es entrada del navegador,
     igual que antes. `/api/pagos` lo valida contra el máximo configurado y
     calcula el importe a partir del plan — el monto nunca se manda desde acá. */
  formData.installments = estado.cuotas;

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
  $("selector-cuotas").addEventListener("change", alCambiarLasCuotas);
  $("comprobante-archivo").addEventListener("change", alElegirComprobante);
  cargarReserva();
});
