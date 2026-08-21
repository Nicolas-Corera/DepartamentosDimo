/**
 * api/_lib/precios.js
 * ---------------------------------------------------------------------------
 * El monto a cobrar se calcula ACÁ, en el servidor, a partir de las fechas que
 * están guardadas en la reserva. El navegador nunca manda un importe.
 *
 * Es la decisión de seguridad más importante de toda la integración: si el
 * front mandara el monto, cualquiera abre la consola, lo cambia por 1 y se
 * lleva la estadía por un peso. El Brick recibe un monto solo para mostrarlo;
 * `crearPago()` lo vuelve a calcular y usa el suyo.
 */

/** "2026-01-15" -> milisegundos UTC. Sin zona horaria de por medio. */
function aUTC(fechaISO) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fechaISO));
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

const UN_DIA = 24 * 60 * 60 * 1000;

export function calcularNoches(checkIn, checkOut) {
  const a = aUTC(checkIn);
  const b = aUTC(checkOut);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / UN_DIA);
}

/**
 * Devuelve el desglose completo. `total` es lo que se muestra; `aCobrar` es lo
 * que efectivamente va a MercadoPago (puede ser una seña, según
 * PORCENTAJE_A_COBRAR).
 */
export function calcularPrecio(reserva, precios) {
  const noches = calcularNoches(reserva.check_in, reserva.check_out);

  if (noches <= 0) {
    throw new Error(
      `Las fechas de la reserva no cierran: check_in=${reserva.check_in}, check_out=${reserva.check_out}`,
    );
  }

  const alojamiento = noches * precios.porNoche;
  const total = alojamiento + precios.limpieza;

  // Redondeo al peso: MercadoPago acepta decimales, pero en ARS los centavos
  // solo generan diferencias raras entre lo que se muestra y lo que se cobra.
  const aCobrar = Math.round((total * precios.porcentajeACobrar) / 100);

  return {
    porNoche: precios.porNoche,
    noches,
    alojamiento,
    limpieza: precios.limpieza,
    total,
    porcentajeACobrar: precios.porcentajeACobrar,
    aCobrar,
    esSenia: precios.porcentajeACobrar < 100,
    moneda: precios.moneda,
  };
}
