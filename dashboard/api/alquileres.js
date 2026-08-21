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

export default async function handler(req, res) {
  if (!exigirMetodo(req, res, "GET")) return;

  try {
    exigirSesion(req);

    const filas = (await seleccionar("payments", CONSULTA)) || [];

    const alquileres = filas.map((f) => {
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
      };
    });

    const cobrado = alquileres.reduce((s, a) => s + a.monto, 0);
    const devuelto = alquileres.reduce((s, a) => s + a.devuelto, 0);

    json(res, 200, {
      alquileres,
      totales: {
        cantidad: alquileres.length,
        cobrado,
        devuelto,
        neto: cobrado - devuelto,
      },
    });
  } catch (error) {
    manejarError(res, "alquileres", error);
  }
}
