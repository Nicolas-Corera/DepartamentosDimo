/**
 * GET /api/alquileres
 * ---------------------------------------------------------------------------
 * El registro de la pestaña Alquileres: quién pagó, cuándo, cuánto y por qué
 * noches. Del más nuevo al más viejo.
 *
 * Qué cuenta como alquiler: un pago que MOVIÓ PLATA. Es decir `approved` (está
 * cobrado), `refunded` (se cobró y se devolvió) y `charged_back` (el cliente lo
 * desconoció ante su banco). Los rechazados no entran: son intentos fallidos,
 * quedan en `payments` para diagnóstico y no representan una reserva.
 *
 * Y además, las TRANSFERENCIAS. Esas no pasan por MercadoPago: la plata entra a
 * la cuenta por fuera, y lo único que llega al sistema es el comprobante que
 * sube quien reservó. Viven en `transfer_receipts` y se mezclan acá para que el
 * registro sea uno solo — con una diferencia importante: mientras el
 * comprobante está `pendiente`, la fila se muestra pero NO suma a los totales.
 * Todavía nadie miró el extracto, así que esa plata no está cobrada.
 *
 * El orden lo pone la base y no el navegador. Es lo que garantiza que la web y
 * el PDF muestren exactamente lo mismo — si ordenara cada uno por su cuenta,
 * dos criterios distintos darían dos listados distintos del mismo día.
 */

import { exigirMetodo, json, manejarError } from "./_lib/http.js";
import { exigirSesion } from "./_lib/sesion.js";
import { seleccionar } from "./_lib/supabase.js";

const ESTADOS_CON_PLATA = ["approved", "refunded", "charged_back"];

/**
 * El embed de PostgREST (`booking_requests(...)`) trae la reserva junto con el
 * pago en una sola consulta, siguiendo la foreign key `booking_id`. Sin eso
 * serían N+1 pedidos, uno por fila del listado.
 *
 * `booking_id` puede ser null: es el caso de una notificación de MercadoPago
 * que no corresponde a ninguna reserva nuestra (una devolución hecha a mano
 * desde el panel de MP, por ejemplo). Esas filas se muestran igual, con los
 * datos del huésped en blanco, porque esconderlas haría que el total del
 * reporte no cerrara con lo que dice MercadoPago.
 */
const CONSULTA =
  "select=mp_payment_id,booking_id,status,monto,moneda,metodo,tipo,cuotas," +
  "ultimos_cuatro,payer_email,aprobado_en,created_at,devuelto,devuelto_en," +
  "booking_requests(id,nombre,email,dni,telefono,procedencia,check_in,check_out," +
  "personas,adultos,ninos,estado)" +
  `&status=in.(${ESTADOS_CON_PLATA.join(",")})` +
  "&order=created_at.desc";

/**
 * Los comprobantes de transferencia, con la misma forma que un alquiler de
 * MercadoPago para que la tabla del panel no tenga que saber de dónde vino cada
 * fila. Lo que las distingue es `origen`.
 *
 * Los tres estados entran, incluso los rechazados: un comprobante que se dio de
 * baja es parte del historial de esa reserva, y esconderlo haría que el mismo
 * huésped apareciera y desapareciera del registro según lo que se decidió.
 */
const CONSULTA_COMPROBANTES =
  "select=id,booking_id,mime,bytes,monto_declarado,estado,created_at,revisado_en," +
  "booking_requests(id,nombre,email,dni,telefono,procedencia,check_in,check_out," +
  "personas,adultos,ninos,estado)" +
  "&order=created_at.desc";

function comprobanteComoAlquiler(c) {
  const r = c.booking_requests || null;
  const monto = Number(c.monto_declarado || 0);

  return {
    origen: "transferencia",
    comprobanteId: c.id,

    // No hay número de operación de MercadoPago porque no hubo operación de
    // MercadoPago. La tabla del panel lo sabe y muestra otra cosa.
    paymentId: null,
    bookingId: c.booking_id,
    fecha: c.revisado_en || c.created_at,

    // pendiente | confirmado | rechazado. Es lo que decide el cartel y los
    // botones de la fila.
    estadoComprobante: c.estado,
    estadoPago: c.estado === "confirmado" ? "approved" : "pending",

    monto,
    devuelto: 0,
    neto: monto,
    devueltoEn: null,
    moneda: "ARS",
    metodo: "transferencia",
    tipo: "bank_transfer",
    cuotas: 1,
    ultimosCuatro: null,

    huesped: r
      ? {
          nombre: r.nombre,
          email: r.email,
          dni: r.dni,
          telefono: r.telefono,
          procedencia: r.procedencia,
        }
      : { nombre: null, email: null, dni: null, telefono: null, procedencia: null },

    checkIn: r?.check_in || null,
    checkOut: r?.check_out || null,
    personas: r?.personas ?? null,
    adultos: r?.adultos ?? null,
    ninos: r?.ninos ?? null,
    estadoReserva: r?.estado || null,
  };
}

