/**
 * api/_lib/mensajes.js
 * ---------------------------------------------------------------------------
 * Traduce el par (status, status_detail) que devuelve la API de pagos a algo
 * que una persona entienda y, sobre todo, a algo que le diga QUÉ HACER.
 *
 * "cc_rejected_bad_filled_security_code" no le sirve a nadie. "Revisá el código
 * de seguridad" sí. Y la diferencia entre "probá otra tarjeta" y "llamá a tu
 * banco" es lo que decide si esa venta se recupera o se pierde.
 *
 * Referencia: MercadoPago -> Checkout API -> Manejo de respuestas.
 */

/**
 * `accion` le dice al front qué ofrecer:
 *   reintentar   -> el mismo formulario sirve, es un dato mal cargado
 *   otra_tarjeta -> hay que cambiar de medio de pago
 *   contactar    -> el problema está del lado del banco del cliente
 *   esperar      -> no hay nada que hacer, se resuelve solo
 *   ninguna      -> terminó bien
 */
const POR_DETALLE = {
  /* --- aprobados --------------------------------------------------------- */
  accredited: {
    titulo: "¡Listo! Tu pago fue aprobado",
    detalle: "Te va a llegar el comprobante por mail. Ya podés cerrar esta página.",
    accion: "ninguna",
  },

  /* --- pendientes / en revisión ------------------------------------------ */
  pending_contingency: {
    titulo: "Estamos procesando tu pago",
    detalle:
      "En menos de 2 días hábiles te avisamos por mail si se acreditó. No hace falta que vuelvas a pagar.",
    accion: "esperar",
  },
  pending_review_manual: {
    titulo: "Tu pago está en revisión",
    detalle:
      "MercadoPago lo está revisando. En menos de 2 días hábiles te avisamos por mail. No lo vuelvas a intentar.",
    accion: "esperar",
  },
  pending_waiting_transfer: {
    titulo: "Falta completar la transferencia",
    detalle: "Terminá la operación desde tu banco para que se acredite el pago.",
    accion: "esperar",
  },

  /* --- rechazos por datos mal cargados (se arreglan reintentando) --------- */
  cc_rejected_bad_filled_card_number: {
    titulo: "Revisá el número de la tarjeta",
    detalle: "El número no coincide con ninguna tarjeta. Verificalo y probá de nuevo.",
    accion: "reintentar",
  },
  cc_rejected_bad_filled_date: {
    titulo: "Revisá la fecha de vencimiento",
    detalle: "La fecha que cargaste no es la de la tarjeta. Está en el frente, con formato MM/AA.",
    accion: "reintentar",
  },
  cc_rejected_bad_filled_security_code: {
    titulo: "Revisá el código de seguridad",
    detalle:
      "El código no es correcto. Son los 3 números del dorso (4 en el frente, si es American Express).",
    accion: "reintentar",
  },
  cc_rejected_bad_filled_other: {
    titulo: "Hay un dato mal cargado",
    detalle: "Revisá el número, la fecha de vencimiento y el código de seguridad, y probá de nuevo.",
    accion: "reintentar",
  },
  cc_rejected_form_error: {
    titulo: "Hay un dato mal cargado",
    detalle: "Revisá los campos del formulario y volvé a intentar.",
    accion: "reintentar",
  },

  /* --- rechazos del banco / del emisor ------------------------------------ */
  cc_rejected_call_for_authorize: {
    titulo: "Tu banco tiene que autorizar el pago",
    detalle:
      "Llamá al teléfono que figura en el dorso de la tarjeta, autorizá el consumo y volvé a intentar.",
    accion: "contactar",
  },
  cc_rejected_insufficient_amount: {
    titulo: "La tarjeta no tiene fondos suficientes",
    detalle: "Probá con otra tarjeta o con menos cuotas.",
    accion: "otra_tarjeta",
  },
  cc_rejected_card_disabled: {
    titulo: "La tarjeta está inhabilitada",
    detalle: "Llamá a tu banco para activarla, o pagá con otra tarjeta.",
    accion: "contactar",
  },
  cc_rejected_card_error: {
    titulo: "No pudimos procesar la tarjeta",
    detalle: "Volvé a intentar en unos minutos o usá otra tarjeta.",
    accion: "otra_tarjeta",
  },
  cc_rejected_invalid_installments: {
    titulo: "Esa cantidad de cuotas no está disponible",
    detalle: "Elegí otra cantidad de cuotas para esta tarjeta.",
    accion: "reintentar",
  },
  cc_rejected_duplicated_payment: {
    titulo: "Ese pago ya lo hiciste",
    detalle:
      "Detectamos un pago igual hecho recién. Si creés que es un error, escribinos antes de volver a intentar.",
    accion: "contactar",
  },
  cc_rejected_max_attempts: {
    titulo: "Demasiados intentos",
    detalle:
      "Alcanzaste el límite de intentos con esta tarjeta. Probá con otra o esperá unas horas.",
    accion: "otra_tarjeta",
  },
  cc_rejected_high_risk: {
    titulo: "El pago fue rechazado",
    detalle: "MercadoPago no autorizó la operación. Probá con otro medio de pago o escribinos.",
    accion: "otra_tarjeta",
  },
  cc_rejected_blacklist: {
    titulo: "El pago fue rechazado",
    detalle: "No pudimos procesar la operación. Probá con otra tarjeta o escribinos.",
    accion: "otra_tarjeta",
  },
  cc_rejected_card_type_not_allowed: {
    titulo: "Ese tipo de tarjeta no está habilitado",
    detalle: "Probá con otra tarjeta de crédito o débito.",
    accion: "otra_tarjeta",
  },
  cc_rejected_other_reason: {
    titulo: "El banco rechazó el pago",
    detalle: "No nos dieron un motivo. Probá con otra tarjeta o consultá con tu banco.",
    accion: "otra_tarjeta",
  },
  cc_rejected_3ds_challenge: {
    titulo: "Falta la verificación de tu banco",
    detalle:
      "No se completó la validación con tu banco. Volvé a intentar y seguí los pasos hasta el final.",
    accion: "reintentar",
  },
  cc_rejected_3ds_mandatory: {
    titulo: "Falta la verificación de tu banco",
    detalle: "Tu banco pide una validación extra que no se completó. Volvé a intentar.",
    accion: "reintentar",
  },

  /* --- devoluciones y cancelaciones --------------------------------------- */
  refunded: {
    titulo: "El pago fue devuelto",
    detalle: "El importe vuelve a tu tarjeta. Puede tardar hasta 2 resúmenes según el banco.",
    accion: "ninguna",
  },
  by_collector: {
    titulo: "El pago fue cancelado",
    detalle: "Cancelamos la operación. Si no fuiste vos, escribinos.",
    accion: "contactar",
  },
  expired: {
    titulo: "El pago venció",
    detalle: "Pasó el plazo sin acreditarse. Podés generar uno nuevo.",
    accion: "reintentar",
  },
};

