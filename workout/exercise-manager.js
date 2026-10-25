/*
 * The "Exercises" tab of the coach builder (2026-10-22, Max: "a separate
 * section to my workout builder where it's just for making exercises and
 * selecting what muscle groups they are").
 *
 * What it does:
 *  - Make an exercise: a name, a Movement and Body Part (the same lists the
 *    exercise picker uses), and which muscles it works: tap a muscle once for
 *    "main" (red), twice for "helps" (pink), a third time to clear, on the
 *    list or on the body figure. Saving uses the backend's existing
 *    `addExercise` action (no PIN, the same one the picker's "+ Add as a new
 *    exercise" calls), so nothing needs redeploying.
 *  - The library: every exercise in the Exercises tab, searchable, with a
 *    "Needs muscles" filter. Tapping one that has no muscles opens it for
 *    filling in (the backend fills blanks only); tapping one that has them
 *    shows them on the figure, read-only. The backend never changes muscles an
 *    exercise already has, so editing those is still done in the sheet.
 *
 * After a save it forgets the cached Exercises tab and fires
 * "maxfit:exercises-changed", which builder.js and exercise-picker.js listen
 * for, so the Workouts tab's picker sees the new exercise straight away.
 *
 * Needs, already loaded: card/sheet.js, card/muscle-map.js, builder.js (for
 * APPS_SCRIPT_URL) and exercise-picker.js.
 */
