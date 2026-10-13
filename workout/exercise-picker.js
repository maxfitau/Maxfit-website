/*
 * Shared exercise picker — Movement, then Body Part, then the exercise
 * itself, used by both the coach's builder (builder.js) and a client's
 * "+ Add Exercise" ad-hoc flow (app.js). Picking from a list instead of
 * typing a name means every mention of "Bench Press" is really the same
 * exercise, so its logged history (starting weight, previous sets) is
 * always found — a typo used to quietly start that history over.
 *
 * Self-mounting: builds its own full-screen overlay on first open() and
 * appends it to <body>, so neither host page needs any picker markup of
 * its own, just this script and exercise-picker.css loaded after sheet.js
 * (for fetchExercises()) and after whichever script declares
 * APPS_SCRIPT_URL — this file deliberately doesn't redeclare that const,
 * it just uses the host page's.
 */
const ExercisePicker = (function () {
  const MOVEMENTS = ["Push", "Pull", "Legs", "Core", "Conditioning"];

  const BODY_PARTS_BY_MOVEMENT = {
    Push: ["Chest", "Shoulders", "Triceps", "Traps"],
    Pull: ["Back", "Biceps", "Forearms"],
    Legs: ["Quads", "Hamstrings", "Glutes", "Calves"],
    Core: ["Abs", "Obliques", "Lower Back"],
    Conditioning: ["Full Body"],
  };

  // One accent colour per body part — red stays the only accent everywhere
  // else in the app; this is a deliberately separate, functional use of
  // colour (telling muscle groups apart at a glance), not a second accent.
  const BODY_PART_COLORS = {
    Chest: "#e0954a",
    Shoulders: "#e0c04a",
    Triceps: "#d4714a",
    Traps: "#d4a14a",
    Back: "#4a8fd4",
    Biceps: "#4ab8c9",
    Forearms: "#6f4ad4",
    Quads: "#5ac97a",
    Hamstrings: "#8fc94a",
    Glutes: "#4ac99e",
    Calves: "#4ac9c0",
    Abs: "#9a7ad9",
    Obliques: "#c97ad9",
    "Lower Back": "#7a7ad9",
    "Full Body": "#9a9a9a",
  };
  const FALLBACK_COLOR = "#999999";

  function colorFor(bodyPart) {
    return BODY_PART_COLORS[bodyPart] || FALLBACK_COLOR;
  }

  // One colour per movement too, each picked from that movement's own body
  // parts above so the two steps feel connected (tap an orange Push tile,
  // land on orange-family Chest/Shoulders/Triceps/Traps tiles).
  const MOVEMENT_COLORS_ = {
    Push: "#e0954a",
    Pull: "#4a8fd4",
    Legs: "#5ac97a",
    Core: "#9a7ad9",
    Conditioning: "#9a9a9a",
  };

  // Cardio only (Conditioning works everything, so a muscle crop can't single
  // anything out) — the rest get a crop of Max's own figure (muscle-map.js),
  // tight on whichever region that movement's body parts actually light up,
  // so the tile icon is a real "this is the muscle" symbol, not an arrow.
  const CONDITIONING_ICON_ =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l1.5-4L12 17l2.5-9L16 12h5"/></svg>';

  // view + a tight viewBox over the relevant region of muscle-map.js's
  // 200x460 figure, chosen for whichever view covers more of that
  // movement's own body parts (Push/Core read better from the front,
  // Pull/Legs from the back — picked by checking shape coverage, not by eye).
  const MOVEMENT_CROPS_ = {
    Push: { view: "front", box: "25 45 150 110", keys: ["chest", "delts", "traps"] },
    Pull: { view: "back", box: "35 45 130 150", keys: ["lats", "traps", "delts"] },
    Legs: { view: "back", box: "45 210 110 200", keys: ["glutes", "hamstrings", "calves"] },
    Core: { view: "front", box: "50 108 100 105", keys: ["abs", "obliques"] },
  };

  function movementIconHtml_(movement) {
    const crop = MOVEMENT_CROPS_[movement];
    if (!crop || typeof muscleCropSvg === "undefined") return CONDITIONING_ICON_;
    return muscleCropSvg(crop.view, crop.box, crop.keys);
  }

  // Same idea as MOVEMENT_CROPS_ above, one level deeper: a tight crop over
  // just THIS body part's own shape(s), whichever view (front/back) actually
  // has it — e.g. triceps only exists on the back view, biceps only on the
  // front. "Full Body" (Conditioning's only body part) has no single muscle
  // to single out, so it falls through to CONDITIONING_ICON_ like its
  // movement tile does.
  const BODY_PART_CROPS_ = {
    Chest: { view: "front", box: "55 70 90 75", keys: ["chest"] },
    Shoulders: { view: "front", box: "35 65 130 60", keys: ["delts"] },
    Triceps: { view: "back", box: "30 100 140 60", keys: ["triceps"] },
    Traps: { view: "back", box: "45 50 110 90", keys: ["traps"] },
    Back: { view: "back", box: "48 90 105 100", keys: ["lats"] },
    Biceps: { view: "front", box: "30 100 140 60", keys: ["biceps"] },
    Forearms: { view: "front", box: "20 160 160 70", keys: ["forearms"] },
    Quads: { view: "front", box: "55 245 90 100", keys: ["quads"] },
    Hamstrings: { view: "back", box: "55 255 90 100", keys: ["hamstrings"] },
    Glutes: { view: "back", box: "55 212 90 65", keys: ["glutes"] },
    Calves: { view: "back", box: "50 335 100 85", keys: ["calves"] },
    Abs: { view: "front", box: "65 110 70 105", keys: ["abs"] },
    Obliques: { view: "front", box: "55 110 90 100", keys: ["obliques"] },
    "Lower Back": { view: "back", box: "65 150 70 65", keys: ["lowerback"] },
  };

  function bodyPartIconHtml_(bodyPart) {
    const crop = BODY_PART_CROPS_[bodyPart];
    if (!crop || typeof muscleCropSvg === "undefined") return CONDITIONING_ICON_;
    return muscleCropSvg(crop.view, crop.box, crop.keys);
  }

  let overlay, titleEl, backBtn, closeBtn, bodyEl;
  let onChoose = null;
  // Set by chooseMuscles() for a builder row whose name isn't in the
  // library: Movement and Body Part are picked as usual, then the muscle
  // step for this name instead of the exercise list.
  let fixName = null;
  let exercisesCache = null; // { rows, col } from fetchExercises(), fetched once per open()

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.className = "exercise-picker";
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="exercise-picker__head">' +
      '<button class="exercise-picker__back" type="button" aria-label="Back" hidden>' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>' +
      "</button>" +
      '<span class="exercise-picker__title"></span>' +
      '<button class="exercise-picker__close" type="button" aria-label="Close">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
      "</button>" +
      "</div>" +
      '<div class="exercise-picker__body"></div>';
    document.body.appendChild(overlay);

    titleEl = overlay.querySelector(".exercise-picker__title");
    backBtn = overlay.querySelector(".exercise-picker__back");
    closeBtn = overlay.querySelector(".exercise-picker__close");
    bodyEl = overlay.querySelector(".exercise-picker__body");
    closeBtn.addEventListener("click", close);
  }

  function close() {
    if (overlay) overlay.hidden = true;
  }

  function render(title, html, backHandler) {
    titleEl.textContent = title;
    bodyEl.innerHTML = html;
    if (backHandler) {
      backBtn.hidden = false;
      backBtn.onclick = backHandler;
    } else {
      backBtn.hidden = true;
      backBtn.onclick = null;
    }
    bodyEl.scrollTop = 0;
  }

  function esc(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
  }

  function showMovementStep() {
    const tiles = MOVEMENTS.map((m) => {
      const color = MOVEMENT_COLORS_[m] || FALLBACK_COLOR;
      return (
        `<button class="exercise-picker__tile exercise-picker__tile--movement" type="button" data-movement="${esc(m)}" style="background:${color}14; border-color:${color}40">` +
        `<span class="exercise-picker__tile-icon--big">${movementIconHtml_(m)}</span>` +
        `<span class="exercise-picker__tile-label exercise-picker__tile-label--big">${esc(m)}</span>` +
        `</button>`
      );
    }).join("");
    render("Add Exercise", `<div class="exercise-picker__grid exercise-picker__grid--fill">${tiles}</div>`, null);
    bodyEl.querySelectorAll("[data-movement]").forEach((btn) => {
      btn.addEventListener("click", () => showBodyPartStep(btn.dataset.movement));
      const svg = btn.querySelector("svg[data-crop-keys]");
      if (svg && typeof paintMuscleCrop === "function") paintMuscleCrop(svg);
    });
  }

  function showBodyPartStep(movement) {
    const parts = BODY_PARTS_BY_MOVEMENT[movement] || [];
    const tiles = parts
      .map((bp) => {
        const color = colorFor(bp);
        return (
          `<button class="exercise-picker__tile exercise-picker__tile--movement" type="button" data-bodypart="${esc(bp)}" style="background:${color}14; border-color:${color}40">` +
          `<span class="exercise-picker__tile-icon--big">${bodyPartIconHtml_(bp)}</span>` +
          `<span class="exercise-picker__tile-label exercise-picker__tile-label--big">${esc(bp)}</span>` +
          "</button>"
        );
      })
      .join("");
    render(movement, `<div class="exercise-picker__grid exercise-picker__grid--fill">${tiles}</div>`, showMovementStep);
    bodyEl.querySelectorAll("[data-bodypart]").forEach((btn) => {
      btn.addEventListener("click", () =>
        fixName ? showMuscleStep(fixName, movement, btn.dataset.bodypart, [], [], () => showBodyPartStep(movement)) : showExerciseStep(movement, btn.dataset.bodypart)
      );
      const svg = btn.querySelector("svg[data-crop-keys]");
      if (svg && typeof paintMuscleCrop === "function") paintMuscleCrop(svg);
    });
  }

  async function showExerciseStep(movement, bodyPart) {
    render(
      bodyPart,
      '<p class="exercise-picker__empty">Loading exercises…</p>',
      () => showBodyPartStep(movement)
    );

    if (!exercisesCache) {
      try {
        exercisesCache = await fetchExercises();
      } catch (err) {
        exercisesCache = { rows: [], col: {} };
      }
    }

    const { rows, col } = exercisesCache;
    const all =
      col.name >= 0
        ? rows
            .map((r) => ({
              name: String(r[col.name] || "").trim(),
              movement: col.movement >= 0 ? String(r[col.movement] || "").trim() : "",
              bodyPart: col.bodyPart >= 0 ? String(r[col.bodyPart] || "").trim() : "",
              primaryMuscles: col.primaryMuscles >= 0 ? parseMuscleKeys(r[col.primaryMuscles]) : [],
              secondaryMuscles: col.secondaryMuscles >= 0 ? parseMuscleKeys(r[col.secondaryMuscles]) : [],
              bestView: col.bestView >= 0 ? String(r[col.bestView] || "").trim() : "",
              muscleWeights: col.muscleWeights >= 0 ? String(r[col.muscleWeights] || "").trim() : "",
            }))
            .filter((ex) => ex.name && ex.movement === movement && ex.bodyPart === bodyPart)
            .sort((a, b) => a.name.localeCompare(b.name))
        : [];

    renderExerciseList(movement, bodyPart, all, "");
  }

  function renderExerciseList(movement, bodyPart, all, query) {
    const q = query.trim().toLowerCase();
    const filtered = q ? all.filter((ex) => ex.name.toLowerCase().includes(q)) : all;
    const color = colorFor(bodyPart);

    const items = filtered
      .map(
        (ex) =>
          `<button class="exercise-picker__item" type="button" data-name="${esc(ex.name)}">` +
          `<span class="exercise-picker__item-dot" style="background:${color}"></span>` +
          `<span class="exercise-picker__item-name">${esc(ex.name)}</span>` +
          "</button>"
      )
      .join("");

    const exactMatch = q && all.some((ex) => ex.name.toLowerCase() === q);
    const addRow =
      q && !exactMatch
        ? `<button class="exercise-picker__add" type="button" id="epAddNew">+ Add "${esc(query.trim())}" as a new exercise</button>`
        : "";

    const empty = !filtered.length && !addRow ? '<p class="exercise-picker__empty">Type to search, or add a new one below.</p>' : "";

    render(
      bodyPart,
      `<input class="exercise-picker__search" type="text" placeholder="Search ${esc(bodyPart)} exercises…" value="${esc(query)}" id="epSearch" autocomplete="off" />` +
        `<div class="exercise-picker__list">${items}${empty}</div>` +
        addRow,
      () => showBodyPartStep(movement)
    );

    const search = bodyEl.querySelector("#epSearch");
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
    search.addEventListener("input", () => renderExerciseList(movement, bodyPart, all, search.value));

    bodyEl.querySelectorAll("[data-name]").forEach((btn) => {
      btn.addEventListener("click", () => {
        close();
        const picked = filtered.find((ex) => ex.name === btn.dataset.name);
        onChoose({
          name: btn.dataset.name,
          movement,
          bodyPart,
          primaryMuscles: (picked && picked.primaryMuscles) || [],
          secondaryMuscles: (picked && picked.secondaryMuscles) || [],
          bestView: (picked && picked.bestView) || "",
          muscleWeights: (picked && picked.muscleWeights) || "",
        });
      });
    });

    const addBtn = bodyEl.querySelector("#epAddNew");
    if (addBtn) {
      addBtn.addEventListener("click", () =>
        showMuscleStep(query.trim(), movement, bodyPart, [], [], () => renderExerciseList(movement, bodyPart, all, query))
      );
    }
  }

  const CHOOSER_KEYS_ = new Set(MUSCLE_CHOOSER_.flatMap((s) => s.muscles.map((m) => m[0])));
  const CHOOSER_KEY_FOR_GROUP_ = { lowerback: "erector-spinae", hipflexors: "hip-flexors" };

  /** The muscle-list key a figure shape belongs to, or null. */
  function chooserKeyFor_(shape) {
    const muscle = shape.getAttribute("data-muscle");
    const group = shape.getAttribute("data-group");
    if (CHOOSER_KEYS_.has(muscle)) return muscle;
    if (CHOOSER_KEYS_.has(group)) return group;
    return CHOOSER_KEY_FOR_GROUP_[group] || null;
  }

  /**
   * "What does it work?" (2026-10-10, Max): tap a muscle once if it's the
   * main one (red), twice if it only helps (pink), a third time to clear.
   * The body figure lights up as you go. Saving adds the exercise to the
   * Exercises tab with those muscles, or fills them in on an existing row
   * that has none, so the Muscles tab and the builder both count it.
   * `opts.pickDifferent` adds a way out to the normal picker (a row being
   * fixed may simply be the wrong exercise).
   */
  function showMuscleStep(name, movement, bodyPart, primary, secondary, backHandler, opts) {
    const state = {};
    (primary || []).forEach((k) => (state[k] = "main"));
    (secondary || []).forEach((k) => (state[k] = state[k] || "helps"));

    const sections = MUSCLE_CHOOSER_.map(
      (s) =>
        `<p class="exercise-picker__muscle-section">${esc(s.section)}</p>` +
        `<div class="exercise-picker__muscle-chips">${s.muscles
          .map(([key, label]) => `<button class="exercise-picker__muscle-chip" type="button" data-key="${esc(key)}">${esc(label)}</button>`)
          .join("")}</div>`
    ).join("");

    render(
      "Muscles",
      `<p class="exercise-picker__muscle-intro"><b>${esc(name)}</b>: tap a muscle on the body or in the list. Once if it's the main one, twice if it just helps.</p>` +
        `<div class="exercise-picker__muscle-figs">${muscleFigureSvg("front", "epMuscleFront")}${muscleFigureSvg("back", "epMuscleBack")}</div>` +
        '<p class="exercise-picker__muscle-legend"><span class="exercise-picker__muscle-key exercise-picker__muscle-key--main"></span>Main<span class="exercise-picker__muscle-key exercise-picker__muscle-key--helps"></span>Helps</p>' +
        sections +
        '<button class="exercise-picker__save" type="button" id="epMuscleSave"></button>' +
        (opts && opts.pickDifferent ? '<button class="exercise-picker__add" type="button" id="epPickDifferent">Choose a different exercise instead</button>' : ""),
      backHandler
    );

    const saveBtn = bodyEl.querySelector("#epMuscleSave");
    const keysWith = (v) => Object.keys(state).filter((k) => state[k] === v);
    function paint() {
      bodyEl.querySelectorAll("[data-key]").forEach((chip) => {
        const v = state[chip.dataset.key] || "";
        chip.dataset.state = v;
        chip.setAttribute("aria-label", `${chip.textContent}${v === "main" ? ", main muscle" : v === "helps" ? ", helps" : ""}`);
      });
      bodyEl.querySelectorAll("svg.muscle-figure").forEach((svg) => paintMuscleFigure(svg, keysWith("main"), keysWith("helps")));
      const ready = keysWith("main").length > 0;
      saveBtn.disabled = !ready;
      saveBtn.textContent = ready ? `Save ${name}` : "Tap at least one main muscle";
    }
    function cycle(k) {
      state[k] = state[k] === "main" ? "helps" : state[k] === "helps" ? undefined : "main";
      if (!state[k]) delete state[k];
      paint();
    }
    bodyEl.querySelectorAll("[data-key]").forEach((chip) => chip.addEventListener("click", () => cycle(chip.dataset.key)));
    // The body figure is tappable too (Max tapped it first): a shape stands
    // for the list muscle it belongs to; neck, rotator cuff and the like
    // have no list muscle and do nothing.
    bodyEl.querySelectorAll(".exercise-picker__muscle-figs svg").forEach((svg) =>
      svg.addEventListener("click", (e) => {
        const shape = e.target.closest("[data-muscle]");
        const k = shape && chooserKeyFor_(shape);
        if (k) cycle(k);
      })
    );
    paint();

    const different = bodyEl.querySelector("#epPickDifferent");
    if (different) different.addEventListener("click", () => open({ onChoose }));

    saveBtn.addEventListener("click", async () => {
      const main = keysWith("main");
      const helps = keysWith("helps");
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      try {
        const res = await fetch(APPS_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ action: "addExercise", name, movement, bodyPart, primaryMuscles: main.join(","), secondaryMuscles: helps.join(",") }),
        });
        const result = await res.json();
        if (result.status !== "success") {
          paint();
          window.alert(result.message || "Couldn't save that exercise — try again.");
          return;
        }
        const ex = result.exercise;
        if (!result.musclesSaved) {
          window.alert("The exercise is saved, but its muscles weren't: the check-in backend needs its new code pasted in first. They'll still show in this workout for now.");
        }
        exercisesCache = null; // next open() re-fetches, so it shows up in the list
        close();
        // An existing row that already had muscles keeps them (the server
        // only fills blanks), so trust what comes back over what was tapped.
        const savedMain = ex.primaryMuscles && ex.primaryMuscles.length ? ex.primaryMuscles : main;
        onChoose({
          name: ex.name,
          movement: ex.movement,
          bodyPart: ex.bodyPart,
          primaryMuscles: savedMain,
          secondaryMuscles: ex.primaryMuscles && ex.primaryMuscles.length ? ex.secondaryMuscles || [] : helps,
          bestView: "",
          muscleWeights: "",
        });
      } catch (err) {
        paint();
        window.alert("Couldn't reach the server — check your connection and try again.");
      }
    });
  }

  /** opts.onChoose({name, movement, bodyPart}) fires once, when a pick is made (existing or newly added). */
  function open(opts) {
    onChoose = (opts && opts.onChoose) || function () {};
    fixName = null;
    ensureOverlay();
    overlay.hidden = false;
    showMovementStep();
  }

  /**
   * Straight to the muscle step for a row with no muscle data (the
   * builder's "Tap to choose muscles"). A name already in the library
   * (known Movement/Body Part) goes there directly; an unknown one picks
   * Movement and Body Part first. opts.onChoose as for open().
   */
  function chooseMuscles(opts) {
    onChoose = opts.onChoose || function () {};
    fixName = null;
    ensureOverlay();
    overlay.hidden = false;
    if (opts.movement && opts.bodyPart) {
      showMuscleStep(opts.name, opts.movement, opts.bodyPart, opts.primary, opts.secondary, null, { pickDifferent: true });
    } else {
      fixName = opts.name;
      showMovementStep();
    }
  }

  return { open, chooseMuscles, close, colorFor, MOVEMENTS, BODY_PARTS_BY_MOVEMENT };
})();
