/*
 * Shared muscle-group data and the "which muscles does this exercise work"
 * display — used by the coach's workout builder, a client's own workout
 * page, and the Exercise Library / Anatomy Lab (workout/library.html).
 * Keys match the muscle keys in the Exercises sheet's Primary/Secondary
 * Muscles columns (comma-separated), added with Max's fuller exercise
 * library (2026-10-02).
 *
 * Colour language (Max's spec, 2026-10-02): every primary muscle is the
 * SAME red, every secondary muscle the SAME salmon — the muscle's NAME is
 * what tells one from another, not a rainbow of per-muscle hues. That's
 * deliberate (his spec: "Colour is never the only signal: always list
 * muscle names in text too") and matches how gym-machine diagrams actually
 * work. Applies to both the chip row (renderMuscleHighlight) and the real
 * figure (muscleFigureSvg/paintMuscleFigure) below, so the two always
 * agree with each other.
 */
const MUSCLE_KEYS = {
  chest: "Chest",
  delts: "Shoulders",
  triceps: "Triceps",
  biceps: "Biceps",
  forearms: "Forearms",
  abs: "Abs",
  obliques: "Obliques",
  lats: "Lats",
  lowerback: "Lower Back",
  glutes: "Glutes",
  quads: "Quads",
  hamstrings: "Hamstrings",
  calves: "Calves",
  traps: "Traps",
};

const MUSCLE_PRIMARY_COLOR = "#ff2a1f";
const MUSCLE_SECONDARY_COLOR = "#ff9a7a";
const MUSCLE_UNUSED_COLOR = "#3c3c3c"; // a muscle key that exists, but isn't part of this exercise
const MUSCLE_BASE_COLOR = "#2a2a2a"; // head, neck, hands, feet — never individually highlighted
const MUSCLE_GAP_STROKE_COLOR = "#141414"; // outline between adjoining muscles, dark-card version

function muscleLabel_(key) {
  return MUSCLE_KEYS[key] || key;
}

