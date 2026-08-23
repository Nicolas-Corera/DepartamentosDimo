import { test, expect } from "@playwright/test";
import { config } from "../lib/config.mjs";
import { consultaValida, resenaValida, MARCA_DE_PRUEBA } from "../lib/datos.mjs";

const ESCRIBE = config.permitirEscritura;

async function elegirDosDiasSeguidos(page, contenedor) {
  const dias = page.locator(`${contenedor} .cal-day:not(.empty)`);
  await expect(dias.first()).toBeVisible();

  const total = await dias.count();

  for (let i = 0; i < total - 1; i += 1) {
    const uno = dias.nth(i);
    const dos = dias.nth(i + 1);

    const unoLibre = await uno.isEnabled();
    const dosLibre = await dos.isEnabled();

    if (unoLibre && dosLibre) {
      await uno.click();
      await dos.click();
      return true;
    }
  }

  return false;
}

async function completarFormularioDeReserva(page, datos) {
  await page.fill("#nombre", datos.nombre);
  await page.fill("#email", datos.email);
  await page.fill("#dni", datos.dni);
  await page.fill("#telefono", datos.telefono);
  await page.fill("#procedencia", datos.procedencia);

  await page.click("#fechasBtn");
  await expect(page.locator("#modalFechas")).toBeVisible();

  const hubo = await elegirDosDiasSeguidos(page, "#calFormulario");
  expect(hubo, "no hay dos días libres seguidos en el mes visible del calendario").toBe(true);

  await page.click("#confirmarFechas");
  await expect(page.locator("#modalFechas")).toBeHidden();
  await expect(page.locator("#fechasInput")).not.toHaveValue("");

  await page.selectOption("#personas", String(datos.personas));
  await page.selectOption("#adultos", String(datos.adultos));
  await page.selectOption("#ninos", String(datos.ninos));

  await page.fill("#mensaje", datos.mensaje.slice(0, 480));
}

