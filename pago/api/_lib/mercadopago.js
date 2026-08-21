/**
 * api/_lib/mercadopago.js
 * ---------------------------------------------------------------------------
 * Todo lo que habla con MercadoPago pasa por acá: crear el pago, consultarlo y
 * validar la firma del webhook.
 *
 * El Access Token vive solo en este módulo (vía leerConfig()). Ninguna función
 * de este archivo lo devuelve ni lo loguea.
 */

import crypto from "node:crypto";
import {
  MercadoPagoConfig,
  Payment,
  WebhookSignatureValidator,
  InvalidWebhookSignatureError,
} from "mercadopago";
import { leerConfig } from "./env.js";
import { log } from "./log.js";

let clientePagos = null;

function pagos() {
  if (clientePagos) return clientePagos;
  const { mp } = leerConfig();
  const cliente = new MercadoPagoConfig({
    accessToken: mp.accessToken,
    options: { timeout: 10_000 },
  });
  clientePagos = new Payment(cliente);
  return clientePagos;
}

/**
 * Clave de idempotencia DETERMINÍSTICA.
 *
 * MercadoPago usa el header X-Idempotency-Key para garantizar que un mismo
 * pedido no genere dos cobros: si le llega dos veces la misma clave, devuelve
 * el pago original en vez de crear uno nuevo.
 *
 * Por qué derivarla de (reserva + token de tarjeta) en vez de un UUID al azar:
 * un UUID nuevo por request no protege de nada, porque el caso que queremos
 * cubrir es justamente el reintento — doble clic, F5, timeout de red que en
 * realidad sí llegó. Con esta clave, esos tres casos devuelven el MISMO pago.
 *
 * Y como el token de tarjeta es de un solo uso, dos intentos legítimos y
 * distintos (por ejemplo, reintentar con otra tarjeta) tienen tokens distintos
 * y por lo tanto claves distintas: no se pisan entre sí.
 */
export function claveIdempotencia(ref, token) {
  const hash = crypto.createHash("sha256").update(`${ref}:${token}`).digest("hex");
  // Formato UUID-like: MercadoPago acepta cualquier string, pero así es legible
  // en el panel y en los logs.
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join("-");
}

/**
 * POST /v1/payments — Checkout API.
 *
 * `datos.monto` lo calcula el servidor (ver precios.js). Lo que manda el
 * navegador se usa solo para el token y el medio de pago.
 */
export async function crearPago(datos) {
  const { mp } = leerConfig();

  const body = {
    transaction_amount: datos.monto,
    token: datos.token,
    description: datos.descripcion,
    installments: datos.cuotas,
    payment_method_id: datos.paymentMethodId,
    // La reserva. Es lo que después ata el pago del webhook con la fila de la
    // base sin depender de nada más.
    external_reference: datos.ref,
    statement_descriptor: mp.statementDescriptor,
    payer: {
      email: datos.pagador.email,
      identification: datos.pagador.identificacion,
    },
    metadata: {
      booking_id: datos.ref,
      origen: "sitio-pago-dimo",
    },
  };

  // Opcionales: si vienen vacíos, mejor no mandarlos que mandarlos en null.
  if (datos.issuerId) body.issuer_id = datos.issuerId;
  if (datos.pagador.nombre) body.payer.first_name = datos.pagador.nombre;

  const idempotencyKey = claveIdempotencia(datos.ref, datos.token);

  log.info("mp.crearPago.inicio", {
    ref: datos.ref,
    monto: datos.monto,
    cuotas: datos.cuotas,
    payment_method_id: datos.paymentMethodId,
    idempotency_key: idempotencyKey,
  });

  const respuesta = await pagos().create({ body, requestOptions: { idempotencyKey } });

  log.info("mp.crearPago.ok", {
    ref: datos.ref,
    payment_id: respuesta?.id,
    status: respuesta?.status,
    status_detail: respuesta?.status_detail,
  });

  return respuesta;
}

/** GET /v1/payments/{id} — la única fuente de verdad sobre el estado de un pago. */
export async function consultarPago(paymentId) {
  return pagos().get({ id: String(paymentId) });
}

/**
 * ¿MercadoPago rechazó este pedido por ser un duplicado?
 *
 * Cuando llegan dos requests con la misma X-Idempotency-Key, MercadoPago NO
 * devuelve el pago original: responde
 *
 *     HTTP 423  resource_already_locked
 *     code 2001 "Already posted the same request in the last minute"
 *
 * Es el caso del doble clic. Detectarlo es lo que permite mostrarle a la
 * persona el pago que SÍ se hizo, en vez de un error que la invita a pagar
 * otra vez con otra tarjeta.
 */
export function esPedidoDuplicado(error) {
  if (!error) return false;
  const status = error.status || error.statusCode;
  if (status === 423) return true;
  if (error.error === "resource_already_locked") return true;
  return Array.isArray(error.cause) && error.cause.some((c) => Number(c?.code) === 2001);
}

/**
 * GET /v1/payments/search?external_reference=… — todos los pagos de una reserva.
 *
 * Se usa para recuperarse del duplicado de arriba: como el `external_reference`
 * es el uuid de la reserva, alcanza para encontrar el pago que creó el request
 * gemelo. Se le pregunta a MercadoPago y no a nuestra base porque el gemelo
 * puede no haber terminado de escribir todavía.
 */