/** Cuando no conocemos el detalle, respondemos según el estado general. */
const POR_ESTADO = {
  approved: {
    titulo: "¡Listo! Tu pago fue aprobado",
    detalle: "Te va a llegar el comprobante por mail.",
    accion: "ninguna",
  },
  authorized: {
    titulo: "Pago autorizado",
    detalle: "Falta que se acredite. Te avisamos por mail cuando esté.",
    accion: "esperar",
  },
  in_process: {
    titulo: "Estamos procesando tu pago",
    detalle: "En menos de 2 días hábiles te avisamos por mail. No hace falta que vuelvas a pagar.",
    accion: "esperar",
  },
  pending: {
    titulo: "Tu pago quedó pendiente",
    detalle: "Todavía no se acreditó. Te avisamos por mail apenas se resuelva.",
    accion: "esperar",
  },
  in_mediation: {
    titulo: "El pago está en mediación",
    detalle: "MercadoPago está mediando la operación. Escribinos si necesitás ayuda.",
    accion: "contactar",
  },
  rejected: {
    titulo: "El pago fue rechazado",
    detalle: "Probá con otra tarjeta o consultá con tu banco.",
    accion: "otra_tarjeta",
  },
  cancelled: {
    titulo: "El pago fue cancelado",
    detalle: "La operación no se completó. Podés intentar de nuevo.",
    accion: "reintentar",
  },
  refunded: {
    titulo: "El pago fue devuelto",
    detalle: "El importe vuelve a tu medio de pago.",
    accion: "ninguna",
  },
  charged_back: {
    titulo: "El pago tiene un contracargo",
    detalle: "Escribinos para resolverlo.",
    accion: "contactar",
  },
};

const GENERICO = {
  titulo: "No pudimos confirmar el pago",
  detalle: "Escribinos y lo revisamos. No vuelvas a pagar hasta que te confirmemos.",
  accion: "contactar",
};

/**
 * Los tres grupos en los que el front decide qué pantalla mostrar.
 * Es más estable que mirar el status crudo en 12 lugares distintos.
 */
export function grupoDeEstado(status) {
  if (status === "approved") return "aprobado";
  if (status === "in_process" || status === "pending" || status === "authorized") return "pendiente";
  return "rechazado";
}

export function mensajeDePago(status, statusDetail) {
  const base = POR_DETALLE[statusDetail] || POR_ESTADO[status] || GENERICO;
  return { ...base, grupo: grupoDeEstado(status) };
}