test.describe("Sitio público", () => {
  test.use({ baseURL: config.urls.sitio });

  test("la portada carga con el hero, la galería y el formulario", async ({ page }) => {
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));

    const respuesta = await page.goto("/");
    expect(respuesta?.status()).toBe(200);

    await expect(page.locator("#inicio")).toBeVisible();
    await expect(page.locator("#bookingForm")).toBeVisible();
    expect(await page.locator("#masonry img").count()).toBeGreaterThan(0);
    await expect(page.locator("#reserva")).toBeVisible();

    expect(errores, `errores de JS en la portada: ${errores.join(" | ")}`).toHaveLength(0);
  });

  test("el calendario de disponibilidad abre y usa /api/ocupacion", async ({ page }) => {
    const llamada = page.waitForResponse(
      (r) => r.url().includes("/api/ocupacion") && r.status() === 200,
    );

    await page.goto("/");

    const respuesta = await llamada;
    const cuerpo = await respuesta.json();
    expect(Array.isArray(cuerpo.fechas)).toBe(true);

    await page.click("#btnDisponibilidad");
    await expect(page.locator("#modalDisponibilidad")).toBeVisible();
    await expect(page.locator("#calDisponibilidad .cal-day:not(.empty)").first()).toBeVisible();
  });

  test("el formulario rechaza un email inválido antes de enviar", async ({ page }) => {
    await page.goto("/");

    await page.fill("#nombre", `${MARCA_DE_PRUEBA} email malo`);
    await page.fill("#email", "esto-no-es-un-email");
    await page.fill("#dni", "30111222");
    await page.fill("#telefono", "1159367822");

    let sePidio = false;
    await page.route("**/api/consulta", async (ruta) => {
      sePidio = true;
      await ruta.abort();
    });

    await page.locator("#bookingForm button[type=submit]").click();

    expect(sePidio, "el formulario dejó salir un email inválido").toBe(false);

    const valido = await page.locator("#email").evaluate((el) => el.checkValidity());
    expect(valido).toBe(false);
  });

  test("el formulario de reserva se completa entero y arma el payload correcto", async ({ page }) => {
    await page.goto("/");

    const datos = consultaValida();
    let enviado = null;

    await page.route("**/api/consulta", async (ruta) => {
      enviado = ruta.request().postDataJSON();

      if (ESCRIBE) {
        await ruta.continue();
        return;
      }

      await ruta.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, id: "00000000-0000-4000-8000-000000000000" }),
      });
    });

    await completarFormularioDeReserva(page, datos);
    await page.locator("#bookingForm button[type=submit]").click();

    await expect
      .poll(() => enviado, { message: "el formulario nunca llamó a /api/consulta" })
      .not.toBeNull();

    expect(enviado.nombre).toBe(datos.nombre);
    expect(enviado.email).toBe(datos.email);
    expect(enviado.dni).toBe(datos.dni);
    expect(enviado.telefonoPais).toBe("54");
    expect(enviado.personas).toBe(datos.personas);
    expect(enviado.adultos + enviado.ninos).toBe(enviado.personas);
    expect(enviado.check_in).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(enviado.check_out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(enviado.check_out > enviado.check_in).toBe(true);

    if (!ESCRIBE) {
      test.info().annotations.push({
        type: "modo seco",
        description:
          "La respuesta 201 se falsificó en el navegador. Para probar el alta real: PERMITIR_ESCRITURA=1.",
      });
    }
  });

  test("la reseña se completa y arma el payload correcto", async ({ page }) => {
    await page.goto("/");

    const datos = resenaValida();
    let enviado = null;

    await page.route("**/api/resena", async (ruta) => {
      enviado = ruta.request().postDataJSON();

      if (ESCRIBE) {
        await ruta.continue();
        return;
      }

      await ruta.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, id: "00000000-0000-4000-8000-000000000000" }),
      });
    });

    await page.locator("[data-open-resena]").first().click();
    await expect(page.locator("#modalResena")).toBeVisible();

    await page.fill("#resenaNombre", datos.name);
    await page.locator('#starPicker button[data-val="5"]').click();
    await page.fill("#resenaComentario", datos.text);

    await page.locator("#resenaForm button[type=submit]").click();

    await expect
      .poll(() => enviado, { message: "el modal nunca llamó a /api/resena" })
      .not.toBeNull();

    expect(enviado.name).toBe(datos.name);
    expect(enviado.rating).toBe(5);
    expect(enviado.text).toBe(datos.text);
  });
});

test.describe("Checkout", () => {
  test.use({ baseURL: config.urls.pago });

  test("sin ref muestra la pantalla de error, no el formulario de pago", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("#pantalla-error")).toBeVisible();
    await expect(page.locator("#error-detalle")).not.toBeEmpty();
    await expect(page.locator("#checkout")).toBeHidden();
  });

  test("con una reserva real abre el checkout con el resumen y los medios de pago", async ({
    page,
  }) => {
    test.skip(
      !config.refDePrueba,
      "falta REF_DE_PRUEBA en testing-bots/.env (un UUID de booking_requests)",
    );

    await page.goto(`/?ref=${config.refDePrueba}&modo=reserva`);

    await expect(page.locator("#checkout")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#dato-nombre")).not.toHaveText("—");
    await expect(page.locator("#dato-dni")).toContainText("•");
    await expect(page.locator("#resumen-total")).not.toHaveText("—");
    await expect(page.locator("#resumen-checkin")).not.toHaveText("—");

    await expect(page.locator('.tab-btn[data-metodo="credito"]')).toBeVisible();
    await expect(page.locator('.tab-btn[data-metodo="debito"]')).toBeVisible();
    await expect(page.locator('.tab-btn[data-metodo="transferencia"]')).toBeVisible();

    await page.locator('.tab-btn[data-metodo="transferencia"]').click();
    await expect(page.locator("#form-transfer")).toBeVisible();
    await expect(page.locator("#transfer-monto")).not.toHaveText("—");
    await expect(page.locator("#comprobante-archivo")).toBeAttached();

    await page.locator('.tab-btn[data-metodo="credito"]').click();
    await expect(page.locator("#form-card")).toBeVisible();
  });

  test("el checkout nunca manda el monto desde el navegador", async ({ page }) => {
    test.skip(!config.refDePrueba, "falta REF_DE_PRUEBA en testing-bots/.env");

    const cuerpos = [];
    await page.route("**/api/pagos", async (ruta) => {
      cuerpos.push(ruta.request().postDataJSON());
      await ruta.abort();
    });

    await page.goto(`/?ref=${config.refDePrueba}&modo=reserva`);
    await expect(page.locator("#checkout")).toBeVisible({ timeout: 20_000 });

    const guion = await page.request.get(`${config.urls.pago}/pago.js`);
    const texto = await guion.text();

    expect(texto).toContain("/api/pagos");
    expect(texto).not.toMatch(/body:\s*JSON\.stringify\(\{[^}]*\bmonto\b/);
  });
});

