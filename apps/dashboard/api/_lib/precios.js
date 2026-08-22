function aUTC(fechaISO) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fechaISO));
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

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

export function nochesDe(checkIn, checkOut) {
  const cantidad = calcularNoches(checkIn, checkOut);
  const inicio = aUTC(checkIn);
  const fechas = [];
  for (let i = 0; i < cantidad; i++) fechas.push(aISO(inicio + i * UN_DIA));
  return fechas;
}

export function temporadaDe(fechaISO, temporadas = []) {
  let elegida = null;
  for (const t of temporadas) {
    if (fechaISO >= t.fecha_desde && fechaISO <= t.fecha_hasta) {
      if (!elegida || t.precio_por_noche > elegida.precio_por_noche) elegida = t;
    }
  }
  return elegida;
}

export function precioDeFallback(temporadas = []) {
  const baja = temporadas.find((t) => t.clave === "baja");
  if (baja) return baja.precio_por_noche;

  const precios = temporadas.map((t) => t.precio_por_noche).filter(Number.isFinite);
  if (precios.length) return Math.min(...precios);

  throw new Error(
    "No hay ninguna temporada cargada en la tabla `temporadas`: no se puede calcular el precio.",
  );
}

function tarifaEspecialDe(fechaISO, tarifas) {
  let elegida = null;
  for (const t of tarifas) {
    if (fechaISO >= t.fecha_desde && fechaISO <= t.fecha_hasta) {
      if (!elegida || t.precio_por_noche > elegida.precio_por_noche) elegida = t;
    }
  }
  return elegida;
}

export function calcularPrecio(reserva, temporadas = [], especiales = [], tarifaLimpieza = 0) {
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

  const limpieza = Math.max(0, Math.round(Number(tarifaLimpieza) || 0));

  const importes = noches.map((n) => n.precio);
  const minimo = Math.min(...importes);
  const maximo = Math.max(...importes);

  return {
    noches,
    cantidadNoches: noches.length,

    tarifaUniforme: minimo === maximo,
    precioMinimo: minimo,
    precioMaximo: maximo,
    alojamiento,
    limpieza,
    hayLimpieza: limpieza > 0,

    total: alojamiento + limpieza,

    nochesSinTemporada: noches.filter((n) => !n.temporada && !n.motivo).length,
    moneda: "ARS",
  };
}

export function planDeCuotas(cuotas, planes = []) {
  return planes.find((p) => p.habilitado && Number(p.cuotas) === Number(cuotas)) || null;
}

export function maximoDeCuotas(planes = []) {
  const habilitados = planes.filter((p) => p.habilitado).map((p) => Number(p.cuotas));
  return habilitados.length ? Math.max(...habilitados) : 1;
}

export function medioDePago(clave, medios = []) {
  return medios.find((m) => m.habilitado && m.clave === clave) || null;
}

export function calcularRecargo(totalBase, medio, plan = null) {
  const recargoMedio = Number(medio?.recargo_porcentaje || 0);
  const recargoCuotas = Number(plan?.recargo_porcentaje || 0);
  const recargoPorcentaje = recargoMedio + recargoCuotas;

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

    valorCuota: cuotas > 1 ? Math.round(total / cuotas) : total,
    hayRecargo: recargoPorcentaje > 0,
  };
}
