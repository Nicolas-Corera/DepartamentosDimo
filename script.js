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

  /* ==========================================================
     CALENDARIO: HASTA CUÁNDO SE PUEDE RESERVAR PARA HOY

     El mismo día se puede reservar hasta las 09:00; pasada esa hora el
     día de hoy queda bloqueado y la estadía tiene que arrancar mañana.

     La hora se mide SIEMPRE en la zona del departamento, no en la del
     visitante: si alguien consulta desde España, lo que manda es qué
     hora es en San Bernardo, no en su reloj.
  =========================================================== */
  const TZ_DESTINO = "America/Argentina/Buenos_Aires";
  const HORA_CIERRE = 9;
  // Para los textos, siempre con dos digitos: 9 -> "09:00".
  const HORA_CIERRE_TXT = String(HORA_CIERRE).padStart(2, "0") + ":00";

  const FMT_DESTINO = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_DESTINO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23", // sin esto, medianoche puede venir como "24"
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

  /* "2026-01-10" -> Date del 10/01/2026 a medianoche LOCAL.
     Con `new Date("2026-01-10")` sería medianoche UTC, o sea el día
     anterior a las 21:00 hora argentina, y las comparaciones se corren
     un día. */
  function keyADate(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  /* Primer día que se puede elegir: hoy si todavía no son las 09:00 en
     el destino, mañana si ya pasaron. Se recalcula en cada render, así
     que una página abierta desde temprano se corrige sola. */
  function primerDiaElegible() {
    const { anio, mes, dia, hora } = ahoraEnDestino();
    const base = new Date(anio, mes, dia);
    if (hora >= HORA_CIERRE) base.setDate(base.getDate() + 1);
    return base;
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

      const hoy = ahoraEnDestino();
      const minimo = primerDiaElegible();
      const hoyCerrado = hoy.hora >= HORA_CIERRE;

      /* Si la página quedó abierta y en el medio cruzó las 09:00 (o
         cambió el día), lo que ya estaba elegido puede haber quedado
         fuera de rango. Se limpia acá para que nunca se pueda confirmar
         una fecha que el calendario ya no deja tocar. */
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

        // El día de hoy pasada la hora de cierre queda igual que un día ya
        // pasado: mismo apagado, sin marca propia. Lo que explica por qué
        // está cerrado es la nota de abajo de la grilla.
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
            } else {
              if (keyADate(key) < keyADate(rangeStart)) {
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

      /* La aclaración del horario solo tiene sentido mirando el mes en
         curso: en marzo del año que viene no aporta nada. */
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
    return {
      getRange: () => ({ start: rangeStart, end: rangeEnd }),
      reset: () => {
        rangeStart = null;
        rangeEnd = null;
        render();
      },
      // Repinta con la hora de AHORA. Se llama al abrir cada modal para
      // que el corte de las 09:00 valga aunque la página lleve horas abierta.
      refresh: render,
    };
  }

  // Calendario del modal "Ver disponibilidad"
  const dispoCalendar = createCalendar(
    document.getElementById("calDisponibilidad"),
  );

  // Calendario del formulario
  const fechasInput = document.getElementById("fechasInput");
  const fechasLabel = document.getElementById("fechasLabel");
  const formCalendar = createCalendar(document.getElementById("calFormulario"));

  function fmtDisplay(key) {
    const [y, m, d] = key.split("-");
    return `${d}/${m}/${y}`;
  }

  document.getElementById("btnDisponibilidad").addEventListener("click", () => {
    dispoCalendar.refresh();
    openModal(document.getElementById("modalDisponibilidad"));
  });

  document.getElementById("fechasBtn").addEventListener("click", () => {
    // Repintar con la hora de ahora puede invalidar lo que ya estaba
    // elegido (cruzaron las 09:00 con la página abierta). Si pasa, el
    // formulario también tiene que dejar de mostrar esas fechas.
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
    // Falta una de las dos fechas: el modal se queda abierto y el aviso va
    // por toast. Antes se escribía en la etiqueta del botón que abre este
    // mismo modal, o sea que quedaba tapada detrás del overlay y el
    // visitante veía que "Confirmar fechas" no hacía nada.
    mostrarToast(
      start
        ? "Elegí también la fecha de salida."
        : "Elegí la fecha de entrada y la de salida.",
      "error",
    );
  });

  /* ==========================================================
     FORMULARIO: PERSONAS / ADULTOS / NIÑOS / EDADES

     Primero se elige el TOTAL de personas (1 a 4, el tope del depto).
     Recién ahí aparecen los dos selects que reparten ese total entre
     adultos y niños. Los dos están siempre atados: si cambiás uno, el
     otro se recalcula para que la suma dé exactamente el total, así que
     nunca puede quedar un grupo inconsistente.

     Regla que no se negocia: al menos un adulto. Por eso el select de
     niños llega hasta total - 1 y el de adultos arranca en 1.
  =========================================================== */
  const personasSel = document.getElementById("personas");
  const personasHint = document.getElementById("personasHint");
  const adultosField = document.getElementById("adultosField");
  const adultosSel = document.getElementById("adultos");
  const ninosField = document.getElementById("ninosField");
  const ninosSel = document.getElementById("ninos");
  const edadesGroup = document.getElementById("edadesGroup");
  const edadesWrap = document.getElementById("edadesWrap");

  /* Tope duro del departamento: adultos + niños nunca puede superarlo. */
  const MAX_PERSONAS = 4;
  const EDAD_MAX_NINO = 17;

  function total() {
    return parseInt(personasSel.value, 10) || 0;
  }

  /* Mientras no haya un total elegido no se muestra nada del reparto. */
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

  /* Repinta los dos selects para un total dado y deja marcada la
     combinación adultos/niños que se le pase. */
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

  /* Al elegir el total se arranca con todos adultos: es la opción más
     común y evita que el visitante tenga que tocar los dos selects. */
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

  /* Un select de edad (0 a 17) por cada niño declarado. */
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
      // Si ya había una edad cargada para ese niño se conserva: cambiar de
      // 2 a 3 niños no tiene por qué borrar lo que el visitante ya eligió.
      if (previas[i - 1]) field.querySelector("select").value = previas[i - 1];
    }
  }

  personasSel.addEventListener("change", onTotalChange);
  adultosSel.addEventListener("change", onAdultosChange);
  ninosSel.addEventListener("change", onNinosChange);

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

     Todo el acoplamiento con Supabase vive en createBookingRequest():
     una sola fila en public.booking_requests con TODOS los campos del
     formulario. Esa tabla es de solo-alta desde el sitio — guarda DNI,
     mail y teléfono, así que no tiene policy de SELECT y se lee desde el
     panel de Supabase. Ver SUPABASE.md.
  =========================================================== */
  const bookingForm = document.getElementById("bookingForm");
  const bookingSubmit = bookingForm.querySelector('button[type="submit"]');

  async function createBookingRequest(consulta) {
    const { error } = await db.from("booking_requests").insert(consulta);
    if (error) throw error;
  }

  /* Los <select> de edad se crean dinámicamente, así que las edades se leen
     del DOM recién al enviar. La posición i del array es el "Niño i + 1". */
  function leerEdades() {
    return Array.from(edadesWrap.querySelectorAll("select")).map((s) =>
      parseInt(s.value, 10),
    );
  }

  /* Devuelve el objeto listo para insertar, o un string con el motivo por el
     que no se puede armar (que es justo el texto que ve el visitante).
     Las validaciones de acá son las mismas que los check de la tabla: si
     tocás una, tocá la otra. */
  function armarConsulta() {
    const [checkIn, checkOut] = fechasInput.value.split(" a ");
    if (!checkIn || !checkOut) return "Elegí las fechas de tu estadía.";
    if (checkOut <= checkIn)
      return "La fecha de salida tiene que ser posterior a la de entrada.";
    // Misma regla que el calendario: después de las 09:00 el día de hoy ya
    // no se puede reservar. Acá se vuelve a chequear por si la página
    // quedó abierta desde antes de esa hora.
    if (keyADate(checkIn) < primerDiaElegible())
      return `Las reservas para el mismo día cierran a las ${HORA_CIERRE_TXT}. Elegí de nuevo las fechas de tu estadía.`;

    // El campo de DNI es de texto libre: se guarda solo con dígitos para que
    // "12.345.678" y "12345678" no entren como dos consultas distintas.
    const dni = document.getElementById("dni").value.replace(/\D/g, "");
    if (dni.length < 6 || dni.length > 9)
      return "Revisá el DNI: tiene que tener entre 6 y 9 dígitos.";

    // personas es el TOTAL declarado; adultos + ninos tiene que dar justo eso.
    // El front los mantiene atados, así que esto es la red de seguridad.
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
        "¡Gracias! Recibimos tu consulta, te vamos a contactar a la brevedad.",
        "exito",
      );
      bookingForm.reset();
      limpiarGrupo();
      toggleVehiculo();
      resetContadores();
      fechasLabel.textContent = "Seleccionar fechas";
      fechasInput.value = "";
      formCalendar.reset();
    } catch (err) {
      console.error("No se pudo guardar la consulta:", err);
      // 23505 = unique_violation: lo tira booking_requests_dedupe_idx cuando
      // ya hay una consulta con el mismo DNI y las mismas fechas.
      // 42501 = la política RLS rechazó la fila. Con los datos ya validados
      // en el front, el caso realista es la fecha: cruzaron las 09:00 entre
      // que eligió las fechas y que apretó enviar.
      const rlsFecha = err?.code === "42501";
      const aviso = rlsFecha
        ? `Las reservas para el mismo día cierran a las ${HORA_CIERRE_TXT}. Volvé a elegir las fechas de tu estadía.`
        : err?.code === "23505"
          ? "Ya recibimos una consulta con ese DNI para esas fechas. Si necesitás cambiar algo, escribinos por WhatsApp."
          : "No pudimos enviar tu consulta. Probá de nuevo en un momento.";
      mostrarToast(aviso, "error");
    } finally {
      bookingSubmit.disabled = false;
      bookingSubmit.textContent = textoBoton;
    }
  });

  /* ==========================================================
     RESEÑAS: ORIGEN DE DATOS

     Las reseñas ya NO están hardcodeadas: la lista arranca vacía y se
     llena con lo que devuelva la capa de datos (Supabase).

     Todo el acoplamiento con el backend vive en estas dos funciones.
     Ver SUPABASE.md para el paso a paso de la implementación.
  =========================================================== */

  // Lista en memoria que consume el carrusel. Cada item: { name, rating, text }
  let reviews = [];

  // Límites del comentario. Existen para que TODAS las tarjetas entren en
  // el mismo cuadrado sin que el texto se corte: si cambiás estos números,
  // ajustá también el -webkit-line-clamp de .review-text en style.css.
  const REVIEW_MAX_CHARS = 180; // también está como maxlength en el HTML
  const REVIEW_MAX_WORDS = 35;
  const REVIEW_NAME_MAX = 40;

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
    const { error } = await db.from("reviews").insert({
      name: review.name,
      rating: review.rating,
      text: review.text,
    });

    if (error) throw error;
    return review;
  }

  /* ==========================================================
     RESEÑAS: CARRUSEL
  =========================================================== */
  const reviewsTrack = document.getElementById("reviewsTrack");
  const reviewDots = document.getElementById("reviewDots");
  const reviewsCarousel = document.getElementById("reviewsCarousel");
  const reviewsEmpty = document.getElementById("reviewsEmpty");
  const reviewPrev = document.getElementById("reviewPrev");
  const reviewNext = document.getElementById("reviewNext");

  // Cuántas tarjetas entran a la vez. Tiene que coincidir con los
  // breakpoints de .review-card en style.css.
  function perView() {
    if (window.matchMedia("(min-width: 980px)").matches) return 3;
    if (window.matchMedia("(min-width: 680px)").matches) return 2;
    return 1;
  }

  // El loop infinito se arma triplicando la lista (clon-anterior + real +
  // clon-siguiente). Eso solo tiene sentido si hay MÁS reseñas que las que
  // entran en pantalla: con 1 sola reseña, las tres copias se veían todas
  // juntas y parecía que la reseña se había guardado tres veces.
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

  // Escapa el texto que viene del backend / del formulario antes de
  // inyectarlo con innerHTML.
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

    // Sin reseñas: mostramos el estado vacío y escondemos el carrusel entero.
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

    // Sin loop, todas las reseñas entran en pantalla: flechas y dots no
    // tienen nada que hacer. Las flechas se deshabilitan y el CSS las
    // saca del layout (display:none), así el track aprovecha todo el ancho
    // mientras no hagan falta.
    reviewPrev.disabled = !isLooping;
    reviewNext.disabled = !isLooping;
    reviewDots.hidden = !isLooping;

    tripledIndex = isLooping ? N : 0; // con loop arrancamos en la copia del medio
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

  // Lleva el carrusel a un índice real (0..N-1), eligiendo la copia
  // (anterior, real o siguiente) más cercana a la posición actual para
  // que el desplazamiento sea siempre corto.
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

  // Da un paso (+1 / -1) dentro de la lista triplicada. tripledIndex se
  // actualiza acá mismo, al instante del clic, en lugar de esperar a que
  // el evento "scroll" lo "adivine" más tarde. Así los clics rápidos se
  // van acumulando correctamente en vez de pisarse entre sí.
  function step(delta) {
    const N = reviews.length;
    if (!N || !isLooping) return;
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
    if (!N || !isLooping) return;
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
    const N = reviews.length;
    if (!N || !isLooping) return;
    if (!isAnimating) {
      // El usuario arrastró el carrusel manualmente (touch/trackpad):
      // ahí sí leemos la posición real y la adoptamos como fuente de verdad.
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
      if (!reviews.length) return;
      // Si el breakpoint cambió cuántas tarjetas entran, puede que ahora
      // sobren (o falten) copias: hay que rearmar el track.
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

  // Carga inicial. Si el backend falla, dejamos el estado vacío en pantalla
  // en vez de romper la sección.
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

  renderReviews(); // pinta el estado vacío de entrada
  loadReviews();

  /* ==========================================================
     MODAL DEJAR RESEÑA
  =========================================================== */
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

  /* ---- Selector de estrellas ----
     El problema anterior era que el encendido dependía de `:hover` en CSS,
     que solo alcanza al botón que está bajo el mouse: se prendía una sola
     estrella, sin progresión. Ahora el pintado lo maneja siempre el JS,
     marcando TODAS las estrellas hasta el valor correspondiente:
       - `is-on`      => valor confirmado con el clic
       - `is-preview` => valor que se está apuntando con el mouse/teclado
     Al salir del selector, el preview se descarta y vuelve a verse la
     selección confirmada. */
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
  // Un único listener en el contenedor: se dispara al salir de todo el
  // grupo, no al pasar de una estrella a la de al lado.
  starPicker.addEventListener("mouseleave", () => paintStars(0));

  function resetStars() {
    selectedStars = 0;
    paintStars(0);
  }

  /* ---- Contador de caracteres y palabras ----
     Mismo comportamiento que el textarea del formulario de contacto: el
     texto se recorta al llegar al tope, así que la reseña nunca puede
     exceder el largo que entra en la tarjeta. Los chips avisan en amarillo
     al acercarse y en rojo al tocar el límite. */
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
      // Con publicación automática la reseña ya está visible en la base, así
      // que se recarga la lista desde Supabase en vez de re-pintar la copia
      // en memoria (que no la tiene y dejaba el carrusel igual que antes).
      await loadReviews();
      resenaForm.reset();
      resetStars();
      updateContador();
      mostrarToast("¡Gracias por dejar tu reseña!", "exito");
      closeModal(modalResena);
    } catch (err) {
      console.error("No se pudo publicar la reseña:", err);
      // 23505 = unique_violation: lo tira el índice reviews_dedupe_idx cuando
      // ya existe una reseña con el mismo nombre y el mismo comentario.
      mostrarToast(
        err?.code === "23505"
          ? "Ya hay una reseña publicada con ese nombre y ese mismo comentario."
          : "No pudimos publicar tu reseña. Probá de nuevo en un momento.",
        "error",
      );
    } finally {
      resenaSubmit.disabled = false;
    }
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
