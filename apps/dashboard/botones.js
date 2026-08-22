(function () {
  "use strict";

  var ATRIBUTO = "data-bloqueado";
  var EXCEPTO = "data-sin-bloqueo";

  var RETENCION_MS = 120;
  var VENTANA_MS = 600;
  var LIMITE_MS = 20000;

  var enVuelo = 0;
  var iniciados = 0;
  var bloqueados = new Set();

  var ultimoVigilado = null;
  var ultimoClick = 0;
  var envioEnCurso = null;

  var estilo = document.createElement("style");
  estilo.textContent =
    "button[" + ATRIBUTO + "],input[" + ATRIBUTO + "],[role=button][" + ATRIBUTO + "]" +
    "{pointer-events:none!important;opacity:.55;cursor:default}";
  (document.head || document.documentElement).appendChild(estilo);

  function bloquear(elemento) {
    if (!elemento || elemento.hasAttribute(ATRIBUTO)) return;
    elemento.setAttribute(ATRIBUTO, "");
    elemento.setAttribute("aria-disabled", "true");
    elemento.setAttribute("aria-busy", "true");
    bloqueados.add(elemento);
  }

  function liberar(elemento) {
    if (!elemento) return;
    elemento.removeAttribute(ATRIBUTO);
    elemento.removeAttribute("aria-disabled");
    elemento.removeAttribute("aria-busy");
    bloqueados.delete(elemento);
  }

  function liberarTodos() {
    Array.prototype.forEach.call(Array.from(bloqueados), liberar);
  }

  function alEmpezarPedido() {
    iniciados += 1;
    enVuelo += 1;
    if (ultimoVigilado && Date.now() - ultimoClick < VENTANA_MS) bloquear(ultimoVigilado);
  }

  function alTerminarPedido() {
    enVuelo -= 1;
    if (enVuelo <= 0) {
      enVuelo = 0;
      liberarTodos();
    }
  }

  var fetchOriginal = window.fetch;
  if (typeof fetchOriginal === "function") {
    window.fetch = function () {
      var terminado = false;
      function cerrar() {
        if (terminado) return;
        terminado = true;
        alTerminarPedido();
      }
      alEmpezarPedido();
      try {
        return fetchOriginal.apply(this, arguments).then(
          function (respuesta) {
            cerrar();
            return respuesta;
          },
          function (error) {
            cerrar();
            throw error;
          },
        );
      } catch (error) {
        cerrar();
        throw error;
      }
    };
  }

  var enviarOriginal = window.XMLHttpRequest && window.XMLHttpRequest.prototype.send;
  if (typeof enviarOriginal === "function") {
    window.XMLHttpRequest.prototype.send = function () {
      var terminado = false;
      function cerrar() {
        if (terminado) return;
        terminado = true;
        alTerminarPedido();
      }
      alEmpezarPedido();
      this.addEventListener("loadend", cerrar);
      try {
        return enviarOriginal.apply(this, arguments);
      } catch (error) {
        cerrar();
        throw error;
      }
    };
  }

  function vigilar(elemento) {
    if (!elemento || elemento.hasAttribute(EXCEPTO)) return;

    var marca = iniciados;
    ultimoVigilado = elemento;
    ultimoClick = Date.now();
    bloquear(elemento);

    envioEnCurso = elemento;
    setTimeout(function () {
      if (envioEnCurso === elemento) envioEnCurso = null;
    }, 0);

    setTimeout(function () {
      if (iniciados === marca && enVuelo === 0) liberar(elemento);
    }, RETENCION_MS);

    setTimeout(function () {
      liberar(elemento);
    }, LIMITE_MS);
  }

  function botonMasCercano(destino) {
    if (!destino || typeof destino.closest !== "function") return null;
    return destino.closest(
      "button, input[type=submit], input[type=button], [role=button]",
    );
  }

  document.addEventListener(
    "click",
    function (evento) {
      var boton = botonMasCercano(evento.target);
      if (!boton) return;

      if (boton.hasAttribute(ATRIBUTO)) {
        evento.preventDefault();
        evento.stopImmediatePropagation();
        return;
      }
      if (boton.disabled) return;

      vigilar(boton);
    },
    true,
  );

  document.addEventListener(
    "keydown",
    function (evento) {
      if (evento.key !== "Enter" || evento.isComposing) return;

      var destino = evento.target;
      if (!destino || typeof destino.closest !== "function") return;
      if (destino.tagName === "TEXTAREA") return;

      var contenedor = destino.closest("form");
      if (!contenedor || contenedor.hasAttribute(EXCEPTO)) return;
      if (!contenedor.querySelector("button[" + ATRIBUTO + "]")) return;

      evento.preventDefault();
      evento.stopImmediatePropagation();
    },
    true,
  );

  function botonDeEnvio(formulario) {
    return formulario.querySelector(
      "button[type=submit], button:not([type]), input[type=submit]",
    );
  }

  document.addEventListener(
    "submit",
    function (evento) {
      var formulario = evento.target;
      if (!formulario || typeof formulario.querySelector !== "function") return;
      if (formulario.hasAttribute(EXCEPTO)) return;

      var vigilado = botonDeEnvio(formulario) || formulario;

      if (vigilado === envioEnCurso) return;

      if (vigilado.hasAttribute(ATRIBUTO)) {
        evento.preventDefault();
        evento.stopImmediatePropagation();
        return;
      }

      vigilar(vigilado);
    },
    true,
  );
})();