export async function buscarPagoPorReferencia(ref) {
  const respuesta = await pagos().search({
    options: {
      external_reference: ref,
      sort: "date_created",
      criteria: "desc",
      limit: 5,
    },
  });

  const resultados = respuesta?.results || [];
  if (!resultados.length) return null;

  // Si hubo varios intentos, el aprobado manda; si no, el más reciente.
  return resultados.find((p) => p.status === "approved") || resultados[0];
}

/**
 * Se queda con los campos del pago que vale la pena guardar. Deja afuera todo
 * lo que sea dato de tarjeta más allá de los últimos 4 dígitos (que no es
 * información sensible y sirve para que el cliente reconozca la operación).
 */
export function resumirPago(pago) {
  return {
    mp_payment_id: String(pago.id),
    external_reference: pago.external_reference || null,
    status: pago.status,
    status_detail: pago.status_detail || null,
    monto: pago.transaction_amount,
    moneda: pago.currency_id || "ARS",
    metodo: pago.payment_method_id || null,
    tipo: pago.payment_type_id || null,
    cuotas: normalizarCuotas(pago.installments),
    ultimos_cuatro: normalizarUltimosCuatro(pago.card?.last_four_digits),
    payer_email: pago.payer?.email || null,
    aprobado_en: pago.date_approved || null,
  };
}

/**
 * En los pagos RECHAZADOS, MercadoPago devuelve `card.last_four_digits` como
 * string vacío en vez de omitirlo. Guardar eso violaba el `check` de la tabla
 * y hacía fallar el INSERT — o sea que el rechazo no quedaba registrado y la
 * persona veía un error genérico en lugar de "tu tarjeta no tiene fondos".
 *
 * Solo pasa lo que de verdad son cuatro dígitos; cualquier otra cosa es null.
 */
function normalizarUltimosCuatro(valor) {
  const limpio = String(valor ?? "").trim();
  return /^[0-9]{4}$/.test(limpio) ? limpio : null;
}

/** Mismo criterio para las cuotas: fuera del rango que acepta la tabla, null. */
function normalizarCuotas(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 && n <= 24 ? n : null;
}

/* ===========================================================================
   Firma del webhook
   =========================================================================== */

/**
 * Valida el header `x-signature` de una notificación.
 *
 * MercadoPago firma con HMAC-SHA256 un "manifest" armado con tres datos:
 *
 *     id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 *
 * donde `data.id` viene en el query string de la notificación, `x-request-id`
 * es un header, y `ts` sale del propio `x-signature` (que llega como
 * `ts=1704908010,v1=618c85...`). La clave del HMAC es la que se genera en el
 * panel: tu aplicación -> Webhooks -> Generar clave secreta.
 *
 * Por qué importa: sin esto, cualquiera que conozca la URL del webhook puede
 * mandarnos un POST diciendo "el pago 123 está aprobado". Con esto, solo
 * MercadoPago puede.
 *
 * El cálculo lo hace `WebhookSignatureValidator`, que viene en el propio SDK.
 * Escribir el HMAC a mano son quince líneas y funciona, pero deja dos detalles
 * de la documentación librados a que uno los recuerde (si falta `x-request-id`
 * ese tramo del manifest se omite entero, y el id va en minúsculas), y sobre
 * todo deja el formato de la firma congelado en `v1`: el día que MercadoPago
 * publique `v2`, la versión oficial lo soporta con actualizar el paquete y la
 * artesanal falla en silencio. La comparación también es en tiempo constante.
 *
 * Esta función solo lo envuelve para no propagar excepciones: devuelve
 * { valido, motivo, ts }.
 */
export function validarFirmaWebhook({ signatureHeader, requestId, dataId, secreto }) {
  if (!secreto) return { valido: false, motivo: "no hay MP_WEBHOOK_SECRET configurado" };
  if (!dataId) return { valido: false, motivo: "falta data.id" };

  const ts = tsDeLaFirma(signatureHeader);

  try {
    WebhookSignatureValidator.validate({
      xSignature: signatureHeader,
      xRequestId: requestId,
      dataId,
      secret: secreto,
      // `toleranceSeconds` queda sin definir a propósito (chequeo desactivado):
      // el handler consulta el pago a la API y guarda el resultado de forma
      // idempotente, así que reprocesar una notificación vieja no cambia nada.
      // Activarlo agregaría un modo de falla nuevo — que el reloj del servidor
      // se corra y se caiga TODA la sincronización de estados en silencio.
    });
    return { valido: true, ts };
  } catch (error) {
    if (error instanceof InvalidWebhookSignatureError) {
      // `reason` es un enum del SDK: MissingSignatureHeader, SignatureMismatch,
      // MissingHash (= MercadoPago migró a v2 y hay que actualizar el paquete)…
      return { valido: false, motivo: error.reason, ts };
    }
    throw error;
  }
}

/** El `ts` del header, solo para medir la demora en el log. */
function tsDeLaFirma(signatureHeader) {
  const m = /(?:^|,)\s*ts\s*=\s*(\d+)/.exec(String(signatureHeader || ""));
  return m ? Number(m[1]) : null;
}
