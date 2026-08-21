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
 *
 * ---------------------------------------------------------------------------
 * CÓMO SE ARMA EL PRECIO
 *
 * Noche por noche, no con un precio único por estadía. Dos pasos:
 *
 *   1. TEMPORADA — según en qué parte del año cae esa noche:
 *
 *        15/12 al 31/01   alta
 *        01/02 al 15/02   media
 *        16/02 al 14/12   baja
 *
 *      Los importes de cada temporada están en variables de entorno.
 *
 *   2. TARIFA ESPECIAL — si la noche cae dentro de un rango cargado en la
 *      tabla `tarifas_especiales`, ese precio pisa al de la temporada. Ahí
 *      viven los fines de semana largo (y cualquier otra excepción).
 *
 * Una "noche" se identifica por la fecha en la que se duerme: una estadía del
 * 10 al 14 son las noches del 10, 11, 12 y 13. La del 14 no se cobra porque esa
 * mañana se van.
 */

/** "2026-01-15" -> milisegundos UTC. Sin zona horaria de por medio. */
function aUTC(fechaISO) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fechaISO));
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** El inverso: milisegundos UTC -> "2026-01-15". */
function aISO(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

const UN_DIA = 24 * 60 * 60 * 1000;

export function calcularNoches(checkIn, checkOut) {
  const a = aUTC(checkIn);
  const b = aUTC(checkOut);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / UN_DIA);
}

/**
 * En qué temporada cae una fecha. Se mira solo el día y el mes: las temporadas
 * se repiten todos los años.
 *
 * Ojo con la temporada alta, que cruza el año: arranca el 15/12 y termina el
 * 31/01. Por eso son dos condiciones y no un rango.
 */
export function temporadaDe(fechaISO) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fechaISO));
  if (!m) return "baja";

  const mes = Number(m[2]);
  const dia = Number(m[3]);

  if ((mes === 12 && dia >= 15) || mes === 1) return "alta";
  if (mes === 2 && dia <= 15) return "media";
  return "baja";
}

/** Las noches de una estadía, como fechas ISO. */
export function nochesDe(checkIn, checkOut) {
  const cantidad = calcularNoches(checkIn, checkOut);
  const inicio = aUTC(checkIn);
  const fechas = [];
  for (let i = 0; i < cantidad; i++) fechas.push(aISO(inicio + i * UN_DIA));
  return fechas;
}

/**
 * Busca si una fecha cae en alguna tarifa especial.
 * Si se solapan dos rangos (no debería, pero puede pasar cargando a mano),
 * gana el más caro: es la interpretación conservadora — mejor cobrar de más y
 * que el cliente reclame, que cobrar de menos y comerse la diferencia.
 */
function tarifaEspecialDe(fechaISO, tarifas) {
  let elegida = null;
  for (const t of tarifas) {
    if (fechaISO >= t.fecha_desde && fechaISO <= t.fecha_hasta) {
      if (!elegida || t.precio_por_noche > elegida.precio_por_noche) elegida = t;
    }
  }
  return elegida;
}

/**
 * Devuelve el desglose completo, noche por noche.
 *
 * `total` es lo que sale la estadía; `aCobrar` es lo que efectivamente va a
 * MercadoPago (puede ser una seña, según PORCENTAJE_A_COBRAR).
 *
 * @param reserva  fila de booking_requests (usa check_in y check_out)
 * @param precios  config.precios (importes por temporada, limpieza, %)
 * @param tarifas  filas de tarifas_especiales que tocan el rango (puede ir [])
 */
export function calcularPrecio(reserva, precios, tarifas = []) {
  const fechas = nochesDe(reserva.check_in, reserva.check_out);

  if (fechas.length === 0) {
    throw new Error(
      `Las fechas de la reserva no cierran: check_in=${reserva.check_in}, check_out=${reserva.check_out}`,
    );
  }

  const noches = fechas.map((fecha) => {
    const temporada = temporadaDe(fecha);
    const especial = tarifaEspecialDe(fecha, tarifas);

    return especial
      ? { fecha, precio: especial.precio_por_noche, temporada, motivo: especial.motivo }
      : { fecha, precio: precios.porTemporada[temporada], temporada, motivo: null };
  });

  const alojamiento = noches.reduce((suma, n) => suma + n.precio, 0);
  const total = alojamiento + precios.limpieza;

  // Redondeo al peso: MercadoPago acepta decimales, pero en ARS los centavos
  // solo generan diferencias raras entre lo que se muestra y lo que se cobra.
  const aCobrar = Math.round((total * precios.porcentajeACobrar) / 100);

  const importes = noches.map((n) => n.precio);
  const minimo = Math.min(...importes);
  const maximo = Math.max(...importes);

  return {
    noches,
    cantidadNoches: noches.length,
    // Cuando todas las noches valen igual, el resumen puede decir "precio por
    // noche". Cuando no, tiene que mostrar el desglose o el cliente no entiende
    // de dónde sale el total.
    tarifaUniforme: minimo === maximo,
    precioMinimo: minimo,
    precioMaximo: maximo,
    alojamiento,
    limpieza: precios.limpieza,
    total,
    porcentajeACobrar: precios.porcentajeACobrar,
    aCobrar,
    esSenia: precios.porcentajeACobrar < 100,
    moneda: precios.moneda,
  };
}
