export const MARCA_DE_PRUEBA = "TEST-BOT";

const TZ = "America/Argentina/Buenos_Aires";
const HORA_DE_CIERRE = 9;

const FORMATO = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

export function primerDiaElegible() {
  const partes = {};
  for (const p of FORMATO.formatToParts(new Date())) partes[p.type] = p.value;

  const base = new Date(
    Date.UTC(Number(partes.year), Number(partes.month) - 1, Number(partes.day)),
  );
  if (Number(partes.hour) >= HORA_DE_CIERRE) base.setUTCDate(base.getUTCDate() + 1);

  return base;
}

function aClave(fecha) {
  return fecha.toISOString().slice(0, 10);
}

export function fechasDeEstadia({ desdeHoy = 45, noches = 3 } = {}) {
  const entrada = primerDiaElegible();
  entrada.setUTCDate(entrada.getUTCDate() + desdeHoy);

  const salida = new Date(entrada);
  salida.setUTCDate(salida.getUTCDate() + noches);

  return { checkIn: aClave(entrada), checkOut: aClave(salida) };
}

export function fechaPasada(dias = 30) {
  const fecha = primerDiaElegible();
  fecha.setUTCDate(fecha.getUTCDate() - dias);
  return aClave(fecha);
}

let contador = 0;

export function sufijoUnico() {
  contador += 1;
  return `${Date.now().toString(36)}${contador.toString(36)}`;
}

export function dniDePrueba() {
  return String(20_000_000 + Math.floor(Math.random() * 39_000_000));
}

export function consultaValida(opciones = {}) {
  const { checkIn, checkOut } = fechasDeEstadia(opciones);
  const sufijo = sufijoUnico();

  return {
    nombre: `${MARCA_DE_PRUEBA} ${sufijo}`,
    email: `bot.${sufijo}@example.com`,
    dni: dniDePrueba(),
    telefono: "1159367822",
    telefonoPais: "54",
    procedencia: "Testing",
    check_in: checkIn,
    check_out: checkOut,
    personas: 2,
    adultos: 2,
    ninos: 0,
    edades_ninos: [],
    vehiculo: false,
    vehiculo_marca: null,
    vehiculo_modelo: null,
    vehiculo_tipo: null,
    vehiculo_anio: null,
    mensaje: `Generada por los bots de testing (${MARCA_DE_PRUEBA}). Se puede borrar.`,
    ...opciones.pisar,
  };
}

export function resenaValida(opciones = {}) {
  const sufijo = sufijoUnico();

  return {
    name: `${MARCA_DE_PRUEBA} ${sufijo}`.slice(0, 40),
    rating: 5,
    text: `Resena generada por los bots de testing ${sufijo}. Se puede borrar.`.slice(0, 180),
    ...opciones.pisar,
  };
}

export function consultaConTopes() {
  return {
    ...consultaValida(),
    check_in: fechaPasada(30),
    dni: "",
  };
}

export function resenaConTopes() {
  return {
    ...resenaValida(),
    rating: 0,
    name: "",
  };
}

export const REF_INEXISTENTE = "00000000-0000-4000-8000-000000000000";
