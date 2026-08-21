document.addEventListener("DOMContentLoaded", () => {
  const toastStack = document.getElementById("toastStack");

  // Un error necesita más tiempo de lectura que un "listo".
  const TOAST_MS = { exito: 3000, error: 5000 };

  function mostrarToast(mensaje, tipo = "exito") {
    const toast = document.createElement("div");
    toast.className = `toast toast-${tipo}`;
    // Los errores interrumpen al lector de pantalla; los avisos de éxito no.
    toast.setAttribute("role", tipo === "error" ? "alert" : "status");

    const icono = tipo === "error" ? "#ic-alert" : "#ic-check";
    toast.innerHTML = `<svg class="ic-sm" aria-hidden="true"><use href="${icono}"/></svg><span></span>`;
    // textContent y no innerHTML: el texto puede venir del mensaje de error
    // de la base y no tiene por qué terminar interpretado como HTML.
    toast.querySelector("span").textContent = mensaje;

    let reloj;
    let cerrando = false;
    function cerrar() {
      if (cerrando) return;
      cerrando = true;
      clearTimeout(reloj);
      toast.classList.add("toast-saliendo");
      toast.addEventListener("animationend", () => toast.remove());
      // Red de seguridad: con animaciones desactivadas (reduced motion)
      // animationend no llega nunca y el toast se quedaría pegado.
      setTimeout(() => toast.remove(), 400);
    }

    toast.addEventListener("click", cerrar);
    reloj = setTimeout(cerrar, TOAST_MS[tipo] || TOAST_MS.exito);

    toastStack.appendChild(toast);
    return toast;
  }

  //   mostrarToast(
  //   start
  //     ? "Elegí también la fecha de salida."
  //     : "Elegí la fecha de entrada y la de salida.",
  //   "error",
  // );
  //     mostrarToast(
  //     "¡Gracias! Recibimos tu consulta, te vamos a contactar a la brevedad.",
  //     "exito",
  //   );

  const form = document.getElementById("tarifas-form");
  const carousel = document.querySelector(".special-dates-carousel");
  const dotsContainer = document.querySelector(".carousel-dots");
  const saveBtn = document.querySelector(".save-btn");

  // --- Tab Switching Logic ---
  const navItems = document.querySelectorAll(".nav-item, .bottom-nav-item");
  const tabContents = document.querySelectorAll(".tab-content");

  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const targetId = item.getAttribute("data-target");

      if (item.classList.contains("active")) return;

      // Sacar active de TODOS los nav-item (aside + bottom)
      navItems.forEach((nav) => nav.classList.remove("active"));

      // Agregar active a TODOS los que coincidan con este target
      document
        .querySelectorAll(
          `.nav-item[data-target="${targetId}"], .bottom-nav-item[data-target="${targetId}"]`,
        )
        .forEach((nav) => nav.classList.add("active"));
      // Handle tab content animation
      const currentTab = document.querySelector(".tab-content.active");
      const nextTab = document.getElementById(targetId);

      if (currentTab && nextTab) {
        gsap.to(currentTab, {
          opacity: 0,
          y: -20,
          duration: 0.3,
          onComplete: () => {
            currentTab.classList.remove("active");
            nextTab.classList.add("active");
            gsap.fromTo(
              nextTab,
              { opacity: 0, y: 20 },
              { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" },
            );
          },
        });
      }
    });
  });

  // --- Animations ---
  // Card hover effects
  const cards = document.querySelectorAll(".card");
  cards.forEach((card) => {
    card.addEventListener("mouseenter", () => {
      gsap.to(card, { borderColor: "var(--turquesa)", duration: 0.3 });
    });
    card.addEventListener("mouseleave", () => {
      gsap.to(card, { borderColor: "var(--arena-deep)", duration: 0.3 });
    });
  });

  // Button hover effect
  if (saveBtn) {
    saveBtn.addEventListener("mouseenter", () => {
      gsap.to(saveBtn, {
        scale: 1.05,
        backgroundColor: "var(--surface-tint)",
        duration: 0.2,
      });
    });
    saveBtn.addEventListener("mouseleave", () => {
      // Only reset if not in success state
      if (!saveBtn.classList.contains("btn-success")) {
        gsap.to(saveBtn, {
          scale: 1,
          backgroundColor: "var(--primary-container)",
          duration: 0.2,
        });
      } else {
        gsap.to(saveBtn, { scale: 1, duration: 0.2 });
      }
    });
    saveBtn.addEventListener("mousedown", () => {
      gsap.to(saveBtn, { scale: 0.95, duration: 0.1 });
    });
    saveBtn.addEventListener("mouseup", () => {
      gsap.to(saveBtn, { scale: 1.05, duration: 0.1 });
    });
  }

  // --- Carousel Logic ---
  const updateDots = () => {
    if (!carousel || !dotsContainer) return;
    const dateCards = carousel.querySelectorAll(".special-date-card");
    dotsContainer.innerHTML = "";

    // +1 for the add button card
    for (let i = 1; i <= dateCards.length; i++) {
      const dot = document.createElement("div");
      dot.className = "dot";
      if (i === 0) dot.classList.add("active");
      // En PC no hay drag, así que el dot navega el carousel con un click.
      // En mobile el swipe sigue funcionando igual; el click no molesta.
      dot.addEventListener("click", () => {
        const targetCard = dateCards[i - 1];
        if (!targetCard) return;
        carousel.scrollTo({
          left: targetCard.offsetLeft - carousel.offsetLeft,
          behavior: "smooth",
        });
      });
      dotsContainer.appendChild(dot);
    }
    updateActiveDot();
  };

  const updateActiveDot = () => {
    if (!carousel || !dotsContainer) return;
    const scrollLeft = carousel.scrollLeft;
    const width = carousel.offsetWidth;
    let index = Math.round(scrollLeft / width);
    const dots = dotsContainer.querySelectorAll(".dot");

    if (index >= dots.length) index = dots.length - 1;

    dots.forEach((dot, i) => {
      if (i === index) {
        dot.classList.add("active");
      } else {
        dot.classList.remove("active");
      }
    });
  };

  if (carousel) carousel.addEventListener("scroll", updateActiveDot);

  const addNewCard = () => {
    if (!carousel) return;
    const existingCards = carousel.querySelectorAll(".special-date-card");
    if (existingCards.length === 0) return;

    const template = existingCards[0].cloneNode(true);

    // Reset inputs
    template.querySelectorAll("input").forEach((input) => {
      input.value = "";
      input.classList.remove("input-error");
    });
    template.querySelectorAll(".error-msg").forEach((msg) => msg.remove());

    const addCard = carousel.querySelector(".add-date-card");

    carousel.insertBefore(template, addCard);

    void template.offsetWidth;

    gsap.fromTo(
      template,
      { opacity: 0, x: -50 },
      { opacity: 1, x: 0, duration: 0.4, ease: "power2.out" },
    );

    // Animate entry
    gsap.set(template, { opacity: 0, x: -50 });
    carousel.insertBefore(template, addCard);
    gsap.to(template, {
      opacity: 1,
      x: 0,
      duration: 0.4,
      ease: "power2.out",
    });

    updateDots();

    // Scroll to new
    setTimeout(() => {
      carousel.scrollTo({
        left: template.offsetLeft - carousel.offsetLeft,
        behavior: "smooth",
      });
    }, 50);

    attachValidationListeners(template);
  };

  // Event Delegation for adding/deleting
  document.addEventListener("click", (e) => {
    // Add
    const addBtn = e.target.closest(".add-special-date-btn");
    if (addBtn) {
      addNewCard();
    }

    // Delete
    const deleteBtn = e.target.closest(".delete-special-date-btn");
    if (deleteBtn) {
      const card = deleteBtn.closest(".special-date-card");
      if (carousel) {
        const cardsCount =
          carousel.querySelectorAll(".special-date-card").length;

        if (cardsCount > 1) {
          // Capturar posiciones actuales de todas las cards antes de eliminar
          const allCards = Array.from(
            carousel.querySelectorAll(".special-date-card"),
          );
          const state = allCards.map((c) => ({
            el: c,
            left: c.getBoundingClientRect().left,
          }));

          // Animar salida de la card eliminada
          gsap.to(card, {
            opacity: 0,
            x: 50,
            duration: 0.4,
            ease: "power2.out",
            onComplete: () => {
              card.remove();
              updateDots();
              updateActiveDot();

              // FLIP: mover el resto de las cards a su nueva posición con animación
              const remainingCards = state.filter((s) => s.el !== card);

              remainingCards.forEach((s) => {
                const newLeft = s.el.getBoundingClientRect().left;
                const delta = s.left - newLeft;

                if (delta !== 0) {
                  gsap.fromTo(
                    s.el,
                    { x: delta },
                    { x: 0, duration: 0.4, ease: "power2.out" },
                  );
                }
              });
            },
          });
        } else {
          mostrarToast((start = "Elegí también la fecha de salida."), "error");
        }
      }
    }
  });

  // --- Validation ---
  const validateDates = (desdeInput, hastaInput) => {
    let errorMsgEl = hastaInput.parentElement.querySelector(".error-msg");

    if (desdeInput.value && hastaInput.value) {
      const desdeDate = new Date(desdeInput.value);
      const hastaDate = new Date(hastaInput.value);

      if (hastaDate <= desdeDate) {
        hastaInput.setCustomValidity(
          'La fecha "Hasta" debe ser posterior a "Desde".',
        );
        hastaInput.classList.add("input-error");

        if (!errorMsgEl) {
          errorMsgEl = document.createElement("span");
          errorMsgEl.className = "error-msg";
          errorMsgEl.textContent = 'Debe ser posterior a "Desde"';
          hastaInput.parentElement.appendChild(errorMsgEl);
          gsap.fromTo(
            errorMsgEl,
            { opacity: 0, y: -5 },
            { opacity: 1, y: 0, duration: 0.3 },
          );
        }
      } else {
        hastaInput.setCustomValidity("");
        hastaInput.classList.remove("input-error");
        if (errorMsgEl) {
          gsap.to(errorMsgEl, {
            opacity: 0,
            height: 0,
            duration: 0.2,
            onComplete: () => errorMsgEl.remove(),
          });
        }
      }
    } else {
      hastaInput.setCustomValidity("");
      hastaInput.classList.remove("input-error");
      if (errorMsgEl) errorMsgEl.remove();
    }
  };

  const attachValidationListeners = (container) => {
    const rows = container.querySelectorAll(".input-row");
    rows.forEach((row) => {
      const desdeInput = row.querySelector(".date-desde");
      const hastaInput = row.querySelector(".date-hasta");

      if (desdeInput && hastaInput) {
        desdeInput.addEventListener("change", () =>
          validateDates(desdeInput, hastaInput),
        );
        hastaInput.addEventListener("change", () =>
          validateDates(desdeInput, hastaInput),
        );
      }
    });
  };

  attachValidationListeners(document);

  // --- Save Flow ---
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();

      let isValid = true;
      const allDesde = document.querySelectorAll(".date-desde");
      const allHasta = document.querySelectorAll(".date-hasta");

      for (let i = 0; i < allDesde.length; i++) {
        validateDates(allDesde[i], allHasta[i]);
        if (allHasta[i].validationMessage) {
          isValid = false;
          allHasta[i].focus();
          break;
        }
      }

      if (!isValid || !form.checkValidity()) {
        form.reportValidity();
        return;
      }

      // Loading State Animation
      const icon = saveBtn.querySelector(".icon-save");
      const text = saveBtn.querySelector(".btn-text-content");

      saveBtn.disabled = true;

      gsap.to(icon, {
        rotation: 360,
        duration: 1,
        repeat: -1,
        ease: "linear",
      });
      icon.textContent = "sync";
      text.textContent = "Guardando...";

      // Simulate network request
      setTimeout(() => {
        // Success State
        gsap.killTweensOf(icon);
        gsap.set(icon, { rotation: 0 });

        icon.textContent = "check_circle";
        text.textContent = "¡Guardado!";

        saveBtn.classList.add("btn-success");
        gsap.to(saveBtn, {
          backgroundColor: "var(--turquesa)",
          duration: 0.3,
        });

        // Reset after delay
        setTimeout(() => {
          icon.textContent = "save";
          text.textContent = "Guardar Cambios";
          saveBtn.classList.remove("btn-success");
          gsap.to(saveBtn, {
            backgroundColor: "var(--primary-container)",
            duration: 0.3,
          });
          saveBtn.disabled = false;
        }, 3000);
      }, 1500);
    });
  }

  // Init
  updateDots();

  // Set initial active state correctly based on initial css
  gsap.set(".tab-content.active", { opacity: 1, y: 0 });
});