(function () {
  "use strict";

  const tabWorkouts = document.getElementById("tabWorkouts");
  const tabExercises = document.getElementById("tabExercises");
  const panelWorkouts = document.getElementById("panelWorkouts");
  const panel = document.getElementById("panelExercises");
  if (!tabWorkouts || !tabExercises || !panelWorkouts || !panel) return;

  const headerTag = document.querySelector(".card__top .card__tag");

  const MOVEMENTS = ExercisePicker.MOVEMENTS;
  const PARTS = ExercisePicker.BODY_PARTS_BY_MOVEMENT;
  const colorFor = ExercisePicker.colorFor;

  // "delts-front" -> "Front Delts": the labels the muscle list offers, falling
  // back to the map's own label for any other key an exercise carries.
  const CHOOSER_LABEL = {};
  MUSCLE_CHOOSER_.forEach((s) => s.muscles.forEach(([key, label]) => (CHOOSER_LABEL[key] = label)));
  const labelFor = (key) => CHOOSER_LABEL[key] || muscleLabel_(key);

  const INTRO_NEW = "Make a new exercise and choose which muscles it works. It shows up in the exercise picker for every workout straight away.";

  const state = {
    mode: "new", // "new": making one; "fill": adding muscles to one that has none; "view": looking at one that has them
    name: "",
    movement: "",
    bodyPart: "",
    muscles: {}, // key -> "main" | "helps"
    library: null, // [{ key, name, movement, bodyPart, primary, secondary }] once loaded
    filter: "all",
    query: "",
    current: null, // the library exercise being viewed or filled in
    saving: false,
  };

  // Exercises saved this visit, merged into the library if its first load was
  // still in flight when they were saved.
  const savedThisVisit = [];

  function esc(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
  }

  const hasMuscles = (ex) => ex.primary.length > 0 || ex.secondary.length > 0;
  const keysWith = (v) => Object.keys(state.muscles).filter((k) => state.muscles[k] === v);
  const validMovement = (m) => MOVEMENTS.indexOf(m) >= 0;
  const validPart = (m, p) => (PARTS[m] || []).indexOf(p) >= 0;

  function joinList(items) {
    if (items.length <= 1) return items.join("");
    return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
  }

  // ---------------------------------------------------------------------
  // The panel's markup (built here, like builder.js builds its note field,
  // so this script never depends on markup an older cached page lacks)
  // ---------------------------------------------------------------------

  const muscleSectionsHtml = MUSCLE_CHOOSER_.map(
    (s) =>
      `<p class="exercise-picker__muscle-section">${esc(s.section)}</p>` +
      `<div class="exercise-picker__muscle-chips">${s.muscles
        .map(([key, label]) => `<button class="exercise-picker__muscle-chip" type="button" data-key="${esc(key)}">${esc(label)}</button>`)
        .join("")}</div>`
  ).join("");

  const legendHtml =
    '<p class="exercise-picker__muscle-legend"><span class="exercise-picker__muscle-key exercise-picker__muscle-key--main"></span>Main<span class="exercise-picker__muscle-key exercise-picker__muscle-key--helps"></span>Helps</p>';

  panel.innerHTML =
    '<div class="exm__layout">' +
    '<div class="exm__main">' +
    `<p class="exm__intro" id="exmIntro">${INTRO_NEW}</p>` +
    '<div class="exm__form" id="exmFormBox">' +
    '<div class="builder__field">' +
    '<label class="card__label" for="exmName">Exercise name</label>' +
    '<input class="picker__input" id="exmName" type="text" maxlength="120" placeholder="e.g. Incline Dumbbell Press" autocomplete="off" />' +
    '<p class="exm__hint exm__hint--note" id="exmNameHint" hidden></p>' +
    "</div>" +
    '<div class="builder__field"><span class="card__label">Movement</span><div class="exm__chips" id="exmMovements" role="group" aria-label="Movement"></div></div>' +
    '<div class="builder__field"><span class="card__label">Body part</span><div class="exm__chips" id="exmBodyParts" role="group" aria-label="Body part"></div></div>' +
    '<div class="builder__field">' +
    '<span class="card__label">Which muscles does it work?</span>' +
    '<p class="exm__hint">Tap a muscle once if it is the main one, twice if it only helps, a third time to clear. You can tap the body too.</p>' +
    `<div class="exm__muscles">${muscleSectionsHtml}</div>` +
    "</div>" +
    '<div class="exm__actions">' +
    '<button class="builder__save exm__save" id="exmSave" type="button" disabled>Save exercise</button>' +
    '<button class="exm__clear" id="exmClear" type="button">Clear</button>' +
    "</div>" +
    '<p class="exm__needs" id="exmNeeds"></p>' +
    '<p class="picker__error" id="exmError" role="alert" hidden></p>' +
    '<p class="builder__success" id="exmSuccess" role="status" hidden></p>' +
    "</div>" +
    '<div class="exm__view" id="exmViewBox" hidden>' +
    '<h3 class="exm__view-name" id="exmViewName"></h3>' +
    '<div class="exm__view-cat" id="exmViewCat"></div>' +
    '<p class="exm__view-note">This exercise already has its muscles. To change them, edit its row in the Exercises tab of the CRM sheet.</p>' +
    '<button class="exm__clear" id="exmNew" type="button">Make a new exercise</button>' +
    "</div>" +
    "</div>" +
    '<aside class="exm__side" aria-label="Muscles it works">' +
    '<div class="exm__side-head"><span class="card__label">Muscles it works</span><span class="exm__side-sub" id="exmSideSub"></span></div>' +
    `<div class="exm__figs" id="exmFigs"><div class="exm__fig-col">${muscleFigureSvg("front", "exmFrontTitle")}<span class="exm__fig-caption">Front</span></div><div class="exm__fig-col">${muscleFigureSvg("back", "exmBackTitle")}<span class="exm__fig-caption">Back</span></div></div>` +
    legendHtml +
    '<p class="exm__summary" id="exmSummary"></p>' +
    "</aside>" +
    "</div>" +
    '<section class="exm__library" aria-labelledby="exmLibTitle">' +
    '<div class="exm__library-head"><span class="card__label" id="exmLibTitle">Exercise library</span><span class="exm__library-count" id="exmLibCount"></span></div>' +
    '<input class="picker__input" id="exmSearch" type="search" placeholder="Search exercises…" autocomplete="off" aria-label="Search exercises" />' +
    '<div class="exm__filters" id="exmFilters" role="group" aria-label="Filter exercises"></div>' +
    '<div class="exm__list" id="exmList"></div>' +
    "</section>";

  const $ = (id) => document.getElementById(id);
  const els = {
    intro: $("exmIntro"),
    formBox: $("exmFormBox"),
    viewBox: $("exmViewBox"),
    viewName: $("exmViewName"),
    viewCat: $("exmViewCat"),
    name: $("exmName"),
    nameHint: $("exmNameHint"),
    movements: $("exmMovements"),
    bodyParts: $("exmBodyParts"),
    save: $("exmSave"),
    clear: $("exmClear"),
    needs: $("exmNeeds"),
    error: $("exmError"),
    success: $("exmSuccess"),
    figs: $("exmFigs"),
    summary: $("exmSummary"),
    sideSub: $("exmSideSub"),
    libCount: $("exmLibCount"),
    search: $("exmSearch"),
    filters: $("exmFilters"),
    list: $("exmList"),
  };

  // ---------------------------------------------------------------------
  // Tabs: Workouts | Exercises
  // ---------------------------------------------------------------------

  function showTab(which, opts) {
    const exercises = which === "exercises";
    panelWorkouts.hidden = exercises;
    panel.hidden = !exercises;
    tabWorkouts.setAttribute("aria-selected", String(!exercises));
    tabExercises.setAttribute("aria-selected", String(exercises));
    tabWorkouts.tabIndex = exercises ? -1 : 0;
    tabExercises.tabIndex = exercises ? 0 : -1;
    if (headerTag) headerTag.textContent = exercises ? "Exercises" : "Build Workout";
    document.title = exercises ? "MaxFit — Exercises" : "MaxFit — Build Workout";
    if (!opts || !opts.keepHash) {
      try {
        history.replaceState(null, "", exercises ? "#exercises" : location.pathname + location.search);
      } catch (err) {
        // A browser that won't rewrite the address just keeps the old one.
      }
    }
    if (exercises) ensureLibrary();
  }

  tabWorkouts.addEventListener("click", () => showTab("workouts"));
  tabExercises.addEventListener("click", () => showTab("exercises"));
  [tabWorkouts, tabExercises].forEach((tab) =>
    tab.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const next = tab === tabWorkouts ? tabExercises : tabWorkouts;
      next.focus();
      showTab(next === tabExercises ? "exercises" : "workouts");
    })
  );
  window.addEventListener("hashchange", () => showTab(location.hash === "#exercises" ? "exercises" : "workouts", { keepHash: true }));

  // ---------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------

  function clearMessages() {
    els.error.hidden = true;
    els.success.hidden = true;
  }

  function showError(message) {
    els.error.textContent = message;
    els.error.hidden = false;
    els.success.hidden = true;
  }

  function showSuccess(message) {
    els.success.textContent = message;
    els.success.hidden = false;
    els.error.hidden = true;
  }

  // ---------------------------------------------------------------------
  // The library (the Exercises tab, read the same way the picker reads it)
  // ---------------------------------------------------------------------

  function parseLibrary(rows, col) {
    if (col.name < 0) return [];
    const cell = (r, i) => (i >= 0 ? String(r[i] || "").trim() : "");
    return rows
      .map((r) => ({
        name: cell(r, col.name),
        movement: cell(r, col.movement),
        bodyPart: cell(r, col.bodyPart),
        primary: parseMuscleKeys(cell(r, col.primaryMuscles)),
        secondary: parseMuscleKeys(cell(r, col.secondaryMuscles)),
      }))
      .filter((e) => e.name)
      .map((e) => Object.assign(e, { key: e.name.toLowerCase() }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function findInLibrary(name) {
    const key = String(name || "").trim().toLowerCase();
    return key && state.library ? state.library.find((e) => e.key === key) : null;
  }

  let libraryLoading = false;

  function ensureLibrary() {
    if (state.library || libraryLoading) return;
    libraryLoading = true;
    els.list.innerHTML = '<p class="exm__empty">Loading the exercise library…</p>';
    fetchExercises().then(
      ({ rows, col }) => {
        const lib = parseLibrary(rows, col);
        savedThisVisit.forEach((saved) => {
          if (!lib.some((e) => e.key === saved.key)) lib.push(saved);
        });
        lib.sort((a, b) => a.name.localeCompare(b.name));
        state.library = lib;
        libraryLoading = false;
        renderLibrary();
        updateNameHint();
        update();
      },
      () => {
        libraryLoading = false;
        if (typeof resetExercisesCache === "function") resetExercisesCache();
        els.list.innerHTML = '<p class="exm__empty">Couldn\'t load the exercise library. <button class="exm__chip" type="button" id="exmRetry">Try again</button></p>';
        const retry = $("exmRetry");
        if (retry) retry.addEventListener("click", ensureLibrary);
      }
    );
  }

  function filteredLibrary() {
    const q = state.query.trim().toLowerCase();
    return (state.library || []).filter((e) => {
      if (state.filter === "needs") {
        if (hasMuscles(e)) return false;
      } else if (state.filter !== "all" && e.movement !== state.filter) {
        return false;
      }
      return !q || e.key.indexOf(q) >= 0;
    });
  }

  function renderLibrary() {
    const lib = state.library || [];
    const needs = lib.filter((e) => !hasMuscles(e)).length;
    els.libCount.textContent = state.library ? `${lib.length} exercises${needs ? `, ${needs} without muscles` : ""}` : "";

    const filters = [["all", "All"]].concat(MOVEMENTS.map((m) => [m, m]), [["needs", needs ? `Needs muscles (${needs})` : "Needs muscles"]]);
    els.filters.innerHTML = filters
      .map(([id, label]) => `<button class="exm__chip" type="button" data-filter="${esc(id)}" aria-pressed="${state.filter === id}">${esc(label)}</button>`)
      .join("");

    if (!state.library) return;
    const list = filteredLibrary();
    els.list.innerHTML = list.length
      ? list
          .map((e) => {
            const sub = [e.movement, e.bodyPart].filter(Boolean).join(" · ") || "No category";
            const current = state.current && state.current.key === e.key;
            return (
              `<button class="exm__item" type="button" data-key="${esc(e.key)}"${current ? ' aria-current="true"' : ""}>` +
              `<span class="exm__item-dot" style="background:${colorFor(e.bodyPart)}"></span>` +
              `<span class="exm__item-main"><span class="exm__item-name">${esc(e.name)}</span><span class="exm__item-sub">${esc(sub)}</span></span>` +
              (hasMuscles(e) ? "" : '<span class="exm__item-tag">No muscles yet</span>') +
              "</button>"
            );
          })
          .join("")
      : '<p class="exm__empty">Nothing matches. Try a different search or filter.</p>';
  }

  els.filters.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (!btn) return;
    state.filter = btn.dataset.filter;
    renderLibrary();
  });

  els.search.addEventListener("input", () => {
    state.query = els.search.value;
    renderLibrary();
  });

  els.list.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-key]");
    if (btn) selectExercise(btn.dataset.key);
  });

  // ---------------------------------------------------------------------
  // The form
  // ---------------------------------------------------------------------

  function renderMovements() {
    const locked = state.mode === "fill" && state.current && validMovement(state.current.movement);
    els.movements.innerHTML = MOVEMENTS.map(
      (m) => `<button class="exm__chip" type="button" data-movement="${esc(m)}" aria-pressed="${state.movement === m}"${locked ? " disabled" : ""}>${esc(m)}</button>`
    ).join("");
  }

  function renderBodyParts() {
    const parts = PARTS[state.movement] || [];
    if (!parts.length) {
      els.bodyParts.innerHTML = '<span class="exm__pick-first">Choose a movement first.</span>';
      return;
    }
    const locked = state.mode === "fill" && state.current && validPart(state.current.movement, state.current.bodyPart);
    els.bodyParts.innerHTML = parts
      .map(
        (p) =>
          `<button class="exm__chip" type="button" data-part="${esc(p)}" aria-pressed="${state.bodyPart === p}"${locked ? " disabled" : ""}>` +
          `<span class="exm__chip-dot" style="background:${colorFor(p)}"></span>${esc(p)}</button>`
      )
      .join("");
  }

  els.movements.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-movement]");
    if (!btn || btn.disabled) return;
    state.movement = btn.dataset.movement;
    if (!validPart(state.movement, state.bodyPart)) state.bodyPart = "";
    clearMessages();
    renderMovements();
    renderBodyParts();
    update();
  });

  els.bodyParts.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-part]");
    if (!btn || btn.disabled) return;
    state.bodyPart = btn.dataset.part;
    clearMessages();
    renderBodyParts();
    update();
  });

  function cycle(key) {
    if (state.mode === "view") return;
    const now = state.muscles[key];
    if (now === "main") state.muscles[key] = "helps";
    else if (now === "helps") delete state.muscles[key];
    else state.muscles[key] = "main";
    clearMessages();
    update();
  }

  panel.querySelectorAll(".exercise-picker__muscle-chip").forEach((chip) => chip.addEventListener("click", () => cycle(chip.dataset.key)));

  // The figure is tappable too: a shape stands for the list muscle it belongs
  // to (the picker's own mapping); neck, rotator cuff and the like do nothing.
  els.figs.addEventListener("click", (e) => {
    const shape = e.target.closest("[data-muscle]");
    const key = shape && ExercisePicker.muscleKeyForShape(shape);
    if (key) cycle(key);
  });

  els.name.addEventListener("input", () => {
    state.name = els.name.value;
    clearMessages();
    updateNameHint();
    update();
  });

  function updateNameHint() {
    const hit = state.mode === "new" ? findInLibrary(state.name) : null;
    if (!hit) {
      els.nameHint.hidden = true;
      return;
    }
    els.nameHint.textContent = hasMuscles(hit)
      ? "That one is already in the library, with its muscles. Tap it in the list below to see them."
      : "That one is already in the library but has no muscles yet. Choose them below and save to fill them in.";
    els.nameHint.hidden = false;
  }

  function summaryHtml(main, helps) {
    if (!main.length && !helps.length) return "Tap a muscle on the body or in the list.";
    const names = (keys) => esc(keys.map(labelFor).join(", "));
    return (main.length ? `<b>Main:</b> ${names(main)}` : "") + (main.length && helps.length ? "<br>" : "") + (helps.length ? `<b>Helps:</b> ${names(helps)}` : "");
  }

  /** Repaints everything that depends on the form: muscle chips, figure, summary and the Save button. */
  function update() {
    const view = state.mode === "view" && state.current;
    const main = view ? state.current.primary : keysWith("main");
    const helps = view ? state.current.secondary : keysWith("helps");

    panel.querySelectorAll(".exercise-picker__muscle-chip").forEach((chip) => {
      const v = view ? "" : state.muscles[chip.dataset.key] || "";
      chip.dataset.state = v;
      chip.setAttribute("aria-label", `${chip.textContent}${v === "main" ? ", main muscle" : v === "helps" ? ", helps" : ""}`);
    });
    els.figs.querySelectorAll("svg.muscle-figure").forEach((svg) => paintMuscleFigure(svg, main, helps));
    els.summary.innerHTML = summaryHtml(main, helps);
    els.sideSub.textContent = view ? state.current.name : state.name.trim();

    const missing = [];
    if (state.name.trim().length < 2) missing.push("a name");
    if (!state.movement) missing.push("a movement");
    else if (!state.bodyPart) missing.push("a body part");
    if (!main.length) missing.push("a main muscle");
    const dup = state.mode === "new" ? findInLibrary(state.name) : null;
    const blocked = Boolean(dup && hasMuscles(dup));

    els.save.disabled = state.saving || missing.length > 0 || blocked;
    els.needs.hidden = state.saving || (!missing.length && !blocked);
    els.needs.textContent = blocked ? "That name is already in the library with its muscles." : missing.length ? `Still needed: ${joinList(missing)}.` : "";
  }

  // ---------------------------------------------------------------------
  // Modes
  // ---------------------------------------------------------------------

  function setMode(mode) {
    state.mode = mode;
    els.formBox.hidden = mode === "view";
    els.viewBox.hidden = mode !== "view";
    els.intro.hidden = mode === "view";
    els.figs.classList.toggle("exm__figs--readonly", mode === "view");
    els.name.readOnly = mode === "fill";
    els.save.textContent = mode === "fill" ? "Save muscles" : "Save exercise";
    els.intro.textContent = mode === "fill" && state.current ? `${state.current.name} is in the library but has no muscles yet. Choose which it works and save.` : INTRO_NEW;
  }

  /** A blank form: making a new exercise. */
  function startNew() {
    state.current = null;
    state.name = "";
    state.movement = "";
    state.bodyPart = "";
    state.muscles = {};
    els.name.value = "";
    setMode("new");
    renderMovements();
    renderBodyParts();
    clearMessages();
    updateNameHint();
    update();
    renderLibrary();
  }

  els.clear.addEventListener("click", startNew);
  $("exmNew").addEventListener("click", () => {
    startNew();
    els.name.focus();
  });

  /** Tapped in the library: show its muscles, or open it for filling in if it has none. */
  function selectExercise(key) {
    const ex = (state.library || []).find((e) => e.key === key);
    if (!ex) return;
    state.current = ex;
    clearMessages();
    if (hasMuscles(ex)) {
      state.muscles = {};
      setMode("view");
      els.viewName.textContent = ex.name;
      const cat = [ex.movement, ex.bodyPart].filter(Boolean).join(" · ") || "No category";
      els.viewCat.innerHTML = `<span class="exm__chip-dot" style="background:${colorFor(ex.bodyPart)}"></span>${esc(cat)}`;
    } else {
      state.name = ex.name;
      state.movement = validMovement(ex.movement) ? ex.movement : "";
      state.bodyPart = state.movement && validPart(state.movement, ex.bodyPart) ? ex.bodyPart : "";
      state.muscles = {};
      els.name.value = ex.name;
      setMode("fill");
      renderMovements();
      renderBodyParts();
      updateNameHint();
    }
    update();
    renderLibrary();
    // On a narrow screen the form is above the library, so bring it into view.
    if (window.innerWidth < 860) panel.querySelector(".exm__main").scrollIntoView({ block: "start", behavior: "smooth" });
  }

  // ---------------------------------------------------------------------
  // Saving
  // ---------------------------------------------------------------------

  function finishSaving() {
    state.saving = false;
    els.save.textContent = state.mode === "fill" ? "Save muscles" : "Save exercise";
    update();
  }

  async function save() {
    if (els.save.disabled) return;
    const main = keysWith("main");
    const helps = keysWith("helps");
    const wasFill = state.mode === "fill";
    const payload = {
      action: "addExercise",
      name: state.name.trim(),
      movement: state.movement,
      bodyPart: state.bodyPart,
      primaryMuscles: main.join(","),
      secondaryMuscles: helps.join(","),
    };

    state.saving = true;
    els.save.textContent = "Saving…";
    clearMessages();
    update();

    let result;
    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight
        body: JSON.stringify(payload),
      });
      result = await res.json();
    } catch (err) {
      finishSaving();
      showError("Couldn't reach the server. Check your connection and try again.");
      return;
    }

    if (!result || result.status !== "success") {
      finishSaving();
      showError((result && result.message) || "Couldn't save that exercise. Try again.");
      return;
    }

    // Trust what the server says it now holds: an existing row that already had
    // muscles keeps them, so they can differ from what was tapped.
    const saved = result.exercise || {};
    const entry = {
      name: saved.name || payload.name,
      movement: saved.movement || payload.movement,
      bodyPart: saved.bodyPart || payload.bodyPart,
      primary: Array.isArray(saved.primaryMuscles) && saved.primaryMuscles.length ? saved.primaryMuscles : main,
      secondary: Array.isArray(saved.primaryMuscles) && saved.primaryMuscles.length ? saved.secondaryMuscles || [] : helps,
    };
    entry.key = entry.name.toLowerCase();

    savedThisVisit.push(entry);
    if (state.library) {
      const at = state.library.findIndex((e) => e.key === entry.key);
      if (at >= 0) state.library[at] = entry;
      else state.library.push(entry);
      state.library.sort((a, b) => a.name.localeCompare(b.name));
    }

    // The Workouts tab's picker and lookup read the same sheet: make them re-read it.
    if (typeof resetExercisesCache === "function") resetExercisesCache();
    document.dispatchEvent(new CustomEvent("maxfit:exercises-changed"));

    state.saving = false;
    if (wasFill) {
      startNew();
    } else {
      // Ready for the next one in the same body part: keep Movement and Body part, clear the rest.
      state.name = "";
      state.muscles = {};
      els.name.value = "";
      updateNameHint();
      update();
      renderLibrary();
      els.name.focus();
    }

    if (!result.musclesSaved) {
      showError("The exercise is saved, but its muscles weren't: the check-in backend needs its new code pasted in first.");
    } else {
      showSuccess(wasFill ? `Added muscles to "${entry.name}".` : `Saved "${entry.name}". It is in the exercise picker now.`);
    }
    els.save.textContent = "Save exercise";
  }

  els.save.addEventListener("click", save);

  // ---------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------

  startNew();
  if (location.hash === "#exercises") showTab("exercises", { keepHash: true });
})();
