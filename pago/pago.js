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

/** "2026-01-15" -> "15 Ene". Sin `new Date(iso)`, que resta un día por zona horaria. */
function fechaCorta(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return String(iso);
  return `${Number(m[3])} ${MESES[Number(m[2]) - 1]}`;
}

function fechaLarga(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return String(iso);
  return `${Number(m[3])} ${MESES[Number(m[2]) - 1]}, ${m[1]}`;
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
  brick: null, // controller del Brick, para poder desmontarlo
  brickFallo: false,
  procesando: false,
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
  await montarBrick();
}

/* ===========================================================================
   2. Pintar el resumen
   =========================================================================== */

function pintarResumen({ reserva, precio }) {
  $("dato-nombre").textContent = reserva.nombre;
  $("dato-email").textContent = reserva.email;
  $("dato-dni").textContent = reserva.dni;

  const partes = [`${reserva.personas} ${reserva.personas === 1 ? "persona" : "personas"}`];
  if (reserva.ninos > 0) {
    partes.push(`${reserva.adultos} ad. · ${reserva.ninos} ${reserva.ninos === 1 ? "niño" : "niños"}`);
  }
  $("dato-huespedes").textContent = partes.join(" — ");

  $("resumen-fechas").textContent =
    `${fechaCorta(reserva.checkIn)} - ${fechaCorta(reserva.checkOut)} ` +
    `(${precio.noches} ${precio.noches === 1 ? "noche" : "noches"})`;
  $("resumen-por-noche").textContent = pesos.format(precio.porNoche);
  $("resumen-noches").textContent = `x ${precio.noches}`;
  $("resumen-checkin").textContent = fechaLarga(reserva.checkIn);
  $("resumen-checkout").textContent = fechaLarga(reserva.checkOut);
  $("resumen-limpieza").textContent = pesos.format(precio.limpieza);
  $("resumen-total").textContent = pesos.format(precio.total);
  $("transfer-monto").textContent = pesos.format(precio.aCobrar);

  // Si se cobra una seña, el total y lo que se paga ahora son distintos:
  // decirlo explícito evita el reclamo posterior.
  if (precio.esSenia) {
    $("resumen-total-label").textContent = "Total de la estadía";
    $("nota-senia").hidden = false;
    $("nota-senia").textContent =
      `Ahora pagás una seña del ${precio.porcentajeACobrar}%: ` +
      `${pesos.format(precio.aCobrar)}. El resto se abona al llegar.`;
  }
}

/* ===========================================================================
   3. El Brick
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
        texts: {
          formSubmit: `Pagar ${pesos.format(precio.aCobrar)}`,
        },
      },
      paymentMethods: {
        minInstallments: 1,
        maxInstallments: maxCuotas,
      },
    },
    callbacks: {
      onReady: () => {
        clearTimeout(vigia);
        $("brick-cargando").hidden = true;
        anunciar("Formulario de pago listo.");
      },

      /**
       * El Brick entrega `formData` con el token y el medio de pago, y espera
       * una promesa. Mientras no se resuelva, mantiene su botón bloqueado —
       * que es exactamente la protección que queremos contra el doble clic.
       */
      onSubmit: (formData) => enviarPago(formData),

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
   4. Cobrar
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
 * Manda el formulario al backend. Devuelve la promesa que espera el Brick:
 * se resuelve siempre (nunca rechaza), porque el resultado lo mostramos
 * nosotros — si la rechazáramos, el Brick pintaría su propio error encima
 * del nuestro y la persona vería dos mensajes distintos del mismo problema.
 */
async function enviarPago(formData) {
  if (estado.procesando) return;
  estado.procesando = true;
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

    // Rechazado: se queda en el formulario con el motivo arriba, así puede
    // corregir el dato o probar otra tarjeta sin volver a empezar.
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
  }
}

/* ===========================================================================
   5. Pantalla final
   =========================================================================== */

const ICONOS = {
  aprobado: { glifo: "check_circle", clase: "pantalla-icono--exito" },
  pendiente: { glifo: "schedule", clase: "pantalla-icono--espera" },
  rechazado: { glifo: "cancel", clase: "pantalla-icono--error" },
};

function mostrarResultado(mensaje, pago) {
  // Fuera del tick actual: esta función puede estar corriendo dentro del
  // onSubmit del Brick, y desmontarlo mientras espera su propia promesa es
  // pedirle que se saque la silla de abajo.
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
   6. Tabs (tarjeta / transferencia)
   =========================================================================== */

function activarTabs() {
  const tabs = document.querySelectorAll(".tab-btn");
  let activo = $("form-card");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      if (tab.classList.contains("active")) return;

      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      const destino = $(tab.dataset.target);
      if (destino === activo) return;

      const cambiar = () => {
        activo.classList.remove("active");
        destino.classList.add("active");
        activo = destino;
      };

      // GSAP es opcional: si no cargó, el cambio es instantáneo igual.
      if (window.gsap) {
        window.gsap.to(activo, {
          opacity: 0,
          y: 10,
          duration: 0.2,
          onComplete: () => {
            cambiar();
            window.gsap.fromTo(destino, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.3 });
          },
        });
      } else {
        cambiar();
      }
    });
  });
}

/* ===========================================================================
   Arranque
   =========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  activarTabs();

  $("error-reintentar").addEventListener("click", () => cargarReserva());

  $("btn-ir-al-pago").addEventListener("click", () => {
    document.querySelector(".tab-btn").click();
    $("seccion-pago").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  cargarReserva();
});
