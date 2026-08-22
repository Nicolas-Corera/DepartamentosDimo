import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, dirname, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUERTO = Number(process.env.PORT || 8000);

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function adaptarRespuesta(res) {
  res.status = (codigo) => {
    res.statusCode = codigo;
    return res;
  };
  res.send = (cuerpo) => {
    res.end(cuerpo);
    return res;
  };
  res.json = (obj) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

function leerCuerpo(req) {
  return new Promise((resolver, rechazar) => {
    const trozos = [];
    req.on("data", (t) => trozos.push(t));
    req.on("end", () => {
      const crudo = Buffer.concat(trozos).toString("utf8");
      if (!crudo) return resolver({});
      try {
        resolver(JSON.parse(crudo));
      } catch {
        resolver(crudo);
      }
    });
    req.on("error", rechazar);
  });
}

async function servirEstatico(res, rutaUrl) {
  const relativa = rutaUrl === "/" ? "index.html" : rutaUrl.slice(1);

  const destino = join(RAIZ, normalize(relativa).replace(/^(\.\.[/\\])+/, ""));
  if (!destino.startsWith(RAIZ)) {
    res.statusCode = 403;
    return res.end("prohibido");
  }

  try {
    const info = await stat(destino);
    if (info.isDirectory()) return servirEstatico(res, `${rutaUrl}/index.html`.replace("//", "/"));
    const contenido = await readFile(destino);
    res.statusCode = 200;
    res.setHeader("Content-Type", TIPOS[extname(destino)] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    res.end(contenido);
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("404");
  }
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PUERTO}`);
  const inicio = Date.now();

  if (!url.pathname.startsWith("/api/")) {
    return servirEstatico(res, url.pathname);
  }

  const nombre = url.pathname.slice("/api/".length).replace(/\/+$/, "");

  if (!nombre || nombre.startsWith("_") || nombre.includes("/")) {
    res.statusCode = 404;
    return res.end(JSON.stringify({ error: "endpoint inexistente" }));
  }

  let handler;
  try {
    const mod = await import(
      `${pathToFileURL(join(RAIZ, "api", `${nombre}.js`)).href}?t=${Date.now()}`
    );
    handler = mod.default;
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: "endpoint inexistente" }));
    }
    console.error("[dev] no se pudo cargar el endpoint:", error.message);
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: "no se pudo cargar el endpoint" }));
  }

  req.query = Object.fromEntries(url.searchParams.entries());
  req.body = req.method === "GET" || req.method === "HEAD" ? {} : await leerCuerpo(req);
  adaptarRespuesta(res);

  try {
    await handler(req, res);
  } catch (error) {
    console.error("[dev] el endpoint reventó:", error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "error interno" }));
    }
  } finally {
    console.log(`[dev] ${req.method} ${url.pathname} -> ${res.statusCode} (${Date.now() - inicio}ms)`);
  }
});

servidor.listen(PUERTO, () => {
  console.log(`
  Sitio publico en desarrollo
  ---------------------------
  http://localhost:${PUERTO}

  Endpoints: /api/consulta
  Ctrl+C para cortar.
`);
});
