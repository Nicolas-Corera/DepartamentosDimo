import { exigirMetodo, json, leerBody, manejarError, ErrorVisible } from "./_lib/http.js";
import {
  insertarConsulta,
  leerConfigTarifas,
  buscarTarifasEspeciales,
  leerConfigDeCobro,
} from "./_lib/supabase.js";
import { calcularPrecio } from "./_lib/precios.js";
import { montoDeLaSenia } from "./_lib/cobro.js";
import { avisarConsultaNueva } from "./_lib/mails.js";
import { enSegundoPlano } from "./_lib/segundo-plano.js";
import { normalizarTelefono, telefonoParaWhatsapp } from "./_lib/telefono.js";
import { exigirCupoDeIp, exigirCupoGlobal } from "./_lib/limite.js";

const TZ = "America/Argentina/Buenos_Aires";
const HORA_CIERRE = 9;

const MAX_PERSONAS = 4;
const ANIO_MIN = 1950;
const ANIO_MAX = 2100;

const TIPOS_DE_VEHICULO = ["auto", "suv", "camioneta", "moto", "bici"];

const FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

function primerDiaElegible() {
  const partes = {};
  for (const p of FMT.formatToParts(new Date())) partes[p.type] = p.value;

  const anio = Number(partes.year);
  const mes = Number(partes.month);
  const dia = Number(partes.day);
  const hora = Number(partes.hour);

  const base = new Date(Date.UTC(anio, mes - 1, dia));
  if (hora >= HORA_CIERRE) base.setUTCDate(base.getUTCDate() + 1);
  return base.toISOString().slice(0, 10);
}

function texto(valor, { min, max, campo }) {
  const limpio = String(valor == null ? "" : valor).trim();
  if (limpio.length < min || limpio.length > max) {
    throw new ErrorVisible(400, `Revisá el campo ${campo}.`, "validacion");
  }
  return limpio;
}

function textoOpcional(valor, max) {
  const limpio = String(valor == null ? "" : valor).trim();
  return limpio ? limpio.slice(0, max) : null;
}

function fechaISO(valor, campo) {
  const s = String(valor || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) {
    throw new ErrorVisible(400, `La fecha de ${campo} no es válida.`, "validacion");
  }
  return s;
}

function entero(valor, { min, max, campo }) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ErrorVisible(400, `Revisá el campo ${campo}.`, "validacion");
  }
  return n;
}

function normalizarDelCuerpo(cuerpo) {
  const crudo = String(cuerpo.telefono || "").trim();
  const pais = String(cuerpo.telefonoPais || "").replace(/\D/g, "");

  const e164 = pais ? normalizarTelefono(pais, crudo) : `+${telefonoParaWhatsapp(crudo)}`;

  const digitos = e164.replace(/\D/g, "");

  if (digitos.length < 10 || digitos.length > 15) {
    throw new ErrorVisible(
      400,
      "Revisá el teléfono: elegí el código de país y escribí el número completo.",
      "validacion",
    );
  }

  return e164;
}

