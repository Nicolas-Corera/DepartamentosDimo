import { exigirMetodo, json, leerBody, manejarError, ErrorVisible, entero, porcentaje, fechaISO } from "./_lib/http.js";
import { exigirSesion } from "./_lib/sesion.js";
import { seleccionar, upsert, insertar, actualizar, borrar } from "./_lib/supabase.js";

const TEMPORADAS = {
  alta: "Temporada Alta",
  media: "Temporada Media",
  baja: "Temporada Baja",
};

const MEDIOS = {
  transferencia: "Transferencia",
  debito: "Tarjeta de débito",
  credito: "Tarjeta de crédito",
};

const CLAVES_TEMPORADA = Object.keys(TEMPORADAS);
const CLAVES_MEDIO = Object.keys(MEDIOS);
const MAX_CUOTAS_POSIBLES = 24;
const PRECIO_MAX = 100_000_000;
const PORCENTAJE_RESERVA_POR_DEFECTO = 30;

async function leerTodo() {
  const [temporadas, medios, planes, especiales, cobro] = await Promise.all([
    seleccionar("temporadas", "select=clave,nombre,fecha_desde,fecha_hasta,precio_por_noche,orden&order=orden"),
    seleccionar("medios_pago", "select=clave,nombre,habilitado,recargo_porcentaje,orden&order=orden"),
    seleccionar("planes_cuotas", "select=cuotas,habilitado,recargo_porcentaje&order=cuotas"),
    seleccionar("tarifas_especiales", "select=id,fecha_desde,fecha_hasta,precio_por_noche,motivo&order=fecha_desde"),
    seleccionar("configuracion_pagos", "select=porcentaje_reserva,tarifa_limpieza&id=eq.1"),
  ]);

  const normalizados = (planes || []).map((p) => ({
    cuotas: Number(p.cuotas),
    habilitado: p.habilitado,
    recargoPorcentaje: Number(p.recargo_porcentaje),
  }));

  const habilitadas = normalizados.filter((p) => p.habilitado).map((p) => p.cuotas);

  return {
    porcentajeReserva: Number(cobro?.[0]?.porcentaje_reserva ?? PORCENTAJE_RESERVA_POR_DEFECTO),
    tarifaLimpieza: Number(cobro?.[0]?.tarifa_limpieza ?? 0),
    temporadas: (temporadas || []).map((t) => ({
      clave: t.clave,
      nombre: t.nombre,
      desde: t.fecha_desde,
      hasta: t.fecha_hasta,
      precio: t.precio_por_noche,
    })),
    medios: (medios || []).map((m) => ({
      clave: m.clave,
      nombre: m.nombre,
      habilitado: m.habilitado,
      recargoPorcentaje: Number(m.recargo_porcentaje),
    })),
    maxCuotas: habilitadas.length ? Math.max(...habilitadas) : 1,
    planes: normalizados,
    especiales: (especiales || []).map((e) => ({
      id: e.id,
      desde: e.fecha_desde,
      hasta: e.fecha_hasta,
      precio: e.precio_por_noche,
      motivo: e.motivo,
    })),
  };
}

