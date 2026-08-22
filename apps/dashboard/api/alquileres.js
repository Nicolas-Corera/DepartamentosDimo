import { exigirMetodo, json, manejarError } from "./_lib/http.js";
import { exigirSesion } from "./_lib/sesion.js";
import { seleccionar } from "./_lib/supabase.js";

const ESTADOS_CON_PLATA = ["approved", "refunded", "charged_back"];

const CONSULTA =
  "select=mp_payment_id,booking_id,status,monto,moneda,metodo,tipo,cuotas," +
  "ultimos_cuatro,payer_email,aprobado_en,created_at,devuelto,devuelto_en," +
  "booking_requests(id,nombre,email,dni,telefono,procedencia,check_in,check_out," +
  "personas,adultos,ninos,estado)" +
  `&status=in.(${ESTADOS_CON_PLATA.join(",")})` +
  "&order=created_at.desc";

const CONSULTA_COMPROBANTES =
  "select=id,booking_id,mime,bytes,monto_declarado,estado,created_at,revisado_en," +
  "devuelto,devuelto_en," +
  "booking_requests(id,nombre,email,dni,telefono,procedencia,check_in,check_out," +
  "personas,adultos,ninos,estado)" +
  "&order=created_at.desc";

function comprobanteComoAlquiler(c) {
  const r = c.booking_requests || null;
  const monto = Number(c.monto_declarado || 0);

  const devuelto = Number(c.devuelto || 0);

  return {
    origen: "transferencia",
    comprobanteId: c.id,

    paymentId: null,
    bookingId: c.booking_id,
    fecha: c.revisado_en || c.created_at,

    estadoComprobante: c.estado,

    estadoPago:
      c.estado !== "confirmado"
        ? "pending"
        : devuelto >= monto && monto > 0
          ? "refunded"
          : "approved",

    monto,
    devuelto,
    neto: Math.max(0, monto - devuelto),
    devueltoEn: c.devuelto_en || null,
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

    const alquileres = [...deMercadoPago, ...(comprobantes || []).map(comprobanteComoAlquiler)].sort(
      (a, b) => new Date(b.fecha) - new Date(a.fecha),
    );

    const cuentanPlata = alquileres.filter(
      (a) => a.estadoComprobante !== "pendiente" && a.estadoComprobante !== "rechazado",
    );
    const cobrado = cuentanPlata.reduce((s, a) => s + a.monto, 0);
    const devuelto = cuentanPlata.reduce((s, a) => s + a.devuelto, 0);
    const pendientes = alquileres.filter((a) => a.estadoComprobante === "pendiente");

    json(res, 200, {
      alquileres,
      totales: {
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
