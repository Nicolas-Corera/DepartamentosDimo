const AGENTE = "DimoTestingBot/1.0 (+testing-bots)";

export async function pedir(url, opciones = {}) {
  const {
    metodo = "GET",
    cuerpo = null,
    cabeceras = {},
    timeoutMs = 15000,
    cookie = null,
    crudo = false,
  } = opciones;

  const reloj = new AbortController();
  const corte = setTimeout(() => reloj.abort(), timeoutMs);
  const arranque = performance.now();

  const finales = {
    Accept: "application/json, text/html;q=0.9, */*;q=0.8",
    "User-Agent": AGENTE,
    ...cabeceras,
  };

  if (cuerpo !== null && !finales["Content-Type"]) {
    finales["Content-Type"] = "application/json";
  }
  if (cookie) finales.Cookie = cookie;

  try {
    const respuesta = await fetch(url, {
      method: metodo,
      headers: finales,
      body: cuerpo === null ? undefined : crudo ? cuerpo : JSON.stringify(cuerpo),
      signal: reloj.signal,
      redirect: "manual",
    });

    const texto = await respuesta.text();

    let json = null;
    try {
      json = JSON.parse(texto);
    } catch {
      json = null;
    }

    return {
      url,
      metodo,
      ok: respuesta.status >= 200 && respuesta.status < 400,
      status: respuesta.status,
      ms: Math.round(performance.now() - arranque),
      cabeceras: Object.fromEntries(respuesta.headers.entries()),
      cookies: respuesta.headers.getSetCookie?.() || [],
      texto,
      json,
      fallo: null,
    };
  } catch (error) {
    return {
      url,
      metodo,
      ok: false,
      status: 0,
      ms: Math.round(performance.now() - arranque),
      cabeceras: {},
      cookies: [],
      texto: "",
      json: null,
      fallo: error.name === "AbortError" ? `timeout tras ${timeoutMs}ms` : error.message,
    };
  } finally {
    clearTimeout(corte);
  }
}

export function dormir(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

export function cookieDeSesion(respuesta) {
  for (const galleta of respuesta.cookies) {
    const par = galleta.split(";")[0];
    if (par.startsWith("panel_sesion=")) return par;
  }
  return null;
}