function validar(cuerpo) {
  const errores = [];

  const temporadas = [];
  for (const clave of CLAVES_TEMPORADA) {
    const fila = (cuerpo.temporadas || []).find((t) => t?.clave === clave);
    if (!fila) {
      errores.push(`Falta la temporada "${clave}".`);
      continue;
    }

    const desde = fechaISO(fila.desde);
    const hasta = fechaISO(fila.hasta);
    const precio = entero(fila.precio, { min: 1, max: PRECIO_MAX });

    if (!desde || !hasta) errores.push(`Las fechas de la temporada ${clave} no son válidas.`);
    else if (hasta < desde) errores.push(`En la temporada ${clave}, "hasta" es anterior a "desde".`);
    if (precio === null) errores.push(`El precio de la temporada ${clave} tiene que ser un número mayor a 0.`);

    if (desde && hasta && hasta >= desde && precio !== null) {
      temporadas.push({
        clave,
        nombre: TEMPORADAS[clave],
        fecha_desde: desde,
        fecha_hasta: hasta,
        precio_por_noche: precio,
      });
    }
  }

  const medios = [];
  for (const clave of CLAVES_MEDIO) {
    const fila = (cuerpo.medios || []).find((m) => m?.clave === clave);
    if (!fila) {
      errores.push(`Falta el medio de pago "${clave}".`);
      continue;
    }
    const recargo = porcentaje(fila.recargoPorcentaje);
    if (recargo === null) errores.push(`El recargo de ${clave} tiene que ser un porcentaje entre 0 y 100.`);
    else {
      medios.push({
        clave,
        nombre: MEDIOS[clave],
        habilitado: Boolean(fila.habilitado),
        recargo_porcentaje: recargo,
      });
    }
  }

  if (medios.length && !medios.some((m) => m.habilitado)) {
    errores.push("Tiene que quedar al menos un medio de pago habilitado, o nadie puede pagar.");
  }

  const maxCuotas = entero(cuerpo.maxCuotas, { min: 1, max: MAX_CUOTAS_POSIBLES });
  if (maxCuotas === null) {
    errores.push(`El máximo de cuotas tiene que ser un número entre 1 y ${MAX_CUOTAS_POSIBLES}.`);
  }

  const planes = [];
  if (maxCuotas !== null) {
    for (let n = 1; n <= MAX_CUOTAS_POSIBLES; n++) {
      const fila = (cuerpo.planes || []).find((p) => Number(p?.cuotas) === n);
      const recargo = fila ? porcentaje(fila.recargoPorcentaje) : 0;
      if (fila && recargo === null) {
        errores.push(`El recargo de ${n} cuota${n === 1 ? "" : "s"} tiene que ser un porcentaje entre 0 y 100.`);
        continue;
      }
      planes.push({ cuotas: n, habilitado: n <= maxCuotas, recargo_porcentaje: recargo ?? 0 });
    }
  }

  const especiales = [];
  for (const [i, fila] of (cuerpo.especiales || []).entries()) {
    const etiqueta = fila?.motivo?.trim() ? `"${fila.motivo.trim()}"` : `#${i + 1}`;

    const desde = fechaISO(fila?.desde);
    const hasta = fechaISO(fila?.hasta);
    const precio = entero(fila?.precio, { min: 1, max: PRECIO_MAX });
    const motivo = String(fila?.motivo || "").trim();

    if (!desde || !hasta) { errores.push(`La fecha especial ${etiqueta} tiene fechas inválidas.`); continue; }
    if (hasta < desde) { errores.push(`En la fecha especial ${etiqueta}, "hasta" es anterior a "desde".`); continue; }
    if (precio === null) { errores.push(`El precio de la fecha especial ${etiqueta} tiene que ser mayor a 0.`); continue; }
    if (motivo.length < 2 || motivo.length > 80) {
      errores.push(`La fecha especial ${etiqueta} necesita un motivo de entre 2 y 80 caracteres.`);
      continue;
    }

    const id = fila?.id == null ? null : entero(fila.id, { min: 1 });
    especiales.push({ id, fecha_desde: desde, fecha_hasta: hasta, precio_por_noche: precio, motivo });
  }

  const porcentajeReserva = porcentaje(cuerpo.porcentajeReserva);
  if (porcentajeReserva === null || porcentajeReserva <= 0) {
    errores.push("El porcentaje de seña tiene que ser un número mayor a 0 y hasta 100.");
  }

  const tarifaLimpieza = entero(cuerpo.tarifaLimpieza, { min: 0, max: PRECIO_MAX });
  if (tarifaLimpieza === null) {
    errores.push(
      "La tarifa de limpieza tiene que ser un número entero de 0 en adelante. " +
        "Poné 0 si no querés cobrarla.",
    );
  }

  if (errores.length) {
    throw new ErrorVisible(400, errores.join(" "), "validacion");
  }

  return { temporadas, medios, planes, especiales, porcentajeReserva, tarifaLimpieza };
}

async function guardarTodo(datos) {
  const sello = new Date().toISOString();

  await upsert("configuracion_pagos", [
    {
      id: 1,
      porcentaje_reserva: datos.porcentajeReserva,
      tarifa_limpieza: datos.tarifaLimpieza,
      actualizado_en: sello,
    },
  ]);

  await upsert("temporadas", datos.temporadas.map((t) => ({ ...t, actualizado_en: sello })));
  await upsert("medios_pago", datos.medios.map((m) => ({ ...m, actualizado_en: sello })));
  await upsert("planes_cuotas", datos.planes.map((p) => ({ ...p, actualizado_en: sello })));

  const existentes = (await seleccionar("tarifas_especiales", "select=id")) || [];
  const queSiguen = new Set(datos.especiales.map((e) => e.id).filter(Boolean));
  const aBorrar = existentes.map((e) => e.id).filter((id) => !queSiguen.has(id));

  if (aBorrar.length) {
    await borrar("tarifas_especiales", `id=in.(${aBorrar.join(",")})`);
  }

  for (const especial of datos.especiales.filter((e) => e.id)) {
    const { id, ...campos } = especial;
    await actualizar("tarifas_especiales", `id=eq.${id}`, campos);
  }

  const nuevas = datos.especiales.filter((e) => !e.id).map(({ id, ...resto }) => resto);
  if (nuevas.length) await insertar("tarifas_especiales", nuevas);
}

export default async function handler(req, res) {
  if (!exigirMetodo(req, res, ["GET", "PUT"])) return;

  try {
    exigirSesion(req);

    if (req.method === "GET") {
      return json(res, 200, await leerTodo());
    }

    const datos = validar(leerBody(req));
    await guardarTodo(datos);

    console.log(
      `[tarifas] guardadas — ${datos.temporadas.length} temporadas, ` +
        `${datos.especiales.length} fechas especiales`,
    );

    json(res, 200, await leerTodo());
  } catch (error) {
    manejarError(res, "tarifas", error);
  }
}
