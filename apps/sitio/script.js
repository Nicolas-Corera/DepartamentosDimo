(function () {
  "use strict";

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

  const toastStack = document.getElementById("toastStack");

  const TOAST_MS = { exito: 3000, error: 5000 };

  function mostrarToast(mensaje, tipo = "exito") {
    const toast = document.createElement("div");
    toast.className = `toast toast-${tipo}`;

    toast.setAttribute("role", tipo === "error" ? "alert" : "status");

    const icono = tipo === "error" ? "#ic-alert" : "#ic-check";
    toast.innerHTML = `<svg class="ic-sm" aria-hidden="true"><use href="${icono}"/></svg><span></span>`;

    toast.querySelector("span").textContent = mensaje;

    let reloj;
    let cerrando = false;
    function cerrar() {
      if (cerrando) return;
      cerrando = true;
      clearTimeout(reloj);
      toast.classList.add("toast-saliendo");
      toast.addEventListener("animationend", () => toast.remove());

      setTimeout(() => toast.remove(), 400);
    }

    toast.addEventListener("click", cerrar);
    reloj = setTimeout(cerrar, TOAST_MS[tipo] || TOAST_MS.exito);

    toastStack.appendChild(toast);
    return toast;
  }

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

  const bookedDates = new Set();

  function fmtKey(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  const TZ_DESTINO = "America/Argentina/Buenos_Aires";
  const HORA_CIERRE = 9;

  const HORA_CIERRE_TXT = String(HORA_CIERRE).padStart(2, "0") + ":00";

  const FMT_DESTINO = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_DESTINO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });

  function ahoraEnDestino() {
    const p = {};
    FMT_DESTINO.formatToParts(new Date()).forEach((x) => {
      p[x.type] = x.value;
    });
    return {
      anio: Number(p.year),
      mes: Number(p.month) - 1,
      dia: Number(p.day),
      hora: Number(p.hour),
    };
  }

  function keyADate(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function primerDiaElegible() {
    const { anio, mes, dia, hora } = ahoraEnDestino();
    const base = new Date(anio, mes, dia);
    if (hora >= HORA_CIERRE) base.setDate(base.getDate() + 1);
    return base;
  }

  function hayOcupadasEntre(desdeKey, hastaKey) {
    const cursor = keyADate(desdeKey);
    const fin = keyADate(hastaKey);
    while (cursor < fin) {
      const key = fmtKey(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
      if (bookedDates.has(key)) return true;
      cursor.setDate(cursor.getDate() + 1);
    }
    return false;
  }

  const calendarios = [];

  function createCalendar(container, { onRangeChange } = {}) {
    const today = new Date();
    let viewYear = today.getFullYear();
    let viewMonth = today.getMonth();
    let rangeStart = null,
      rangeEnd = null;
    let avisoRango = "";

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
      let startOffset = firstDay.getDay() - 1;
      if (startOffset < 0) startOffset = 6;
      const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

      for (let i = 0; i < startOffset; i++) {
        const empty = document.createElement("div");
        empty.className = "cal-day empty";
        grid.appendChild(empty);
      }

      const hoy = ahoraEnDestino();
      const minimo = primerDiaElegible();
      const hoyCerrado = hoy.hora >= HORA_CIERRE;

      if (rangeStart && keyADate(rangeStart) < minimo) {
        rangeStart = null;
        rangeEnd = null;
        if (onRangeChange) onRangeChange(null, null);
      }

      for (let d = 1; d <= daysInMonth; d++) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cal-day";
        btn.textContent = d;
        const key = fmtKey(viewYear, viewMonth, d);
        const dateObj = new Date(viewYear, viewMonth, d);

        if (dateObj < minimo) {
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
            dateObj > keyADate(rangeStart) &&
            dateObj < keyADate(rangeEnd)
          ) {
            btn.classList.add("in-range");
          }
          btn.addEventListener("click", () => {
            if (!rangeStart || (rangeStart && rangeEnd)) {
              rangeStart = key;
              rangeEnd = null;
              avisoRango = "";
            } else {
              const nuevoInicio = keyADate(key) < keyADate(rangeStart);
              const desde = nuevoInicio ? key : rangeStart;
              const hasta = nuevoInicio ? rangeStart : key;

              if (hayOcupadasEntre(desde, hasta)) {
                rangeStart = key;
                rangeEnd = null;
                avisoRango =
                  "Entre esas dos fechas hay días ya reservados. Empezamos de nuevo desde el día que elegiste: marcá la salida antes de la próxima reserva.";
                render();
                if (onRangeChange) onRangeChange(rangeStart, rangeEnd);
                return;
              }

              avisoRango = "";
              if (nuevoInicio) {
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

      if (avisoRango) {
        const aviso = document.createElement("p");
        aviso.className = "cal-note cal-note-cerrado";
        aviso.setAttribute("role", "status");
        aviso.textContent = avisoRango;
        container.appendChild(aviso);
      }

      if (viewYear === hoy.anio && viewMonth === hoy.mes) {
        const nota = document.createElement("p");
        nota.className = "cal-note";
        if (hoyCerrado) {
          nota.classList.add("cal-note-cerrado");
          nota.textContent = `Hoy ya no se puede reservar: las reservas para el mismo día cierran a las ${HORA_CIERRE_TXT}. La estadía puede arrancar desde mañana.`;
        } else {
          nota.textContent = `Podés reservar para hoy mismo hasta las ${HORA_CIERRE_TXT}.`;
        }
        container.appendChild(nota);
      }

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
    const api = {
      getRange: () => ({ start: rangeStart, end: rangeEnd }),
      reset: () => {
        rangeStart = null;
        rangeEnd = null;
        avisoRango = "";
        render();
      },

      refresh: render,
    };
    calendarios.push(api);
    return api;
  }

  async function cargarFechasOcupadas() {
    if (typeof window.db === "undefined") {
      console.warn("[disponibilidad] Supabase no está cargado; el calendario queda sin ocupación.");
      return;
    }

    const { data, error } = await window.db.rpc("fechas_ocupadas");

    if (error) {
      console.error("[disponibilidad] no se pudieron traer las fechas ocupadas:", error.message);
      return;
    }

    bookedDates.clear();

    for (const reserva of data || []) {
      const cursor = keyADate(reserva.check_in);
      const salida = keyADate(reserva.check_out);

      let vueltas = 0;
      while (cursor <= salida && vueltas++ < 400) {
        bookedDates.add(
          fmtKey(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()),
        );
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    calendarios.forEach((c) => c.refresh());
  }

  const dispoCalendar = createCalendar(
    document.getElementById("calDisponibilidad"),
  );

  const fechasInput = document.getElementById("fechasInput");
  const fechasLabel = document.getElementById("fechasLabel");
  const formCalendar = createCalendar(document.getElementById("calFormulario"));

  cargarFechasOcupadas();

  function fmtDisplay(key) {
    const [y, m, d] = key.split("-");
    return `${d}/${m}/${y}`;
  }

  document.getElementById("btnDisponibilidad").addEventListener("click", () => {
    dispoCalendar.refresh();
    openModal(document.getElementById("modalDisponibilidad"));
  });

  document.getElementById("fechasBtn").addEventListener("click", () => {
    formCalendar.refresh();
    const { start, end } = formCalendar.getRange();
    if (!start || !end) {
      fechasInput.value = "";
      fechasLabel.textContent = "Seleccionar fechas";
    }
    openModal(document.getElementById("modalFechas"));
  });

  document.getElementById("confirmarFechas").addEventListener("click", () => {
    const { start, end } = formCalendar.getRange();
    if (start && end) {
      fechasLabel.textContent = `${fmtDisplay(start)} → ${fmtDisplay(end)}`;
      fechasInput.value = `${start} a ${end}`;
      closeModal(document.getElementById("modalFechas"));
      return;
    }

    mostrarToast(
      start
        ? "Elegí también la fecha de salida."
        : "Elegí la fecha de entrada y la de salida.",
      "error",
    );
  });

  const personasSel = document.getElementById("personas");
  const personasHint = document.getElementById("personasHint");
  const adultosField = document.getElementById("adultosField");
  const adultosSel = document.getElementById("adultos");
  const ninosField = document.getElementById("ninosField");
  const ninosSel = document.getElementById("ninos");
  const edadesGroup = document.getElementById("edadesGroup");
  const edadesWrap = document.getElementById("edadesWrap");

  const MAX_PERSONAS = 4;
  const EDAD_MAX_NINO = 17;

  function total() {
    return parseInt(personasSel.value, 10) || 0;
  }

  function limpiarGrupo() {
    adultosField.hidden = true;
    ninosField.hidden = true;
    adultosSel.innerHTML = `<option value="1">1 adulto</option>`;
    adultosSel.value = "1";
    ninosSel.innerHTML = `<option value="0">Sin niños</option>`;
    ninosSel.value = "0";
    personasHint.textContent = "";
    edadesGroup.hidden = true;
    edadesWrap.innerHTML = "";
  }

  function optAdultos(n) {
    return `<option value="${n}">${n} adulto${n > 1 ? "s" : ""}</option>`;
  }

  function optNinos(n) {
    return n === 0
      ? `<option value="0">Sin niños</option>`
      : `<option value="${n}">${n} niño${n > 1 ? "s" : ""}</option>`;
  }

  function renderGrupo(adultos, ninos) {
    const t = total();

    adultosSel.innerHTML = Array.from({ length: t }, (_, i) => optAdultos(i + 1))
      .join("");
    ninosSel.innerHTML = Array.from({ length: t }, (_, i) => optNinos(i)).join(
      "",
    );

    adultosSel.value = String(adultos);
    ninosSel.value = String(ninos);

    adultosField.hidden = false;
    ninosField.hidden = false;

    personasHint.textContent =
      t === 1
        ? `El departamento admite hasta ${MAX_PERSONAS} personas en total.`
        : `Repartí las ${t} personas entre adultos y niños: al cambiar uno se ajusta el otro. Siempre tiene que haber al menos un adulto.`;

    renderEdades();
  }

  function onTotalChange() {
    const t = total();
    if (t < 1) {
      limpiarGrupo();
      return;
    }
    renderGrupo(t, 0);
  }

  function onAdultosChange() {
    const adultos = parseInt(adultosSel.value, 10) || 1;
    renderGrupo(adultos, total() - adultos);
  }

  function onNinosChange() {
    const ninos = parseInt(ninosSel.value, 10) || 0;
    renderGrupo(total() - ninos, ninos);
  }

  function renderEdades() {
    const cantidad = parseInt(ninosSel.value, 10) || 0;
    const previas = Array.from(edadesWrap.querySelectorAll("select")).map(
      (s) => s.value,
    );
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

      if (previas[i - 1]) field.querySelector("select").value = previas[i - 1];
    }
  }

  personasSel.addEventListener("change", onTotalChange);
  adultosSel.addEventListener("change", onAdultosChange);
  ninosSel.addEventListener("change", onNinosChange);

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

  const bookingForm = document.getElementById("bookingForm");
  const bookingSubmit = bookingForm.querySelector('button[type="submit"]');

  async function createBookingRequest(consulta) {
    const respuesta = await fetch("/api/consulta", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(consulta),
    });

    const cuerpo = await respuesta.json().catch(() => ({}));

    if (!respuesta.ok) {
      const error = new Error(cuerpo.error || "No pudimos enviar tu consulta.");
      error.visible = cuerpo.error || null;
      error.codigo = cuerpo.codigo || null;
      throw error;
    }

    return cuerpo;
  }

  function leerEdades() {
    return Array.from(edadesWrap.querySelectorAll("select")).map((s) =>
      parseInt(s.value, 10),
    );
  }

  function armarConsulta() {
    const [checkIn, checkOut] = fechasInput.value.split(" a ");
    if (!checkIn || !checkOut) return "Elegí las fechas de tu estadía.";
    if (checkOut <= checkIn)
      return "La fecha de salida tiene que ser posterior a la de entrada.";

    if (keyADate(checkIn) < primerDiaElegible())
      return `Las reservas para el mismo día cierran a las ${HORA_CIERRE_TXT}. Elegí de nuevo las fechas de tu estadía.`;

    const dni = document.getElementById("dni").value.replace(/\D/g, "");
    if (dni.length < 6 || dni.length > 9)
      return "Revisá el DNI: tiene que tener entre 6 y 9 dígitos.";

    const personas = total();
    const adultos = adultosField.hidden
      ? 0
      : parseInt(adultosSel.value, 10) || 0;
    const ninos = ninosField.hidden ? 0 : parseInt(ninosSel.value, 10) || 0;
    if (personas < 1 || personas > MAX_PERSONAS)
      return `El departamento admite hasta ${MAX_PERSONAS} personas en total.`;
    if (adultos < 1) return "Tiene que viajar al menos un adulto.";
    if (adultos + ninos !== personas)
      return "Revisá el reparto: adultos y niños tienen que sumar el total de personas.";

    const edades = leerEdades();
    if (edades.length !== ninos || edades.some((e) => Number.isNaN(e)))
      return "Completá la edad de cada niño.";

    const conVehiculo = vehiculoChk.checked;
    const texto = (el) => el.value.trim() || null;

    return {
      nombre: document.getElementById("nombre").value.trim(),
      email: document.getElementById("email").value.trim().toLowerCase(),
      dni,
      telefono: document.getElementById("telefono").value.trim(),
      procedencia: texto(document.getElementById("procedencia")),
      check_in: checkIn,
      check_out: checkOut,
      personas,
      adultos,
      ninos,
      edades_ninos: edades,
      vehiculo: conVehiculo,
      vehiculo_marca: conVehiculo ? texto(vehiculoMarca) : null,
      vehiculo_modelo: conVehiculo ? texto(vehiculoModelo) : null,
      vehiculo_tipo: conVehiculo ? vehiculoTipo.value || null : null,
      vehiculo_anio: conVehiculo
        ? parseInt(vehiculoAnio.value, 10) || null
        : null,
      mensaje: texto(document.getElementById("mensaje")),
    };
  }

  bookingForm.addEventListener("submit", async (e) => {
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

    const consulta = armarConsulta();
    if (typeof consulta === "string") {
      mostrarToast(consulta, "error");
      return;
    }

    const textoBoton = bookingSubmit.textContent;
    bookingSubmit.disabled = true;
    bookingSubmit.textContent = "Enviando…";
    try {
      await createBookingRequest(consulta);
      mostrarToast(
        "¡Gracias! Recibimos tu consulta y te mandamos un mail con el detalle. Te contactamos a la brevedad por mail o WhatsApp.",
        "exito",
      );
      bookingForm.reset();
      limpiarGrupo();
      toggleVehiculo();
      resetContadores();
      fechasLabel.textContent = "Seleccionar fechas";
      fechasInput.value = "";
      formCalendar.reset();
      cargarFechasOcupadas();
    } catch (err) {
      console.error("No se pudo guardar la consulta:", err);
      mostrarToast(
        err?.visible || "No pudimos enviar tu consulta. Probá de nuevo en un momento.",
        "error",
      );
    } finally {
      bookingSubmit.disabled = false;
      bookingSubmit.textContent = textoBoton;
    }
  });

  let reviews = [];

  const REVIEW_MAX_CHARS = 180;
  const REVIEW_MAX_WORDS = 35;
  const REVIEW_NAME_MAX = 40;

  const REVIEW_MIN_CHARS = 5;
  const REVIEW_NAME_MIN = 2;

  function countWords(str) {
    const t = str.trim();
    return t ? t.split(/\s+/).length : 0;
  }

  async function fetchReviews() {
    const { data, error } = await db
      .from("reviews")
      .select("name, rating, text, created_at")
      .eq("approved", true)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) throw error;
    return data;
  }

  async function createReview(review) {
    const respuesta = await fetch("/api/resena", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        name: review.name,
        rating: review.rating,
        text: review.text,
      }),
    });

    const cuerpo = await respuesta.json().catch(() => ({}));

    if (!respuesta.ok) {
      const error = new Error(cuerpo.error || "No pudimos publicar tu reseña.");
      error.visible = cuerpo.error || null;
      throw error;
    }

    return cuerpo;
  }

  const reviewsTrack = document.getElementById("reviewsTrack");
  const reviewDots = document.getElementById("reviewDots");
  const reviewsCarousel = document.getElementById("reviewsCarousel");
  const reviewsEmpty = document.getElementById("reviewsEmpty");
  const reviewPrev = document.getElementById("reviewPrev");
  const reviewNext = document.getElementById("reviewNext");

  function perView() {
    if (window.matchMedia("(min-width: 980px)").matches) return 3;
    if (window.matchMedia("(min-width: 680px)").matches) return 2;
    return 1;
  }

  function shouldLoop() {
    return reviews.length > perView();
  }
  let isLooping = false;

  function starsMarkup(rating) {
    return Array.from(
      { length: 5 },
      (_, i) =>
        `<svg style="opacity:${i < rating ? 1 : 0.25}"><use href="#ic-star"/></svg>`,
    ).join("");
  }

  const ESC_MAP = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  function esc(str) {
    return String(str == null ? "" : str).replace(
      /[&<>"']/g,
      (c) => ESC_MAP[c],
    );
  }

  let tripledIndex = 0;
  let activeIndex = 0;
  let isAnimating = false;

  function renderReviews() {
    const N = reviews.length;

    reviewsEmpty.hidden = N > 0;
    reviewsCarousel.hidden = N === 0;
    reviewDots.hidden = N === 0;
    if (N === 0) {
      reviewsTrack.innerHTML = "";
      reviewDots.innerHTML = "";
      return;
    }

    isLooping = shouldLoop();
    const copies = isLooping ? 3 : 1;

    reviewsTrack.innerHTML = "";
    for (let copy = 0; copy < copies; copy++) {
      reviews.forEach((r) => {
        const card = document.createElement("div");
        card.className = "review-card";
        card.innerHTML = `
          <svg class="quote-mark"><use href="#ic-quote"/></svg>
          <div class="stars">${starsMarkup(r.rating)}</div>
          <p class="review-text">${esc(r.text)}</p>
          <p class="review-name">${esc(r.name)}</p>
        `;
        reviewsTrack.appendChild(card);
      });
    }

    reviewPrev.disabled = !isLooping;
    reviewNext.disabled = !isLooping;
    reviewDots.hidden = !isLooping;

    tripledIndex = isLooping ? N : 0;
    activeIndex = 0;
    renderDots();
    moveTo(tripledIndex, false);
  }

  function moveTo(index, animate) {
    isAnimating = true;
    reviewsTrack.scrollTo({
      left: index * cardWidth(),
      behavior: animate ? "smooth" : "auto",
    });
    if (!animate) {
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
    if (!isLooping) return;
    for (let i = 0; i < N; i++) {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.setAttribute("aria-label", `Ir a la reseña ${i + 1}`);
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

  function goToReal(i) {
    const N = reviews.length;
    if (!N || !isLooping) return;
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

  function step(delta) {
    const N = reviews.length;
    if (!N || !isLooping) return;
    tripledIndex += delta;
    activeIndex = ((tripledIndex % N) + N) % N;
    updateDots();
    moveTo(tripledIndex, true);
  }

  function settleLoop() {
    const N = reviews.length;
    if (!N || !isLooping) return;
    if (tripledIndex >= 2 * N || tripledIndex < N) {
      tripledIndex = (((tripledIndex % N) + N) % N) + N;
      moveTo(tripledIndex, false);
    }
  }

  let scrollEndTimer;
  function onScrollSettled() {
    const N = reviews.length;
    if (!N || !isLooping) return;
    if (!isAnimating) {
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

  let dotsRecalcTimer;
  const scheduleDotsRecalc = () => {
    clearTimeout(dotsRecalcTimer);
    dotsRecalcTimer = setTimeout(() => {
      if (!reviews.length) return;

      if (shouldLoop() !== isLooping) renderReviews();
      else moveTo(tripledIndex, false);
    }, 120);
  };
  if (window.ResizeObserver) {
    new ResizeObserver(scheduleDotsRecalc).observe(reviewsTrack);
  } else {
    window.addEventListener("resize", scheduleDotsRecalc);
  }
  window.addEventListener("load", scheduleDotsRecalc);

  reviewPrev.addEventListener("click", () => {
    step(-1);
  });
  reviewNext.addEventListener("click", () => {
    step(1);
  });

  async function loadReviews() {
    try {
      const data = await fetchReviews();
      reviews = Array.isArray(data) ? data : [];
    } catch (err) {
      console.error("No se pudieron cargar las reseñas:", err);
      reviews = [];
    }
    renderReviews();
  }

  renderReviews();
  loadReviews();

  const modalResena = document.getElementById("modalResena");
  const resenaForm = document.getElementById("resenaForm");
  const resenaSubmit = document.getElementById("resenaSubmit");
  const starPicker = document.getElementById("starPicker");
  const starButtons = [...starPicker.querySelectorAll("button")];

  document.querySelectorAll("[data-open-resena]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openModal(modalResena);
    });
  });

  let selectedStars = 0;

  function paintStars(previewValue) {
    starButtons.forEach((b) => {
      const val = parseInt(b.dataset.val, 10);
      b.classList.toggle("is-on", val <= selectedStars);
      b.classList.toggle("is-preview", previewValue > 0 && val <= previewValue);
      b.setAttribute("aria-pressed", String(val <= selectedStars));
    });
  }

  starButtons.forEach((btn) => {
    const val = parseInt(btn.dataset.val, 10);
    btn.addEventListener("mouseenter", () => paintStars(val));
    btn.addEventListener("focus", () => paintStars(val));
    btn.addEventListener("blur", () => paintStars(0));
    btn.addEventListener("click", () => {
      selectedStars = val;
      paintStars(val);
    });
  });

  starPicker.addEventListener("mouseleave", () => paintStars(0));

  function resetStars() {
    selectedStars = 0;
    paintStars(0);
  }

  const resenaComentario = document.getElementById("resenaComentario");
  const resenaPalabras = document.getElementById("resenaPalabras");
  const resenaCaracteres = document.getElementById("resenaCaracteres");
  const resenaPalabrasChip = document.getElementById("resenaPalabrasChip");
  const resenaCaracteresChip = document.getElementById("resenaCaracteresChip");

  function updateContador() {
    const palabras = countWords(resenaComentario.value);
    resenaPalabras.textContent = palabras;
    resenaCaracteres.textContent = resenaComentario.value.length;
    pintarChip(resenaPalabrasChip, palabras, REVIEW_MAX_WORDS);
    pintarChip(
      resenaCaracteresChip,
      resenaComentario.value.length,
      REVIEW_MAX_CHARS,
    );
  }

  resenaComentario.addEventListener("input", () => {
    if (resenaComentario.value.length > REVIEW_MAX_CHARS) {
      resenaComentario.value = resenaComentario.value.slice(
        0,
        REVIEW_MAX_CHARS,
      );
    }
    const palabras = resenaComentario.value.trim()
      ? resenaComentario.value.trim().split(/\s+/)
      : [];
    if (palabras.length > REVIEW_MAX_WORDS) {
      resenaComentario.value = palabras.slice(0, REVIEW_MAX_WORDS).join(" ");
    }
    updateContador();
  });
  updateContador();

  resenaForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nombre = document.getElementById("resenaNombre").value.trim();
    const comentario = document.getElementById("resenaComentario").value.trim();

    if (!nombre || !comentario) return;
    if (!selectedStars) {
      mostrarToast("Elegí una puntuación de 1 a 5 estrellas.", "error");
      return;
    }
    if (nombre.length < REVIEW_NAME_MIN) {
      mostrarToast(
        `Escribí tu nombre completo: necesita al menos ${REVIEW_NAME_MIN} caracteres.`,
        "error",
      );
      return;
    }
    if (comentario.length < REVIEW_MIN_CHARS) {
      mostrarToast(
        `Contanos un poco más: el comentario necesita al menos ${REVIEW_MIN_CHARS} caracteres.`,
        "error",
      );
      return;
    }
    if (nombre.length > REVIEW_NAME_MAX) {
      mostrarToast(
        `El nombre no puede superar los ${REVIEW_NAME_MAX} caracteres.`,
        "error",
      );
      return;
    }
    if (comentario.length > REVIEW_MAX_CHARS) {
      mostrarToast(
        `El comentario no puede superar los ${REVIEW_MAX_CHARS} caracteres.`,
        "error",
      );
      return;
    }
    if (countWords(comentario) > REVIEW_MAX_WORDS) {
      mostrarToast(
        `El comentario no puede superar las ${REVIEW_MAX_WORDS} palabras.`,
        "error",
      );
      return;
    }

    resenaSubmit.disabled = true;
    try {
      await createReview({
        name: nombre,
        rating: selectedStars,
        text: comentario,
      });

      resenaForm.reset();
      resetStars();
      updateContador();
      mostrarToast(
        "¡Gracias! Tu reseña quedó pendiente de aprobación y se publica apenas la revisemos.",
        "exito",
      );
      closeModal(modalResena);
    } catch (err) {
      console.error("No se pudo publicar la reseña:", err);

      mostrarToast(
        err?.visible || "No pudimos publicar tu reseña. Probá de nuevo en un momento.",
        "error",
      );
    } finally {
      resenaSubmit.disabled = false;
    }
  });

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

  const mapContainer = document.getElementById("map");
  const mapFrame = document.querySelector(".map-frame");
  const mapOverlay = document.getElementById("mapOverlay");
  const mapOverlayText = document.getElementById("mapOverlayText");

  if (mapContainer && mapFrame && mapOverlay && typeof L !== "undefined") {
    const DEPTO_COORDS = [-36.68960161007483, -56.6791927028098];
    const DIRECCION_HTML =
      "<b>Dirección:</b> Calle San Juan 2530,<br>entre las calles Santa María de Oro y Andrade,<br>San Bernardo del Tuyú, Buenos Aires";
    const HINT_DESKTOP =
      "Usá <kbd>Ctrl</kbd> + <kbd>Scroll</kbd> para hacer zoom";
    const HINT_TOUCH = "Usá dos dedos para mover y hacer zoom en el mapa";

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

    mapContainer.addEventListener("mouseenter", () => {
      if (!isDesktop()) return;
      showOverlay(HINT_DESKTOP);
    });

    mapContainer.addEventListener("mouseleave", () => {
      if (!isDesktop()) return;
      hideOverlay();
    });

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

    map.on("zoomstart dragstart", hideOverlay);

    function handleTouch(e) {
      if (isDesktop()) return;

      if (e.touches.length >= 2) {
        map.dragging.enable();
        hideOverlay();
        return;
      }

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

    const onPointerChange = () => {
      if (isDesktop()) map.dragging.enable();
      else map.dragging.disable();
      hideOverlay();
    };
    if (typeof finePointer.addEventListener === "function") {
      finePointer.addEventListener("change", onPointerChange);
    }

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

  const REFRESCO_MS = 90_000;
  const REFRESCO_MAX_MS = 10 * 60_000;

  const refresco = { timer: null, espera: REFRESCO_MS, corriendo: false };

  function hayModalAbierto() {
    return Array.from(document.querySelectorAll(".modal-overlay")).some((m) => !m.hidden);
  }

  function huellaDeResenas(lista) {
    return (lista || []).map((r) => `${r.created_at}|${r.rating}|${r.name}`).join("~");
  }

  async function refrescarResenas() {
    const frescas = await fetchReviews();
    if (huellaDeResenas(frescas) === huellaDeResenas(reviews)) return;

    reviews = Array.isArray(frescas) ? frescas : [];
    renderReviews();
  }

  async function refrescarDatos() {
    if (refresco.corriendo || document.hidden) return true;

    refresco.corriendo = true;
    try {
      await Promise.all([
        hayModalAbierto() ? Promise.resolve() : cargarFechasOcupadas(),
        refrescarResenas(),
      ]);
      return true;
    } catch (err) {
      console.warn("[refresco] no se pudo actualizar:", err?.message || err);
      return false;
    } finally {
      refresco.corriendo = false;
    }
  }

  async function ciclarRefresco() {
    const ok = await refrescarDatos();
    refresco.espera = ok ? REFRESCO_MS : Math.min(refresco.espera * 2, REFRESCO_MAX_MS);
    refresco.timer = setTimeout(ciclarRefresco, refresco.espera);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    refrescarDatos();
  });

  refresco.timer = setTimeout(ciclarRefresco, REFRESCO_MS);
})();