test.describe("Panel de administración", () => {
  test.use({ baseURL: config.urls.panel });

  test("un código incorrecto no abre sesión", async ({ page }) => {
    await page.goto("/login_panel.html");

    const inputs = page.locator(".otp-input");
    await expect(inputs).toHaveCount(6);

    for (let i = 0; i < 6; i += 1) await inputs.nth(i).fill("0");

    await expect(page.locator("#error-login")).toBeVisible();
    expect(page.url()).toContain("login_panel");

    const sesion = await page.request.get(`${config.urls.panel}/api/sesion`);
    expect(sesion.status()).toBe(401);
  });

  test("con el código correcto entra y las tres pestañas cargan", async ({ page }) => {
    test.skip(
      !config.codigoDelPanel,
      "falta PANEL_CODIGO: ponelo en testing-bots/.env o en apps/dashboard/.env",
    );

    await page.goto("/login_panel.html");

    const inputs = page.locator(".otp-input");
    const digitos = String(config.codigoDelPanel).padStart(6, "0").slice(-6);

    const tarifas = page.waitForResponse(
      (r) => r.url().includes("/api/tarifas") && r.status() === 200,
    );

    for (let i = 0; i < 6; i += 1) await inputs.nth(i).fill(digitos[i]);

    await page.waitForURL("**/index.html", { timeout: 20_000 });

    const respuesta = await tarifas;
    const cuerpo = await respuesta.json();
    expect(Array.isArray(cuerpo.temporadas)).toBe(true);
    expect(Array.isArray(cuerpo.medios)).toBe(true);

    await expect(page.locator("#tarifas")).toHaveClass(/active/);

    await page.locator('.nav-item[data-target="alquileres"]').click();
    await expect(page.locator("#alquileres")).toHaveClass(/active/);

    await page.locator('.nav-item[data-target="resenas"]').click();
    await expect(page.locator("#resenas")).toHaveClass(/active/);

    const conSesion = page.request;

    const alquileres = await conSesion.get(`${config.urls.panel}/api/alquileres`);
    expect(alquileres.status()).toBe(200);
    expect(Array.isArray((await alquileres.json()).alquileres)).toBe(true);

    const resenas = await conSesion.get(`${config.urls.panel}/api/resenas`);
    expect(resenas.status()).toBe(200);
    expect(Array.isArray((await resenas.json()).resenas)).toBe(true);
  });

  test("los endpoints del panel están cerrados sin cookie", async ({ request }) => {
    for (const ruta of ["/api/tarifas", "/api/alquileres", "/api/resenas", "/api/comprobantes"]) {
      const respuesta = await request.get(`${config.urls.panel}${ruta}`);
      expect(respuesta.status(), `${ruta} debería dar 401 sin sesión`).toBe(401);
    }
  });
});
