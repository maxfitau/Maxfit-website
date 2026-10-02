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

  let overlay, titleEl, backBtn, closeBtn, bodyEl;
  let onChoose = null;
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
    render("Add Exercise", `<div class="exercise-picker__grid">${tiles}</div>`, null);
    bodyEl.querySelectorAll("[data-movement]").forEach((btn) => {
      btn.addEventListener("click", () => showBodyPartStep(btn.dataset.movement));
      const svg = btn.querySelector("svg[data-crop-keys]");
      if (svg && typeof paintMuscleCrop === "function") paintMuscleCrop(svg);
    });
  }

  function showBodyPartStep(movement) {
    const parts = BODY_PARTS_BY_MOVEMENT[movement] || [];
    const tiles = parts
      .map(
        (bp) =>
          `<button class="exercise-picker__tile" type="button" data-bodypart="${esc(bp)}">` +
          `<span class="exercise-picker__tile-dot" style="background:${colorFor(bp)}"></span>` +
          `<span class="exercise-picker__tile-label">${esc(bp)}</span>` +
          "</button>"
      )
      .join("");
    render(movement, `<div class="exercise-picker__grid">${tiles}</div>`, showMovementStep);
    bodyEl.querySelectorAll("[data-bodypart]").forEach((btn) => {
      btn.addEventListener("click", () => showExerciseStep(movement, btn.dataset.bodypart));
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
        });
      });
    });

    const addBtn = bodyEl.querySelector("#epAddNew");
    if (addBtn) {
      addBtn.addEventListener("click", async () => {
        addBtn.disabled = true;
        addBtn.textContent = "Adding…";
        const name = query.trim();
        try {
          const res = await fetch(APPS_SCRIPT_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "addExercise", name, movement, bodyPart }),
          });
          const result = await res.json();
          if (result.status !== "success") {
            addBtn.disabled = false;
            addBtn.textContent = `+ Add "${name}" as a new exercise`;
            window.alert(result.message || "Couldn't add that exercise — try again.");
            return;
          }
          exercisesCache = null; // next open() re-fetches, so the new one shows up in its list
          close();
          onChoose({
            name: result.exercise.name,
            movement: result.exercise.movement,
            bodyPart: result.exercise.bodyPart,
            primaryMuscles: [],
            secondaryMuscles: [],
            bestView: "",
          });
        } catch (err) {
          addBtn.disabled = false;
          addBtn.textContent = `+ Add "${name}" as a new exercise`;
          window.alert("Couldn't reach the server — check your connection and try again.");
        }
      });
    }
  }

  /** opts.onChoose({name, movement, bodyPart}) fires once, when a pick is made (existing or newly added). */
  function open(opts) {
    onChoose = (opts && opts.onChoose) || function () {};
    ensureOverlay();
    overlay.hidden = false;
    showMovementStep();
  }

  return { open, close, colorFor, MOVEMENTS, BODY_PARTS_BY_MOVEMENT };
})();
