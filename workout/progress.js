/*
 * Strength progress — opened from the workout history calendar
 * (workout/calendar.html -> progress.html?id=<slug>). Same identity
 * resolution as the rest of the workout pages: ?id= in the URL, falling
 * back to whatever the card last remembered in localStorage.
 *
 * Reads the full "Logged Sets" history for this client (same read-only CSV
 * fetch the calendar page already uses) and turns it into one strength
 * trend per exercise. This is a "look back at history" page like the
 * calendar, not the live logger — it's fine for it to read Logged Sets;
 * the live workout page (app.js) is the one that must never do that.
 */
const MEMBER_ID_STORAGE_KEY = "maxfitMemberId"; // shared with card/app.js

const params = new URLSearchParams(window.location.search);
let memberId = params.get("id");
if (!memberId) {
  try {
    memberId = localStorage.getItem(MEMBER_ID_STORAGE_KEY);
  } catch (err) {
    // Ignore — memberId stays null, handled below.
  }
}

const els = {
  backLink: document.getElementById("backLink"),
  pickerRow: document.getElementById("pickerRow"),
  select: document.getElementById("exerciseSelect"),
  empty: document.getElementById("progressEmpty"),
  content: document.getElementById("progressContent"),
  metricLabel: document.getElementById("metricLabel"),
  headlineValue: document.getElementById("headlineValue"),
  headlineDelta: document.getElementById("headlineDelta"),
  chartWrap: document.getElementById("chartWrap"),
  singleHint: document.getElementById("singleHint"),
  note: document.getElementById("progressNote"),
  status: document.getElementById("status"),
};

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// These mirror the color tokens in card/styles.css :root — kept as literal
// hex here (rather than var()) because SVG presentation attributes aren't
// reliably themed via custom properties across older mobile Safari/Chrome.
// Update both places together if the palette ever changes.
const COLOR_RED = "#e00000";
const COLOR_DIM = "#999999";
const COLOR_GRID = "rgba(255,255,255,0.08)";
const COLOR_DOT_FILL = "#1c1c1c";

function showStatus(message, isError) {
  els.status.textContent = message;
  els.status.hidden = false;
  els.status.classList.toggle("status--error", Boolean(isError));
}

