/*
 * Mix it up (2026-11-09): a surprise HIIT session (boxing or bootcamp) a client
 * starts from the Train tab's "LOG SOMETHING ELSE" when they feel like training
 * but not their usual program. Max's workouts live in the "Mix It Up" tab of
 * the CRM sheet (one row per exercise); this file reads them, shuffles one
 * (style / level / where filters, never one of the last 2 started), randomises
 * the picks inside it, plays it block by block and saves it like any other
 * session.
 *
 * Loaded after card/sheet.js and before workout/app.js on workout/index.html,
 * and reuses app.js's own helpers at call time (draft storage, postSession via
 * saveSimpleSession_, the shared else-overlay, the review screen's tiles and
 * muscle figure, wake lock, the combo words and the audio unlock). Nothing here
 * touches assigned workouts, supersets, boxing blocks, runs or custom workouts.
 *
 * Sections: pure logic (parse / filter / pick / instantiate / compile, exposed
 * as window.MixItUp for the tests), then the screens (setup, reveal, player,
 * review).
 */
(function () {
  "use strict";

  // ===========================================================================
  // Pure logic
  // ===========================================================================

  const COMBO_POOL = ["1-2", "1-2-3", "1-1-2", "2-3-2", "1-2-3-2", "1-2, slip, 2", "3-4", "5-6", "1-6-3-2", "1-2, roll, 3-2"];
  const BETWEEN_BLOCKS_SECONDS = 60;
  const LEVELS = ["Gentle", "Steady", "Push"];
  const STYLES = ["Boxing", "Bootcamp", "Surprise me"];
  const WHERES = ["At the gym", "At home (no equipment)"];

  const num = (v) => {
    const n = Number(String(v == null ? "" : v).trim());
    return Number.isFinite(n) ? n : NaN;
  };
  const cell = (r, i) => (i >= 0 ? String(r[i] == null ? "" : r[i]).trim() : "");
  const splitOptions = (text) => String(text || "").split(" / ").map((t) => t.trim()).filter(Boolean);

  /** The sheet's rows -> [{ name, style, equipment, minutes, blocks: [...] }], skipping rows (or whole workouts) switched off with On = N. */
  function parseWorkouts(rows, col) {
    const byName = new Map();
    rows.forEach((r) => {
      const name = cell(r, col.workout);
      const exercise = cell(r, col.exercise);
      if (!name || !exercise) return;
      if (col.on >= 0 && cell(r, col.on).toUpperCase() === "N") return;
      if (!byName.has(name)) {
        byName.set(name, { name, style: "", equipment: "", minutes: NaN, blocksByOrder: new Map() });
      }
      const w = byName.get(name);
      if (!w.style) w.style = cell(r, col.style);
      if (!w.equipment) w.equipment = cell(r, col.equipment);
      if (!Number.isFinite(w.minutes)) w.minutes = num(cell(r, col.minutes));
      const order = num(cell(r, col.blockOrder));
      const orderKey = Number.isFinite(order) ? order : 999;
      if (!w.blocksByOrder.has(orderKey)) {
        w.blocksByOrder.set(orderKey, {
          order: orderKey, type: cell(r, col.blockType), name: cell(r, col.blockName) || cell(r, col.blockType),
          rounds: NaN, work: NaN, rest: NaN, between: NaN, minutes: NaN, combos: [], moves: [],
        });
      }
      const b = w.blocksByOrder.get(orderKey);
      // Block settings can sit on any row of the block (Max may only fill in the first); the first value found wins.
      if (!Number.isFinite(b.rounds)) b.rounds = num(cell(r, col.rounds));
      if (!Number.isFinite(b.work)) b.work = num(cell(r, col.workSeconds));
      if (!Number.isFinite(b.rest)) b.rest = num(cell(r, col.restSeconds));
      if (!Number.isFinite(b.between)) b.between = num(cell(r, col.restBetween));
      if (!Number.isFinite(b.minutes)) b.minutes = num(cell(r, col.blockMinutes));
      const combos = cell(r, col.combos);
      if (combos && !b.combos.length) b.combos = combos.split("|").map((c) => c.trim()).filter(Boolean);
      const reps = splitOptions(cell(r, col.reps));
      b.moves.push({
        order: num(cell(r, col.exerciseOrder)), options: splitOptions(exercise), easier: cell(r, col.easier), reps,
      });
    });
    const out = [];
    byName.forEach((w) => {
      const blocks = Array.from(w.blocksByOrder.values()).sort((a, b) => a.order - b.order);
      blocks.forEach((b) => b.moves.sort((x, y) => (Number.isFinite(x.order) ? x.order : 999) - (Number.isFinite(y.order) ? y.order : 999)));
      if (!blocks.length) return;
      out.push({ name: w.name, style: w.style, equipment: w.equipment, minutes: w.minutes, blocks });
    });
    return out;
  }

  /** Style chip (Boxing / Bootcamp / Surprise me) and Where chip (the gym offers everything; home only workouts whose Equipment is None). */
  function filterWorkouts(all, style, where) {
    return all.filter((w) => {
      if (style === "Boxing" || style === "Bootcamp") {
        if (w.style.toLowerCase() !== style.toLowerCase()) return false;
      }
      if (where && where.indexOf("home") >= 0) {
        if (w.equipment.trim().toLowerCase() !== "none") return false;
      }
      return true;
    });
  }

  /** A random workout from the filtered list, never one of `avoid` (the last two started, plus the one on screen) while there's another choice. */
  function pickWorkout(list, avoid, rng) {
    if (!list.length) return null;
    const avoidSet = new Set((avoid || []).map((n) => String(n).toLowerCase()));
    let pool = list.filter((w) => !avoidSet.has(w.name.toLowerCase()));
    if (!pool.length) {
      // Nothing else matches: fall back to only avoiding the one on screen (the last entry), then to anything.
      const justShown = avoid && avoid.length ? String(avoid[avoid.length - 1]).toLowerCase() : "";
      pool = list.filter((w) => w.name.toLowerCase() !== justShown);
      if (!pool.length) pool = list;
    }
    return pool[Math.floor((rng || Math.random)() * pool.length)];
  }

  const pickOne = (arr, rng) => arr[Math.floor((rng || Math.random)() * arr.length)];

  /** A random combo for each round (never the same one twice running), the last round always Freestyle. */
  function randomCombos(rounds, rng) {
    const out = [];
    for (let r = 1; r <= rounds; r++) {
      if (r === rounds) { out.push("Freestyle"); continue; }
      let c = pickOne(COMBO_POOL, rng);
      for (let tries = 0; tries < 5 && c === out[out.length - 1]; tries++) c = pickOne(COMBO_POOL, rng);
      out.push(c);
    }
    return out;
  }

  function comboForRound(combos, round) {
    if (!combos || !combos.length) return "Freestyle";
    return combos[Math.min(round, combos.length) - 1];
  }

  /**
   * One shuffle of a template at a level: picks "A / B / C" options, applies
   * Gentle / Steady / Push to rounds, rest and minutes, and rolls the boxing
   * combos. Returns a fresh plan (the template is never changed).
   */
  function instantiate(workout, level, rng) {
    const gentle = level === "Gentle";
    const push = level === "Push";
    const blocks = workout.blocks.map((tb) => {
      const isRounds = tb.type === "Rounds";
      const isIntervals = tb.type === "Intervals";
      const isTimed = tb.type === "EMOM" || tb.type === "AMRAP";
      const b = {
        type: tb.type, name: tb.name,
        rounds: Number.isFinite(tb.rounds) ? tb.rounds : 1,
        work: Number.isFinite(tb.work) ? tb.work : 45,
        rest: Number.isFinite(tb.rest) ? tb.rest : 0,
        between: Number.isFinite(tb.between) ? tb.between : NaN,
        minutes: Number.isFinite(tb.minutes) ? tb.minutes : 0,
        combos: [],
      };
      if (isIntervals || isRounds) {
        if (gentle) {
          b.rounds = Math.max(1, b.rounds - 1);
          b.rest += 15;
          if (Number.isFinite(b.between)) b.between += 15;
        } else if (push) {
          b.rounds += 1;
          b.rest = Math.max(10, b.rest - 10);
          if (Number.isFinite(b.between)) b.between = Math.max(10, b.between - 10);
        }
      }
      if (isTimed && gentle) b.minutes = Math.max(1, Math.round(b.minutes * 0.8));
      if (isRounds) b.combos = tb.combos.length ? tb.combos.slice() : randomCombos(b.rounds, rng);
      b.moves = tb.moves.map((tm) => {
        const idx = Math.floor((rng || Math.random)() * tm.options.length);
        const name = tm.options[idx];
        // Reps can be one value for all options, or one per option ("200 m / 30s").
        const reps = tm.reps.length === tm.options.length ? tm.reps[idx] : tm.reps[0] || "";
        const hasEasier = !!tm.easier && !isRounds;
        return { name, easier: tm.easier || "", reps, easierOn: gentle && hasEasier };
      });
      return b;
    });
    return { name: workout.name, style: workout.style, equipment: workout.equipment, minutes: workout.minutes, level: level || "Steady", blocks };
  }

  const moveName = (m) => (m.easierOn && m.easier ? m.easier : m.name);

  /** "10 Goblet squats", "200 m Rowing Machine", "20s Plank"; anything else is "Name · reps". */
  function moveLabel(m) {
    const name = moveName(m);
    const reps = String(m.reps || "").trim();
    if (!reps) return name;
    if (/^\d+\s*(m|s|sec|secs)?$/i.test(reps)) return `${reps} ${name}`;
    return `${name} · ${reps}`;
  }

  const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  /** One short line per block for the reveal card. */
  function describeBlock(b) {
    const names = b.moves.map((m) => moveName(m));
    const shown = names.length > 3 ? names.slice(0, 3).join(", ") + ` +${names.length - 3} more` : names.join(", ");
    switch (b.type) {
      case "Warm-up":
      case "Cool-down":
        return `${b.name} · ${plural(b.moves.length, "move")} · about ${Math.max(1, Math.round((b.moves.length * b.work) / 60))} min`;
      case "Rounds":
        return `${b.name} · ${b.rounds} × ${clock(b.work)}`;
      case "EMOM":
        return `${b.name} · ${b.minutes} min · ${shown}`;
      case "AMRAP":
        return `${b.name} · ${b.minutes} min · ${shown}`;
      default:
        return `${b.name} · ${plural(b.rounds, "round")} · ${shown}`;
    }
  }

  /**
   * The whole session as a flat list of timed segments (work, rest, EMOM
   * minutes, the AMRAP), which the one player walks through. A segment that
   * counts carries `log` (the Logged Sets row it becomes when it's finished);
   * warm-up and cool-down carry none. Names are read from the move at the
   * moment they're shown or logged, so "Too much? Use the easier option" can
   * swap them mid-session.
   */
  function compile(plan) {
    const segs = [];
    plan.blocks.forEach((b, bi) => {
      const base = { block: bi, blockType: b.type, blockName: b.name };
      if (b.type === "Warm-up" || b.type === "Cool-down") {
        b.moves.forEach((m, mi) => {
          segs.push(Object.assign({}, base, { kind: "work", move: m, seconds: b.work, sub: `Move ${mi + 1} of ${b.moves.length}`, tag: b.type.toUpperCase() }));
          if (b.rest > 0 && mi < b.moves.length - 1) segs.push(Object.assign({}, base, { kind: "rest", seconds: b.rest, title: "Rest" }));
        });
      } else if (b.type === "Rounds") {
        const m = b.moves[0];
        for (let r = 1; r <= b.rounds; r++) {
          segs.push(Object.assign({}, base, {
            kind: "work", move: m, seconds: b.work, tag: "BOXING", sub: `Round ${r} of ${b.rounds}`, combo: comboForRound(b.combos, r),
            log: { setNumber: r, type: "round", duration: b.work, reps: 0 },
          }));
          if (r < b.rounds && b.rest > 0) segs.push(Object.assign({}, base, { kind: "rest", seconds: b.rest, title: "Rest", sub: `Round ${r + 1} of ${b.rounds} next` }));
        }
      } else if (b.type === "EMOM") {
        const n = b.moves.length || 1;
        for (let k = 1; k <= b.minutes; k++) {
          const m = b.moves[(k - 1) % n];
          segs.push(Object.assign({}, base, {
            kind: "emom", move: m, seconds: 60, tag: "EMOM", sub: `Minute ${k} of ${b.minutes}`,
            log: { setNumber: Math.floor((k - 1) / n) + 1, type: "interval", duration: 60, reps: parseInt(m.reps, 10) || 0 },
          }));
        }
      } else if (b.type === "AMRAP") {
        segs.push(Object.assign({}, base, { kind: "amrap", moves: b.moves, seconds: b.minutes * 60, tag: "AMRAP", rounds: 0 }));
      } else {
        // Intervals
        for (let r = 1; r <= b.rounds; r++) {
          b.moves.forEach((m, mi) => {
            segs.push(Object.assign({}, base, {
              kind: "work", move: m, seconds: b.work, tag: "WORK", sub: `Round ${r} of ${b.rounds}`,
              log: { setNumber: r, type: "interval", duration: b.work, reps: 0 },
            }));
            const lastMove = mi === b.moves.length - 1;
            const lastOfBlock = lastMove && r === b.rounds;
            if (lastOfBlock) return;
            const gap = lastMove ? (Number.isFinite(b.between) ? b.between : b.rest) : b.rest;
            if (gap > 0) segs.push(Object.assign({}, base, { kind: "rest", seconds: gap, title: lastMove ? "Rest between rounds" : "Rest", sub: lastMove ? `Round ${r + 1} of ${b.rounds} next` : "" }));
          });
        }
      }
      if (bi < plan.blocks.length - 1) {
        const nextName = plan.blocks[bi + 1].name;
        segs.push(Object.assign({}, base, { kind: "rest", between: true, seconds: BETWEEN_BLOCKS_SECONDS, title: `Next up: ${nextName}`, sub: "Take a breather", nextBlock: bi + 1 }));
      }
    });
    segs.forEach((s, i) => { s.index = i; });
    return segs;
  }

  /** The Logged Sets rows for what's been done: one per exercise per interval/EMOM minute/round; one per AMRAP exercise holding the rounds completed. */
  function rowsForSegment(seg, elapsedSeconds) {
    if (seg.kind === "amrap") {
      if (!(seg.rounds > 0)) return [];
      return seg.moves.map((m) => ({ exercise: moveName(m), setNumber: 1, weight: 0, reps: seg.rounds, duration: Math.round(elapsedSeconds), type: "amrap" }));
    }
    if (!seg.log) return [];
    return [{ exercise: moveName(seg.move), setNumber: seg.log.setNumber, weight: 0, reps: seg.log.reps, duration: seg.log.duration, type: seg.log.type }];
  }

  window.MixItUp = {
    COMBO_POOL, LEVELS, STYLES, WHERES, parseWorkouts, filterWorkouts, pickWorkout, randomCombos, instantiate,
    describeBlock, compile, rowsForSegment, moveName, moveLabel, clock,
  };

  // ===========================================================================
  // Screens
  // ===========================================================================

  const h = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  };
  const btn = (cls, text, onClick) => {
    const b = h("button", cls, text);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  };

  function store(key) {
    return {
      get() { try { return localStorage.getItem(key); } catch (err) { return null; } },
      set(v) { try { localStorage.setItem(key, v); } catch (err) { /* not remembered this time */ } },
    };
  }
  const memberKey = (what, shared) => `maxfitMix${what}|${shared.clientSlug}`;
  const levelStore = (shared) => store(memberKey("Level", shared));
  const noteStore = (shared) => store(memberKey("Note", shared));
  const historyStore = (shared) => store(memberKey("History", shared));
  const readHistory = (shared) => { try { return JSON.parse(historyStore(shared).get() || "[]").filter((x) => typeof x === "string"); } catch (err) { return []; } };
  const pushHistory = (shared, name) => historyStore(shared).set(JSON.stringify([name].concat(readHistory(shared).filter((n) => n !== name)).slice(0, 2)));

  let allWorkouts = null; // parsed once per page
  async function loadWorkouts() {
    if (allWorkouts) return allWorkouts;
    const { rows, col } = await fetchMixItUp();
    allWorkouts = parseWorkouts(rows, col);
    return allWorkouts;
  }

  const firstName = () => (typeof elseFirstName_ === "function" ? elseFirstName_() : "there");
  const workoutLabel = (name) => `Mix it up: ${name}`;

  // ---- the entry point (called by the Train tab's button) --------------------

  async function open(shared) {
    const first = !noteStore(shared).get();
    if (first) {
      showSafetyNote(shared);
      return;
    }
    openSetup(shared);
  }

  function showSafetyNote(shared) {
    const wrap = h("div", "workout__else-body");
    wrap.appendChild(h("h2", "workout__else-title", "Before you start"));
    wrap.appendChild(h("p", "mix__note", "Go at your own pace. Slow down or stop if you feel dizzy, short of breath or any pain — and check with your GP first if you're new to high-intensity exercise."));
    wrap.appendChild(btn("workout__else-primary-btn", "OK, got it", () => {
      noteStore(shared).set("1");
      openSetup(shared);
    }));
    showElseOverlay_(wrap);
  }

  // ---- setup ---------------------------------------------------------------

  function chipRow(options, current, onPick) {
    const row = h("div", "workout__else-chip-row");
    options.forEach((o) => {
      const c = btn("workout__else-chip" + (o === current ? " is-on" : ""), o, () => {
        row.querySelectorAll(".workout__else-chip").forEach((x) => x.classList.toggle("is-on", x === c));
        onPick(o);
      });
      row.appendChild(c);
    });
    return row;
  }

  /** An unfinished Mix it up from earlier today (the app was closed mid-session): its finished work is still on the phone. */
  function unfinishedDraft(shared) {
    const prefix = `${DRAFT_KEY_PREFIX}${shared.clientSlug}|mix it up:`;
    for (const key of allDraftKeys()) {
      if (!key.startsWith(prefix)) continue;
      const d = readDraft(key);
      if (d && d.pending && d.date === shared.date && Array.isArray(d.sets) && d.sets.length) return { key, draft: d };
    }
    return null;
  }

  function openSetup(shared) {
    const wrap = h("div", "workout__else-body");
    wrap.appendChild(h("h2", "workout__else-title", "Mix it up"));
    wrap.appendChild(h("p", "mix__sub", "A surprise HIIT session. Pick a style and a level, then shuffle."));

    const left = unfinishedDraft(shared);
    if (left) {
      const box = h("div", "mix__resume");
      const n = left.draft.sets.length;
      box.appendChild(h("p", "mix__resume-text", `You have an unfinished session from earlier today: ${left.draft.workoutName.replace(/^Mix it up: /, "")} (${plural(n, "interval")} done).`));
      const msg = h("p", "workout__else-error");
      msg.hidden = true;
      const save = btn("workout__else-secondary-btn", "Save what I did", async () => {
        save.disabled = true;
        const ok = await saveSimpleSession_(shared, left.draft.workoutName, left.draft.sets, left.draft.notes || "");
        if (ok) { box.remove(); } else { save.disabled = false; msg.textContent = "Couldn't reach the server — it's still saved on this phone."; msg.hidden = false; }
      });
      const drop = btn("mix__link", "Throw it away", () => { removeDraft(left.key); box.remove(); });
      box.append(save, drop, msg);
      wrap.appendChild(box);
    }

    const state = { style: "Surprise me", level: levelStore(shared).get(), where: "At the gym" };
    if (LEVELS.indexOf(state.level) < 0) state.level = "Steady";

    wrap.appendChild(elseFieldLabel_("Style"));
    wrap.appendChild(chipRow(STYLES, state.style, (v) => (state.style = v)));
    wrap.appendChild(elseFieldLabel_("Level"));
    wrap.appendChild(chipRow(LEVELS, state.level, (v) => { state.level = v; levelStore(shared).set(v); }));
    wrap.appendChild(elseFieldLabel_("Where"));
    wrap.appendChild(chipRow(WHERES, state.where, (v) => (state.where = v)));

    const msg = h("p", "workout__else-error");
    msg.hidden = true;
    wrap.appendChild(msg);

    const go = btn("workout__else-primary-btn mix__shuffle", "SHUFFLE", async () => {
      msg.hidden = true;
      go.disabled = true;
      go.textContent = "Shuffling…";
      try {
        const all = await loadWorkouts();
        const list = filterWorkouts(all, state.style, state.where);
        if (!all.length) throw new Error("none");
        if (!list.length) {
          msg.textContent = "Nothing matches those choices yet. Try another style or place.";
          msg.hidden = false;
          return;
        }
        reveal(shared, state, list, null);
      } catch (err) {
        msg.textContent = "Couldn't load the workouts. Check your signal and try again.";
        msg.hidden = false;
      } finally {
        go.disabled = false;
        go.textContent = "SHUFFLE";
      }
    });
    wrap.appendChild(go);
    showElseOverlay_(wrap);
  }

  // ---- reveal --------------------------------------------------------------

  function reveal(shared, state, list, current) {
    const avoid = readHistory(shared).slice();
    if (current) avoid.push(current.name); // the one on screen is always the last entry
    const workout = pickWorkout(list, avoid, Math.random);
    const plan = instantiate(workout, state.level, Math.random);

    const wrap = h("div", "workout__else-body mix__reveal");
    wrap.appendChild(h("p", "mix__eyebrow", "Your surprise"));
    wrap.appendChild(h("h2", "mix__name", plan.name));
    const equipment = /^none$/i.test(plan.equipment.trim()) ? "No equipment needed" : `Equipment: ${plan.equipment}`;
    wrap.appendChild(h("p", "mix__meta", `${plan.style} · about ${Number.isFinite(plan.minutes) ? plan.minutes : "30"} min · ${plan.level}`));
    wrap.appendChild(h("p", "mix__meta mix__meta--eq", equipment));
    const lines = h("ul", "mix__blocks");
    plan.blocks.forEach((b) => lines.appendChild(h("li", "", describeBlock(b))));
    wrap.appendChild(lines);

    wrap.appendChild(btn("workout__else-primary-btn mix__start", "START", () => {
      pushHistory(shared, plan.name);
      startPlayer(shared, plan);
    }));
    wrap.appendChild(btn("workout__else-secondary-btn", "Shuffle again", () => reveal(shared, state, list, plan)));
    wrap.appendChild(btn("mix__link", "Back", () => openSetup(shared)));
    showElseOverlay_(wrap);
  }

  // ---- the player ----------------------------------------------------------

  let playerEl = null;
  let session = null;
  let tickTimer = null;

  const SOUND_KEY = "maxfitRoundTimerSound"; // the same sound choice the boxing timer remembers
  const soundPref = () => { try { return localStorage.getItem(SOUND_KEY) !== "off"; } catch (err) { return true; } };

  function tone(freq, ms, delay) {
    if (!session || !session.soundOn || typeof sharedAudioCtx_ === "undefined" || !sharedAudioCtx_) return;
    try {
      const a = sharedAudioCtx_;
      const at = a.currentTime + (delay || 0) / 1000;
      const osc = a.createOscillator();
      const gain = a.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.linearRampToValueAtTime(0.3, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000);
      osc.connect(gain).connect(a.destination);
      osc.start(at);
      osc.stop(at + ms / 1000 + 0.05);
    } catch (err) { /* silent */ }
  }
  const bell = () => { tone(880, 350, 0); tone(880, 350, 450); };
  const beep = () => { tone(1200, 120, 0); tone(1200, 120, 180); };
  const buzz = (p) => { if (navigator.vibrate) navigator.vibrate(p); };

  function startPlayer(shared, plan) {
    unlockAudio_();
    const segs = compile(plan);
    session = {
      shared, plan, segs, idx: 0, paused: false, remainingMs: 0, endAt: 0, segTotalMs: 0,
      soundOn: soundPref(), rowsBySeg: new Map(), pausedAt: 0, pausedTotal: 0, startedAt: Date.now(), warned: false, finished: false,
      draftKey: draftKey(shared.clientSlug, workoutLabel(plan.name), shared.date), rev: 0,
    };
    closeElseOverlay_();
    if (!playerEl) {
      playerEl = h("div", "mix__player");
      playerEl.hidden = true;
      document.body.appendChild(playerEl);
    }
    playerEl.hidden = false;
    acquireWakeLock_();
    enterSegment(0, Date.now());
    clearInterval(tickTimer);
    tickTimer = setInterval(tick, 200);
  }

  function allRows() {
    const out = [];
    session.segs.forEach((s) => { const r = session.rowsBySeg.get(s.index); if (r) out.push(...r); });
    return out;
  }

  /** Keeps the on-phone draft current after every finished interval, so closing the app loses nothing already done. */
  function persistDraft() {
    const s = session;
    const rows = allRows();
    if (!rows.length) return;
    s.rev += 1;
    writeDraft(s.draftKey, {
      schema: DRAFT_SCHEMA, clientSlug: s.shared.clientSlug, workoutName: workoutLabel(s.plan.name), date: s.shared.date,
      sets: rows, notes: "", rev: s.rev, pending: true, updatedAt: Date.now(),
    });
  }

  function enterSegment(i, startAt) {
    const s = session;
    s.idx = i;
    const seg = s.segs[i];
    s.segTotalMs = seg.seconds * 1000;
    s.endAt = startAt + s.segTotalMs;
    s.remainingMs = Math.max(0, s.endAt - Date.now());
    s.warned = false;
    seg.startedAt = startAt;
    render();
  }

  /** Records a finished segment's rows (an AMRAP records however many rounds were counted). */
  function completeSegment(seg, elapsedSeconds) {
    const rows = rowsForSegment(seg, elapsedSeconds);
    if (rows.length) session.rowsBySeg.set(seg.index, rows);
    else session.rowsBySeg.delete(seg.index);
    persistDraft();
  }

  function tick() {
    const s = session;
    if (!s || s.paused || s.finished) return;
    const now = Date.now();
    // Wall-clock based: if the screen was locked, finish every segment that ended meanwhile (each counted in full), then carry on from where the clock says we are.
    let advanced = 0;
    while (s.idx < s.segs.length && s.endAt <= now) {
      const seg = s.segs[s.idx];
      completeSegment(seg, seg.seconds);
      const endedAt = s.endAt;
      advanced++;
      if (s.idx === s.segs.length - 1) { finishSession(); return; }
      enterSegment(s.idx + 1, endedAt);
    }
    if (advanced) { bell(); buzz([200, 100, 200]); }
    s.remainingMs = Math.max(0, s.endAt - now);
    if (!s.warned && s.segTotalMs >= 30000 && s.remainingMs <= 10000 && s.remainingMs > 0 && s.segs[s.idx].kind !== "rest") {
      s.warned = true;
      beep();
    }
    updateTime();
  }

  function updateTime() {
    const s = session;
    if (!s || !playerEl) return;
    const t = playerEl.querySelector(".mix__time");
    if (t) t.textContent = clock(Math.ceil(s.remainingMs / 1000));
    const bar = playerEl.querySelector(".mix__bar-fill");
    if (bar) bar.style.width = `${s.segTotalMs ? (1 - s.remainingMs / s.segTotalMs) * 100 : 0}%`;
  }

  /** "Next: ..." for the segment after this one that has something to show. */
  function nextText(seg) {
    const s = session;
    const nxt = s.segs[seg.index + 1];
    if (!nxt) return "Next: finish";
    if (nxt.kind === "rest") {
      const after = s.segs[nxt.index + 1];
      if (nxt.between) return `Next: ${nxt.title.replace("Next up: ", "")}`;
      return after ? `Next: ${segTitle(after)}` : "Next: finish";
    }
    return `Next: ${segTitle(nxt)}`;
  }
  function segTitle(seg) {
    if (seg.kind === "rest") return seg.title;
    if (seg.kind === "amrap") return seg.blockName;
    if (seg.kind === "emom") return `Do ${moveLabel(seg.move)}`;
    return moveName(seg.move);
  }

  function render() {
    const s = session;
    const seg = s.segs[s.idx];
    const el = playerEl;
    el.textContent = "";
    el.className = "mix__player" + (seg.kind === "rest" ? " is-rest" : "");

    const top = h("div", "mix__top");
    const blocks = s.plan.blocks;
    top.appendChild(h("span", "mix__top-title", `${s.plan.name} · Block ${seg.block + 1} of ${blocks.length}`));
    const sound = btn("mix__icon-btn", "", () => {
      s.soundOn = !s.soundOn;
      try { localStorage.setItem(SOUND_KEY, s.soundOn ? "on" : "off"); } catch (err) { /* ignore */ }
      sound.innerHTML = s.soundOn ? SOUND_ON_SVG : SOUND_OFF_SVG;
      sound.setAttribute("aria-label", s.soundOn ? "Sound on" : "Sound off");
    });
    sound.innerHTML = s.soundOn ? SOUND_ON_SVG : SOUND_OFF_SVG;
    sound.setAttribute("aria-label", s.soundOn ? "Sound on" : "Sound off");
    const end = btn("mix__icon-btn mix__end", "End", () => confirmEnd());
    top.append(sound, end);
    el.appendChild(top);

    const body = h("div", "mix__body");
    const tag = seg.kind === "rest" ? (seg.between ? "REST" : "REST") : seg.tag || "WORK";
    body.appendChild(h("p", "mix__tag", tag));
    body.appendChild(h("h2", "mix__title", segTitle(seg)));
    if (seg.sub) body.appendChild(h("p", "mix__subline", seg.sub));
    if (seg.kind === "emom") body.appendChild(h("p", "mix__subline", "then rest for the rest of the minute"));

    if (seg.kind === "work" && seg.combo) {
      const f = typeof formatCombo_ === "function" ? formatCombo_(seg.combo) : { nums: seg.combo, words: "" };
      const card = h("div", "mix__combo");
      card.appendChild(h("p", "mix__combo-nums", f.nums));
      if (f.words) card.appendChild(h("p", "mix__combo-words", f.words));
      body.appendChild(card);
    }

    if (seg.kind === "amrap") {
      const list = h("ul", "mix__amrap-list");
      seg.moves.forEach((m) => list.appendChild(h("li", "", moveLabel(m))));
      body.appendChild(list);
    }

    body.appendChild(h("p", "mix__time", clock(Math.ceil(s.remainingMs / 1000))));
    const bar = h("div", "mix__bar");
    bar.appendChild(h("span", "mix__bar-fill"));
    body.appendChild(bar);

    if (seg.kind === "amrap") {
      const count = h("p", "mix__rounds", `Rounds: ${seg.rounds}`);
      body.appendChild(count);
      const plus = btn("mix__plus", "+1 ROUND", () => { seg.rounds += 1; count.textContent = `Rounds: ${seg.rounds}`; amrapSync(seg); });
      const minus = btn("mix__minus", "−1", () => { seg.rounds = Math.max(0, seg.rounds - 1); count.textContent = `Rounds: ${seg.rounds}`; amrapSync(seg); });
      minus.setAttribute("aria-label", "Take one round off");
      body.append(plus, minus);
    }

    // Easier option: shown small when it isn't already being used, with a one-tap swap for the rest of the session.
    const mv = seg.move;
    if (mv && mv.easier && !mv.easierOn && seg.kind !== "rest" && !(seg.blockType === "Warm-up" || seg.blockType === "Cool-down")) {
      body.appendChild(h("p", "mix__easier", `Easier: ${mv.easier}`));
      body.appendChild(btn("mix__link mix__too-much", "Too much? Use the easier option", () => { mv.easierOn = true; render(); }));
    }

    if (seg.kind !== "rest" && seg.move && typeof buildWatchButton_ === "function") body.appendChild(buildWatchButton_({ video: "" }, "large"));
    body.appendChild(h("p", "mix__next", nextText(seg)));
    el.appendChild(body);

    const controls = h("div", "mix__controls");
    controls.appendChild(btn("mix__main-btn", s.paused ? "RESUME" : "PAUSE", () => togglePause()));
    controls.appendChild(btn("mix__skip-btn", seg.between || seg.kind === "rest" ? "Skip rest" : "Skip", () => skip()));
    el.appendChild(controls);
    updateTime();
  }

  /** Keeps an AMRAP's rounds in the draft as they're counted, with the time done so far. */
  function amrapSync(seg) {
    const elapsed = seg.seconds - Math.ceil(session.remainingMs / 1000);
    completeSegment(seg, Math.max(1, Math.min(seg.seconds, elapsed)));
  }

  /** Time on the clock, not counting time spent paused. */
  function trainingMs(s) {
    const pausedNow = s.paused ? Date.now() - s.pausedAt : 0;
    return Math.max(0, Date.now() - s.startedAt - s.pausedTotal - pausedNow);
  }

  function pause() {
    const s = session;
    if (s.paused) return;
    s.remainingMs = Math.max(0, s.endAt - Date.now());
    s.paused = true;
    s.pausedAt = Date.now();
  }

  function resume() {
    const s = session;
    if (!s.paused) return;
    s.pausedTotal += Date.now() - s.pausedAt;
    s.paused = false;
    s.endAt = Date.now() + s.remainingMs; // carry on with exactly what was left
    acquireWakeLock_();
  }

  function togglePause() {
    if (session.paused) resume(); else pause();
    render();
  }

  function skip() {
    const s = session;
    const seg = s.segs[s.idx];
    // An AMRAP keeps whatever rounds were counted; every other skipped interval logs nothing.
    if (seg.kind === "amrap") amrapSync(seg);
    if (s.idx === s.segs.length - 1) { finishSession(); return; }
    resume();
    enterSegment(s.idx + 1, Date.now());
  }

  function confirmEnd() {
    const s = session;
    pause();
    const box = h("div", "mix__confirm");
    box.appendChild(h("p", "mix__confirm-text", "End the session now? What you've finished so far is kept."));
    box.appendChild(btn("mix__main-btn", "Yes, finish up", () => { box.remove(); const seg = s.segs[s.idx]; if (seg.kind === "amrap") amrapSync(seg); finishSession(); }));
    box.appendChild(btn("mix__skip-btn", "Keep going", () => { box.remove(); resume(); render(); }));
    playerEl.appendChild(box);
  }

  function stopPlayer() {
    clearInterval(tickTimer);
    tickTimer = null;
    releaseWakeLock_();
    if (playerEl) { playerEl.hidden = true; playerEl.textContent = ""; }
  }

  // ---- finish: review and save ---------------------------------------------

  function finishSession() {
    const s = session;
    if (s.finished) return;
    s.finished = true;
    stopPlayer();
    const rows = allRows();
    if (!rows.length) {
      session = null;
      openSetup(s.shared);
      return;
    }
    showReview(s, rows);
  }

  /** Intervals + rounds completed: an interval round with several exercises is one round, each EMOM minute and boxing round is one, an AMRAP adds its counted rounds. */
  function roundsDone(s) {
    const perRound = new Set();
    let plain = 0;
    s.segs.forEach((seg) => {
      const r = s.rowsBySeg.get(seg.index);
      if (!r || !r.length) return;
      if (seg.kind === "amrap") return;
      if (seg.blockType === "Intervals") perRound.add(`${seg.block}|${seg.log.setNumber}`);
      else plain += 1;
    });
    const amrap = s.segs.reduce((n, seg) => n + (seg.kind === "amrap" && s.rowsBySeg.get(seg.index) ? seg.rounds : 0), 0);
    return perRound.size + plain + amrap;
  }

  function blocksDone(s) {
    // A main block (not warm-up or cool-down) counts once it has something logged.
    const done = new Set();
    s.segs.forEach((seg) => {
      if (seg.blockType === "Warm-up" || seg.blockType === "Cool-down") return;
      if (s.rowsBySeg.get(seg.index)) done.add(seg.block);
    });
    return done.size;
  }

  function showReview(s, rows) {
    const shared = s.shared;
    const wrap = h("div", "workout__review-inner mix__review");
    const head = h("div", "workout__review-head");
    const tick = h("span", "workout__review-tick");
    tick.innerHTML = CHECK_CIRCLE_SVG;
    head.append(tick, h("h2", "workout__review-title", "Session done"), h("p", "workout__review-sub", `Nice work, ${firstName()}. ${s.plan.name} is ready to save.`));
    wrap.appendChild(head);

    const minutes = Math.max(1, Math.round(trainingMs(s) / 60000));
    const tiles = h("div", "workout__review-tiles");
    [["TIME", `${minutes} min`], ["ROUNDS", String(roundsDone(s))], ["BLOCKS", String(blocksDone(s))]].forEach(([label, val]) => {
      const t = h("div", "workout__review-tile");
      t.append(h("span", "workout__review-tile-label", label), h("span", "workout__review-tile-value", val));
      tiles.appendChild(t);
    });
    wrap.appendChild(tiles);

    const muscle = h("div", "workout__review-section");
    const figs = h("div");
    const list = h("div");
    renderMuscleReview_(figs, list, rows);
    muscle.append(h("span", "workout__review-section-label", "Muscles Worked"), figs, list);
    wrap.appendChild(muscle);

    const notesWrap = h("div", "workout__review-section");
    const input = h("textarea", "workout__review-notes-input");
    input.rows = 2;
    input.placeholder = "e.g. slept bad, shoulder hurts, etc.";
    notesWrap.append(h("span", "workout__review-section-label", "How did it feel? (optional)"), input);
    wrap.appendChild(notesWrap);

    const err = h("p", "workout__else-error");
    err.hidden = true;
    wrap.appendChild(err);
    const save = btn("workout__review-save", "Save & Close", async () => {
      save.disabled = true;
      save.textContent = "Saving…";
      const feel = input.value.trim();
      const notes = `Mix it up · ${s.plan.style} · ${minutes} min · ${s.plan.level}` + (feel ? ` — ${feel}` : "");
      const ok = await saveSimpleSession_(shared, workoutLabel(s.plan.name), rows, notes);
      if (ok) {
        session = null;
        window.location.href = homeHref();
      } else {
        save.disabled = false;
        save.textContent = "Save & Close";
        err.textContent = "Couldn't reach the server — it's saved on this phone. Try again when you have signal.";
        err.hidden = false;
      }
    });
    wrap.appendChild(save);
    showElseOverlay_(wrap, { hideClose: true });
  }

  document.addEventListener("visibilitychange", () => {
    if (!session || session.finished) return;
    if (document.visibilityState === "visible") {
      acquireWakeLock_(); // the browser drops the screen lock whenever the page is hidden
      tick(); // catch up on anything that finished while the screen was off
    }
  });

  window.openMixItUp_ = open;
  window.MixItUpTest_ = { get session() { return session; }, tick, skip, togglePause };
})();
