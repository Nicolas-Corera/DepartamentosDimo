import { defineConfig, devices } from "@playwright/test";
import { config } from "./lib/config.mjs";
import { exigirSoloLectura } from "./lib/guardia.mjs";

exigirSoloLectura("1-funcional", [config.urls.sitio, config.urls.pago, config.urls.panel]);

export default defineConfig({
  testDir: "./bots",
  testMatch: /1-funcional\.spec\.mjs$/,

  timeout: 60_000,
  expect: { timeout: 10_000 },

  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,

  outputDir: "reportes/funcional",

  reporter: [
    ["list"],
    ["html", { outputFolder: "reportes/funcional-html", open: "never" }],
    ["json", { outputFile: "reportes/funcional.json" }],
  ],

  use: {
    baseURL: config.urls.sitio,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    viewport: { width: 1440, height: 900 },
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
