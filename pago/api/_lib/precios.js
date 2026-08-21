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
 * En dos etapas: primero el precio base de la estadía, después el recargo del
 * medio de pago.
 *
 * ETAPA 1 — BASE. Noche por noche, no con un precio único por estadía:
 *
 *   a. TEMPORADA — el rango de `public.temporadas` en el que cae esa noche.
 *      Son rangos absolutos, con año, y se editan desde el dashboard. Si dos
 *      se solapan gana el más caro; si la noche no cae en ninguno, se cobra al
 *      precio de la temporada baja (el fallback).
 *
 *   b. TARIFA ESPECIAL — si la noche cae dentro de un rango cargado en
 *      `public.tarifas_especiales`, ese precio pisa al de la temporada. Ahí
 *      viven los fines de semana largo (y cualquier otra excepción).
 *
 * El total de esta etapa es el precio DE TRANSFERENCIA: el de contado.
 *
 * ETAPA 2 — RECARGO. Sobre ese total se suma el recargo del medio de pago
 * (`public.medios_pago`) y, si es crédito en cuotas, el del plan elegido
 * (`public.planes_cuotas`). Los dos porcentajes se suman entre sí: un crédito
 * con +8% pagado en 3 cuotas con un plan de +15% termina en +23% sobre la base.
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

/** Las noches de una estadía, como fechas ISO. */
export function nochesDe(checkIn, checkOut) {
  const cantidad = calcularNoches(checkIn, checkOut);
  const inicio = aUTC(checkIn);
  const fechas = [];
  for (let i = 0; i < cantidad; i++) fechas.push(aISO(inicio + i * UN_DIA));
  return fechas;
}

/**
 * La temporada en la que cae una fecha.
 *
 * Los rangos son absolutos y los carga una persona desde el dashboard, así que
 * hay que contemplar los dos accidentes posibles:
 *
 *   - Se SOLAPAN dos rangos: gana el más caro. Es la interpretación
 *     conservadora — mejor cobrar de más y que el cliente reclame, que cobrar
 *     de menos y comerse la diferencia.
 *
 *   - No la cubre NINGUNO (típico: se venció el ciclo y nadie corrió las
 *     fechas): devuelve null y el que llama usa el fallback. Nunca tira un
 *     error, porque eso dejaría al cliente sin poder pagar por un descuido de
 *     configuración.
 */
export function temporadaDe(fechaISO, temporadas = []) {
  let elegida = null;
  for (const t of temporadas) {
    if (fechaISO >= t.fecha_desde && fechaISO <= t.fecha_hasta) {
      if (!elegida || t.precio_por_noche > elegida.precio_por_noche) elegida = t;
    }
  }
  return elegida;
}

/**
 * El precio de las noches huérfanas: las que no caen en ninguna temporada.
 *
 * Es el de la temporada baja. Si tampoco existiera esa fila, la más barata de
 * las que haya. Solo si la tabla está vacía se levanta la mano y se corta, que
 * es el único caso en el que inventar un número sería peor que fallar.
 */
export function precioDeFallback(temporadas = []) {
  const baja = temporadas.find((t) => t.clave === "baja");
  if (baja) return baja.precio_por_noche;

  const precios = temporadas.map((t) => t.precio_por_noche).filter(Number.isFinite);
  if (precios.length) return Math.min(...precios);

  throw new Error(
    "No hay ninguna temporada cargada en la tabla `temporadas`: no se puede calcular el precio.",
  );
}

/**
 * Busca si una fecha cae en alguna tarifa especial.
 * Mismo criterio que las temporadas ante un solapamiento: gana la más cara.
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
 * ETAPA 1: el desglose base, noche por noche.
 *
 * `total` es lo que sale la estadía pagada por transferencia. El recargo del
 * medio de pago lo agrega `calcularRecargo()`, que se llama después — cuando ya
 * se sabe con qué va a pagar.
 *
 * @param reserva     fila de booking_requests (usa check_in y check_out)
 * @param temporadas  filas de `temporadas`
 * @param especiales  filas de `tarifas_especiales` que tocan el rango (puede ir [])
 */