function validar(cuerpo) {
  const nombre = texto(cuerpo.nombre, { min: 2, max: 80, campo: "nombre" });

  const email = String(cuerpo.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 120) {
    throw new ErrorVisible(400, "Revisá el email: no tiene formato de correo.", "validacion");
  }

  const dni = String(cuerpo.dni || "").replace(/\D/g, "");
  if (dni.length < 6 || dni.length > 9) {
    throw new ErrorVisible(400, "Revisá el DNI: tiene que tener entre 6 y 9 dígitos.", "validacion");
  }

  const telefono = normalizarDelCuerpo(cuerpo);

  const checkIn = fechaISO(cuerpo.check_in, "entrada");
  const checkOut = fechaISO(cuerpo.check_out, "salida");

  if (checkOut <= checkIn) {
    throw new ErrorVisible(
      400,
      "La fecha de salida tiene que ser posterior a la de entrada.",
      "validacion",
    );
  }

  if (checkIn < primerDiaElegible()) {
    throw new ErrorVisible(
      400,
      `Las reservas para el mismo día cierran a las ${String(HORA_CIERRE).padStart(2, "0")}:00. ` +
        "Elegí de nuevo las fechas de tu estadía.",
      "fecha_cerrada",
    );
  }

  const personas = entero(cuerpo.personas, { min: 1, max: MAX_PERSONAS, campo: "personas" });
  const adultos = entero(cuerpo.adultos, { min: 1, max: MAX_PERSONAS, campo: "adultos" });
  const ninos = entero(cuerpo.ninos, { min: 0, max: MAX_PERSONAS - 1, campo: "niños" });

  if (adultos + ninos !== personas) {
    throw new ErrorVisible(
      400,
      "Revisá el reparto: adultos y niños tienen que sumar el total de personas.",
      "validacion",
    );
  }

  const edades = Array.isArray(cuerpo.edades_ninos) ? cuerpo.edades_ninos : [];
  if (edades.length !== ninos || edades.some((e) => !Number.isInteger(Number(e)) || e < 0 || e > 17)) {
    throw new ErrorVisible(400, "Completá la edad de cada niño.", "validacion");
  }

  const conVehiculo = Boolean(cuerpo.vehiculo);

  const vehiculo = conVehiculo
    ? {
        vehiculo: true,
        vehiculo_marca: texto(cuerpo.vehiculo_marca, { min: 1, max: 40, campo: "marca del vehículo" }),
        vehiculo_modelo: texto(cuerpo.vehiculo_modelo, {
          min: 1,
          max: 40,
          campo: "modelo del vehículo",
        }),
        vehiculo_tipo: TIPOS_DE_VEHICULO.includes(String(cuerpo.vehiculo_tipo))
          ? String(cuerpo.vehiculo_tipo)
          : null,
        vehiculo_anio: entero(cuerpo.vehiculo_anio, {
          min: ANIO_MIN,
          max: ANIO_MAX,
          campo: "año del vehículo",
        }),
      }
    : {
        vehiculo: false,
        vehiculo_marca: null,
        vehiculo_modelo: null,
        vehiculo_tipo: null,
        vehiculo_anio: null,
      };

  if (conVehiculo && !vehiculo.vehiculo_tipo) {
    throw new ErrorVisible(400, "Elegí el tipo de vehículo.", "validacion");
  }

  return {
    nombre,
    email,
    dni,
    telefono,
    procedencia: textoOpcional(cuerpo.procedencia, 80),
    check_in: checkIn,
    check_out: checkOut,
    personas,
    adultos,
    ninos,
    edades_ninos: edades.map(Number),
    ...vehiculo,
    mensaje: textoOpcional(cuerpo.mensaje, 1000),
    estado: "nueva",
  };
}

export default async function handler(req, res) {
  if (!exigirMetodo(req, res, "POST")) return;

  try {
    exigirCupoDeIp(req, "consulta");

    const fila = validar(leerBody(req));

    await exigirCupoGlobal("consulta");

    let reserva;
    try {
      reserva = await insertarConsulta(fila);
    } catch (error) {
      if (error.codigoPostgres === "23505") {
        throw new ErrorVisible(
          409,
          "Ya recibimos una consulta con ese DNI para esas fechas. " +
            "Si necesitás cambiar algo, escribinos por WhatsApp.",
          "duplicada",
        );
      }
      throw error;
    }

    if (!reserva?.id) {
      throw new Error("Supabase aceptó el alta pero no devolvió la fila.");
    }

    console.log(
      `[consulta] ${reserva.id} — ${fila.nombre} — ${fila.check_in} al ${fila.check_out}`,
    );

    await enSegundoPlano(
      "consulta.mails",
      async () => {
        const [tarifas, especiales, cobroConfig] = await Promise.all([
          leerConfigTarifas(),
          buscarTarifasEspeciales(fila.check_in, fila.check_out),
          leerConfigDeCobro(),
        ]);

        const precio = calcularPrecio(reserva, tarifas.temporadas, especiales || [], cobroConfig.tarifaLimpieza);

        await avisarConsultaNueva({
          reserva,
          precio,
          cobro: {
            porcentajeReserva: cobroConfig.porcentajeReserva,
            montoTotal: precio.total,
            montoReserva: montoDeLaSenia(precio.total, cobroConfig.porcentajeReserva),
          },
        });
      },
      (error) =>
        console.error(
          "[consulta] la consulta quedó guardada pero los mails fallaron:",
          error.message,
        ),
    );

    return json(res, 201, { ok: true, id: reserva.id });
  } catch (error) {
    manejarError(res, "consulta", error);
  }
}
