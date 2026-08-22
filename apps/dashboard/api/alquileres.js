import { exigirMetodo, json, manejarError } from "./_lib/http.js";
import { exigirSesion } from "./_lib/sesion.js";
import { seleccionar, leerConfigTarifas, leerConfigDeCobro } from "./_lib/supabase.js";
import { calcularPrecio } from "./_lib/precios.js";
import { montoDeLaSenia } from "./_lib/cobro.js";

const ESTADOS_CON_PLATA = ["approved", "refunded", "charged_back"];

const CONSULTA =
  "select=mp_payment_id,booking_id,status,monto,monto_base,concepto,moneda,metodo,tipo,cuotas," +
  "ultimos_cuatro,payer_email,aprobado_en,created_at,devuelto,devuelto_en," +
  "booking_requests(id,nombre,email,dni,telefono,procedencia,check_in,check_out," +
  "personas,adultos,ninos,estado)" +
  `&status=in.(${ESTADOS_CON_PLATA.join(",")})` +
  "&order=created_at.desc";

const CONSULTA_COMPROBANTES =
  "select=id,booking_id,mime,bytes,monto_declarado,monto_base,concepto,estado,created_at,revisado_en," +
  "devuelto,devuelto_en," +
  "booking_requests(id,nombre,email,dni,telefono,procedencia,check_in,check_out," +
  "personas,adultos,ninos,estado)" +
  "&order=created_at.desc";

function datosDeLaReserva(saldos, bookingId) {
  const info = saldos.get(bookingId);
  if (!info) {
    return { totalReserva: null, pagadoReserva: null, saldoReserva: null, reservaCompleta: null };
  }
  return {
    totalReserva: info.total,
    pagadoReserva: info.pagado,
    saldoReserva: info.saldo,
    reservaCompleta: info.completa,
  };
}

function comprobanteComoAlquiler(c, saldos) {
  const r = c.booking_requests || null;
  const monto = Number(c.monto_declarado || 0);

  const devuelto = Number(c.devuelto || 0);

  return {
    origen: "transferencia",
    comprobanteId: c.id,
    concepto: c.concepto || null,
    ...datosDeLaReserva(saldos, c.booking_id),

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

function reservasConSaldo(pagos, comprobantes, tarifas, especiales, cobroConfig) {
  const porReserva = new Map();

  const anotar = (bookingId, reserva, base) => {
    if (!bookingId || !reserva?.check_in) return;
    if (!porReserva.has(bookingId)) {
      porReserva.set(bookingId, { reserva, pagado: 0 });
    }
    porReserva.get(bookingId).pagado += base;
  };

  for (const p of pagos || []) {
    if (p.status !== "approved") continue;
    anotar(p.booking_id, p.booking_requests, Number(p.monto_base ?? p.monto) || 0);
  }

  for (const c of comprobantes || []) {
    if (c.estado !== "confirmado") continue;
    anotar(c.booking_id, c.booking_requests, Number(c.monto_base ?? c.monto_declarado) || 0);
  }

  const resultado = new Map();

  for (const [bookingId, { reserva, pagado }] of porReserva) {
    let total = 0;
    try {
      total = calcularPrecio(
        reserva,
        tarifas.temporadas,
        especiales || [],
        cobroConfig.tarifaLimpieza,
      ).total;
    } catch {
      continue;
    }

    const cobrado = Math.min(Math.round(pagado), total);

    resultado.set(bookingId, {
      total,
      pagado: cobrado,
      saldo: Math.max(0, total - cobrado),
      senia: montoDeLaSenia(total, cobroConfig.porcentajeReserva),
      completa: cobrado >= total,
    });
  }

  return resultado;
}

export default async function handler(req, res) {
  if (!exigirMetodo(req, res, "GET")) return;

  try {
    exigirSesion(req);

    const [filas, comprobantes, tarifas, especiales, cobroConfig] = await Promise.all([
      seleccionar("payments", CONSULTA),
      seleccionar("transfer_receipts", CONSULTA_COMPROBANTES),
      leerConfigTarifas(),
      seleccionar("tarifas_especiales", "select=fecha_desde,fecha_hasta,precio_por_noche,motivo"),
      leerConfigDeCobro(),
    ]);

    const saldos = reservasConSaldo(filas, comprobantes, tarifas, especiales, cobroConfig);

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
        concepto: f.concepto || null,
        ...datosDeLaReserva(saldos, f.booking_id),
      };
    });

    const alquileres = [...deMercadoPago, ...(comprobantes || []).map((c) => comprobanteComoAlquiler(c, saldos))].sort(
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
