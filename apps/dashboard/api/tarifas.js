/**
 * GET /api/tarifas  — todo lo que muestra la pestaña Tarifas
 * PUT /api/tarifas  — guarda todo de una
 * ---------------------------------------------------------------------------
 * Un solo endpoint para las cuatro tablas (temporadas, medios de pago, planes
 * de cuotas y fechas especiales) porque la pantalla tiene un solo botón de
 * "Guardar Cambios": partirlo en cuatro endpoints haría que un guardado pudiera
 * quedar a mitad de camino, con las temporadas nuevas y los recargos viejos.
 *
 * Sigue sin ser atómico — PostgREST no da transacciones entre tablas — pero al
 * menos falla en un solo lugar y con un solo mensaje. Por eso TODO se valida
 * antes de escribir la primera fila: si algo no cierra, no se escribe nada.
 */

import { exigirMetodo, json, leerBody, manejarError, ErrorVisible, entero, porcentaje, fechaISO } from "./_lib/http.js";
import { exigirSesion } from "./_lib/sesion.js";
import { seleccionar, upsert, insertar, actualizar, borrar } from "./_lib/supabase.js";

/**
 * Los nombres son fijos: el panel edita fechas, precios y recargos, no cómo se
 * llaman las cosas. Van igual en cada guardado porque `nombre` es NOT NULL y
 * el upsert de PostgREST es un INSERT ... ON CONFLICT: aunque las filas ya
 * existan siempre, el INSERT tiene que ser válido o el pedido se rechaza.
 */
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

/* ===========================================================================
   Lectura
   =========================================================================== */

async function leerTodo() {
  const [temporadas, medios, planes, especiales] = await Promise.all([
    seleccionar("temporadas", "select=clave,nombre,fecha_desde,fecha_hasta,precio_por_noche,orden&order=orden"),
    seleccionar("medios_pago", "select=clave,nombre,habilitado,recargo_porcentaje,orden&order=orden"),
    seleccionar("planes_cuotas", "select=cuotas,habilitado,recargo_porcentaje&order=cuotas"),
    seleccionar("tarifas_especiales", "select=id,fecha_desde,fecha_hasta,precio_por_noche,motivo&order=fecha_desde"),
  ]);

  const normalizados = (planes || []).map((p) => ({
    cuotas: Number(p.cuotas),
    habilitado: p.habilitado,
    recargoPorcentaje: Number(p.recargo_porcentaje),
  }));

  const habilitadas = normalizados.filter((p) => p.habilitado).map((p) => p.cuotas);

  return {
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

/* ===========================================================================
   Validación
   ---------------------------------------------------------------------------
   Todo junto y antes de escribir. Los mensajes nombran la fila exacta ("La
   Temporada Alta…") porque del otro lado hay un formulario con cuatro tarjetas
   y "precio inválido" a secas obligaría a revisarlas todas.
   =========================================================================== */

function validar(cuerpo) {
  const errores = [];

  // --- Temporadas -----------------------------------------------------------
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

  // --- Medios de pago -------------------------------------------------------
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

  // --- Cuotas ---------------------------------------------------------------
  const maxCuotas = entero(cuerpo.maxCuotas, { min: 1, max: MAX_CUOTAS_POSIBLES });
  if (maxCuotas === null) {
    errores.push(`El máximo de cuotas tiene que ser un número entre 1 y ${MAX_CUOTAS_POSIBLES}.`);
  }

  // Se escriben las 24 filas siempre: las de arriba del máximo quedan
  // deshabilitadas. Así bajar el máximo de 6 a 3 apaga de verdad las de 4 a 6,
  // en vez de dejarlas habilitadas y esperando.
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

  // --- Fechas especiales ----------------------------------------------------
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

  if (errores.length) {
    throw new ErrorVisible(400, errores.join(" "), "validacion");
  }

  return { temporadas, medios, planes, especiales };
}

/* ===========================================================================
   Escritura
   =========================================================================== */

async function guardarTodo(datos) {
  const sello = new Date().toISOString();

  await upsert("temporadas", datos.temporadas.map((t) => ({ ...t, actualizado_en: sello })));
  await upsert("medios_pago", datos.medios.map((m) => ({ ...m, actualizado_en: sello })));
  await upsert("planes_cuotas", datos.planes.map((p) => ({ ...p, actualizado_en: sello })));

  /**
   * Las fechas especiales son la única lista de largo variable: se pueden
   * agregar y borrar tarjetas desde la pantalla. La pantalla manda la lista
   * COMPLETA, así que las que ya no están hay que borrarlas.
   *
   * Se borra por diferencia de ids y no con un "delete todo + insert todo"
   * porque eso rompería el id de cada fila en cada guardado — y con él,
   * cualquier referencia futura y el orden natural de la tabla.
   */
  const existentes = (await seleccionar("tarifas_especiales", "select=id")) || [];
  const queSiguen = new Set(datos.especiales.map((e) => e.id).filter(Boolean));
  const aBorrar = existentes.map((e) => e.id).filter((id) => !queSiguen.has(id));

  if (aBorrar.length) {
    await borrar("tarifas_especiales", `id=in.(${aBorrar.join(",")})`);
  }

  /**
   * Las que ya existen van con UPDATE una por una, no con upsert: el `id` de
   * `tarifas_especiales` es `generated always as identity`, y Postgres
   * rechaza cualquier INSERT que traiga un valor para esa columna — incluido el
   * INSERT ... ON CONFLICT que hay abajo de un upsert de PostgREST.
   *
   * Son un puñado de filas y se editan a mano cada tanto: N updates chicos no
   * son un problema acá.
   */
  for (const especial of datos.especiales.filter((e) => e.id)) {
    const { id, ...campos } = especial;
    await actualizar("tarifas_especiales", `id=eq.${id}`, campos);
  }

  const nuevas = datos.especiales.filter((e) => !e.id).map(({ id, ...resto }) => resto);
  if (nuevas.length) await insertar("tarifas_especiales", nuevas);
}

/* ===========================================================================
   Handler
   =========================================================================== */

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

    // Se devuelve el estado ya releído de la base y no el que llegó: es lo que
    // le permite a la pantalla quedarse con los ids de las fechas especiales
    // nuevas sin tener que recargar.
    json(res, 200, await leerTodo());
  } catch (error) {
    manejarError(res, "tarifas", error);
  }
}
