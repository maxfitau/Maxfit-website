/*
 * The card's weekly recap and monthly goal (2026-10-13, Max).
 *
 *   - "Last week" tile: kilos moved, a fun comparison ("about 5 elephants")
 *     and new personal bests. Tap for the whole week: where the kilos went,
 *     bests, workouts, green days, the goal, and a tip of the week.
 *   - "Your goal" tile: this month's SMART goal and how it's going. Tap for
 *     progress, "get there quicker", the next goal and Change my goal.
 *   - Goal setup opens by itself the first time a client opens their card,
 *     and again when their month ends. "Not now" waits until tomorrow.
 *   - "Shopping list" tile while their list (Gold and Diamond) has things
 *     to buy; it opens mealplan.js's list.
 *
 * The maths is all MacroCore (weekRecap, goalOptions, goalProgress...).
 * Goals are stored by the Fuel backend (goal / saveGoal). Weight and
 * green-day goals read Fuel's private data, so they only appear with the
 * client's Fuel link on this phone. Nothing here uses AI, so it costs
 * nothing to run. Text is big on purpose: many clients are older.
 */
const WeekCard = (function () {
  // One tip a week, in order, for a year. Max approved these on 2026-10-13.
  const TIPS = [
    "Eat some protein at every meal. A palm-sized serve helps your muscles recover.",
    "A 10-minute walk after dinner helps keep your blood sugar steady.",
    "Sleep is part of training. Aim for 7 to 9 hours a night.",
    "Have a glass of water when you wake up, before your coffee.",
    "Protein and carbs have 4 calories per gram. Alcohol has 7. That's almost double.",
    "Warm up for 5 minutes before lifting: a brisk walk or an easy bike.",
    "Lower each weight slowly. Control is where strength is built.",
    "Stand on one leg while you brush your teeth. It builds balance.",
    "Missed a session? Don't try to make it up. Just turn up to the next one.",
    "Breathe out as you push or pull, and in as you lower.",
    "Strong legs make stairs, gardening and playing with the grandkids easier.",
    "Add a vegetable to your lunch and your dinner this week.",
    "Rest 1 to 2 minutes between heavy sets, so you can lift well again.",
    "Sore the day after? A gentle walk helps more than sitting still.",
    "Get up and move for 2 minutes for every hour you sit.",
    "A little stronger each month adds up to a lot in a year.",
    "Keep healthy snacks where you can see them: fruit, yoghurt, nuts.",
    "Good form first. Then add weight.",
    "Carry your shopping with a tall back. That's strength training too.",
    "Stretch your calves and hips after a walk.",
    "Plan tomorrow's meals tonight. It makes good choices easier.",
    "If you weigh yourself, do it at the same time of day and watch the trend, not one day.",
    "Strength training helps keep your bones strong as you get older.",
    "Eat slowly. It takes about 20 minutes to feel full.",
    "Working hard is fine; sharp pain is not. Stop and tell Max.",
    "Try one new healthy recipe this week.",
    "Stand up from a chair 10 times without your hands. Try it each month and watch it get easier.",
    "Get some morning sunlight. It helps you sleep better at night.",
    "Alcohol slows your recovery. Fewer drinks means better sleep and better sessions.",
    "Before you lift, gently tighten your tummy, as if you're about to cough.",
    "A strong grip helps with jars, bags and doors. Farmer's carries build it.",
    "Celebrate the small wins. One extra rep counts.",
    "Swap one sugary drink a day for water or sparkling water.",
    "Keep your shoulders down and back when you press.",
    "A piece of fruit and some protein makes a quick, filling snack.",
    "Turning up beats going all out. Three good sessions a week is plenty.",
    "Look ahead, not down, when you squat.",
    "Walk tall: chin level, shoulders relaxed.",
    "Bring a water bottle to every session.",
    "Feeling flat? A short walk outside lifts your mood.",
    "Protein keeps you full: eggs, Greek yoghurt, fish, chicken, beans.",
    "Take the stairs when you can.",
    "If an exercise doesn't feel right, ask Max. There's always another way.",
    "Go to bed and get up at the same times, even on weekends.",
    "Fibre keeps you full and regular: oats, beans, fruit and vegetables.",
    "Your muscles grow while you rest, not while you train.",
    "On your days off, do something active you enjoy: swim, garden, dance.",
    "Small serves of the foods you love can fit into a healthy week.",
    "Check your posture on your phone: ears over your shoulders.",
    "Strength is a skill. The more you practise, the better it feels.",
    "Set one goal for this month and tell Max about it.",
    "Look back at where you started. You've come a long way.",
  ];
  const TIP_START = "2026-01-05"; // a Monday: tip 1's week

  const TYPES = {
    weight: { emoji: "⚖️", name: "Lose weight", sub: "Using your Fuel weigh-ins", q: "How much by the end of the month?",
      how: ["Hit my protein most days", "Walk 20 minutes after dinner", "Log every meal in Fuel", "Keep alcohol to the weekend"] },
    strength: { emoji: "🏋️", name: "Get stronger", sub: "Using the weights you log", q: "How heavy?",
      how: ["Do this lift twice a week", "Add a little weight when I hit the top of my reps", "Sleep 7 hours or more", "Eat my protein"] },
    sessions: { emoji: "📅", name: "Train more often", sub: "Using the workouts you log", q: "How many workouts a week?",
      how: ["Book my sessions on Sunday", "Train before work", "Have a short plan for busy days"] },
    green: { emoji: "🥗", name: "Eat better", sub: "Using your Fuel green days", q: "How many green days a week?",
      how: ["Plan tomorrow's meals tonight", "Have protein at every meal", "Log meals as I eat them"] },
  };
  const WHY_IDEAS = ["keep up with my grandkids", "feel better in my clothes", "stay independent", "sleep better"];
  const SECTION_WORD = { "Legs & Hips": "legs", Chest: "chest", Back: "back", Arms: "arms", Shoulders: "shoulders", Core: "core" };
  const SNOOZE_KEY = "maxfitGoalSnoozed";
  const MUSCLE_MAP_SRC = "muscle-map.js?v=20261013b";

  let slug = "";
  let mount = null;
  let sheet = null;
  let today = "";
  let sets = [];
  let fuel = null;
  let goal = null;
  let ready = false;
  let toBuy = 0; // shopping list items not yet ticked (Gold and Diamond only)

  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
  const chevron = '<svg class="week-tile__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------

  /** "2026-9-9" or "2026-09-09 ..." -> "2026-09-09". */
  function ymd(raw) {
    const p = String(raw || "").slice(0, 10).split("-").map(Number);
    if (p.length !== 3 || !p[0]) return "";
    return `${p[0]}-${String(p[1]).padStart(2, "0")}-${String(p[2]).padStart(2, "0")}`;
  }

  async function loadSets() {
    const { rows, col } = await fetchLoggedSets();
    sets = rows
      .filter((r) => String(r[col.client] || "").trim().toLowerCase() === slug)
      .map((r) => ({ date: ymd(r[col.date]), exercise: String(r[col.exercise] || "").trim(), kg: Number(r[col.weight]) || 0, reps: Number(r[col.reps]) || 0 }))
      .filter((s) => s.date && s.exercise);
  }

  async function loadGoal() {
    if (typeof MacroApi === "undefined" || !MacroApi.configured()) return;
    const data = await MacroApi.call("goal", { id: slug });
    goal = data.goal || null;
    fuel = data.fuel || null;
    toBuy = Number(data.shoppingToBuy) || 0;
    shareToBuy();
    if (data.today) today = data.today;
  }

  /** Fuel's Shopping tile (macros.js) shows the same count, so it doesn't ask the server again. */
  function shareToBuy() {
    document.dispatchEvent(new CustomEvent("maxfit:tobuy", { detail: toBuy }));
  }

  function progressData() {
    return { sets, weights: fuel ? fuel.weights : [], kcal: fuel ? fuel.kcal : null, greenWeeks: fuel ? fuel.greenWeeks : [] };
  }

  function activeGoal() {
    return goal && !goal.locked && goal.end_date >= today ? goal : null;
  }

  // ---------------------------------------------------------------------------
  // Tiles
  // ---------------------------------------------------------------------------

  function lastMonday() {
    return MacroCore.addDays(MacroCore.mondayOf(today), -7);
  }

  function paint() {
    if (!mount) return;
    let html = "";
    const r = MacroCore.weekRecap(sets, lastMonday());
    if (r.sets) {
      const cmp = MacroCore.weightComparison(r.totalKg);
      const sub = [cmp ? cmp.text.charAt(0).toUpperCase() + cmp.text.slice(1) : plural(r.workouts, "workout")];
      if (r.bests.length) sub.push(plural(r.bests.length, "new best"));
      html +=
        `<button class="week-tile" type="button" data-open="recap"><span class="week-tile__emoji" aria-hidden="true">${cmp ? cmp.emoji : "💪"}</span>` +
        `<span class="week-tile__text"><span class="week-tile__label">Last week · ${esc(weekRange(r))}</span>` +
        `<span class="week-tile__big">${MacroCore.thousands(r.totalKg)} kg moved</span>` +
        `<span class="week-tile__sub">${esc(sub.join(" · "))}</span></span>${chevron}</button>`;
    }
    const g = activeGoal();
    if (g) {
      const p = MacroCore.goalProgress(g, progressData(), today);
      html +=
        `<button class="week-tile week-tile--goal" type="button" data-open="goal"><span class="week-tile__emoji" aria-hidden="true">${p.status === "done" ? "🏆" : "🎯"}</span>` +
        `<span class="week-tile__text"><span class="week-tile__label">Your goal · until ${esc(MacroCore.shortDate(g.end_date))}</span>` +
        `<span class="week-tile__big week-tile__big--goal">${esc(MacroCore.goalTitle(g))}</span>` +
        `<span class="week-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.pct}"><span style="width:${p.pct}%"></span></span>` +
        `<span class="week-tile__sub">${esc(p.statusText)}</span></span>${chevron}</button>`;
    } else if (goal && goal.locked) {
      html +=
        '<div class="week-tile week-tile--quiet"><span class="week-tile__emoji" aria-hidden="true">🎯</span><span class="week-tile__text">' +
        '<span class="week-tile__label">Your goal</span><span class="week-tile__sub">Your goal uses Fuel. Open your card from the personal link Max sent you to see it.</span></span></div>';
    } else if (ready) {
      const last = goal ? MacroCore.goalProgress(goal, progressData(), today) : null;
      html +=
        `<button class="week-tile week-tile--goal" type="button" data-open="setup"><span class="week-tile__emoji" aria-hidden="true">🎯</span>` +
        `<span class="week-tile__text"><span class="week-tile__label">${goal ? "New month" : "Your goal"}</span>` +
        `<span class="week-tile__big week-tile__big--goal">Set this month's goal</span>` +
        `<span class="week-tile__sub">${esc(last ? `Last month: ${last.statusText.replace(/^[^:]+: /, "")}` : "Pick one thing to work on. It takes a minute.")}</span></span>${chevron}</button>`;
    }
    if (toBuy > 0 && typeof MealPlan !== "undefined") {
      html +=
        `<button class="week-tile" type="button" data-open="shopping"><span class="week-tile__emoji" aria-hidden="true">🛒</span>` +
        `<span class="week-tile__text"><span class="week-tile__label">Shopping list</span>` +
        `<span class="week-tile__big week-tile__big--goal">${plural(toBuy, "thing")} to buy</span>` +
        `<span class="week-tile__sub">Tap to tick things off in the shop</span></span>${chevron}</button>`;
    }
    mount.innerHTML = html;
  }

  function weekRange(r) {
    const a = r.weekStart.split("-").map(Number);
    const b = r.weekEnd.split("-").map(Number);
    const mon = (ymdStr) => MacroCore.shortDate(ymdStr).split(" ")[1];
    return a[1] === b[1] ? `${a[2]}–${b[2]} ${mon(r.weekEnd)}` : `${a[2]} ${mon(r.weekStart)} – ${b[2]} ${mon(r.weekEnd)}`;
  }

  // ---------------------------------------------------------------------------
  // Full-screen sheet
  // ---------------------------------------------------------------------------

  function openSheet(title, body, onClose) {
    if (!sheet) {
      sheet = document.createElement("div");
      sheet.className = "week-sheet";
      sheet.setAttribute("role", "dialog");
      sheet.setAttribute("aria-modal", "true");
      document.body.appendChild(sheet);
    }
    sheet.innerHTML =
      `<div class="week-sheet__bar"><h2 class="week-sheet__title">${esc(title)}</h2><button class="week-sheet__close" type="button" data-close aria-label="Close">✕</button></div>` +
      `<div class="week-sheet__body">${body}</div>`;
    sheet.hidden = false;
    sheet.scrollTop = 0;
    document.body.classList.add("week-sheet-open");
    sheet.onclose = onClose || null;
    sheet.querySelector("[data-close]").addEventListener("click", closeSheet);
    return sheet.querySelector(".week-sheet__body");
  }

  function closeSheet() {
    if (!sheet) return;
    sheet.hidden = true;
    document.body.classList.remove("week-sheet-open");
    if (sheet.onclose) sheet.onclose();
  }

  // ---------------------------------------------------------------------------
  // The week
  // ---------------------------------------------------------------------------

  function openRecap() {
    const r = MacroCore.weekRecap(sets, lastMonday());
    const cmp = MacroCore.weightComparison(r.totalKg);
    const up = r.prevKg > 0 && r.totalKg > r.prevKg ? Math.round((r.totalKg / r.prevKg - 1) * 100) : 0;
    const g = activeGoal();
    const tipIndex = (((Math.round(MacroCore.daysBetween(TIP_START, r.weekStart) / 7) % TIPS.length) + TIPS.length) % TIPS.length);
    const green = fuel && fuel.greenWeeks ? fuel.greenWeeks.find((w) => w.weekStart === r.weekStart) : null;

    let html =
      `<p class="week-dates">${esc(MacroCore.longDate(r.weekStart))} to ${esc(MacroCore.longDate(r.weekEnd))}</p>` +
      `<div class="week-card week-hero">${cmp ? `<div class="week-hero__emoji" aria-hidden="true">${cmp.emoji}</div>` : ""}` +
      `<div class="week-hero__num">${MacroCore.thousands(r.totalKg)}<small>kg</small></div><div class="week-hero__label">moved last week</div>` +
      (cmp ? `<div class="week-hero__fact">That's ${esc(cmp.text)}.</div>` : "") +
      (up ? `<span class="week-chip">▲ ${up}% more than the week before</span>` : "") +
      "</div>";
    if (g) {
      const p = MacroCore.goalProgress(g, progressData(), today);
      html +=
        `<button class="week-card week-card--button" type="button" data-open="goal"><h3 class="week-h">🎯 Your goal</h3>` +
        `<p class="week-text">${esc(MacroCore.goalTitle(g))} by ${esc(MacroCore.shortDate(g.end_date))}</p>` +
        `<span class="week-bar"><span style="width:${p.pct}%"></span></span><span class="week-chip">${esc(p.statusText)}</span>` +
        `<p class="week-note"><b>To get there quicker:</b> ${esc(p.quicker[0])}</p></button>`;
    }
    html += '<div class="week-card"><h3 class="week-h">💪 Where it went</h3><div data-sections><p class="week-note">Adding it up…</p></div></div>';
    if (r.bests.length) {
      html +=
        '<div class="week-card"><h3 class="week-h">🏆 New personal bests</h3>' +
        r.bests
          .slice(0, 3)
          .map((b) => `<div class="week-pb"><span class="week-pb__name">${esc(b.exercise)}</span><span class="week-pb__val">${esc(b.kg)} kg × ${esc(b.reps)}</span></div>`)
          .join("") +
        (r.bests.length > 3 ? `<p class="week-note">And ${r.bests.length - 3} more. Nice work.</p>` : '<p class="week-note">Nice work.</p>') +
        "</div>";
    }
    html +=
      `<div class="week-card"><h3 class="week-h">✅ You showed up</h3><div class="week-stats${green ? "" : " week-stats--two"}">` +
      `<div><div class="week-stat__num">${r.workouts}</div><div class="week-stat__label">${r.workouts === 1 ? "workout" : "workouts"}</div></div>` +
      `<div><div class="week-stat__num">${r.sets}</div><div class="week-stat__label">sets</div></div>` +
      (green ? `<div><div class="week-stat__num">${green.greenDays}</div><div class="week-stat__label">green ${green.greenDays === 1 ? "day" : "days"}</div></div>` : "") +
      "</div></div>" +
      `<div class="week-card"><h3 class="week-h">💡 Tip of the week</h3><p class="week-text">${esc(TIPS[tipIndex])}</p></div>`;

    const body = openSheet("Your week", html);
    body.querySelectorAll("[data-open='goal']").forEach((b) => b.addEventListener("click", openGoal));
    fillSections(body.querySelector("[data-sections]"), r, cmp);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (typeof buildExerciseIndex_ === "function") return resolve();
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  /** Where the week's kilos went, by body area. Each set's kilos are shared across the areas its main muscles are in. */
  async function fillSections(box, r, cmp) {
    try {
      await loadScript(MUSCLE_MAP_SRC);
      const { rows, col } = await fetchExercises();
      const index = buildExerciseIndex_(rows, col);
      const by = {};
      sets
        .filter((s) => s.date >= r.weekStart && s.date <= r.weekEnd && s.kg * s.reps > 0)
        .forEach((s) => {
          const m = resolveExerciseMuscles_(s.exercise, index);
          const keys = m.primary.length ? m.primary : m.secondary;
          const areas = [...new Set(keys.map(muscleUiGroupOf_))];
          const list = areas.length ? areas : ["Other"];
          list.forEach((a) => (by[a] = (by[a] || 0) + (s.kg * s.reps) / list.length));
        });
      const rowsOut = Object.entries(by).sort((a, b) => b[1] - a[1]);
      if (!rowsOut.length) {
        box.innerHTML = '<p class="week-note">Nothing with weights last week.</p>';
        return;
      }
      const max = rowsOut[0][1];
      const top = rowsOut[0];
      const topCmp = SECTION_WORD[top[0]] ? MacroCore.weightComparison(top[1], cmp ? cmp.one : "") : null;
      box.innerHTML =
        rowsOut
          .map(([area, kg]) => `<div class="week-row"><span class="week-row__name">${esc(area)}</span><span class="week-row__track"><span style="width:${Math.max(3, (kg / max) * 100)}%"></span></span><span class="week-row__num">${MacroCore.thousands(kg)} kg</span></div>`)
          .join("") +
        (topCmp && rowsOut.length > 1 ? `<p class="week-note">Your ${SECTION_WORD[top[0]]} alone moved ${esc(topCmp.text)} ${topCmp.emoji}</p>` : "");
    } catch (err) {
      box.innerHTML = '<p class="week-note">Couldn\'t add this up right now.</p>';
    }
  }

  // ---------------------------------------------------------------------------
  // The goal: progress
  // ---------------------------------------------------------------------------

  function openGoal() {
    const g = activeGoal() || goal;
    if (!g || g.locked) return;
    const p = MacroCore.goalProgress(g, progressData(), today);
    const html =
      `<div class="week-card"><p class="week-sentence">${esc(MacroCore.goalSentence(g))}</p>` +
      `<span class="week-bar week-bar--big"><span style="width:${p.pct}%"></span></span>` +
      `<div class="week-goal-row"><span>${esc(p.startLabel)}</span><b>${esc(p.startValue)}</b></div>` +
      `<div class="week-goal-row"><span>${esc(p.nowLabel)}</span><b>${esc(p.nowValue)}</b></div>` +
      `<span class="week-chip">${esc(p.statusText)}</span>` +
      (p.ended ? "" : `<p class="week-note">${plural(p.daysLeft, "day")} to go.</p>`) +
      "</div>" +
      `<div class="week-card"><h3 class="week-h">⚡ Get there quicker</h3><ul class="week-list">${p.quicker.map((q) => `<li>${esc(q)}</li>`).join("")}</ul></div>` +
      `<div class="week-card"><h3 class="week-h">➡️ ${p.status === "done" || p.ended ? "Next goal" : "When you get there"}</h3><p class="week-text">${esc(p.next)}</p></div>` +
      `<button class="week-btn" type="button" data-change>${p.ended ? "Set next month's goal" : "Change my goal"}</button>`;
    const body = openSheet("Your goal", html);
    body.querySelector("[data-change]").addEventListener("click", () => openSetup(p.ended ? null : g));
  }

  // ---------------------------------------------------------------------------
  // The goal: setting it, one question at a time
  // ---------------------------------------------------------------------------

  /** Their most-done weighted lifts over the last 8 weeks, each with its best set. */
  function recentLifts() {
    const since = MacroCore.addDays(today, -56);
    const by = {};
    sets.forEach((s) => {
      if (s.date < since || !(s.kg > 0) || !(s.reps > 0)) return;
      const k = MacroCore.liftKey(s.exercise);
      const e = MacroCore.estOneRepMax(s.kg, s.reps);
      const cur = (by[k] = by[k] || { days: new Set(), best: null, bestE: 0 });
      cur.days.add(s.date);
      if (e > cur.bestE) Object.assign(cur, { best: s, bestE: e });
    });
    return Object.values(by)
      .sort((a, b) => b.days.size - a.days.size || b.bestE - a.bestE)
      .slice(0, 6)
      .map((l) => ({ exercise: l.best.exercise, kg: l.best.kg, reps: l.best.reps }));
  }

  function latestWeight() {
    const w = fuel && fuel.weights && fuel.weights.length ? fuel.weights[fuel.weights.length - 1] : null;
    return w ? Number(w.kg) : 0;
  }

  function avgPerWeek(type) {
    if (type === "sessions") {
      const since = MacroCore.addDays(MacroCore.mondayOf(today), -28);
      return new Set(sets.filter((s) => s.date >= since && s.date < MacroCore.mondayOf(today)).map((s) => s.date)).size / 4;
    }
    const full = (fuel && fuel.greenWeeks ? fuel.greenWeeks : []).filter((w) => w.weekStart < MacroCore.mondayOf(today)).slice(-2);
    return full.length ? full.reduce((t, w) => t + w.greenDays, 0) / full.length : 0;
  }

  /** `editing`: the goal being changed (keeps its month), or null for a new month. `auto`: opened by itself. */
  function openSetup(editing, auto) {
    const types = Object.keys(TYPES).filter((t) => {
      if (t === "weight" || t === "green") return !!fuel;
      if (t === "strength") return recentLifts().length > 0;
      return true;
    });
    const draft = editing
      ? { type: editing.type, exercise: editing.exercise, target: editing.target, target_reps: editing.target_reps, start_value: editing.start_value, start_reps: editing.start_reps, how: editing.how.slice(), why: editing.why }
      : { type: "", how: [], why: "" };
    const endDate = editing ? editing.end_date : MacroCore.goalEndDate(today);
    let step = 0;
    let saving = false;
    let saved = false;
    let error = "";

    const steps = () => ["type"].concat(draft.type === "strength" ? ["lift"] : [], ["amount", "how", "why", "confirm"]);

    function optionsFor() {
      const lift = draft.type === "strength" ? { exercise: draft.exercise, kg: draft.start_value, reps: draft.start_reps } : null;
      return MacroCore.goalOptions(draft.type, { weightKg: latestWeight(), lift, sessionsPerWeek: avgPerWeek("sessions"), greenPerWeek: avgPerWeek("green") });
    }

    function render() {
      const list = steps();
      const name = list[step];
      const t = TYPES[draft.type];
      let html = `<div class="week-steps">${list.map((_, i) => `<span class="${i <= step ? "on" : ""}"></span>`).join("")}</div>`;
      let canNext = true;
      if (name === "type") {
        html +=
          `<p class="week-q">${goal && !editing ? "New month! What do you want to work on?" : "What do you want to work on this month?"}</p>` +
          '<p class="week-help">Pick one. You can change it any time.</p>' +
          types.map((k) => `<button class="week-opt${draft.type === k ? " is-on" : ""}" type="button" data-type="${k}"><span class="week-opt__emoji" aria-hidden="true">${TYPES[k].emoji}</span><span class="week-opt__text"><span class="week-opt__main">${TYPES[k].name}</span><span class="week-opt__sub">${TYPES[k].sub}</span></span></button>`).join("");
        canNext = !!draft.type;
      } else if (name === "lift") {
        html +=
          '<p class="week-q">Which lift?</p><p class="week-help">These are the ones you do most.</p>' +
          recentLifts()
            .map((l) => `<button class="week-opt${MacroCore.liftKey(draft.exercise) === MacroCore.liftKey(l.exercise) ? " is-on" : ""}" type="button" data-lift="${esc(JSON.stringify(l))}"><span class="week-opt__text"><span class="week-opt__main">${esc(l.exercise)}</span><span class="week-opt__sub">Your best lately: ${esc(l.kg)} kg × ${esc(l.reps)}</span></span></button>`)
            .join("");
        canNext = !!draft.exercise;
      } else if (name === "amount") {
        html += `<p class="week-q">${esc(t.q)}</p>`;
        if (draft.type === "weight" && !latestWeight()) {
          html +=
            '<p class="week-help">First, what do you weigh today? It\'s your starting point.</p>' +
            '<input class="week-input" type="number" inputmode="decimal" step="0.1" min="30" max="300" placeholder="Your weight in kg" data-weigh />' +
            '<button class="week-btn week-btn--ghost" type="button" data-saveweigh>Save my weight</button>';
          canNext = false;
        } else {
          const avg = avgPerWeek(draft.type);
          const help = {
            weight: `You're ${latestWeight()} kg. A safe, steady pace is about half a kilo a week.`,
            strength: `Your best ${draft.exercise} lately is ${draft.start_value} kg × ${draft.start_reps}.`,
            sessions: `You've averaged ${Math.round(avg * 10) / 10} a week over the last 4 weeks.`,
            green: `A green day is enough protein, with calories on target. You've averaged ${Math.round(avg * 10) / 10} a week.`,
          }[draft.type];
          html +=
            `<p class="week-help">${esc(help)}</p>` +
            optionsFor()
              .map((o) => `<button class="week-opt${Number(draft.target) === o.target ? " is-on" : ""}" type="button" data-target="${o.target}" data-reps="${o.reps || ""}"><span class="week-opt__text"><span class="week-opt__main">${esc(o.label)}</span></span><span class="week-opt__tag">${esc(o.tag)}</span></button>`)
              .join("");
          canNext = Number(draft.target) > 0;
        }
      } else if (name === "how") {
        html +=
          '<p class="week-q">How will you get there?</p><p class="week-help">Pick one or two things you\'ll do each week.</p>' +
          t.how.map((h) => `<button class="week-opt${draft.how.includes(h) ? " is-on" : ""}" type="button" data-how="${esc(h)}"><span class="week-opt__text"><span class="week-opt__main">${esc(h)}</span></span></button>`).join("");
        canNext = draft.how.length > 0;
      } else if (name === "why") {
        html +=
          '<p class="week-q">Why does it matter to you?</p><p class="week-help">Optional, but it helps on the hard days.</p>' +
          `<input class="week-input" type="text" maxlength="120" placeholder="So I can…" value="${esc(draft.why)}" data-why />` +
          `<div class="week-chips">${WHY_IDEAS.map((w) => `<button class="week-chip-btn" type="button" data-whyidea="${esc(w)}">${esc(w)}</button>`).join("")}</div>`;
      } else {
        html +=
          '<p class="week-q">Your goal</p>' +
          `<div class="week-card"><p class="week-sentence">${esc(MacroCore.goalSentence(Object.assign({}, draft, { end_date: endDate })))}</p></div>` +
          '<p class="week-help">Max can see your goal too, so he can help.</p>';
      }
      if (error) html += `<p class="week-error">${esc(error)}</p>`;
      const last = name === "confirm";
      html +=
        `<button class="week-btn" type="button" data-next${canNext && !saving ? "" : " disabled"}>${saving ? "Saving…" : last ? "Save my goal" : "Next"}</button>` +
        (step ? '<button class="week-link" type="button" data-back>Back</button>' : auto ? '<button class="week-link" type="button" data-close>Not now</button>' : "");
      const body = openSheet(editing ? "Change my goal" : "This month's goal", html, () => {
        if (auto && !saved) snooze();
      });
      wire(body);
    }

    function wire(body) {
      body.addEventListener("click", async (e) => {
        const b = e.target.closest("button");
        if (!b || b.disabled) return;
        error = "";
        if (b.dataset.type) {
          if (draft.type !== b.dataset.type) Object.assign(draft, { type: b.dataset.type, exercise: "", target: 0, target_reps: 0, start_value: 0, start_reps: 0, how: [] });
        } else if (b.dataset.lift) {
          const l = JSON.parse(b.dataset.lift);
          Object.assign(draft, { exercise: l.exercise, start_value: l.kg, start_reps: l.reps, target: 0, target_reps: 0 });
        } else if (b.dataset.target) {
          draft.target = Number(b.dataset.target);
          draft.target_reps = Number(b.dataset.reps) || 0;
          if (draft.type === "weight") draft.start_value = latestWeight();
        } else if (b.dataset.how) {
          const i = draft.how.indexOf(b.dataset.how);
          if (i >= 0) draft.how.splice(i, 1);
          else if (draft.how.length < 2) draft.how.push(b.dataset.how);
        } else if (b.dataset.whyidea) {
          draft.why = b.dataset.whyidea;
        } else if (b.dataset.saveweigh !== undefined) {
          const kg = Number(body.querySelector("[data-weigh]").value);
          b.disabled = true;
          try {
            await MacroApi.call("logWeight", { kg });
            fuel.weights.push({ date: today, kg: Math.round(kg * 10) / 10 });
          } catch (err) {
            error = err.message || "Couldn't save that. Try again.";
          }
        } else if (b.dataset.back !== undefined) {
          step--;
        } else if (b.dataset.next !== undefined) {
          if (step < steps().length - 1) {
            step++;
          } else {
            saving = true;
            render();
            try {
              const res = await MacroApi.call("saveGoal", { id: slug, goal: draft });
              goal = res.goal;
              saving = false;
              saved = true;
              closeSheet();
              paint();
              return;
            } catch (err) {
              saving = false;
              error = err.message || "Couldn't save your goal. Try again.";
            }
          }
        } else {
          return;
        }
        render();
      });
      const why = body.querySelector("[data-why]");
      if (why) why.addEventListener("input", () => (draft.why = why.value));
    }

    render();
  }

  // ---------------------------------------------------------------------------
  // Asking by itself
  // ---------------------------------------------------------------------------

  function snooze() {
    try {
      localStorage.setItem(SNOOZE_KEY, today);
    } catch (err) {
      // Asks again next time, which is fine.
    }
  }

  function snoozedToday() {
    try {
      return localStorage.getItem(SNOOZE_KEY) === today;
    } catch (err) {
      return false;
    }
  }

  /** First open, or their month just ended: ask (once a day at most). */
  function maybePrompt() {
    if (!ready || activeGoal() || (goal && goal.locked) || snoozedToday()) return;
    if (document.querySelector(".week-sheet:not([hidden]), .fuel-sheet:not([hidden])")) return;
    openSetup(null, true);
  }

  // ---------------------------------------------------------------------------

  /** Called by app.js once a real member's card is on screen. */
  async function init(clientSlug) {
    const grid = document.querySelector("#panelCard .card__grid");
    if (!grid || !clientSlug) return;
    slug = String(clientSlug).toLowerCase();
    today = MacroCore.sydneyDate();
    if (!mount) {
      mount = document.createElement("div");
      mount.className = "week-tiles";
      grid.parentNode.insertBefore(mount, grid);
      mount.addEventListener("click", (e) => {
        const b = e.target.closest("[data-open]");
        if (!b) return;
        if (b.dataset.open === "recap") openRecap();
        else if (b.dataset.open === "goal") openGoal();
        else if (b.dataset.open === "shopping") {
          MealPlan.openList({
            onChange: (n) => {
              toBuy = n;
              shareToBuy();
              paint();
            },
          });
        }
        else openSetup(null);
      });
    }
    const results = await Promise.allSettled([loadSets(), loadGoal()]);
    // Goals need the backend; without it the card just shows the recap.
    ready = results[1].status === "fulfilled" && typeof MacroApi !== "undefined" && MacroApi.configured();
    paint();
    maybePrompt();
  }

  return { init };
})();