function formatNum(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** "yyyy-M-d" or "yyyy-MM-dd", whatever the sheet has — normalized to "yyyy-M-d" (no leading zeros), same helper as calendar.js. */
function normalizeDateKey(raw) {
  const parts = String(raw || "").trim().split("-");
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map((p) => parseInt(p, 10));
  if (!y || !m || !d) return null;
  return `${y}-${m}-${d}`;
}

function dateKeyToDate_(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dateKeyCompare_(a, b) {
  return dateKeyToDate_(a) - dateKeyToDate_(b);
}

function formatAxisDate_(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return `${MONTH_SHORT[m - 1]} ${d}`;
}

/** Epley estimated 1-rep max — heavier weight for fewer reps, or the same weight for more reps, both push this up. */
function epley1RM(weight, reps) {
  return weight * (1 + reps / 30);
}

/**
 * Groups this client's logged sets into one strength trend per exercise.
 * Exercise identity matches by name only (trimmed, case-insensitive) —
 * the same rule the workout page's "last time" prefill uses — so an
 * exercise logged under two differently-named workouts is still one trend.
 * Each calendar day collapses to a single point: the best set logged that
 * day. For an exercise nobody has ever logged a weight for (bodyweight
 * moves saved as 0kg), the trend falls back to best reps that day instead
 * of a flat, meaningless "0kg" line.
 */
function buildSeries_(rows, col, clientSlug) {
  const byExercise = new Map();

  for (const r of rows) {
    if (String(r[col.client] || "").trim().toLowerCase() !== clientSlug) continue;

    const exerciseRaw = (col.exercise >= 0 ? r[col.exercise] : "").trim();
    if (!exerciseRaw) continue;

    const dateKey = normalizeDateKey(col.date >= 0 ? r[col.date] : "");
    if (!dateKey) continue;

    const weight = Number(col.weight >= 0 ? r[col.weight] : NaN);
    const reps = Number(col.reps >= 0 ? r[col.reps] : NaN);
    if (!Number.isFinite(weight) || !Number.isFinite(reps) || weight < 0 || reps <= 0) continue;

    const key = exerciseRaw.toLowerCase();
    if (!byExercise.has(key)) byExercise.set(key, { displayName: exerciseRaw, byDate: new Map() });
    const entry = byExercise.get(key);
    entry.displayName = exerciseRaw; // rows are roughly oldest-first, so the latest spelling/casing wins
    if (!entry.byDate.has(dateKey)) entry.byDate.set(dateKey, []);
    entry.byDate.get(dateKey).push({ weight, reps });
  }

  const exercises = [];
  for (const [key, entry] of byExercise) {
    const dates = [...entry.byDate.keys()].sort(dateKeyCompare_);
    const usesReps = dates.every((d) => entry.byDate.get(d).every((s) => s.weight === 0));
    const points = dates.map((dateKey) => {
      const sets = entry.byDate.get(dateKey);
      const value = usesReps
        ? Math.max(...sets.map((s) => s.reps))
        : Math.max(...sets.map((s) => epley1RM(s.weight, s.reps)));
      return { dateKey, value };
    });
    exercises.push({ key, displayName: entry.displayName, usesReps, points });
  }

  // Whatever this client logged most recently comes first in the picker.
  exercises.sort((a, b) => dateKeyCompare_(b.points[b.points.length - 1].dateKey, a.points[a.points.length - 1].dateKey));
  return exercises;
}

/** Builds a small responsive line chart as an SVG string. Every value plugged in is a number this file computed itself (never raw sheet text), so building it as a template string is safe. */
function buildChartSvg_(points) {
  const W = 320;
  const H = 160;
  const padL = 30;
  const padR = 10;
  const padT = 14;
  const padB = 22;

  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= Math.max(1, Math.abs(min) * 0.1);
    max += Math.max(1, Math.abs(max) * 0.1);
  } else {
    const pad = (max - min) * 0.15;
    min -= pad;
    max += pad;
  }

  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const xFor = (i) => padL + (points.length > 1 ? (i / (points.length - 1)) * innerW : innerW / 2);
  const yFor = (v) => padT + (1 - (v - min) / (max - min)) * innerH;

  const linePoints = points.map((p, i) => `${xFor(i).toFixed(1)},${yFor(p.value).toFixed(1)}`).join(" ");

  const gridLines = [0, 0.5, 1]
    .map((f) => {
      const y = (padT + f * innerH).toFixed(1);
      return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${COLOR_GRID}" stroke-width="1" />`;
    })
    .join("");

  const yLabels = `<text x="0" y="${(padT + 8).toFixed(1)}" font-size="9" fill="${COLOR_DIM}" font-family="Barlow, sans-serif">${formatNum(max)}</text>` +
    `<text x="0" y="${(H - padB + 4).toFixed(1)}" font-size="9" fill="${COLOR_DIM}" font-family="Barlow, sans-serif">${formatNum(min)}</text>`;

  const dots = points
    .map((p, i) => {
      const isLast = i === points.length - 1;
      const r = isLast ? 4.5 : 3;
      const fill = isLast ? COLOR_RED : COLOR_DOT_FILL;
      return `<circle cx="${xFor(i).toFixed(1)}" cy="${yFor(p.value).toFixed(1)}" r="${r}" fill="${fill}" stroke="${COLOR_RED}" stroke-width="2" />`;
    })
    .join("");

  const lastIdx = points.length - 1;
  const xLabelIdxs = points.length === 1 ? [0] : [0, lastIdx];
  const xLabels = xLabelIdxs
    .map((i) => {
      const anchor = i === 0 ? "start" : "end";
      const x = i === 0 ? xFor(i) : xFor(i);
      return `<text x="${x.toFixed(1)}" y="${H - 4}" font-size="9" fill="${COLOR_DIM}" font-family="Barlow, sans-serif" text-anchor="${anchor}">${formatAxisDate_(points[i].dateKey)}</text>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Strength trend over time">` +
    gridLines +
    `<polyline points="${linePoints}" fill="none" stroke="${COLOR_RED}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />` +
    dots +
    yLabels +
    xLabels +
    `</svg>`;
}

function renderExercise_(ex) {
  const unit = ex.usesReps ? "reps" : "kg";
  els.metricLabel.textContent = ex.usesReps ? "Best Reps" : "Est. 1-Rep Max";

  const last = ex.points[ex.points.length - 1];
  els.headlineValue.textContent = `${formatNum(last.value)} ${unit}`;

  const isSingle = ex.points.length < 2;
  els.chartWrap.hidden = isSingle;
  els.singleHint.hidden = !isSingle;
  els.headlineDelta.hidden = isSingle;

  if (!isSingle) {
    const first = ex.points[0];
    const delta = last.value - first.value;
    els.headlineDelta.classList.toggle("progress__headline-delta--up", delta > 0);
    els.headlineDelta.classList.toggle("progress__headline-delta--down", delta < 0);
    if (delta === 0) {
      els.headlineDelta.textContent = `No change since ${formatAxisDate_(first.dateKey)}`;
    } else {
      const pct = first.value !== 0 ? Math.abs((delta / first.value) * 100) : 0;
      const sign = delta > 0 ? "+" : "-";
      els.headlineDelta.textContent = `${sign}${formatNum(Math.abs(delta))} ${unit} (${sign}${formatNum(pct)}%) since ${formatAxisDate_(first.dateKey)}`;
    }
    els.chartWrap.innerHTML = buildChartSvg_(ex.points);
  } else {
    // Clear the previous exercise's leftover chart/delta rather than just
    // hiding them — otherwise switching TO a single-session exercise still
    // leaves the old SVG and delta text sitting invisibly in the DOM.
    els.chartWrap.innerHTML = "";
    els.headlineDelta.textContent = "";
  }

  els.note.textContent = ex.usesReps
    ? "Estimated from your best rep count each session for this bodyweight move — more reps means more strength."
    : "Estimated from your heaviest set each session — lifting more weight or more reps both count as getting stronger.";
}

function populatePicker_(exercises) {
  els.select.innerHTML = "";
  for (const ex of exercises) {
    const opt = document.createElement("option");
    opt.value = ex.key;
    opt.textContent = ex.displayName;
    els.select.appendChild(opt);
  }
}

async function init() {
  if (!memberId) {
    showStatus("Open this from your membership card.", true);
    return;
  }

  const clientSlug = slugify(memberId);
  els.backLink.href = `calendar.html?id=${encodeURIComponent(memberId)}`;

  let exercises;
  try {
    const { rows, col } = await fetchLoggedSets();
    exercises = buildSeries_(rows, col, clientSlug);
  } catch (err) {
    showStatus("Couldn't load your workout history. Check your connection and reopen.", true);
    return;
  }

  if (!exercises.length) {
    els.empty.hidden = false;
    return;
  }

  const exercisesByKey = new Map(exercises.map((ex) => [ex.key, ex]));
  populatePicker_(exercises);
  els.pickerRow.hidden = false;
  els.select.value = exercises[0].key;
  els.content.hidden = false;
  renderExercise_(exercises[0]);

  els.select.addEventListener("change", () => {
    const ex = exercisesByKey.get(els.select.value);
    if (ex) renderExercise_(ex);
  });
}

init();
