(function () {
  "use strict";

  /* ==========================================================
     TYPEWRITER HERO
  =========================================================== */
  const phrases = [
    "Tu depto frente a la costa te espera",
    "Terraza con vista al mar en San Bernardo",
    "A 2 cuadras de la playa, todo el verano",
    "El lugar ideal para tus vacaciones en familia",
  ];
  const twEl = document.getElementById("typewriter");
  const heroTitleEl = document.querySelector(".hero-title");
  let twPhraseIdx = 0,
    twCharIdx = 0,
    twDeleting = false;

  /* Reserva la altura máxima que puede ocupar cualquier frase para que
     el título no cambie de tamaño (y no mueva el resto del hero) mientras
     se "tipea" o se "borra" el texto. Se recalcula en resize. */
  function fixHeroTitleHeight() {
    if (!twEl || !heroTitleEl) return;
    const prevText = twEl.textContent;
    const prevHeight = heroTitleEl.style.height;
    let maxHeight = 0;
    phrases.forEach((phrase) => {
      twEl.textContent = phrase;
      maxHeight = Math.max(maxHeight, heroTitleEl.scrollHeight);
    });
    twEl.textContent = prevText;
  }

  if (twEl && heroTitleEl) {
    fixHeroTitleHeight();
    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(fixHeroTitleHeight, 150);
    });
  }

  function typewriterTick() {
    const current = phrases[twPhraseIdx];
    if (!twDeleting) {
      twCharIdx++;
      twEl.textContent = current.slice(0, twCharIdx);
      if (twCharIdx === current.length) {
        twDeleting = true;
        setTimeout(typewriterTick, 1800);
        return;
      }
    } else {
      twCharIdx--;
      twEl.textContent = current.slice(0, twCharIdx);
      if (twCharIdx === 0) {
        twDeleting = false;
        twPhraseIdx = (twPhraseIdx + 1) % phrases.length;
      }
    }
    setTimeout(typewriterTick, twDeleting ? 35 : 55);
  }
  if (twEl) typewriterTick();

  /* ==========================================================
     GALERÍA / MASONRY + LIGHTBOX
  =========================================================== */
  const galleryImages = [
    {
      src: "/assets/images/galeria/terraza.jpeg",
      alt: "Terraza",
      size: "wide",
    },
    {
      src: "/assets/images/galeria/cocina.jpeg",
      alt: "Cocina",
      size: "std",
    },
    {
      src: "/assets/images/galeria/dormitorio_1.jpeg",
      alt: "Dormitorio",
      size: "tall",
    },
    {
      src: "/assets/images/galeria/frente.jpeg",
      alt: "Frente del edificio",
      size: "xtall",
    },
    {
      src: "/assets/images/galeria/comedor.jpeg",
      alt: "Comedor",
      size: "tall",
    },
    {
      src: "/assets/images/galeria/baño.jpg",
      alt: "Baño",
      size: "std",
    },
    {
      src: "/assets/images/galeria/living.jpeg",
      alt: "Living",
      size: "std",
    },
    {
      src: "/assets/images/galeria/entrada.jpeg",
      alt: "Entrada",
      size: "wide",
    },
    {
      src: "/assets/images/galeria/dormitorio_3.jpeg",
      alt: "Dormitorio",
      size: "std",
    },
  ];

  const masonry = document.getElementById("masonry");
  galleryImages.forEach((img, i) => {
    const item = document.createElement("div");
    item.className = `masonry-item is-${img.size || "std"}`;
    item.innerHTML = `<img src="${img.src}" alt="${img.alt}" loading="lazy">`;
    item.addEventListener("click", () => openLightbox(i));
    masonry.appendChild(item);
  });

  const lightbox = document.getElementById("lightbox");
  const lightboxImg = document.getElementById("lightboxImg");
  const lightboxCount = document.getElementById("lightboxCount");
  let lbIndex = 0;

  function openLightbox(i) {
    lbIndex = i;
    renderLightbox();
    openModal(lightbox);
  }
  function renderLightbox() {
    const img = galleryImages[lbIndex];
    lightboxImg.src = img.src;
    lightboxImg.alt = img.alt;
    lightboxCount.textContent = `${lbIndex + 1} / ${galleryImages.length}`;
  }
  document.getElementById("lbPrev").addEventListener("click", () => {
    lbIndex = (lbIndex - 1 + galleryImages.length) % galleryImages.length;
    renderLightbox();
  });
  document.getElementById("lbNext").addEventListener("click", () => {
    lbIndex = (lbIndex + 1) % galleryImages.length;
    renderLightbox();
  });

  /* ==========================================================
     MODALES (genérico)
  =========================================================== */
  function openModal(el) {
    el.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeModal(el) {
    el.hidden = true;
    document.body.style.overflow = "";
  }
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal(overlay);
    });
  });
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const overlay = btn.closest(".modal-overlay");
      if (overlay) closeModal(overlay);
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-overlay").forEach((o) => {
        if (!o.hidden) closeModal(o);
      });
    }
  });

  /* ==========================================================
     CALENDARIO REUTILIZABLE (rango de fechas)
  =========================================================== */
  const MESES = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
  ];
  const DIAS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

  // Fechas de ejemplo ya reservadas (simulación de disponibilidad)
  const bookedDates = new Set([
    "2026-12-24",
    "2026-12-25",
    "2026-12-31",
    "2027-01-01",
    "2027-01-15",
    "2027-01-16",
    "2027-01-17",
  ]);

  function fmtKey(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function createCalendar(container, { onRangeChange } = {}) {
    const today = new Date();
    let viewYear = today.getFullYear();
    let viewMonth = today.getMonth();
    let rangeStart = null,
      rangeEnd = null;

    function render() {
      container.innerHTML = "";
      const head = document.createElement("div");
      head.className = "cal-head";
      head.innerHTML = `
        <button type="button" aria-label="Mes anterior" data-nav="-1"><svg class="ic-sm rot180"><use href="#ic-chevron"/></svg></button>
        <span>${MESES[viewMonth]} ${viewYear}</span>
        <button type="button" aria-label="Mes siguiente" data-nav="1"><svg class="ic-sm"><use href="#ic-chevron"/></svg></button>
      `;
      container.appendChild(head);

      const grid = document.createElement("div");
      grid.className = "cal-grid";
      DIAS.forEach((d) => {
        const el = document.createElement("div");
        el.className = "cal-dow";
        el.textContent = d;
        grid.appendChild(el);
      });

      const firstDay = new Date(viewYear, viewMonth, 1);
      let startOffset = firstDay.getDay() - 1; // lunes = 0
      if (startOffset < 0) startOffset = 6;
      const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

      for (let i = 0; i < startOffset; i++) {
        const empty = document.createElement("div");
        empty.className = "cal-day empty";
        grid.appendChild(empty);
      }

      const todayMidnight = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
      );

      for (let d = 1; d <= daysInMonth; d++) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cal-day";
        btn.textContent = d;
        const key = fmtKey(viewYear, viewMonth, d);
        const dateObj = new Date(viewYear, viewMonth, d);

        if (dateObj < todayMidnight) {
          btn.disabled = true;
        } else if (bookedDates.has(key)) {
          btn.classList.add("booked");
          btn.disabled = true;
        } else {
          if (rangeStart && !rangeEnd && key === rangeStart) {
            btn.classList.add("selected");
          }
          if (
            rangeStart &&
            rangeEnd &&
            (key === rangeStart || key === rangeEnd)
          ) {
            btn.classList.add("selected");
          }
          if (
            rangeStart &&
            rangeEnd &&
            dateObj > new Date(rangeStart) &&
            dateObj < new Date(rangeEnd)
          ) {
            btn.classList.add("in-range");
          }
          btn.addEventListener("click", () => {
            if (!rangeStart || (rangeStart && rangeEnd)) {
              rangeStart = key;
              rangeEnd = null;
            } else {
              if (new Date(key) < new Date(rangeStart)) {
                rangeStart = key;
              } else {
                rangeEnd = key;
              }
            }
            render();
            if (onRangeChange) onRangeChange(rangeStart, rangeEnd);
          });
        }
        grid.appendChild(btn);
      }
      container.appendChild(grid);

      head.querySelectorAll("[data-nav]").forEach((b) => {
        b.addEventListener("click", () => {
          viewMonth += parseInt(b.dataset.nav, 10);
          if (viewMonth < 0) {
            viewMonth = 11;
            viewYear--;
          }
          if (viewMonth > 11) {
            viewMonth = 0;
            viewYear++;
          }
          render();
        });
      });
    }
    render();
    return {
      getRange: () => ({ start: rangeStart, end: rangeEnd }),
      reset: () => {
        rangeStart = null;
        rangeEnd = null;
        render();
      },
    };
  }

  // Calendario del modal "Ver disponibilidad"
  createCalendar(document.getElementById("calDisponibilidad"));

  // Calendario del formulario
  const fechasInput = document.getElementById("fechasInput");
  const fechasLabel = document.getElementById("fechasLabel");
  const formCalendar = createCalendar(document.getElementById("calFormulario"));

  function fmtDisplay(key) {
    const [y, m, d] = key.split("-");
    return `${d}/${m}/${y}`;
  }

  document.getElementById("btnDisponibilidad").addEventListener("click", () => {
    openModal(document.getElementById("modalDisponibilidad"));
  });

  document.getElementById("fechasBtn").addEventListener("click", () => {
    openModal(document.getElementById("modalFechas"));
  });

  document.getElementById("confirmarFechas").addEventListener("click", () => {
    const { start, end } = formCalendar.getRange();
    if (start && end) {
      fechasLabel.textContent = `${fmtDisplay(start)} → ${fmtDisplay(end)}`;
      fechasInput.value = `${start} a ${end}`;
      closeModal(document.getElementById("modalFechas"));
    } else if (start) {
      fechasLabel.textContent = `Elegí también la fecha de salida`;
    } else {
      fechasLabel.textContent = "Seleccionar fechas";
    }
  });

  /* ==========================================================
     FORMULARIO: PERSONAS / NIÑOS / EDADES
  =========================================================== */
  const personasSel = document.getElementById("personas");
  const ninosField = document.getElementById("ninosField");
  const ninosSel = document.getElementById("ninos");
  const ninosHint = document.getElementById("ninosHint");
  const edadesGroup = document.getElementById("edadesGroup");
  const edadesWrap = document.getElementById("edadesWrap");

  /* Tope duro del departamento: adultos + niños nunca puede superar este número. */
  const MAX_PERSONAS = 4;
  const EDAD_MAX_NINO = 17;

  function limpiarNinos() {
    ninosField.hidden = true;
    ninosSel.innerHTML = `<option value="0">Sin niños</option>`;
    ninosSel.value = "0";
    ninosHint.textContent = "";
    edadesGroup.hidden = true;
    edadesWrap.innerHTML = "";
  }

  /* El select de niños se arma según el cupo que queda para llegar a
     MAX_PERSONAS: si eligen 2 adultos quedan 2 lugares, si eligen 3 queda 1. */
  function renderNinos() {
    const adultos = parseInt(personasSel.value, 10) || 0;
    if (adultos < 2) {
      limpiarNinos();
      return;
    }

    const cupo = Math.max(0, MAX_PERSONAS - adultos);
    const previo = parseInt(ninosSel.value, 10) || 0;

    ninosField.hidden = false;
    ninosSel.innerHTML = `<option value="0">Sin niños</option>`;
    for (let n = 1; n <= cupo; n++) {
      const opt = document.createElement("option");
      opt.value = String(n);
      opt.textContent = `${n} niño${n > 1 ? "s" : ""}`;
      ninosSel.appendChild(opt);
    }
    ninosSel.value = String(Math.min(previo, cupo));

    ninosHint.textContent =
      cupo > 0
        ? `Podés sumar hasta ${cupo} niño${cupo > 1 ? "s" : ""} (máximo ${MAX_PERSONAS} personas en total).`
        : `Ya cubriste el máximo de ${MAX_PERSONAS} personas.`;

    renderEdades();
  }

  /* Un select de edad (0 a 17) por cada niño declarado. */
  function renderEdades() {
    const cantidad = parseInt(ninosSel.value, 10) || 0;
    edadesWrap.innerHTML = "";

    if (cantidad < 1) {
      edadesGroup.hidden = true;
      return;
    }

    edadesGroup.hidden = false;
    const opciones = Array.from({ length: EDAD_MAX_NINO + 1 }, (_, y) => {
      const texto = y === 0 ? "Menos de 1 año" : `${y} año${y > 1 ? "s" : ""}`;
      return `<option value="${y}">${texto}</option>`;
    }).join("");

    for (let i = 1; i <= cantidad; i++) {
      const field = document.createElement("div");
      field.className = "edad-field";
      field.innerHTML = `
        <label for="edadNino${i}">Niño ${i}</label>
        <select id="edadNino${i}" name="edadNino${i}" required>
          <option value="" selected disabled>Elegir edad</option>
          ${opciones}
        </select>
      `;
      edadesWrap.appendChild(field);
    }
  }

  personasSel.addEventListener("change", renderNinos);
  ninosSel.addEventListener("change", renderEdades);

  /* ==========================================================
     FORMULARIO: VEHÍCULO
  =========================================================== */
  const vehiculoChk = document.getElementById("vehiculo");
  const vehiculoFields = document.getElementById("vehiculoFields");
  const vehiculoMarca = document.getElementById("vehiculoMarca");
  const vehiculoModelo = document.getElementById("vehiculoModelo");
  const vehiculoTipo = document.getElementById("vehiculoTipo");
  const vehiculoAnio = document.getElementById("vehiculoAnio");
  const vehiculoInputs = [
    vehiculoMarca,
    vehiculoModelo,
    vehiculoTipo,
    vehiculoAnio,
  ];

  const ANIO_MIN = 1950;
  const ANIO_MAX = new Date().getFullYear() + 1;

  /* Los datos del vehículo solo existen (y solo son obligatorios) mientras
     el checkbox esté tildado; al destildar se limpian para no enviar basura. */
  function toggleVehiculo() {
    const activo = vehiculoChk.checked;
    vehiculoFields.hidden = !activo;
    vehiculoInputs.forEach((el) => {
      el.required = activo;
      if (!activo) {
        el.value = "";
        el.setCustomValidity("");
      }
    });
  }

  vehiculoChk.addEventListener("change", toggleVehiculo);

  vehiculoAnio.addEventListener("input", () => {
    vehiculoAnio.value = vehiculoAnio.value.replace(/\D/g, "").slice(0, 4);
    const anio = parseInt(vehiculoAnio.value, 10);
    const valido =
      vehiculoAnio.value.length === 4 && anio >= ANIO_MIN && anio <= ANIO_MAX;
    vehiculoAnio.setCustomValidity(
      vehiculoAnio.value && !valido
        ? `Ingresá un año válido entre ${ANIO_MIN} y ${ANIO_MAX}.`
        : "",
    );
  });

  toggleVehiculo();

  /* ==========================================================
     ENVÍO DE FORMULARIO DE RESERVA
  =========================================================== */
  const bookingForm = document.getElementById("bookingForm");
  const formSuccess = document.getElementById("formSuccess");
  bookingForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!bookingForm.checkValidity()) {
      bookingForm.reportValidity();
      return;
    }
    if (!fechasInput.value) {
      fechasLabel.textContent = "Elegí tus fechas de estadía";
      openModal(document.getElementById("modalFechas"));
      return;
    }
    formSuccess.hidden = false;
    formSuccess.scrollIntoView({ behavior: "smooth", block: "center" });
    bookingForm.reset();
    limpiarNinos();
    toggleVehiculo();
    resetContadores();
    fechasLabel.textContent = "Seleccionar fechas";
    fechasInput.value = "";
    formCalendar.reset();
  });

  /* ==========================================================
     RESEÑAS: CARRUSEL
  =========================================================== */
  const reviews = [
    {
      name: "Marina G.",
      rating: 5,
      text: "El departamento es hermoso, la terraza con vista al mar superó todas nuestras expectativas. Volvemos el próximo verano seguro.",
    },
    {
      name: "Fede R.",
      rating: 5,
      text: "Ubicación inmejorable, a metros de la playa y de la peatonal. Todo impecable y muy bien equipado.",
    },
    {
      name: "Lucía M.",
      rating: 4,
      text: "Muy cómodo para 4 personas, la cocina tiene todo lo necesario. El único detalle fue el calor un día sin viento, pero el ventilador ayudó bastante.",
    },
    {
      name: "Diego P.",
      rating: 5,
      text: "Excelente atención de los dueños, respondieron todas las consultas antes de llegar. El edificio tiene ascensor y cochera, muy práctico.",
    },
    {
      name: "Sol A.",
      rating: 5,
      text: "Nos encantó despertar viendo el mar desde la terraza. Zona tranquila y cerca de todo. Totalmente recomendable.",
    },
  ];

  const reviewsTrack = document.getElementById("reviewsTrack");
  const reviewDots = document.getElementById("reviewDots");

  function starsMarkup(rating) {
    return Array.from(
      { length: 5 },
      (_, i) =>
        `<svg style="opacity:${i < rating ? 1 : 0.25}"><use href="#ic-star"/></svg>`,
    ).join("");
  }

  // Índice dentro de la lista TRIPLICADA (clon-anterior + real + clon-siguiente).
  // Es la ÚNICA fuente de verdad de la posición mientras hay una animación
  // en curso: se actualiza directamente en los clics de prev/next, y el
  // listener de "scroll" la deja en paz hasta que el movimiento programático
  // termina. Antes, clics rápidos y el evento "scroll" (que "adivinaba" el
  // índice a partir de una posición intermedia, todavía en movimiento) se
  // pisaban entre sí, y el carrusel terminaba saltando a un índice
  // equivocado (a veces directo a 0).
  let tripledIndex = 0;
  let activeIndex = 0; // índice real (0..N-1) de la tarjeta más a la izquierda
  let isAnimating = false; // true mientras el scroll lo está moviendo código nuestro (clic o jump silencioso)

  function renderReviews() {
    const N = reviews.length;
    reviewsTrack.innerHTML = "";
    for (let copy = 0; copy < 3; copy++) {
      reviews.forEach((r) => {
        const card = document.createElement("div");
        card.className = "review-card";
        card.innerHTML = `
          <svg class="quote-mark"><use href="#ic-quote"/></svg>
          <div class="stars">${starsMarkup(r.rating)}</div>
          <p>${r.text}</p>
          <p class="review-name">${r.name}</p>
        `;
        reviewsTrack.appendChild(card);
      });
    }
    tripledIndex = N; // arrancamos en el bloque real (la copia del medio)
    activeIndex = 0;
    renderDots();
    moveTo(tripledIndex, false); // reposicionamos sin animación, sin que se note el salto inicial
  }

  // Mueve el track a un índice de la lista triplicada. Marca isAnimating
  // para que el listener de "scroll" ignore los eventos que dispara esta
  // misma animación (y no recalcule tripledIndex con valores intermedios).
  function moveTo(index, animate) {
    isAnimating = true;
    reviewsTrack.scrollTo({
      left: index * cardWidth(),
      behavior: animate ? "smooth" : "auto",
    });
    if (!animate) {
      // Un scroll "auto" no siempre dispara "scrollend" en todos los
      // navegadores: liberamos la bandera en el siguiente frame.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          isAnimating = false;
        }),
      );
    }
  }

  function cardWidth() {
    const card = reviewsTrack.querySelector(".review-card");
    if (!card) return 0;
    return card.getBoundingClientRect().width + 20;
  }

  function renderDots() {
    const N = reviews.length;
    reviewDots.innerHTML = "";
    for (let i = 0; i < N; i++) {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.addEventListener("click", () => goToReal(i));
      reviewDots.appendChild(dot);
    }
    updateDots();
  }

  function updateDots() {
    [...reviewDots.children].forEach((d, i) =>
      d.classList.toggle("active", i === activeIndex),
    );
  }

  // Lleva el carrusel a un índice real (0..N-1), eligiendo la copia
  // (anterior, real o siguiente) más cercana a la posición actual para
  // que el desplazamiento sea siempre corto.
  function goToReal(i) {
    const N = reviews.length;
    const candidates = [i, i + N, i + 2 * N];
    let best = candidates[0];
    let bestDist = Math.abs(best - tripledIndex);
    candidates.forEach((c) => {
      const dist = Math.abs(c - tripledIndex);
      if (dist < bestDist) {
        best = c;
        bestDist = dist;
      }
    });
    tripledIndex = best;
    activeIndex = i;
    updateDots();
    moveTo(tripledIndex, true);
  }

  // Da un paso (+1 / -1) dentro de la lista triplicada. tripledIndex se
  // actualiza acá mismo, al instante del clic, en lugar de esperar a que
  // el evento "scroll" lo "adivine" más tarde. Así los clics rápidos se
  // van acumulando correctamente en vez de pisarse entre sí.
  function step(delta) {
    const N = reviews.length;
    tripledIndex += delta;
    activeIndex = ((tripledIndex % N) + N) % N;
    updateDots();
    moveTo(tripledIndex, true);
  }

  // Si terminamos de desplazarnos dentro de una copia clon (izquierda o
  // derecha), saltamos en silencio al bloque real equivalente. Como la
  // tarjeta clonada es visualmente idéntica, el salto es imperceptible.
  function settleLoop() {
    const N = reviews.length;
    if (tripledIndex >= 2 * N || tripledIndex < N) {
      tripledIndex = (((tripledIndex % N) + N) % N) + N;
      moveTo(tripledIndex, false);
    }
  }

  // Detecta cuándo el scroll terminó realmente de moverse (ya sea por una
  // animación de clic o por un arrastre táctil/manual), en vez de usar un
  // timeout fijo desde el último clic, que era lo que se desincronizaba
  // con clics rápidos y terminaba "reseteando" el carrusel.
  let scrollEndTimer;
  function onScrollSettled() {
    if (!isAnimating) {
      // El usuario arrastró el carrusel manualmente (touch/trackpad):
      // ahí sí leemos la posición real y la adoptamos como fuente de verdad.
      const N = reviews.length;
      tripledIndex = Math.round(reviewsTrack.scrollLeft / (cardWidth() || 1));
      activeIndex = ((tripledIndex % N) + N) % N;
      updateDots();
    }
    isAnimating = false;
    settleLoop();
  }

  reviewsTrack.addEventListener("scroll", () => {
    clearTimeout(scrollEndTimer);
    scrollEndTimer = setTimeout(onScrollSettled, 120);
  });
  reviewsTrack.addEventListener("scrollend", () => {
    clearTimeout(scrollEndTimer);
    onScrollSettled();
  });

  // Recalcula cuando el layout real del carrusel cambia (fuentes, imágenes,
  // resize), no solo al cargar el script, que es cuando el ancho real
  // todavía puede no estar estabilizado. Reubica sin animación en la
  // misma tarjeta activa para no perder la posición.
  let dotsRecalcTimer;
  const scheduleDotsRecalc = () => {
    clearTimeout(dotsRecalcTimer);
    dotsRecalcTimer = setTimeout(() => {
      moveTo(tripledIndex, false);
    }, 120);
  };
  if (window.ResizeObserver) {
    new ResizeObserver(scheduleDotsRecalc).observe(reviewsTrack);
  } else {
    window.addEventListener("resize", scheduleDotsRecalc);
  }
  window.addEventListener("load", scheduleDotsRecalc);

  document.getElementById("reviewPrev").addEventListener("click", () => {
    step(-1);
  });
  document.getElementById("reviewNext").addEventListener("click", () => {
    step(1);
  });

  renderReviews();

  /* ==========================================================
     MODAL DEJAR RESEÑA
  =========================================================== */
  document.getElementById("btnDejarResena").addEventListener("click", () => {
    openModal(document.getElementById("modalResena"));
  });

  let selectedStars = 0;
  const starPicker = document.getElementById("starPicker");
  starPicker.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedStars = parseInt(btn.dataset.val, 10);
      starPicker.querySelectorAll("button").forEach((b) => {
        b.classList.toggle(
          "active",
          parseInt(b.dataset.val, 10) <= selectedStars,
        );
      });
    });
  });

  document.getElementById("resenaForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const nombre = document.getElementById("resenaNombre").value.trim();
    const comentario = document.getElementById("resenaComentario").value.trim();
    if (!nombre || !comentario) {
      return;
    }
    reviews.unshift({
      name: nombre,
      rating: selectedStars || 5,
      text: comentario,
    });
    renderReviews();
    closeModal(document.getElementById("modalResena"));
    e.target.reset();
    selectedStars = 0;
    starPicker
      .querySelectorAll("button")
      .forEach((b) => b.classList.remove("active"));
  });

  //dpto-media opacity change

  const image1 = document.getElementById("deptoImage1");
  const image2 = document.getElementById("deptoImage2");

  const images = [
    "/assets/images/galeria/dormitorio_3.jpeg",
    "/assets/images/galeria/dormitorio_1.jpeg",
    "/assets/images/galeria/cocina.jpeg",
    "/assets/images/galeria/baño.jpg",
    "/assets/images/galeria/living.jpeg",
    "/assets/images/galeria/comedor.jpeg",
  ];

  let currentImage = 0;
  let showingFirst = true;

  setInterval(() => {
    currentImage = (currentImage + 1) % images.length;

    if (showingFirst) {
      image2.src = images[currentImage];

      image2.style.opacity = "1";
      image1.style.opacity = "0";
    } else {
      image1.src = images[currentImage];

      image1.style.opacity = "1";
      image2.style.opacity = "0";
    }

    showingFirst = !showingFirst;
  }, 5000);

  // ===========================
  // MAPA LEAFLET
  // ===========================
  const mapContainer = document.getElementById("map");
  const mapFrame = document.querySelector(".map-frame");
  const mapOverlay = document.getElementById("mapOverlay");
  const mapOverlayText = document.getElementById("mapOverlayText");

  if (mapContainer && mapFrame && mapOverlay && typeof L !== "undefined") {
    /* Coordenadas de San Bernardo del Tuyú */
    const DEPTO_COORDS = [-36.68960161007483, -56.6791927028098];
    const DIRECCION_HTML =
      "<b>Dirección:</b> Calle San Juan 2530,<br>entre las calles Santa María de Oro y Andrade,<br>San Bernardo del Tuyú, Buenos Aires";
    const HINT_DESKTOP =
      "Usá <kbd>Ctrl</kbd> + <kbd>Scroll</kbd> para hacer zoom";
    const HINT_TOUCH = "Usá dos dedos para mover y hacer zoom en el mapa";

    /* Puntero fino (mouse/trackpad) vs. táctil. Se consulta en cada uso
       para que siga siendo correcto al rotar o cambiar de dispositivo,
       en vez de quedar congelado al cargar la página. */
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const isDesktop = () => finePointer.matches;

    const map = L.map(mapContainer, {
      scrollWheelZoom: false,
      dragging: finePointer.matches,
      touchZoom: true,
      attributionControl: false,
    }).setView(DEPTO_COORDS, 15);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);
    const markerSize =
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--marker-size",
        ),
      ) || 40;

    L.control
      .attribution({
        prefix: false,
      })
      .addAttribution("© DepartamentosDimo")
      .addTo(map);

    const BASE_RATIO = (960 - 160) / 960;
    const customIcon = L.divIcon({
      className: "map-marker",
      html:
        '<span class="map-marker__inner">' +
        '<svg class="map-marker__icon" aria-hidden="true" focusable="false">' +
        '<use href="#ic-house"></use></svg>' +
        "</span>",
      iconSize: [markerSize, markerSize],
      iconAnchor: [markerSize / 2, markerSize * BASE_RATIO],
      popupAnchor: [0, -markerSize * BASE_RATIO],
    });

    const marker = L.marker(DEPTO_COORDS, {
      icon: customIcon,
      keyboard: true,
      riseOnHover: true,
    }).addTo(map);

    /* Leaflet sólo aplica `alt` a iconos <img>; en un divIcon el nombre
       accesible hay que ponerlo a mano sobre el elemento generado. */
    const markerEl = marker.getElement();
    if (markerEl) {
      markerEl.setAttribute(
        "aria-label",
        "Ubicación del departamento: Calle San Juan 2530, San Bernardo del Tuyú",
      );
    }

    marker.bindPopup(
      '<div class="map-popup">' +
        "<p>" +
        DIRECCION_HTML +
        "</p>" +
        '<a class="map-popup__link" target="_blank" rel="noopener"' +
        ' href="https://www.google.com/maps/dir/-34.5407488,-58.5662464/San+Juan+2530,+B7111+San+Bernardo+del+Tuy%C3%BA,+Provincia+de+Buenos+Aires/@-35.5599758,-58.9463983,8z/data=!3m1!4b1!4m9!4m8!1m1!4e1!1m5!1m1!1s0x959c6f1e7be20f4f:0xcc0d2c6bf1f4c197!2m2!1d-56.6791927!2d-36.6897651?entry=ttu&g_ep=EgoyMDI2MDgxNy4wIKXMDSoASAFQAw%3D%3D' +
        '">Cómo llegar</a>' +
        "</div>",
      { className: "map-popup-wrap", closeButton: true, autoPan: true },
    );

    // ---------------------------
    // Overlay de bloqueo de zoom
    // ---------------------------
    let hintTimer = null;

    function showOverlay(message) {
      if (marker.isPopupOpen()) return;
      if (message && mapOverlayText) mapOverlayText.innerHTML = message;
      mapFrame.classList.add("is-locked");
      mapOverlay.classList.add("visible");
      mapOverlay.setAttribute("aria-hidden", "false");
    }

    function hideOverlay() {
      clearTimeout(hintTimer);
      mapFrame.classList.remove("is-locked");
      mapOverlay.classList.remove("visible");
      mapOverlay.setAttribute("aria-hidden", "true");
    }

    marker.on("popupopen", hideOverlay);

    // ---------------------------
    // Desktop: Ctrl + Scroll
    // ---------------------------
    mapContainer.addEventListener("mouseenter", () => {
      if (!isDesktop()) return;
      showOverlay(HINT_DESKTOP);
    });

    mapContainer.addEventListener("mouseleave", () => {
      if (!isDesktop()) return;
      hideOverlay();
    });

    /* Se habilita el zoom con rueda sólo mientras Ctrl está presionado.
       El reset en keyup/blur evita que quede habilitado si el usuario
       suelta Ctrl fuera de la pestaña (Alt+Tab, cambio de ventana...). */
    function enableWheelZoom(e) {
      if (e.ctrlKey || e.metaKey) map.scrollWheelZoom.enable();
    }
    function disableWheelZoom() {
      map.scrollWheelZoom.disable();
    }

    document.addEventListener("keydown", enableWheelZoom);
    document.addEventListener("keyup", disableWheelZoom);
    window.addEventListener("blur", disableWheelZoom);

    mapContainer.addEventListener("wheel", (e) => {
      if (!isDesktop()) return;
      if (e.ctrlKey || e.metaKey) hideOverlay();
      else showOverlay(HINT_DESKTOP);
    });

    /* Si el usuario ya está interactuando (zoom con botones, arrastre),
       el cartel sobra. */
    map.on("zoomstart dragstart", hideOverlay);

    // ---------------------------
    // Táctil: un dedo = scroll de página, dos dedos = mapa
    // ---------------------------
    function handleTouch(e) {
      if (isDesktop()) return;

      if (e.touches.length >= 2) {
        map.dragging.enable();
        hideOverlay();
        return;
      }

      /* Un solo dedo: se devuelve el gesto al navegador para que la
         página siga scrolleando y se avisa cómo manejar el mapa. */
      map.dragging.disable();
      if (e.type === "touchstart") {
        showOverlay(HINT_TOUCH);
        clearTimeout(hintTimer);
        hintTimer = setTimeout(hideOverlay, 1800);
      }
    }

    ["touchstart", "touchmove", "touchend", "touchcancel"].forEach((type) => {
      mapContainer.addEventListener(type, handleTouch, { passive: true });
    });

    /* Al cambiar de puntero (tablet con teclado desmontable, rotación)
       se recalcula el modo de arrastre y se limpia el cartel. */
    const onPointerChange = () => {
      if (isDesktop()) map.dragging.enable();
      else map.dragging.disable();
      hideOverlay();
    };
    if (typeof finePointer.addEventListener === "function") {
      finePointer.addEventListener("change", onPointerChange);
    }

    /* El contenedor puede montarse oculto o cambiar de tamaño (resize,
       cambio de layout); esto evita los típicos tiles grises a medio cargar. */
    window.addEventListener("resize", () => {
      map.invalidateSize();
    });
    setTimeout(() => map.invalidateSize(), 300);
  }

  const textarea = document.getElementById("mensaje");
  const contador = document.getElementById("contador");
  const caracteres = document.getElementById("caracteres");
  const contadorChip = document.getElementById("contadorChip");
  const caracteresChip = document.getElementById("caracteresChip");

  const maxPalabras = 100;
  const maxCaracteres = 500;

  /* El chip pasa a "aviso" cerca del límite y a "lleno" cuando lo toca. */
  function pintarChip(chip, actual, max) {
    chip.classList.toggle("is-warn", actual >= max * 0.85 && actual < max);
    chip.classList.toggle("is-full", actual >= max);
  }

  function actualizarContadores() {
    const palabras = textarea.value.trim()
      ? textarea.value.trim().split(/\s+/).length
      : 0;

    contador.textContent = palabras;
    caracteres.textContent = textarea.value.length;
    pintarChip(contadorChip, palabras, maxPalabras);
    pintarChip(caracteresChip, textarea.value.length, maxCaracteres);
  }

  function resetContadores() {
    textarea.value = "";
    actualizarContadores();
  }

  textarea.addEventListener("input", () => {
    if (textarea.value.length > maxCaracteres) {
      textarea.value = textarea.value.slice(0, maxCaracteres);
    }

    const palabras = textarea.value.trim()
      ? textarea.value.trim().split(/\s+/)
      : [];

    if (palabras.length > maxPalabras) {
      textarea.value = palabras.slice(0, maxPalabras).join(" ");
    }

    actualizarContadores();
  });

  actualizarContadores();
})();