/** "chest,delts" (as stored in the sheet) -> ["chest", "delts"], blanks dropped. */
function parseMuscleKeys(raw) {
  return String(raw || "")
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Fills `container` with a small coloured chip per muscle — red for
 * primary, salmon for secondary — and hides it when there's nothing to
 * show, so a caller can always call this unconditionally rather than
 * checking first. `primary`/`secondary` can be either arrays of keys or raw
 * "a,b" strings straight from the sheet.
 */
function renderMuscleHighlight(container, primary, secondary) {
  if (!container) return;
  const p = Array.isArray(primary) ? primary : parseMuscleKeys(primary);
  const s = Array.isArray(secondary) ? secondary : parseMuscleKeys(secondary);
  if (!p.length && !s.length) {
    container.innerHTML = "";
    container.hidden = true;
    return;
  }
  const chip = (key, kind, color) =>
    `<span class="muscle-chip muscle-chip--${kind}">` +
    `<span class="muscle-chip__dot" style="background:${color}"></span>` +
    `<span class="muscle-chip__label">${muscleLabel_(key)}</span>` +
    "</span>";
  container.innerHTML =
    p.map((k) => chip(k, "primary", MUSCLE_PRIMARY_COLOR)).join("") +
    s.map((k) => chip(k, "secondary", MUSCLE_SECONDARY_COLOR)).join("");
  container.hidden = false;
}

// ---------------------------------------------------------------------------
// The real figure — Max's own artwork (maxfit-muscle-figure.svg, supplied
// 2026-10-02), not hand-authored here. The two constants below are a
// byte-for-byte copy of that file's `#front`/`#back` group contents (shapes
// and coordinates untouched — don't hand-edit them). Each muscle shape
// carries `class="muscle" data-muscle="<key>"`; a key can cover several
// shapes (e.g. abs is 7 rects, glutes is 2 ellipses) and paintMuscleFigure
// recolours every one that matches, so that's transparent to callers.
//
// The source file is drawn for a light card (base #e7e5e0, unused muscle
// #d9d6d0, white gap stroke between muscles). Every screen that uses this
// today has a dark card, so MUSCLE_RECOLOUR_FOR_DARK_ below swaps those
// three colours for the dark-card ones at load time. If a light card ever
// needs this figure (the light-themed Muscle Heatmap screen might), add a
// light variant instead of reusing these recoloured constants.
// ---------------------------------------------------------------------------

const MUSCLE_FRONT_SVG_RAW_ = `
<g fill="#e7e5e0" stroke="#e7e5e0">
<ellipse cx="100" cy="34" rx="17" ry="21"></ellipse><rect x="91" y="50" width="18" height="20" rx="4"></rect>
<path d="M64 74 Q100 62 136 74 L146 96 Q142 150 128 200 L124 232 L76 232 L72 200 Q58 150 54 96 Z"></path>
<path d="M74 224 L126 224 L130 254 L100 266 L70 254 Z"></path>
</g>
<g stroke="#e7e5e0" stroke-linecap="round" fill="none">
<line x1="58" y1="92" x2="48" y2="158" stroke-width="26"></line>
<line x1="48" y1="158" x2="38" y2="222" stroke-width="21"></line>
<line x1="142" y1="92" x2="152" y2="158" stroke-width="26"></line>
<line x1="152" y1="158" x2="162" y2="222" stroke-width="21"></line>
<line x1="86" y1="252" x2="82" y2="340" stroke-width="36"></line>
<line x1="82" y1="340" x2="80" y2="428" stroke-width="25"></line>
<line x1="114" y1="252" x2="118" y2="340" stroke-width="36"></line>
<line x1="118" y1="340" x2="120" y2="428" stroke-width="25"></line>
</g>
<g fill="#e7e5e0"><circle cx="36" cy="236" r="9"></circle><circle cx="164" cy="236" r="9"></circle><ellipse cx="77" cy="442" rx="13" ry="7"></ellipse><ellipse cx="123" cy="442" rx="13" ry="7"></ellipse></g>
<g stroke="#ffffff" stroke-width="2" stroke-linejoin="round">
<path class="muscle" data-muscle="traps" fill="#d9d6d0" d="M92 60 L68 78 L92 74 Z"></path>
<path class="muscle" data-muscle="traps" fill="#d9d6d0" d="M108 60 L132 78 L108 74 Z"></path>
<ellipse class="muscle" data-muscle="delts" fill="#d9d6d0" cx="62" cy="91" rx="13" ry="16" transform="rotate(-20 62 91)"></ellipse>
<ellipse class="muscle" data-muscle="delts" fill="#d9d6d0" cx="138" cy="91" rx="13" ry="16" transform="rotate(20 138 91)"></ellipse>
<path class="muscle" data-muscle="chest" fill="#d9d6d0" d="M99 80 L76 83 Q65 96 72 113 Q86 123 99 117 Z"></path>
<path class="muscle" data-muscle="chest" fill="#d9d6d0" d="M101 80 L124 83 Q135 96 128 113 Q114 123 101 117 Z"></path>
<ellipse class="muscle" data-muscle="biceps" fill="#d9d6d0" cx="53" cy="128" rx="9" ry="22" transform="rotate(8 53 128)"></ellipse>
<ellipse class="muscle" data-muscle="biceps" fill="#d9d6d0" cx="147" cy="128" rx="9" ry="22" transform="rotate(-8 147 128)"></ellipse>
<ellipse class="muscle" data-muscle="forearms" fill="#d9d6d0" cx="43" cy="190" rx="8" ry="25" transform="rotate(9 43 190)"></ellipse>
<ellipse class="muscle" data-muscle="forearms" fill="#d9d6d0" cx="157" cy="190" rx="8" ry="25" transform="rotate(-9 157 190)"></ellipse>
<path class="muscle" data-muscle="obliques" fill="#d9d6d0" d="M75 124 Q82 150 86 196 L80 202 Q68 160 71 127 Z"></path>
<path class="muscle" data-muscle="obliques" fill="#d9d6d0" d="M125 124 Q118 150 114 196 L120 202 Q132 160 129 127 Z"></path>
<rect class="muscle" data-muscle="abs" fill="#d9d6d0" x="87" y="123" width="12" height="17" rx="4"></rect>
<rect class="muscle" data-muscle="abs" fill="#d9d6d0" x="101" y="123" width="12" height="17" rx="4"></rect>
<rect class="muscle" data-muscle="abs" fill="#d9d6d0" x="87" y="142" width="12" height="17" rx="4"></rect>
<rect class="muscle" data-muscle="abs" fill="#d9d6d0" x="101" y="142" width="12" height="17" rx="4"></rect>
<rect class="muscle" data-muscle="abs" fill="#d9d6d0" x="87" y="161" width="12" height="17" rx="4"></rect>
<rect class="muscle" data-muscle="abs" fill="#d9d6d0" x="101" y="161" width="12" height="17" rx="4"></rect>
<rect class="muscle" data-muscle="abs" fill="#d9d6d0" x="87" y="180" width="26" height="24" rx="9"></rect>
<ellipse class="muscle" data-muscle="quads" fill="#d9d6d0" cx="84" cy="294" rx="15" ry="42" transform="rotate(3 84 294)"></ellipse>
<ellipse class="muscle" data-muscle="quads" fill="#d9d6d0" cx="116" cy="294" rx="15" ry="42" transform="rotate(-3 116 294)"></ellipse>
<ellipse class="muscle" data-muscle="calves" fill="#d9d6d0" cx="79" cy="378" rx="10" ry="28"></ellipse>
<ellipse class="muscle" data-muscle="calves" fill="#d9d6d0" cx="121" cy="378" rx="10" ry="28"></ellipse>
</g>
`;

const MUSCLE_BACK_SVG_RAW_ = `
<g fill="#e7e5e0" stroke="#e7e5e0">
<ellipse cx="100" cy="34" rx="17" ry="21"></ellipse><rect x="91" y="50" width="18" height="20" rx="4"></rect>
<path d="M64 74 Q100 62 136 74 L146 96 Q142 150 128 200 L124 232 L76 232 L72 200 Q58 150 54 96 Z"></path>
<path d="M74 224 L126 224 L130 254 L100 266 L70 254 Z"></path>
</g>
<g stroke="#e7e5e0" stroke-linecap="round" fill="none">
<line x1="58" y1="92" x2="48" y2="158" stroke-width="26"></line>
<line x1="48" y1="158" x2="38" y2="222" stroke-width="21"></line>
<line x1="142" y1="92" x2="152" y2="158" stroke-width="26"></line>
<line x1="152" y1="158" x2="162" y2="222" stroke-width="21"></line>
<line x1="86" y1="252" x2="82" y2="340" stroke-width="36"></line>
<line x1="82" y1="340" x2="80" y2="428" stroke-width="25"></line>
<line x1="114" y1="252" x2="118" y2="340" stroke-width="36"></line>
<line x1="118" y1="340" x2="120" y2="428" stroke-width="25"></line>
</g>
<g fill="#e7e5e0"><circle cx="36" cy="236" r="9"></circle><circle cx="164" cy="236" r="9"></circle><ellipse cx="77" cy="442" rx="13" ry="7"></ellipse><ellipse cx="123" cy="442" rx="13" ry="7"></ellipse></g>
<g stroke="#ffffff" stroke-width="2" stroke-linejoin="round">
<path class="muscle" data-muscle="traps" fill="#d9d6d0" d="M100 56 L70 80 L100 130 L130 80 Z"></path>
<ellipse class="muscle" data-muscle="delts" fill="#d9d6d0" cx="62" cy="92" rx="13" ry="15" transform="rotate(-20 62 92)"></ellipse>
<ellipse class="muscle" data-muscle="delts" fill="#d9d6d0" cx="138" cy="92" rx="13" ry="15" transform="rotate(20 138 92)"></ellipse>
<path class="muscle" data-muscle="lats" fill="#d9d6d0" d="M76 100 Q63 132 79 178 L96 152 L94 112 Z"></path>
<path class="muscle" data-muscle="lats" fill="#d9d6d0" d="M124 100 Q137 132 121 178 L104 152 L106 112 Z"></path>
<ellipse class="muscle" data-muscle="triceps" fill="#d9d6d0" cx="52" cy="128" rx="10" ry="22" transform="rotate(8 52 128)"></ellipse>
<ellipse class="muscle" data-muscle="triceps" fill="#d9d6d0" cx="148" cy="128" rx="10" ry="22" transform="rotate(-8 148 128)"></ellipse>
<ellipse class="muscle" data-muscle="forearms" fill="#d9d6d0" cx="43" cy="190" rx="8" ry="25" transform="rotate(9 43 190)"></ellipse>
<ellipse class="muscle" data-muscle="forearms" fill="#d9d6d0" cx="157" cy="190" rx="8" ry="25" transform="rotate(-9 157 190)"></ellipse>
<ellipse class="muscle" data-muscle="lowerback" fill="#d9d6d0" cx="93" cy="182" rx="7" ry="22"></ellipse>
<ellipse class="muscle" data-muscle="lowerback" fill="#d9d6d0" cx="107" cy="182" rx="7" ry="22"></ellipse>
<ellipse class="muscle" data-muscle="glutes" fill="#d9d6d0" cx="87" cy="242" rx="15" ry="17"></ellipse>
<ellipse class="muscle" data-muscle="glutes" fill="#d9d6d0" cx="113" cy="242" rx="15" ry="17"></ellipse>
<ellipse class="muscle" data-muscle="hamstrings" fill="#d9d6d0" cx="85" cy="304" rx="14" ry="38"></ellipse>
<ellipse class="muscle" data-muscle="hamstrings" fill="#d9d6d0" cx="115" cy="304" rx="14" ry="38"></ellipse>
<ellipse class="muscle" data-muscle="calves" fill="#d9d6d0" cx="80" cy="372" rx="12" ry="27"></ellipse>
<ellipse class="muscle" data-muscle="calves" fill="#d9d6d0" cx="120" cy="372" rx="12" ry="27"></ellipse>
</g>
`;

function muscleRecolourForDarkCard_(svgMarkup) {
  return svgMarkup
    .split("#e7e5e0").join(MUSCLE_BASE_COLOR)
    .split("#d9d6d0").join(MUSCLE_UNUSED_COLOR)
    .split("#ffffff").join(MUSCLE_GAP_STROKE_COLOR);
}

const MUSCLE_FRONT_SVG_ = muscleRecolourForDarkCard_(MUSCLE_FRONT_SVG_RAW_);
const MUSCLE_BACK_SVG_ = muscleRecolourForDarkCard_(MUSCLE_BACK_SVG_RAW_);

/**
 * The front or back figure as inline SVG markup (a string, not yet in the
 * DOM) — Max's artwork above, filled `MUSCLE_UNUSED_COLOR` until
 * paintMuscleFigure() recolours it. `summaryId` is used for the hidden text
 * summary paintMuscleFigure keeps up to date (the accessible description of
 * what's highlighted).
 */
function muscleFigureSvg(view, summaryId) {
  const inner = view === "back" ? MUSCLE_BACK_SVG_ : MUSCLE_FRONT_SVG_;
  return (
    `<svg class="muscle-figure" data-view="${view}" viewBox="0 0 200 460" role="img" aria-labelledby="${summaryId}">` +
    `<title id="${summaryId}">${view === "back" ? "Back" : "Front"} view</title>` +
    inner +
    "</svg>"
  );
}

/**
 * Recolours every `[data-muscle]` group inside `svgRoot` (a front or back
 * muscleFigureSvg already in the DOM) to match primary/secondary, and
 * updates its `<title>` to a plain-text summary for screen readers — e.g.
 * "Highlights: Chest (primary), Shoulders, Triceps (secondary)". A muscle
 * key this view doesn't have a shape for (e.g. "chest" on the back view)
 * is silently skipped — the other view still carries it.
 */
function paintMuscleFigure(svgRoot, primary, secondary) {
  if (!svgRoot) return;
  const p = Array.isArray(primary) ? primary : parseMuscleKeys(primary);
  const s = Array.isArray(secondary) ? secondary : parseMuscleKeys(secondary);
  svgRoot.querySelectorAll("[data-muscle]").forEach((g) => {
    const key = g.getAttribute("data-muscle");
    g.setAttribute("fill", p.includes(key) ? MUSCLE_PRIMARY_COLOR : s.includes(key) ? MUSCLE_SECONDARY_COLOR : MUSCLE_UNUSED_COLOR);
  });
  const title = svgRoot.querySelector("title");
  if (title) {
    const parts = [];
    if (p.length) parts.push(`${p.map(muscleLabel_).join(", ")} (primary)`);
    if (s.length) parts.push(`${s.map(muscleLabel_).join(", ")} (secondary)`);
    title.textContent = parts.length ? `Highlights: ${parts.join(", ")}` : (svgRoot.dataset.view === "back" ? "Back view" : "Front view");
  }
}
