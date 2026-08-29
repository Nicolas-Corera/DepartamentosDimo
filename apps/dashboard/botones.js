(function () {
  "use strict";

  var ATRIBUTO = "data-bloqueado";
  var EXCEPTO = "data-sin-bloqueo";

  var RETENCION_MS = 120;
  var VENTANA_MS = 600;
  var LIMITE_MS = 20000;

  var enVuelo = 0;
  var bloqueados = new Set();
  var pendientes = new Map();

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

  function duenoDelPedido() {
    if (!ultimoVigilado) return null;
    if (Date.now() - ultimoClick >= VENTANA_MS) return null;
    return ultimoVigilado;
  }

  function alEmpezarPedido() {
    enVuelo += 1;

    var dueno = duenoDelPedido();
    if (dueno) {
      bloquear(dueno);
      pendientes.set(dueno, (pendientes.get(dueno) || 0) + 1);
    }
    return dueno;
  }

  function alTerminarPedido(dueno) {
    enVuelo = enVuelo > 0 ? enVuelo - 1 : 0;

    if (dueno) {
      var quedan = (pendientes.get(dueno) || 1) - 1;
      if (quedan > 0) {
        pendientes.set(dueno, quedan);
      } else {
        pendientes.delete(dueno);
        liberar(dueno);
      }
    }

    if (enVuelo === 0) liberarTodos();
  }

  var fetchOriginal = window.fetch;
  if (typeof fetchOriginal === "function") {
    window.fetch = function (recurso, opciones) {
      if (opciones && opciones.enSegundoPlano) {
        return fetchOriginal.apply(this, arguments);
      }

      var terminado = false;
      var dueno = alEmpezarPedido();
      function cerrar() {
        if (terminado) return;
        terminado = true;
        alTerminarPedido(dueno);
      }
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
      var dueno = alEmpezarPedido();
      function cerrar() {
        if (terminado) return;
        terminado = true;
        alTerminarPedido(dueno);
      }
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

    ultimoVigilado = elemento;
    ultimoClick = Date.now();
    bloquear(elemento);

    envioEnCurso = elemento;
    setTimeout(function () {
      if (envioEnCurso === elemento) envioEnCurso = null;
    }, 0);

    setTimeout(function () {
      if (!pendientes.has(elemento)) liberar(elemento);
    }, RETENCION_MS);

    setTimeout(function () {
      pendientes.delete(elemento);
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
