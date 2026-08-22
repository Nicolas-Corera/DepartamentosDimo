document.addEventListener("DOMContentLoaded", () => {
  gsap.to("#login-card", {
    y: 0,
    opacity: 1,
    duration: 0.8,
    ease: "power3.out",
    delay: 0.1,
  });

  const submitBtn = document.getElementById("submit-btn");
  submitBtn.addEventListener("mousedown", () => {
    gsap.to(submitBtn, { scale: 0.98, duration: 0.1 });
  });
  submitBtn.addEventListener("mouseup", () => {
    gsap.to(submitBtn, { scale: 1, duration: 0.1 });
  });
  submitBtn.addEventListener("mouseleave", () => {
    gsap.to(submitBtn, { scale: 1, duration: 0.1 });
  });

  const inputs = [...document.querySelectorAll(".otp-input")];
  const boton = document.getElementById("submit-btn");
  const error = document.getElementById("error-login");
  const tarjeta = document.getElementById("login-card");

  let enviando = false;

  function mostrarError(mensaje) {
    error.textContent = mensaje;
    error.hidden = false;
    tarjeta.classList.remove("sacudir");

    void tarjeta.offsetWidth;
    tarjeta.classList.add("sacudir");
  }

  function limpiarError() {
    error.hidden = true;
  }

  function codigoTipeado() {
    return inputs.map((i) => i.value).join("");
  }

  function bloquear(si) {
    enviando = si;
    boton.disabled = si;
    for (const i of inputs) i.disabled = si;
    boton.querySelector("span:first-child").textContent = si
      ? "Verificando…"
      : "Verificar y Entrar";
  }

  async function entrar() {
    if (enviando) return;

    const codigo = codigoTipeado();
    if (codigo.length !== inputs.length) {
      mostrarError(`Completá los ${inputs.length} dígitos.`);
      inputs.find((i) => !i.value)?.focus();
      return;
    }

    limpiarError();
    bloquear(true);

    try {
      const respuesta = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo }),
      });
      const cuerpo = await respuesta.json().catch(() => ({}));

      if (!respuesta.ok) {
        bloquear(false);
        mostrarError(cuerpo.error || "No pudimos verificar el código.");
        for (const i of inputs) i.value = "";
        inputs[0].focus();
        return;
      }

      window.location.replace("/index.html");
    } catch {
      bloquear(false);
      mostrarError("No pudimos conectarnos. Revisá tu conexión.");
    }
  }

  inputs.forEach((input, indice) => {
    input.addEventListener("input", (e) => {
      e.target.value = e.target.value.replace(/[^0-9]/g, "");
      limpiarError();

      if (e.target.value !== "" && indice < inputs.length - 1) {
        inputs[indice + 1].focus();
      }

      if (codigoTipeado().length === inputs.length) entrar();
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && e.target.value === "" && indice > 0) {
        inputs[indice - 1].focus();
      }
      if (e.key === "Enter") entrar();
    });

    input.addEventListener("paste", (e) => {
      e.preventDefault();
      const pegado = e.clipboardData
        .getData("text")
        .replace(/[^0-9]/g, "")
        .slice(0, inputs.length);
      if (!pegado) return;

      pegado.split("").forEach((caracter, i) => {
        if (!inputs[i]) return;
        inputs[i].value = caracter;
        if (i < inputs.length - 1) inputs[i + 1].focus();
        else inputs[i].blur();
      });

      if (pegado.length === inputs.length) entrar();
    });
  });

  boton.addEventListener("click", entrar);

  fetch("/api/sesion")
    .then((r) => {
      if (r.ok) window.location.replace("/index.html");
    })
    .catch(() => {
    });
});
