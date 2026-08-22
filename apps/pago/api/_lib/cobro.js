export const MODOS = ["reserva", "total"];

export function normalizarModo(crudo) {
  const modo = String(crudo || "").trim().toLowerCase();
  return MODOS.includes(modo) ? modo : "total";
}

export function montoDeLaSenia(precioTotal, porcentajeReserva) {
  const pct = Number(porcentajeReserva) || 0;
  const senia = Math.round((Number(precioTotal) || 0) * (pct / 100));
  return Math.min(senia, Number(precioTotal) || 0);
}

export function calcularCobro({ precioTotal, porcentajeReserva, pagadoBase, modo }) {
  const montoTotal = Math.max(0, Math.round(Number(precioTotal) || 0));
  const pagado = Math.max(0, Math.min(Math.round(Number(pagadoBase) || 0), montoTotal));

  const montoReserva = montoDeLaSenia(montoTotal, porcentajeReserva);
  const saldo = montoTotal - pagado;

  const pedido = normalizarModo(modo);
  const seniaPendiente = Math.max(0, montoReserva - pagado);

  const cobrarSenia = pedido === "reserva" && seniaPendiente > 0;

  const aCobrarBase = cobrarSenia ? seniaPendiente : saldo;

  const concepto = cobrarSenia ? "reserva" : pagado > 0 ? "saldo" : "total";

  return {
    modo: pedido,
    concepto,

    porcentajeReserva: Number(porcentajeReserva) || 0,
    montoTotal,
    montoReserva,
    pagado,
    saldo,

    aCobrarBase,
    yaPagada: aCobrarBase <= 0,

    esParcial: concepto === "reserva",
    cubreElResto: concepto === "saldo",

    seniaCubierta: pagado >= montoReserva && montoReserva > 0,
  };
}

export function sumarPagado({ pagos = [], transferencias = [] }) {
  const dePagos = pagos.reduce(
    (suma, p) => suma + (Number(p.monto_base ?? p.monto) || 0),
    0,
  );

  const deTransferencias = transferencias.reduce(
    (suma, t) => suma + (Number(t.monto_base ?? t.monto_declarado) || 0),
    0,
  );

  return Math.round(dePagos + deTransferencias);
}

const ETIQUETAS = {
  reserva: "Seña",
  saldo: "Saldo pendiente",
  total: "Total de la estadía",
};

export function etiquetaDeConcepto(concepto) {
  return ETIQUETAS[concepto] || ETIQUETAS.total;
}

export function deducirBase(total, recargoPorcentaje) {
  const pct = Number(recargoPorcentaje) || 0;
  if (pct <= 0) return Math.round(Number(total) || 0);
  return Math.round((Number(total) || 0) / (1 + pct / 100));
}

export function deducirConcepto({ montoBase, montoTotal, montoReserva, pagadoPrevio }) {
  const previo = Math.max(0, Number(pagadoPrevio) || 0);
  if (previo > 0) return "saldo";
  if (montoBase < montoTotal && montoReserva > 0 && montoBase <= montoReserva + 1) return "reserva";
  return "total";
}