export function calcularPrecio(reserva, temporadas = [], especiales = []) {
  const fechas = nochesDe(reserva.check_in, reserva.check_out);

  if (fechas.length === 0) {
    throw new Error(
      `Las fechas de la reserva no cierran: check_in=${reserva.check_in}, check_out=${reserva.check_out}`,
    );
  }

  const fallback = precioDeFallback(temporadas);

  const noches = fechas.map((fecha) => {
    const temporada = temporadaDe(fecha, temporadas);
    const especial = tarifaEspecialDe(fecha, especiales);

    if (especial) {
      return {
        fecha,
        precio: especial.precio_por_noche,
        temporada: temporada?.clave || null,
        motivo: especial.motivo,
      };
    }

    return {
      fecha,
      precio: temporada ? temporada.precio_por_noche : fallback,
      temporada: temporada?.clave || null,
      motivo: null,
    };
  });

  const alojamiento = noches.reduce((suma, n) => suma + n.precio, 0);

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
    // Sin recargo: es el precio de transferencia.
    total: alojamiento,
    // Cuántas noches se cobraron con el fallback. Cero es lo normal; cualquier
    // otro número significa que hay un hueco en las temporadas y se está
    // cobrando por defecto. Va al log para que se pueda detectar.
    nochesSinTemporada: noches.filter((n) => !n.temporada && !n.motivo).length,
    moneda: "ARS",
  };
}

/** El plan de cuotas habilitado para esa cantidad, o null. */
export function planDeCuotas(cuotas, planes = []) {
  return planes.find((p) => p.habilitado && Number(p.cuotas) === Number(cuotas)) || null;
}

/** La mayor cantidad de cuotas habilitada. 1 si no hay ninguna. */
export function maximoDeCuotas(planes = []) {
  const habilitados = planes.filter((p) => p.habilitado).map((p) => Number(p.cuotas));
  return habilitados.length ? Math.max(...habilitados) : 1;
}

/** El medio de pago habilitado con esa clave, o null. */
export function medioDePago(clave, medios = []) {
  return medios.find((m) => m.habilitado && m.clave === clave) || null;
}

/**
 * ETAPA 2: el recargo del medio de pago sobre el total base.
 *
 * Los dos porcentajes se SUMAN, no se componen. Un +8% de crédito y un +15% de
 * plan dan +23% sobre la base, no +24,2%. Es la cuenta que hace cualquiera con
 * una calculadora mirando el resumen, y coincidir con eso vale más que la
 * precisión financiera de componerlos.
 *
 * @param totalBase  el `total` que devolvió calcularPrecio()
 * @param medio      fila de `medios_pago`
 * @param plan       fila de `planes_cuotas`, o null para un pago sin cuotas
 */
export function calcularRecargo(totalBase, medio, plan = null) {
  const recargoMedio = Number(medio?.recargo_porcentaje || 0);
  const recargoCuotas = Number(plan?.recargo_porcentaje || 0);
  const recargoPorcentaje = recargoMedio + recargoCuotas;

  // Redondeo al peso: MercadoPago acepta decimales, pero en ARS los centavos
  // solo generan diferencias raras entre lo que se muestra y lo que se cobra.
  const total = Math.round(totalBase * (1 + recargoPorcentaje / 100));
  const recargo = total - totalBase;
  const cuotas = Number(plan?.cuotas || 1);

  return {
    medio: medio?.clave || null,
    cuotas,
    recargoMedio,
    recargoCuotas,
    recargoPorcentaje,
    recargo,
    totalBase,
    total,
    // Solo para mostrar. La división puede no dar exacta; el importe real de
    // cada cuota lo define MercadoPago.
    valorCuota: cuotas > 1 ? Math.round(total / cuotas) : total,
    hayRecargo: recargoPorcentaje > 0,
  };
}