export default async function handler(req, res) {
  if (!exigirMetodo(req, res, "GET")) return;

  try {
    exigirSesion(req);

    const [filas, comprobantes] = await Promise.all([
      seleccionar("payments", CONSULTA),
      seleccionar("transfer_receipts", CONSULTA_COMPROBANTES),
    ]);

    const deMercadoPago = (filas || []).map((f) => {
      const r = f.booking_requests || null;
      const monto = Number(f.monto);
      const devuelto = Number(f.devuelto || 0);

      return {
        paymentId: f.mp_payment_id,
        bookingId: f.booking_id,

        // `aprobado_en` es cuándo MercadoPago acreditó el pago; `created_at` es
        // cuándo lo registramos nosotros. Se prefiere el primero porque es la
        // fecha que figura en el resumen de la tarjeta del huésped.
        fecha: f.aprobado_en || f.created_at,

        estadoPago: f.status,
        monto,
        devuelto,
        neto: Math.max(0, monto - devuelto),
        devueltoEn: f.devuelto_en,
        moneda: f.moneda,
        metodo: f.metodo,
        tipo: f.tipo,
        cuotas: f.cuotas,
        ultimosCuatro: f.ultimos_cuatro,

        huesped: r
          ? {
              nombre: r.nombre,
              email: r.email,
              dni: r.dni,
              telefono: r.telefono,
              procedencia: r.procedencia,
            }
          : { nombre: null, email: f.payer_email, dni: null, telefono: null, procedencia: null },

        checkIn: r?.check_in || null,
        checkOut: r?.check_out || null,
        personas: r?.personas ?? null,
        adultos: r?.adultos ?? null,
        ninos: r?.ninos ?? null,
        estadoReserva: r?.estado || null,
        origen: "mercadopago",
        comprobanteId: null,
        estadoComprobante: null,
      };
    });

    /* Las dos listas en una sola, de la más nueva a la más vieja.

       El orden lo ponía la base con un `order` y una sola tabla. Con dos hay
       que reordenar acá — pero por el MISMO criterio, así que la web y el PDF
       siguen diciendo lo mismo en el mismo orden. */
    const alquileres = [...deMercadoPago, ...(comprobantes || []).map(comprobanteComoAlquiler)].sort(
      (a, b) => new Date(b.fecha) - new Date(a.fecha),
    );

    /* Los totales cuentan SOLO plata que existe.

       Un comprobante pendiente es alguien diciendo "ya transferí": la fila se
       ve, pero sumarla al cobrado inventaría plata que nadie verificó. Y uno
       rechazado es plata que no entró nunca. */
    const cuentanPlata = alquileres.filter((a) => a.estadoComprobante !== "pendiente" && a.estadoComprobante !== "rechazado");
    const cobrado = cuentanPlata.reduce((s, a) => s + a.monto, 0);
    const devuelto = cuentanPlata.reduce((s, a) => s + a.devuelto, 0);
    const pendientes = alquileres.filter((a) => a.estadoComprobante === "pendiente");

    json(res, 200, {
      alquileres,
      totales: {
        // La cantidad acompaña al dinero: cuenta lo cobrado, no lo que todavía
        // se está mirando. Los pendientes van aparte, en su propio contador.
        cantidad: cuentanPlata.length,
        cobrado,
        devuelto,
        neto: cobrado - devuelto,
        comprobantesPendientes: pendientes.length,
        montoPendiente: pendientes.reduce((s, a) => s + a.monto, 0),
      },
    });
  } catch (error) {
    manejarError(res, "alquileres", error);
  }
}
