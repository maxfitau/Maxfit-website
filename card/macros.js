/*
 * MaxFit membership card — FUEL tab (macro tracker, Phase 1).
 *
 * Draws everything inside #panelFuel plus the bottom sheet (#fuelSheet):
 *   home     — today's totals vs targets, SCAN FOOD, favourites/recent
 *              one-tap chips, and today's entries by meal
 *   scan     — Photo (AI), Barcode (Open Food Facts) or Label (AI)
 *   confirm  — editable grams per item, live macros, ADD TO TODAY
 *   edit     — change grams/meal/name, favourite, delete
 *   targets  — Max's targets (read-only) or the calculator
 *   settings — hide calories, Fuel AI plan, disclaimer
 *   suggest  — "what to eat next" from Max's Foods list (free, no AI)
 *   chat     — Ask Fuel, the AI copilot (Fuel AI plan)
 *   upsell   — Fuel AI: 7-day trial, then $9.99/month (members) via Stripe
 *   progress — weight trend vs goal, calorie target steps, last 14 days
 *              with green days and the nutrition punches (free)
 *
 * Talks to the server only through MacroApi (macros-api.js); maths come
 * from MacroCore (macros-core.js). Photos are shrunk to 1024px JPEG in the
 * browser and never stored. The CARD tab (app.js) is untouched.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const els = {
    tabs: Array.from(document.querySelectorAll(".card__tab")),
    panelCard: $("panelCard"),
    panelFuel: $("panelFuel"),
    sheet: $("fuelSheet"),
    sheetBody: $("fuelSheetBody"),
    toast: $("fuelToast"),
    photoInput: $("fuelPhotoInput"),
    libraryInput: $("fuelLibraryInput"),
  };
  if (!els.panelFuel || !els.sheet) return;

  const TAB_STORAGE = "maxfitCardTab";
  const MEAL_LABELS = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snacks" };
  const MEAL_SHORT = { breakfast: "Brekky", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

  const state = {
    loaded: false,
    loading: false,
    member: null,
    targets: null,
    day: null,
    viewDate: MacroCore.sydneyDate(),
    recent: [],
    favourites: [],
    scansLeft: null,
    scanLimit: 25,
    busy: false,
    confirm: null,
    pendingPhotoMode: null,
    loadedOn: null,
    aiEnabled: true,
    plan: null, // { access, kind, until, daysLeft, upgradeUrl, portalUrl } from the server
    foods: [],
    moreIdeas: false,
    chat: [], // Ask Fuel messages, this visit only: { role, content, foods? }
    awaitingUpgrade: false,
    weightTrend: null, // { kg, date, change7 } from the server
    progress: null, // the last `progress` response
    progressRange: 84, // days shown on the weight chart; 0 = all
  };

  // Back from Stripe checkout: the Payment Link redirects to
  // /card/?paid={CHECKOUT_SESSION_ID}. Take it off the address straight away
  // so it never ends up in a home-screen icon's start URL.
  const returnedSession = (() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("paid");
    if (!id) return null;
    params.delete("paid");
    const rest = params.toString();
    try {
      history.replaceState(null, "", window.location.pathname + (rest ? "?" + rest : "") + window.location.hash);
    } catch (err) {
      // ignore
    }
    return /^cs_[A-Za-z0-9_]+$/.test(id) ? id : null;
  })();

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function int(n) {
    return Math.round(Number(n) || 0).toLocaleString("en-AU");
  }

  function hideKcal() {
    return !!(state.member && state.member.hide_kcal);
  }

  /** "32P · 45C · 12F · 420 kcal" (kcal left off when the client hides calories). */
  function macroLine(m, { bold = false } = {}) {
    const b = (v) => (bold ? `<b>${v}</b>` : v);
    const parts = [
      `${b(int(m.protein_g))}P`,
      `${b(int(m.carbs_g))}C`,
      `${b(int(m.fat_g))}F`,
    ];
    if (!hideKcal()) parts.push(`${b(int(m.kcal))} kcal`);
    return parts.join(" · ");
  }

  function sydneyHour() {
    return Number(
      new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", hourCycle: "h23" }).format(new Date())
    );
  }

  function shiftDate(ymd, days) {
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return dt.toISOString().slice(0, 10);
  }

  function dayLabel(ymd) {
    const today = MacroCore.sydneyDate();
    if (ymd === today) return "Today";
    if (ymd === shiftDate(today, -1)) return "Yesterday";
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  }

  function isToday() {
    return state.viewDate === MacroCore.sydneyDate();
  }

  function defaultMeal() {
    return isToday() ? MacroCore.mealForHour(sydneyHour()) : "snack";
  }

  const ICONS = {
    camera:
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    barcode:
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 5v14M7 5v14M11 5v14M14 5v14M18 5v14M20 5v14"/></svg>',
    label:
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
    gear:
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    left: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    right: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
    x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    spark:
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/></svg>',
    chart:
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19V5M4 19h16"/><path d="M7 15l4-4 3 3 5-6"/></svg>',
    lock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    star: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l3 6.9 7.5.7-5.7 5 1.7 7.4L12 18l-6.5 4 1.7-7.4-5.7-5 7.5-.7z"/></svg>',
  };

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------

  function showTab(name, remember) {
    const fuel = name === "fuel";
    els.tabs.forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    els.panelCard.hidden = fuel;
    els.panelFuel.hidden = !fuel;
    if (remember) {
      try {
        localStorage.setItem(TAB_STORAGE, name);
      } catch (err) {
        // ignore
      }
    }
    if (fuel && !state.loaded && !state.loading) load(returnedSession ? { sync: true } : undefined);
  }

  els.tabs.forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab, true)));

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  function renderNotice(title, body, actionHtml) {
    els.panelFuel.innerHTML = `
      <div class="fuel-panel fuel-notice">
        <h2 class="fuel-notice__title">${esc(title)}</h2>
        <p>${body}</p>
        ${actionHtml || ""}
      </div>`;
  }

  /**
   * "Paste the link Max sent you": for a home-screen icon that opened without
   * the personal link (an older iPhone icon keeps its own storage, separate
   * from Safari). Saves it on this phone and reloads, so the card follows too.
   */
  function renderUnlock(message) {
    renderNotice(
      "Unlock Fuel",
      esc(message),
      `<form class="fuel-field" data-link-form autocomplete="off">
         <span class="card__label">Your link from Max</span>
         <input class="fuel-input" name="link" type="text" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="maxfit.now/card/?id=…" aria-label="Your link from Max" />
         <button class="fuel-btn" type="submit">Unlock Fuel</button>
         <p class="fuel-error" data-link-error hidden>That doesn't look like your MaxFit link. Copy the whole link from Max's message and try again.</p>
       </form>`
    );
    const form = els.panelFuel.querySelector("[data-link-form]");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (MacroApi.saveLink(form.elements.link.value)) window.location.reload();
      else form.querySelector("[data-link-error]").hidden = false;
    });
  }

  function renderLoading(text) {
    els.panelFuel.innerHTML = `<div class="fuel-loading"><div class="fuel-spinner"></div><span class="fuel-loading__text">${esc(text || "Loading")}</span></div>`;
  }

  function applyMe(data) {
    state.member = data.member;
    state.targets = data.targets;
    state.day = data.day;
    state.recent = data.recent || [];
    state.favourites = data.favourites || [];
    state.foods = data.foods || [];
    state.scansLeft = data.scansLeft;
    state.scanLimit = data.scanLimit || 25;
    state.aiEnabled = data.aiEnabled !== false;
    state.plan = data.plan || null;
    state.weightTrend = data.weightTrend || null;
  }

  async function load(opts) {
    if (!MacroApi.configured()) {
      renderNotice("Fuel is coming soon", "Macro tracking isn't switched on for the card yet. Max will let you know when it's ready.");
      return;
    }
    const who = MacroApi.identity();
    if (!who.id || !who.k) {
      if (returnedSession) {
        // Paid in a browser that doesn't hold their card (e.g. Safari
        // instead of the home-screen app): switch Fuel AI on anyway.
        renderLoading("Switching on Fuel AI");
        await confirmStripeReturn();
        renderNotice(
          "Payment received",
          "Thanks! Fuel AI is being switched on. Go back to your MaxFit app from your home screen and open the Fuel tab."
        );
        return;
      }
      renderUnlock("Macro tracking needs your personal link from Max. Paste it below to unlock Fuel on this phone. You only need to do this once.");
      return;
    }
    state.loading = true;
    renderLoading(returnedSession ? "Switching on Fuel AI" : "Loading your day");
    try {
      if (returnedSession) await confirmStripeReturn();
      const data = await MacroApi.call("me", { date: state.viewDate, sync: !!(opts && opts.sync) });
      applyMe(data);
      state.loaded = true;
      state.loadedOn = MacroCore.sydneyDate();
      render();
      if (returnedSession && state.plan && state.plan.kind === "paid") toast("Fuel AI is on. Welcome!");
    } catch (err) {
      if (err.code === "bad_key") {
        renderUnlock(err.message + " If Max has sent you one, paste it below.");
      } else {
        renderNotice("Couldn't load", esc(err.message), '<button class="fuel-btn fuel-btn--ghost" type="button" data-act="retry">Try again</button>');
      }
    } finally {
      state.loading = false;
    }
  }

  /** Tells the server which Stripe checkout just finished, so it can link it straight away. */
  async function confirmStripeReturn() {
    try {
      await MacroApi.call("stripeReturn", { session_id: returnedSession });
    } catch (err) {
      // The 15-minute sync will pick it up anyway.
    }
  }

  async function changeDay(delta) {
    const next = shiftDate(state.viewDate, delta);
    if (next > MacroCore.sydneyDate()) return;
    state.viewDate = next;
    state.day = { date: next, entries: [], totals: MacroCore.sumTotals([]) };
    render();
    try {
      const data = await MacroApi.call("getDay", { date: next });
      if (state.viewDate === next) {
        state.day = data.day;
        render();
      }
    } catch (err) {
      toast(err.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Home view
  // ---------------------------------------------------------------------------

  function progressRow(label, eaten, target, unit, { lead = false, note = "" } = {}) {
    const pct = target > 0 ? Math.min(100, (eaten / target) * 100) : 0;
    return `
      <div class="fuel-row${lead ? " fuel-row--lead" : ""}">
        <div class="fuel-row__head">
          <span class="card__label${lead ? " card__label--red" : ""}">${label}</span>
          ${note ? `<span class="fuel-row__note">${note}</span>` : ""}
        </div>
        <div class="fuel-row__nums">${int(eaten)}<span class="fuel-row__target"> / ${int(target)}</span><span class="fuel-row__unit">${unit}</span></div>
        <div class="fuel-bar"><div class="fuel-bar__fill" style="width:${pct.toFixed(1)}%"></div></div>
      </div>`;
  }

  function smallRow(label, eaten, target) {
    const pct = target > 0 ? Math.min(100, (eaten / target) * 100) : 0;
    return `
      <div class="fuel-row">
        <span class="card__label">${label}</span>
        <div class="fuel-row__nums">${int(eaten)}<span class="fuel-row__target"> / ${int(target)}</span><span class="fuel-row__unit">g</span></div>
        <div class="fuel-bar"><div class="fuel-bar__fill" style="width:${pct.toFixed(1)}%"></div></div>
      </div>`;
  }

  function totalsHtml() {
    const t = state.day ? state.day.totals : MacroCore.sumTotals([]);
    const g = state.targets;
    if (!g) {
      return `
        <div class="fuel-panel fuel-notice">
          <h2 class="fuel-notice__title">Set your daily targets</h2>
          <p>Two minutes with the calculator and you'll see protein, carbs, fat${hideKcal() ? "" : " and calories"} to aim for each day. Or Max can set them for you.</p>
          <button class="fuel-btn" type="button" data-act="targets">Set my targets</button>
          ${
            state.day && state.day.entries.length
              ? `<p class="fuel-row__note">So far ${esc(dayLabel(state.viewDate).toLowerCase())}: ${macroLine(t)}</p>`
              : ""
          }
        </div>`;
    }
    const proteinLeft = g.protein_g - t.protein_g;
    const proteinNote = proteinLeft > 0 ? `${int(proteinLeft)}g to go` : "Target hit";
    const kcalLeft = g.kcal - t.kcal;
    // Over on calories is information, not a failure — keep it calm.
    const kcalNote = kcalLeft >= 0 ? `${int(kcalLeft)} left` : `${int(-kcalLeft)} over · no stress`;
    return `
      <div class="fuel-panel fuel-totals">
        ${progressRow("Protein", t.protein_g, g.protein_g, "g", { lead: true, note: proteinNote })}
        ${hideKcal() ? "" : progressRow("Calories", t.kcal, g.kcal, "kcal", { note: kcalNote })}
        <div class="fuel-grid3" style="grid-template-columns: 1fr 1fr">
          ${smallRow("Carbs", t.carbs_g, g.carbs_g)}
          ${smallRow("Fat", t.fat_g, g.fat_g)}
        </div>
      </div>`;
  }

  function chip(item, kind, index) {
    const m = MacroCore.scale(item.per100, item.grams);
    return `
      <button class="fuel-chip" type="button" data-act="quick" data-kind="${kind}" data-i="${index}">
        <span class="fuel-chip__name">${kind === "fav" ? `<span style="color:var(--red)">${ICONS.star}</span> ` : ""}${esc(item.name)}</span>
        <span class="fuel-chip__meta">${int(item.grams)}g · ${int(m.protein_g)}P${hideKcal() ? "" : ` · ${int(m.kcal)} kcal`}</span>
      </button>`;
  }

  function quickHtml() {
    const favs = state.favourites || [];
    const recents = (state.recent || []).filter(
      (r) => !favs.some((f) => f.name.toLowerCase() === String(r.name).toLowerCase())
    );
    if (!favs.length && !recents.length) return "";
    return `
      <div class="fuel-section">
        <div class="fuel-section__head">
          <span class="card__label">Tap to log again</span>
          ${favs.length ? '<button class="fuel-link" type="button" data-act="favs">Favourites</button>' : ""}
        </div>
        <div class="fuel-chips">
          ${favs.map((f, i) => chip(f, "fav", i)).join("")}
          ${recents.map((r) => chip(r, "recent", state.recent.indexOf(r))).join("")}
        </div>
      </div>`;
  }

  function entriesHtml() {
    const entries = state.day ? state.day.entries : [];
    if (!entries.length) {
      return `<div class="fuel-panel"><p class="fuel-empty">Nothing logged ${esc(dayLabel(state.viewDate).toLowerCase())} yet.</p></div>`;
    }
    const groups = MacroCore.MEALS.map((meal) => ({ meal, items: entries.filter((e) => e.meal === meal) })).filter(
      (g) => g.items.length
    );
    return `
      <div class="fuel-panel">
        ${groups
          .map((g) => {
            const sum = MacroCore.sumTotals(g.items);
            return `
            <div class="fuel-meal">
              <div class="fuel-meal__head">
                <span class="card__label card__label--red">${MEAL_LABELS[g.meal]}</span>
                <span class="fuel-meal__sum">${int(sum.protein_g)}P${hideKcal() ? "" : ` · ${int(sum.kcal)} kcal`}</span>
              </div>
              ${g.items
                .map(
                  (e) => `
                <button class="fuel-entry" type="button" data-act="edit" data-id="${esc(e.id)}">
                  <span>
                    <span class="fuel-entry__name">${esc(e.name)}</span>
                    <span class="fuel-entry__meta">${int(e.grams)}g · ${int(e.carbs_g)}C · ${int(e.fat_g)}F${hideKcal() ? "" : ` · ${int(e.kcal)} kcal`}</span>
                  </span>
                  <span class="fuel-entry__p">${int(e.protein_g)}<small>P</small></span>
                </button>`
                )
                .join("")}
            </div>`;
          })
          .join("")}
      </div>`;
  }

  function render() {
    if (!state.loaded) return;
    const today = isToday();
    const g = state.targets;
    els.panelFuel.innerHTML = `
      <div class="fuel__head">
        <div class="fuel__date">
          <button class="fuel__day-btn" type="button" data-act="prev" aria-label="Previous day">${ICONS.left}</button>
          <span class="fuel__day-label">${esc(dayLabel(state.viewDate))}</span>
          <button class="fuel__day-btn" type="button" data-act="next" aria-label="Next day" ${today ? "disabled" : ""}>${ICONS.right}</button>
        </div>
        <span class="fuel__head-btns">
          <button class="fuel__icon-btn" type="button" data-act="progress" aria-label="Your progress">${ICONS.chart}</button>
          <button class="fuel__icon-btn" type="button" data-act="settings" aria-label="Fuel settings">${ICONS.gear}</button>
        </span>
      </div>
      ${totalsHtml()}
      ${trendHtml()}
      <button class="fuel-scan" type="button" data-act="scan">${ICONS.camera} Scan food</button>
      ${
        state.aiEnabled
          ? `<button class="fuel-btn fuel-btn--ghost fuel-ask" type="button" data-act="ask">${ICONS.spark} Ask Fuel${fuelAi() ? "" : ` ${ICONS.lock}`}</button>`
          : ""
      }
      ${today ? suggestionsHtml(state.moreIdeas ? 5 : 3, true) : ""}
      ${quickHtml()}
      ${entriesHtml()}
      ${
        g
          ? `<p class="fuel-footnote">${g.set_by === "coach" ? "Targets set by Max" : "Targets from your calculator"} · <button class="fuel-link" type="button" data-act="targets">${g.set_by === "coach" ? "View" : "Edit"}</button></p>`
          : ""
      }`;
  }

  els.panelFuel.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "retry") load();
    else if (act === "prev") changeDay(-1);
    else if (act === "next") changeDay(1);
    else if (act === "scan") openScanChooser();
    else if (act === "ask") openChat();
    else if (act === "progress") openProgress();
    else if (act === "more-ideas") {
      state.moreIdeas = !state.moreIdeas;
      render();
    } else if (act === "log-idea") logIdea(btn);
    else if (act === "settings") openSettings();
    else if (act === "targets") openTargets();
    else if (act === "favs") openFavourites();
    else if (act === "edit") {
      const entry = state.day.entries.find((x) => x.id === btn.dataset.id);
      if (entry) openEdit(entry);
    } else if (act === "quick") {
      const list = btn.dataset.kind === "fav" ? state.favourites : state.recent;
      const item = list[Number(btn.dataset.i)];
      if (item) quickLog(item);
    }
  });

  // ---------------------------------------------------------------------------
  // What to eat next (free): ranked in MacroCore from Max's Foods list
  // ---------------------------------------------------------------------------

  let shownIdeas = []; // the suggestions currently on screen, for their Log buttons

  function remainingToday() {
    const g = state.targets;
    const t = state.day ? state.day.totals : MacroCore.sumTotals([]);
    return {
      kcal: g.kcal - t.kcal,
      protein_g: g.protein_g - t.protein_g,
      carbs_g: g.carbs_g - t.carbs_g,
      fat_g: g.fat_g - t.fat_g,
    };
  }

  /** { headline, ideas } for the day on screen, or null without targets/foods. */
  function ideasFor(limit) {
    if (!state.targets || !state.foods.length) return null;
    const left = remainingToday();
    const p = Math.round(left.protein_g);
    const k = Math.round(left.kcal);
    if (k <= 0) {
      return {
        over: true,
        headline: hideKcal()
          ? "You're past today's target. No stress. If you're still hungry, these are high-protein, lighter options:"
          : `You're ${int(-k)} kcal over. No stress. If you're still hungry, these are high-protein, low-calorie options:`,
        ideas: MacroCore.suggestOver(state.foods, limit),
      };
    }
    let ideas = MacroCore.suggestFill(left, state.foods, limit);
    if (!ideas.length) ideas = MacroCore.suggestOver(state.foods, limit).filter((i) => i.totals.kcal <= k);
    let headline;
    if (p <= 0) headline = hideKcal() ? "Protein target hit. Nice work." : `Protein target hit. You've got ${int(k)} kcal left today.`;
    else headline = hideKcal() ? `You've got ${p}g protein left today.` : `You've got ${p}g protein and ${int(k)} kcal left today.`;
    return { over: false, headline: headline, ideas: ideas };
  }

  function ideaMacros(t) {
    return `${int(t.protein_g)}g P${hideKcal() ? "" : ` · ${int(t.kcal)} kcal`}`;
  }

  function suggestionsHtml(limit, withMore) {
    const s = ideasFor(limit);
    if (!s) return "";
    shownIdeas = s.ideas;
    return `
      <div class="fuel-panel fuel-ideas">
        <span class="card__label card__label--red">What to eat next</span>
        <p class="fuel-ideas__headline">${esc(s.headline)}</p>
        ${s.ideas
          .map(
            (idea, i) => `
          <div class="fuel-idea">
            <span>
              <span class="fuel-idea__label">${esc(idea.label)}</span>
              <span class="fuel-entry__meta">${ideaMacros(idea.totals)}</span>
            </span>
            <button class="fuel-idea__log" type="button" data-act="log-idea" data-i="${i}">Log</button>
          </div>`
          )
          .join("")}
        ${withMore && s.ideas.length >= 3 ? `<button class="fuel-link" type="button" data-act="more-ideas">${state.moreIdeas ? "Fewer ideas" : "More ideas"}</button>` : ""}
      </div>`;
  }

  async function logIdea(btn) {
    const idea = shownIdeas[Number(btn.dataset.i)];
    if (!idea || state.busy) return;
    state.busy = true;
    btn.disabled = true;
    const meal = defaultMeal();
    try {
      const items = idea.items.map((p) => ({ name: p.name, grams: p.grams, per100: p.per100, source: "suggestion" }));
      const ids = await addItems(items, meal);
      toast(`Added to ${MEAL_SHORT[meal]}`, () => undoAdd(ids));
    } catch (err) {
      btn.disabled = false;
      toast(err.message);
    } finally {
      state.busy = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------

  let toastTimer;
  function toast(message, undo) {
    clearTimeout(toastTimer);
    els.toast.innerHTML = `<span>${esc(message)}</span>${undo ? '<button type="button">Undo</button>' : ""}`;
    els.toast.hidden = false;
    if (undo) {
      els.toast.querySelector("button").addEventListener("click", () => {
        els.toast.hidden = true;
        undo();
      });
    }
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, undo ? 5000 : 3000);
  }

  // ---------------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------------

  function payloadItem(item) {
    return {
      name: item.name,
      grams: Number(item.grams),
      per100: item.per100,
      source: item.source || "manual",
      confidence: item.confidence || "",
    };
  }

  /** Adds items to the day on screen. Returns the ids of the new entries (for Undo). */
  async function addItems(items, meal) {
    const before = new Set((state.day ? state.day.entries : []).map((x) => x.id));
    const data = await MacroApi.call("addEntries", {
      log_date: state.viewDate,
      meal: meal,
      items: items.map(payloadItem),
    });
    state.day = data.day;
    if (data.recent) state.recent = data.recent;
    render();
    return data.day.entries.filter((x) => !before.has(x.id)).map((x) => x.id);
  }

  async function quickLog(item) {
    if (state.busy) return;
    state.busy = true;
    const meal = defaultMeal();
    try {
      const ids = await addItems([item], meal);
      toast(`Added to ${MEAL_SHORT[meal]}`, () => undoAdd(ids));
    } catch (err) {
      toast(err.message);
    } finally {
      state.busy = false;
    }
  }

  async function undoAdd(ids) {
    for (const id of ids) {
      try {
        const data = await MacroApi.call("deleteEntry", { entryId: id });
        state.day = data.day;
      } catch (err) {
        // Already gone is fine.
      }
    }
    render();
  }

  // ---------------------------------------------------------------------------
  // Bottom sheet
  // ---------------------------------------------------------------------------

  let sheetCleanup = null;

  function openSheet(html, onMount) {
    if (sheetCleanup) {
      sheetCleanup();
      sheetCleanup = null;
    }
    // A fresh element each time, so listeners from the previous sheet
    // (added in onMount) can't pile up and fire twice.
    const fresh = els.sheetBody.cloneNode(false);
    els.sheetBody.replaceWith(fresh);
    els.sheetBody = fresh;
    els.sheetBody.innerHTML = html;
    els.sheet.hidden = false;
    document.body.style.overflow = "hidden";
    if (onMount) sheetCleanup = onMount(els.sheetBody) || null;
  }

  function closeSheet() {
    if (sheetCleanup) {
      sheetCleanup();
      sheetCleanup = null;
    }
    els.sheet.hidden = true;
    els.sheetBody.innerHTML = "";
    document.body.style.overflow = "";
    state.confirm = null;
  }

  els.sheet.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) closeSheet();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.sheet.hidden) closeSheet();
  });

  function sheetLoading(text) {
    openSheet(`<div class="fuel-loading"><div class="fuel-spinner"></div><span class="fuel-loading__text">${esc(text)}</span></div>`);
  }

  function sheetError(title, message, buttons) {
    openSheet(
      `<h2 class="fuel-sheet__title" id="fuelSheetTitle">${esc(title)}</h2>
       <p class="fuel-error">${esc(message)}</p>
       ${buttons || ""}
       <button class="fuel-btn fuel-btn--quiet" type="button" data-close>Close</button>`,
      (body) => {
        body.querySelectorAll("[data-retry]").forEach((b) =>
          b.addEventListener("click", () => {
            const kind = b.dataset.retry;
            if (kind === "barcode") openBarcode();
            else pickPhoto(kind, true);
          })
        );
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Scan chooser + photos
  // ---------------------------------------------------------------------------

  /** Fuel AI (photo/label scans, Ask Fuel): API key on the server AND a trial, plan or free month. */
  function fuelAi() {
    return state.aiEnabled && !!(state.plan && state.plan.access);
  }

  function fmtDate(ymd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) return "";
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
  }

  /** "Free trial · 5 days left", "Fuel AI · renews 23 Oct", … or "" when Fuel AI is off for everyone. */
  function planText() {
    const p = state.plan;
    if (!state.aiEnabled || !p) return "";
    if (p.kind === "paid") return p.until ? `Fuel AI · renews ${fmtDate(p.until)}` : "Fuel AI is on";
    if (p.kind === "comp") return `Fuel AI · free until ${fmtDate(p.until)} (from Max)`;
    if (p.kind === "trial") return `Fuel AI free trial · ${p.daysLeft} day${p.daysLeft === 1 ? "" : "s"} left`;
    if (p.kind === "lapsed") return "Your Fuel AI subscription has ended";
    return "Your Fuel AI free week has finished";
  }

  function openScanChooser() {
    // Photo and label scans need the Claude API key on the server. Without
    // it, barcodes are the only way in, so skip straight to the scanner.
    if (!state.aiEnabled) {
      openBarcode();
      return;
    }
    const locked = !fuelAi();
    const sub = locked ? "Barcodes are free. Photo and label scans are part of Fuel AI." : planText();
    openSheet(
      `<h2 class="fuel-sheet__title" id="fuelSheetTitle">Scan food</h2>
       <p class="fuel-sheet__sub">${esc(sub)}</p>
       <div class="fuel-modes">
         <button class="fuel-mode${locked ? " is-locked" : ""}" type="button" data-mode="meal">${ICONS.camera}Photo<small>${locked ? "Fuel AI" : "Snap your meal"}</small></button>
         <button class="fuel-mode" type="button" data-mode="barcode">${ICONS.barcode}Barcode<small>Packaged food</small></button>
         <button class="fuel-mode${locked ? " is-locked" : ""}" type="button" data-mode="label">${ICONS.label}Label<small>${locked ? "Fuel AI" : "Nutrition panel"}</small></button>
       </div>
       ${locked ? "" : '<button class="fuel-btn fuel-btn--quiet" type="button" data-mode="library">Choose a meal photo from your library</button>'}`,
      (body) => {
        body.querySelectorAll("[data-mode]").forEach((b) =>
          b.addEventListener("click", () => {
            const mode = b.dataset.mode;
            // input.click() has to happen inside this tap handler, or
            // iOS Safari won't open the camera.
            if (mode === "barcode") openBarcode();
            else if (locked) openUpsell();
            else if (mode === "library") pickPhoto("meal", false);
            else pickPhoto(mode, true);
          })
        );
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Fuel AI upsell (Stripe)
  // ---------------------------------------------------------------------------

  function openUpsell() {
    const p = state.plan || {};
    const ended = p.kind === "trial_over" || p.kind === "lapsed";
    openSheet(
      `<h2 class="fuel-sheet__title" id="fuelSheetTitle">Fuel AI</h2>
       <p class="fuel-sheet__sub">${esc(ended ? planText() + "." : "Your AI nutrition coach, in your pocket.")}</p>
       <ul class="fuel-perks">
         <li>${ICONS.camera}<span><b>Snap any meal</b> and get the protein, carbs, fat and calories.</span></li>
         <li>${ICONS.label}<span><b>Scan nutrition labels</b> for anything without a barcode.</span></li>
         <li>${ICONS.spark}<span><b>Ask Fuel</b>, your copilot: "What should I have for dinner?"</span></li>
       </ul>
       <p class="fuel-price"><b>$9.99</b> a month · cancel any time</p>
       ${
         p.upgradeUrl
           ? `<a class="fuel-btn" href="${esc(p.upgradeUrl)}" target="_blank" rel="noopener" data-upgrade>Upgrade to Fuel AI</a>`
           : '<p class="fuel-error">Fuel AI sign-ups open soon. Ask Max about it at your next session.</p>'
       }
       <button class="fuel-btn fuel-btn--quiet" type="button" data-refresh>Already paid? Tap to refresh</button>
       <p class="fuel-disclaimer">Barcode scanning, your totals and "what to eat next" ideas stay free.</p>`,
      (body) => {
        const upgrade = body.querySelector("[data-upgrade]");
        if (upgrade) upgrade.addEventListener("click", () => (state.awaitingUpgrade = true));
        body.querySelector("[data-refresh]").addEventListener("click", (e) => refreshPlan(e.target));
      }
    );
  }

  /** Re-reads the plan (asking the server to check Stripe first). */
  async function refreshPlan(btn) {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Checking…";
    }
    try {
      const data = await MacroApi.call("me", { date: state.viewDate, sync: true });
      applyMe(data);
      render();
      if (fuelAi()) {
        closeSheet();
        toast("Fuel AI is on");
      } else if (btn) {
        btn.disabled = false;
        btn.textContent = "Not showing yet. Tap to check again";
      }
    } catch (err) {
      if (btn) btn.disabled = false;
      toast(err.message);
    }
  }

  function pickPhoto(mode, useCamera) {
    state.pendingPhotoMode = mode;
    const input = useCamera ? els.photoInput : els.libraryInput;
    input.value = "";
    input.click();
  }

  function onPhotoChosen(e) {
    const file = e.target.files && e.target.files[0];
    const mode = state.pendingPhotoMode;
    state.pendingPhotoMode = null;
    if (!file || !mode) return;
    if (mode === "barcodeImage") decodeBarcodePhoto(file);
    else analysePhoto(file, mode);
  }
  els.photoInput.addEventListener("change", onPhotoChosen);
  els.libraryInput.addEventListener("change", onPhotoChosen);

  /** Shrinks a photo to 1024px on its long edge, JPEG 0.8, and returns the base64 (no data: prefix). */
  function resizeImage(file, maxEdge = 1024, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", quality).split(",")[1]);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Couldn't open that photo. Try a different one."));
      };
      img.src = url;
    });
  }

  async function analysePhoto(file, mode) {
    sheetLoading(mode === "label" ? "Reading the label" : "Reading your meal");
    let data;
    try {
      const image = await resizeImage(file);
      data = await MacroApi.call("analyseImage", { image: image, mode: mode }, { timeoutMs: 90000 });
    } catch (err) {
      if (err.code === "no_plan") {
        if (state.plan) state.plan.access = false;
        openUpsell();
        return;
      }
      const again = `<button class="fuel-btn" type="button" data-retry="${mode}">Try another photo</button>`;
      const alt = mode === "meal" ? '<button class="fuel-btn fuel-btn--ghost" type="button" data-retry="barcode">Scan a barcode instead</button>' : "";
      sheetError("Hmm", err.message, again + alt);
      return;
    }
    if (typeof data.scansLeft === "number") state.scansLeft = data.scansLeft;

    if (mode === "label") {
      const l = data.label;
      openConfirm({
        title: l.name,
        source: "label",
        items: [
          {
            name: l.name,
            grams: l.serving_g || 100,
            per100: l.per100,
            serving_g: l.serving_g,
            unit: l.unit,
            confidence: l.confidence,
            notes: l.notes,
            source: "label",
          },
        ],
      });
      return;
    }
    const meal = data.meal;
    if (!meal.items.length) {
      sheetError(
        "No food spotted",
        meal.meal_guess || "We couldn't see any food in that photo.",
        '<button class="fuel-btn" type="button" data-retry="meal">Try another photo</button>'
      );
      return;
    }
    openConfirm({ title: meal.meal_guess || "Your meal", source: "photo", items: meal.items });
  }

  // ---------------------------------------------------------------------------
  // Barcode scanning
  // ---------------------------------------------------------------------------

  const BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
  let zxingPromise = null;

  function loadZxing() {
    if (window.ZXingBrowser) return Promise.resolve(window.ZXingBrowser);
    if (!zxingPromise) {
      zxingPromise = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "vendor/zxing-browser.min.js?v=0.2.1";
        s.onload = () => resolve(window.ZXingBrowser);
        s.onerror = () => {
          zxingPromise = null;
          reject(new Error("Couldn't load the barcode scanner."));
        };
        document.head.appendChild(s);
      });
    }
    return zxingPromise;
  }

  async function nativeDetector() {
    if (!("BarcodeDetector" in window)) return null;
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = BARCODE_FORMATS.filter((f) => supported.indexOf(f) >= 0);
      return formats.length ? new window.BarcodeDetector({ formats: formats }) : null;
    } catch (err) {
      return null;
    }
  }

  function cameraErrorText(err) {
    if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
      return "Camera access is off for this app. Turn it on in your phone's Settings, or type the number below.";
    }
    if (err && err.name === "NotFoundError") return "No camera found. Type the number below instead.";
    return "The camera didn't start. Type the number below, or take a photo of the barcode.";
  }

  function openBarcode() {
    let stopped = false;
    let stream = null;
    let timer = null;
    let zxControls = null;

    function stop() {
      stopped = true;
      clearTimeout(timer);
      if (zxControls) {
        try {
          zxControls.stop();
        } catch (err) {
          // ignore
        }
      }
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }

    openSheet(
      `<h2 class="fuel-sheet__title" id="fuelSheetTitle">Scan a barcode</h2>
       <p class="fuel-sheet__sub">Line the barcode up inside the red box.</p>
       <div class="fuel-camera">
         <video playsinline muted autoplay></video>
         <div class="fuel-camera__frame" data-cam-frame aria-hidden="true"></div>
         <div class="fuel-camera__msg" data-cam-msg>Starting camera…</div>
       </div>
       <form class="fuel-inline" data-code-form autocomplete="off">
         <input class="fuel-input" name="code" inputmode="numeric" pattern="[0-9]*" placeholder="Or type the barcode number" aria-label="Barcode number" />
         <button class="fuel-btn" type="submit">Look up</button>
       </form>
       <button class="fuel-btn fuel-btn--quiet" type="button" data-photo-barcode>Take a photo of the barcode instead</button>`,
      (body) => {
        const video = body.querySelector("video");
        const msg = body.querySelector("[data-cam-msg]");
        const frame = body.querySelector("[data-cam-frame]");
        const cameraFailed = (text) => {
          msg.hidden = false;
          msg.textContent = text;
          frame.hidden = true;
        };
        body.querySelector("[data-code-form]").addEventListener("submit", (e) => {
          e.preventDefault();
          const code = e.target.code.value.replace(/\D/g, "");
          if (code.length < 6) {
            msg.textContent = "That number looks too short.";
            return;
          }
          stop();
          lookupBarcode(code);
        });
        body.querySelector("[data-photo-barcode]").addEventListener("click", () => {
          stop();
          pickPhoto("barcodeImage", true);
        });

        const found = (code) => {
          if (stopped) return;
          stop();
          if (navigator.vibrate) navigator.vibrate(40);
          lookupBarcode(code);
        };

        (async () => {
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            cameraFailed("Live scanning isn't available here. Type the number, or take a photo of the barcode.");
            return;
          }
          const detector = await nativeDetector();
          try {
            if (detector) {
              stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
              if (stopped) return stop();
              video.srcObject = stream;
              await video.play();
              msg.hidden = true;
              const tick = async () => {
                if (stopped) return;
                try {
                  const codes = await detector.detect(video);
                  if (codes.length) return found(codes[0].rawValue);
                } catch (err) {
                  // Frame not ready yet — keep going.
                }
                timer = setTimeout(tick, 200);
              };
              tick();
            } else {
              // iPhone Safari has no BarcodeDetector — ZXing does it in JS.
              const ZX = await loadZxing();
              if (stopped) return;
              const reader = new ZX.BrowserMultiFormatReader();
              zxControls = await reader.decodeFromConstraints(
                { video: { facingMode: { ideal: "environment" } }, audio: false },
                video,
                (result) => {
                  if (result) found(result.getText());
                }
              );
              if (stopped) return stop();
              msg.hidden = true;
            }
          } catch (err) {
            cameraFailed(cameraErrorText(err));
          }
        })();

        return stop;
      }
    );
  }

  async function decodeBarcodePhoto(file) {
    sheetLoading("Reading the barcode");
    const url = URL.createObjectURL(file);
    let code = null;
    try {
      const detector = await nativeDetector();
      if (detector) {
        const bitmap = await createImageBitmap(file);
        const codes = await detector.detect(bitmap);
        if (codes.length) code = codes[0].rawValue;
      } else {
        const ZX = await loadZxing();
        const result = await new ZX.BrowserMultiFormatReader().decodeFromImageUrl(url);
        code = result && result.getText();
      }
    } catch (err) {
      code = null;
    } finally {
      URL.revokeObjectURL(url);
    }
    if (code) lookupBarcode(code);
    else
      sheetError(
        "Couldn't read that barcode",
        "Try again with the barcode flat and filling more of the photo, or type the number in.",
        '<button class="fuel-btn" type="button" data-retry="barcode">Back to barcode</button>'
      );
  }

  async function lookupBarcode(code) {
    sheetLoading("Looking it up");
    let data;
    try {
      data = await MacroApi.call("barcode", { code: code });
    } catch (err) {
      sheetError(
        "Lookup failed",
        err.message,
        '<button class="fuel-btn" type="button" data-retry="barcode">Try again</button>' +
          (fuelAi()
            ? '<button class="fuel-btn fuel-btn--ghost" type="button" data-retry="label">Snap the nutrition label instead</button>'
            : "")
      );
      return;
    }
    const p = data.product;
    if (!p.found) {
      openSheet(
        `<h2 class="fuel-sheet__title" id="fuelSheetTitle">Not in the database yet</h2>
         <p class="fuel-sheet__sub">Barcode ${esc(code)}${p.name ? ` · ${esc(p.name)}` : ""}</p>
         ${
           fuelAi()
             ? `<p class="fuel-disclaimer">No problem. Snap the nutrition panel on the pack and we'll read the numbers from that.</p>
                <button class="fuel-btn" type="button" data-retry="label">Snap the nutrition label instead</button>
                <button class="fuel-btn fuel-btn--ghost" type="button" data-retry="barcode">Scan something else</button>`
             : `<p class="fuel-disclaimer">No problem. Some smaller brands aren't in the free food database yet.</p>
                <button class="fuel-btn" type="button" data-retry="barcode">Scan something else</button>`
         }`,
        (body) => {
          body.querySelectorAll("[data-retry]").forEach((b) =>
            b.addEventListener("click", () => (b.dataset.retry === "barcode" ? openBarcode() : pickPhoto("label", true)))
          );
        }
      );
      return;
    }
    const name = p.brand && p.name.toLowerCase().indexOf(p.brand.toLowerCase()) < 0 ? `${p.brand} ${p.name}` : p.name;
    openConfirm({
      title: name,
      source: "barcode",
      quality: p.quality,
      items: [
        {
          name: name,
          grams: p.serving_g || 100,
          per100: p.per100,
          serving_g: p.serving_g,
          unit: p.unit,
          confidence: "high",
          source: "barcode",
        },
      ],
    });
  }

  // ---------------------------------------------------------------------------
  // Confirm sheet
  // ---------------------------------------------------------------------------

  function rangeMax(item) {
    const base = Math.max(Number(item.grams) || 0, Number(item.serving_g) || 0, 50);
    return Math.min(2000, Math.ceil((base * 2.5) / 10) * 10);
  }

  function itemMacros(item) {
    return MacroCore.scale(item.per100, item.grams);
  }

  function servesHtml(item, i) {
    if (!item.serving_g) {
      return item.source === "barcode" || item.source === "label"
        ? `<div class="fuel-serves"><button type="button" data-serve="${i}" data-g="100">100${item.unit || "g"}</button></div>`
        : "";
    }
    const s = item.serving_g;
    const unit = item.unit || "g";
    const opts = [
      [0.5, `½ serve`],
      [1, `1 serve · ${int(s)}${unit}`],
      [2, "2 serves"],
    ];
    return `<div class="fuel-serves">
      ${opts.map(([mult, label]) => `<button type="button" data-serve="${i}" data-g="${Math.round(s * mult * 10) / 10}">${label}</button>`).join("")}
      <button type="button" data-serve="${i}" data-g="100">100${unit}</button>
    </div>`;
  }

  function confidenceTag(item) {
    if (item.source !== "photo") return "";
    if (item.confidence === "low") return '<span class="fuel-tag fuel-tag--red">Unsure</span>';
    if (item.confidence === "medium") return '<span class="fuel-tag">Estimate</span>';
    return "";
  }

  function itemHtml(item, i) {
    const max = rangeMax(item);
    const step = max > 400 ? 5 : 1;
    return `
      <div class="fuel-item" data-item="${i}">
        <div class="fuel-item__top">
          <input class="fuel-item__name" value="${esc(item.name)}" data-name="${i}" aria-label="Food name" maxlength="80" />
          ${confidenceTag(item)}
          <button class="fuel-item__remove" type="button" data-remove="${i}" aria-label="Remove ${esc(item.name)}">${ICONS.x}</button>
        </div>
        ${servesHtml(item, i)}
        <div class="fuel-item__grams">
          <input class="fuel-range" type="range" min="0" max="${max}" step="${step}" value="${Math.min(max, item.grams)}" data-range="${i}" aria-label="Amount" />
          <label class="fuel-item__gin"><input class="fuel-input" type="number" inputmode="decimal" min="0" max="5000" step="1" value="${item.grams}" data-grams="${i}" aria-label="Grams" /><span>${esc(item.unit || "g")}</span></label>
        </div>
        <div class="fuel-item__macros" data-macros="${i}">${macroLine(itemMacros(item), { bold: true })}</div>
        ${item.notes ? `<p class="fuel-item__note">${esc(item.notes)}</p>` : ""}
      </div>`;
  }

  function sourceNote(c) {
    if (c.source === "photo") return "Estimates only, typically within about 20% for photos. Slide to adjust.";
    if (c.source === "barcode") {
      return c.quality === "check"
        ? "From the product's label data. These numbers look a little odd, so check them against the pack."
        : "Exact · from the product's label data (Open Food Facts).";
    }
    if (c.source === "label") return "Read from your label photo. Check the numbers match the pack.";
    return "";
  }

  function confirmTotals(c) {
    return MacroCore.sumTotals(c.items.map(itemMacros));
  }

  function openConfirm(opts) {
    state.confirm = {
      title: opts.title,
      source: opts.source,
      quality: opts.quality,
      meal: defaultMeal(),
      items: opts.items.map((it) => Object.assign({}, it, { grams: Math.round(Number(it.grams) || 100) })),
    };
    renderConfirm();
  }

  function renderConfirm() {
    const c = state.confirm;
    if (!c) return;
    if (!c.items.length) {
      closeSheet();
      return;
    }
    const where = isToday() ? "today" : dayLabel(state.viewDate);
    openSheet(
      `<h2 class="fuel-sheet__title" id="fuelSheetTitle">${esc(c.title)}</h2>
       <p class="fuel-disclaimer">${esc(sourceNote(c))}</p>
       ${c.items.map(itemHtml).join("")}
       <div class="fuel-field">
         <span class="card__label">Meal</span>
         <div class="fuel-seg" data-meals>
           ${MacroCore.MEALS.map((m) => `<button type="button" data-meal="${m}" class="${m === c.meal ? "is-on" : ""}">${MEAL_SHORT[m]}</button>`).join("")}
         </div>
       </div>
       <div class="fuel-sum">
         <span class="card__label">Total</span>
         <span class="fuel-sum__nums" data-sum>${macroLine(confirmTotals(c))}</span>
       </div>
       <button class="fuel-btn" type="button" data-add>Add to ${esc(where)}</button>
       <button class="fuel-btn fuel-btn--quiet" type="button" data-close>Cancel</button>`,
      (body) => {
        const refresh = (i) => {
          const item = c.items[i];
          body.querySelector(`[data-macros="${i}"]`).innerHTML = macroLine(itemMacros(item), { bold: true });
          body.querySelector("[data-sum]").innerHTML = macroLine(confirmTotals(c));
        };
        const setGrams = (i, grams, from) => {
          const g = Math.max(0, Math.min(5000, Number(grams) || 0));
          c.items[i].grams = g;
          const range = body.querySelector(`[data-range="${i}"]`);
          const box = body.querySelector(`[data-grams="${i}"]`);
          if (from !== "range") range.value = Math.min(Number(range.max), g);
          if (from !== "box") box.value = g;
          refresh(i);
        };
        body.addEventListener("input", (e) => {
          const t = e.target;
          if (t.dataset.range !== undefined) setGrams(Number(t.dataset.range), t.value, "range");
          else if (t.dataset.grams !== undefined) setGrams(Number(t.dataset.grams), t.value, "box");
          else if (t.dataset.name !== undefined) c.items[Number(t.dataset.name)].name = t.value;
        });
        body.addEventListener("click", async (e) => {
          const serve = e.target.closest("[data-serve]");
          if (serve) {
            const i = Number(serve.dataset.serve);
            setGrams(i, serve.dataset.g);
            body.querySelectorAll(`[data-serve="${i}"]`).forEach((b) => b.classList.toggle("is-on", b === serve));
            return;
          }
          const remove = e.target.closest("[data-remove]");
          if (remove) {
            c.items.splice(Number(remove.dataset.remove), 1);
            renderConfirm();
            return;
          }
          const meal = e.target.closest("[data-meal]");
          if (meal) {
            c.meal = meal.dataset.meal;
            body.querySelectorAll("[data-meal]").forEach((b) => b.classList.toggle("is-on", b === meal));
            return;
          }
          const add = e.target.closest("[data-add]");
          if (add) {
            const items = c.items.filter((it) => Number(it.grams) > 0 && String(it.name).trim());
            if (!items.length) {
              toast("Set an amount above 0 first");
              return;
            }
            add.disabled = true;
            add.textContent = "Adding…";
            try {
              const mealName = c.meal;
              const ids = await addItems(items, mealName);
              openAfterLog(mealName, ids);
            } catch (err) {
              add.disabled = false;
              add.textContent = `Add to ${where}`;
              toast(err.message);
            }
          }
        });
      }
    );
  }

  /** Straight after logging: what's left today and what would fill it. */
  function openAfterLog(mealName, ids) {
    const ideas = isToday() ? suggestionsHtml(3, false) : "";
    if (!ideas) {
      closeSheet();
      toast(`Added to ${MEAL_SHORT[mealName]}`, () => undoAdd(ids));
      return;
    }
    openSheet(
      `<h2 class="fuel-sheet__title" id="fuelSheetTitle">Added to ${esc(MEAL_SHORT[mealName])}</h2>
       ${ideas}
       <button class="fuel-btn" type="button" data-close>Done</button>
       <button class="fuel-btn fuel-btn--quiet" type="button" data-undo>Undo</button>`,
      (body) => {
        body.querySelector("[data-undo]").addEventListener("click", async () => {
          closeSheet();
          await undoAdd(ids);
          toast("Removed");
        });
        body.addEventListener("click", async (e) => {
          const btn = e.target.closest('[data-act="log-idea"]');
          if (!btn) return;
          await logIdea(btn);
          closeSheet();
        });
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Ask Fuel (Fuel AI): the AI copilot chat
  // ---------------------------------------------------------------------------

  const CHAT_STARTERS = ["What should I have for dinner?", "What can I get at Guzman?", "I'm hungry but I'm over. Help!"];
  let chatFoods = []; // loggable foods in the conversation, by index

  function chatHtml() {
    chatFoods = [];
    if (!state.chat.length) {
      return `<p class="fuel-disclaimer">Ask anything about food and your macros today. Fuel can see what you've logged and what's left.</p>
        <div class="fuel-serves">${CHAT_STARTERS.map((q) => `<button type="button" data-starter="${esc(q)}">${esc(q)}</button>`).join("")}</div>`;
    }
    return state.chat
      .map((m) => {
        if (m.role === "user") return `<div class="fuel-msg fuel-msg--me">${esc(m.content)}</div>`;
        if (m.pending) return `<div class="fuel-msg"><span class="fuel-typing"><i></i><i></i><i></i></span></div>`;
        const chips = (m.foods || [])
          .map((f) => {
            chatFoods.push(f);
            return `<button class="fuel-chip" type="button" data-chat-log="${chatFoods.length - 1}">
              <span class="fuel-chip__name">+ ${esc(Math.round(f.grams))}g ${esc(f.name)}</span>
              <span class="fuel-chip__meta">${ideaMacros(f)}</span>
            </button>`;
          })
          .join("");
        return `<div class="fuel-msg${m.error ? " fuel-msg--error" : ""}">${esc(m.content).replace(/\n/g, "<br>")}</div>${
          chips ? `<div class="fuel-chips fuel-chips--wrap">${chips}</div>` : ""
        }`;
      })
      .join("");
  }

  function openChat() {
    if (!fuelAi()) {
      openUpsell();
      return;
    }
    openSheet(
      `<h2 class="fuel-sheet__title" id="fuelSheetTitle">Ask Fuel</h2>
       <p class="fuel-sheet__sub">${esc(planText())}</p>
       <div class="fuel-chat" data-chat>${chatHtml()}</div>
       <form class="fuel-inline" data-chat-form autocomplete="off">
         <input class="fuel-input" name="q" maxlength="500" placeholder="Ask about food…" aria-label="Your question" />
         <button class="fuel-btn" type="submit">Send</button>
       </form>
       <p class="fuel-disclaimer">General guidance, not medical advice.</p>`,
      (body) => {
        const box = body.querySelector("[data-chat]");
        const form = body.querySelector("[data-chat-form]");
        const paint = () => {
          box.innerHTML = chatHtml();
          box.scrollTop = box.scrollHeight;
        };
        const send = async (text) => {
          const q = String(text || "").trim();
          if (!q || state.busy) return;
          state.busy = true;
          state.chat.push({ role: "user", content: q });
          const pending = { role: "assistant", pending: true };
          state.chat.push(pending);
          paint();
          const history = state.chat
            .filter((m) => !m.pending && !m.error)
            .slice(-10)
            .map((m) => ({ role: m.role, content: m.content }));
          try {
            const data = await MacroApi.call("chat", { date: state.viewDate, messages: history }, { timeoutMs: 60000 });
            Object.assign(pending, { pending: false, content: data.reply, foods: data.foods || [] });
          } catch (err) {
            if (err.code === "no_plan") {
              state.chat.pop();
              state.busy = false;
              if (state.plan) state.plan.access = false;
              openUpsell();
              return;
            }
            Object.assign(pending, { pending: false, error: true, content: err.message });
          } finally {
            state.busy = false;
          }
          paint();
        };
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          const q = form.q.value;
          form.q.value = "";
          send(q);
        });
        box.addEventListener("click", async (e) => {
          const starter = e.target.closest("[data-starter]");
          if (starter) {
            send(starter.dataset.starter);
            return;
          }
          const logBtn = e.target.closest("[data-chat-log]");
          if (logBtn && !state.busy) {
            const f = chatFoods[Number(logBtn.dataset.chatLog)];
            if (!f) return;
            state.busy = true;
            logBtn.disabled = true;
            const meal = defaultMeal();
            try {
              const ids = await addItems([{ name: f.name, grams: f.grams, per100: f.per100, source: "suggestion" }], meal);
              toast(`Added to ${MEAL_SHORT[meal]}`, () => undoAdd(ids));
            } catch (err) {
              logBtn.disabled = false;
              toast(err.message);
            } finally {
              state.busy = false;
            }
          }
        });
        box.scrollTop = box.scrollHeight;
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Progress (free): weight vs goal, calorie target steps, last 14 days
  // ---------------------------------------------------------------------------

  const SVGNS = "http://www.w3.org/2000/svg";
  const W = 330; // chart viewBox width

  function svg(parent, tag, attrs, text) {
    const el = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach((k) => el.setAttribute(k, attrs[k]));
    if (text != null) el.textContent = text;
    parent.appendChild(el);
    return el;
  }

  function shortDate(ymd) {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  }

  function kgText(kg) {
    return (Math.round(kg * 10) / 10).toFixed(1);
  }

  /** "74.2 kg · ↓0.4 kg this week" under the totals, once there are weigh-ins. */
  function trendHtml() {
    const t = state.weightTrend;
    if (!t || !isToday()) return "";
    let change = "";
    if (t.change7 != null && Math.abs(t.change7) >= 0.1) change = ` · ${t.change7 < 0 ? "↓" : "↑"}${kgText(Math.abs(t.change7))} kg this week`;
    else if (t.change7 != null) change = " · steady this week";
    return `<button class="fuel-trend" type="button" data-act="progress">
      <span class="card__label">Weight trend</span>
      <span class="fuel-trend__val">${kgText(t.kg)} kg${esc(change)}</span>
      ${ICONS.right}
    </button>`;
  }

  /** Nice round y-axis ticks between lo and hi. */
  function ticks(lo, hi, count) {
    const span = hi - lo || 1;
    const raw = span / (count || 3);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= raw) || raw;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
    return out;
  }

  function drawWeightChart(box, readout) {
    const p = state.progress;
    const all = p.weights || [];
    const trendAll = MacroCore.movingAverage(all, 7);
    const today = p.today;
    const from = state.progressRange ? MacroCore.addDays(today, -state.progressRange) : all.length ? all[0].date : today;
    const pts = all.filter((w) => w.date >= from);
    const trend = trendAll.filter((w) => w.date >= from);
    if (!pts.length) {
      box.innerHTML = `<p class="fuel-empty">Log a weigh-in and your trend line starts here. Weigh yourself first thing in the morning for the fairest comparison.</p>`;
      return;
    }
    // Pace line from the first trend point in view, peeking up to 2 weeks
    // past today — enough to see where it's heading without squashing the data.
    const g = p.goal || {};
    const pace = MacroCore.goalPace(trend[0].date, trend[0].kg, g.weekly_rate_kg, g.goal_weight_kg, MacroCore.addDays(today, 14));
    const x0 = pts[0].date;
    const x1 = pace.length && pace[1].date > today ? pace[1].date : today;
    const values = pts.map((q) => q.kg).concat(trend.map((q) => q.kg), pace.map((q) => q.kg));
    // The goal gets its own line only when it's close; otherwise it's named in the header.
    const goalNear = g.goal_weight_kg && Math.abs(g.goal_weight_kg - trend[trend.length - 1].kg) <= 3;
    if (goalNear) values.push(g.goal_weight_kg);
    const lo = Math.floor(Math.min.apply(null, values) - 0.5);
    const hi = Math.ceil(Math.max.apply(null, values) + 0.5);
    const H = 160, L = 34, R = W - 8, T = 10, B = H - 24;
    const span = Math.max(1, MacroCore.daysBetween(x0, x1));
    const x = (d) => L + ((R - L) * MacroCore.daysBetween(x0, d)) / span;
    const y = (v) => T + ((B - T) * (hi - v)) / (hi - lo || 1);
    const root = svg(box, "svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": "Weight trend" });
    ticks(lo, hi, 3).forEach((v) => {
      svg(root, "line", { x1: L, x2: R, y1: y(v), y2: y(v), class: "fuel-grid" });
      svg(root, "text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }, v);
    });
    if (goalNear) {
      svg(root, "line", { x1: L, x2: R, y1: y(g.goal_weight_kg), y2: y(g.goal_weight_kg), class: "fuel-goal" });
      svg(root, "text", { x: R, y: y(g.goal_weight_kg) - 5, "text-anchor": "end", class: "fuel-chart__strong" }, `Goal ${kgText(g.goal_weight_kg)} kg`);
    }
    if (pace.length) svg(root, "line", { x1: x(pace[0].date), y1: y(pace[0].kg), x2: x(pace[1].date), y2: y(pace[1].kg), class: "fuel-pace" });
    pts.forEach((q) => svg(root, "circle", { cx: x(q.date), cy: y(q.kg), r: 2.6, class: "fuel-dot" }));
    if (trend.length > 1) {
      svg(root, "polyline", { points: trend.map((q) => `${x(q.date)},${y(q.kg)}`).join(" "), class: "fuel-line" });
    }
    const last = trend[trend.length - 1];
    svg(root, "circle", { cx: x(last.date), cy: y(last.kg), r: 4.5, class: "fuel-dot--now" });
    svg(root, "text", { x: L, y: H - 6 }, shortDate(x0));
    svg(root, "text", { x: x(today), y: H - 6, "text-anchor": x1 > today ? "middle" : "end" }, "Today");
    if (x1 > today) svg(root, "text", { x: R, y: H - 6, "text-anchor": "end" }, pace[1].goalReached ? "Goal" : shortDate(x1));
    // Tap/hover targets bigger than the dots.
    pts.forEach((q) => {
      const avg = trendAll.find((t) => t.date === q.date);
      const hit = svg(root, "circle", { cx: x(q.date), cy: y(q.kg), r: 11, class: "fuel-hit" });
      const show = () => (readout.textContent = `${shortDate(q.date)} · ${kgText(q.kg)} kg${avg ? ` · 7-day average ${kgText(avg.kg)} kg` : ""}${q.by === "coach" ? " · logged by Max" : ""}`);
      hit.addEventListener("pointerenter", show);
      hit.addEventListener("click", show);
    });
  }

  function drawTargetChart(box) {
    const p = state.progress;
    const hide = hideKcal();
    const key = hide ? "protein_g" : "kcal";
    const today = p.today;
    // Several changes on one day: only the last one counts.
    const hist = [];
    (p.history || []).forEach((h) => {
      if (hist.length && hist[hist.length - 1].effective_date === h.effective_date) hist[hist.length - 1] = h;
      else hist.push(h);
    });
    if (!hist.length) {
      box.innerHTML = `<p class="fuel-empty">Your target history starts when you set targets.</p>`;
      return;
    }
    const from = MacroCore.addDays(today, -84);
    const end = MacroCore.addDays(today, 4); // a little room so today's target shows as a step
    // Steps: each row runs until the next one (the current one to `end`).
    const steps = [];
    hist.forEach((h, i) => {
      const until = i + 1 < hist.length ? hist[i + 1].effective_date : end;
      if (until < from || !(h[key] > 0)) return;
      steps.push({ a: h.effective_date < from ? from : h.effective_date, b: until, v: h[key] });
    });
    if (!steps.length) {
      box.innerHTML = `<p class="fuel-empty">No targets set right now.</p>`;
      return;
    }
    const x0 = steps[0].a;
    const vals = steps.map((st) => st.v);
    const lo = Math.min.apply(null, vals) * 0.92;
    const hi = Math.max.apply(null, vals) * 1.06;
    const H = 110, L = 34, R = W - 8, T = 16, B = H - 22;
    const span = Math.max(1, MacroCore.daysBetween(x0, end));
    const x = (d) => L + ((R - L) * MacroCore.daysBetween(x0, d)) / span;
    const y = (v) => T + ((B - T) * (hi - v)) / (hi - lo || 1);
    const root = svg(box, "svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": hide ? "Protein target over time" : "Calorie target over time" });
    let d = "";
    steps.forEach((st, i) => {
      d += `${i ? " L" : "M"}${x(st.a)},${y(st.v)} L${x(st.b)},${y(st.v)}`;
    });
    svg(root, "path", { d: d, class: "fuel-line fuel-line--step" });
    // Label each step that's wide enough; the current one always, at the right edge.
    steps.forEach((st, i) => {
      const label = hide ? `${int(st.v)}g` : int(st.v);
      const last = i === steps.length - 1;
      if (last) svg(root, "text", { x: R, y: y(st.v) - 6, "text-anchor": "end", class: "fuel-chart__strong" }, `${label} now`);
      else if (x(st.b) - x(st.a) >= 44) svg(root, "text", { x: (x(st.a) + x(st.b)) / 2, y: y(st.v) - 6, "text-anchor": "middle" }, label);
    });
    svg(root, "text", { x: L, y: H - 6 }, shortDate(x0));
    svg(root, "text", { x: x(today), y: H - 6, "text-anchor": "end" }, "Today");
  }

  function drawDaysChart(box, readout) {
    const p = state.progress;
    const days = p.days || [];
    const hide = hideKcal();
    const maxV = Math.max.apply(null, days.map((d) => Math.max(d.kcal, (d.target_kcal || 0) * 1.1)).concat([1])) * 1.05;
    const H = 150, L = hide ? 8 : 34, R = W - 8, T = 8, B = H - 22;
    const slot = (R - L) / days.length;
    const bw = Math.min(14, slot - 6);
    const y = (v) => B - ((B - T) * v) / maxV;
    const root = svg(box, "svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": "Daily calories, last 14 days" });
    if (!hide) {
      ticks(0, maxV, 2).forEach((v) => svg(root, "text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }, v >= 1000 ? `${Math.round(v / 100) / 10}k` : v));
    }
    days.forEach((d, i) => {
      const sx = L + slot * i;
      if (d.target_kcal) {
        svg(root, "rect", { x: sx, y: y(d.target_kcal * 1.1), width: slot, height: y(d.target_kcal * 0.9) - y(d.target_kcal * 1.1), class: "fuel-band" });
        svg(root, "line", { x1: sx, x2: sx + slot, y1: y(d.target_kcal), y2: y(d.target_kcal), class: "fuel-target" });
      }
    });
    days.forEach((d, i) => {
      const bx = L + slot * i + (slot - bw) / 2;
      if (d.kcal > 0) {
        const top = y(d.kcal);
        const h = Math.max(4, B - top);
        svg(root, "path", { d: `M${bx},${B} V${B - h + 4} q0,-4 4,-4 h${bw - 8} q4,0 4,4 V${B} Z`, class: d.green ? "fuel-bar fuel-bar--green" : "fuel-bar" });
      } else {
        svg(root, "line", { x1: bx, x2: bx + bw, y1: B - 1, y2: B - 1, class: "fuel-grid" });
      }
      const hit = svg(root, "rect", { x: L + slot * i, y: T, width: slot, height: B - T, class: "fuel-hit" });
      const show = () => {
        const kc = d.kcal > 0 ? (hide && d.target_kcal ? `${Math.round((d.kcal / d.target_kcal) * 100)}% of target` : `${int(d.kcal)} kcal`) : "nothing logged";
        readout.textContent = `${shortDate(d.date)} · ${kc}${d.kcal > 0 ? ` · ${int(d.protein_g)}g protein` : ""}${d.green ? " · green day" : ""}`;
      };
      hit.addEventListener("pointerenter", show);
      hit.addEventListener("click", show);
    });
    svg(root, "line", { x1: L, x2: R, y1: B, y2: B, class: "fuel-grid" });
    svg(root, "text", { x: L, y: H - 6 }, shortDate(days[0].date));
    svg(root, "text", { x: R, y: H - 6, "text-anchor": "end" }, "Today");
  }

  function weekDotsHtml(week, today) {
    const names = ["M", "T", "W", "T", "F", "S", "S"];
    return week.days
      .map((d, i) => {
        let cls = "fuel-wdot";
        if (d.green) cls += " is-green";
        else if (d.date > today) cls += " is-future";
        else if (d.date === today) cls += " is-today";
        else if (d.logged) cls += " is-logged";
        return `<span class="fuel-wday"><span class="${cls}"></span><span>${names[i]}</span></span>`;
      })
      .join("");
  }

  function punchText(p) {
    const need = p.punchEvery || 5;
    const lw = p.lastWeek;
    const tw = p.thisWeek;
    const daysLeft = tw.days.filter((d) => d.date >= p.today).length;
    const lines = [];
    if (lw.earnsPunch) {
      lines.push(lw.awarded ? `Last week: ${lw.greenDays} green days = +1 punch.` : `Last week: ${lw.greenDays} green days. Your punch lands on your card by tomorrow morning.`);
    } else if (lw.greenDays > 0) {
      lines.push(`Last week: ${lw.greenDays} green day${lw.greenDays === 1 ? "" : "s"}.`);
    }
    if (tw.greenDays >= need) lines.push("This week's punch is in the bag. Nice work.");
    else if (need - tw.greenDays <= daysLeft) {
      const more = need - tw.greenDays;
      lines.push(`This week: ${more} more green day${more === 1 ? "" : "s"} earns a punch.`);
    } else lines.push("Fresh start Monday. Every green day still counts.");
    return lines.join(" ");
  }

  function pegsHtml(loyalty) {
    if (!loyalty) return "";
    const filled = loyalty.owed ? 10 : (loyalty.attended + loyalty.punches) % 10;
    let pegs = "";
    for (let i = 0; i < 10; i++) {
      pegs += `<div class="card__loyalty-peg${i < filled ? " card__loyalty-peg--filled" : i === 9 ? " card__loyalty-peg--next" : ""}"></div>`;
    }
    return `
      <div class="fuel-punch">
        <div class="card__loyalty-head">
          <span class="card__label card__label--red">Sessions to free</span>
          <span class="card__loyalty-count">${loyalty.owed ? "Free session ready" : `${filled}/10`}</span>
        </div>
        <div class="card__loyalty-bar">${pegs}</div>
        <span class="fuel-row__note">${int(loyalty.attended)} class${loyalty.attended === 1 ? "" : "es"} + ${int(loyalty.punches)} nutrition punch${loyalty.punches === 1 ? "" : "es"}</span>
      </div>`;
  }

  async function openProgress() {
    sheetLoading("Loading your progress");
    try {
      const data = await MacroApi.call("progress", {});
      state.progress = data.progress;
      renderProgress();
    } catch (err) {
      sheetError("Couldn't load your progress", err.message, "");
    }
  }

  function renderProgress() {
    const p = state.progress;
    const tw = p.thisWeek;
    const green14 = p.days.filter((d) => d.green).length;
    const lastTrend = MacroCore.movingAverage(p.weights || [], 7).pop();
    const ranges = [[28, "4 wks"], [84, "12 wks"], [0, "All"]];
    openSheet(
      `<h2 class="fuel-sheet__title" id="fuelSheetTitle">Progress</h2>
       ${
         p.hideWeight
           ? '<div class="fuel-panel"><span class="card__label card__label--red">Weight</span><p class="fuel-empty">Weight is hidden. You can turn it back on in Fuel settings.</p></div>'
           : `<div class="fuel-panel fuel-chartcard">
                <span class="card__label card__label--red">Weight</span>
                <div class="fuel-chartcard__head">
                  <span class="fuel-row__nums">${lastTrend ? kgText(lastTrend.kg) : "–"}<span class="fuel-row__unit">kg</span></span>
                  <span class="fuel-row__note">${lastTrend ? "7-day average" : "No weigh-ins yet"}${p.goal && p.goal.goal_weight_kg ? ` · goal ${kgText(p.goal.goal_weight_kg)} kg` : ""}</span>
                </div>
                <form class="fuel-inline" data-weight-form autocomplete="off">
                  <input class="fuel-input" name="kg" type="number" inputmode="decimal" step="0.1" min="30" max="300" placeholder="Today's weight (kg)" aria-label="Today's weight in kg" />
                  <button class="fuel-btn" type="submit">Log</button>
                </form>
                <div class="fuel-seg" data-range>${ranges.map(([d, l]) => `<button type="button" data-days="${d}" class="${state.progressRange === d ? "is-on" : ""}">${l}</button>`).join("")}</div>
                <div class="fuel-chart" data-weight-chart></div>
                <p class="fuel-readout" data-weight-readout>Tap a dot for the details.</p>
                <p class="fuel-legend"><span class="fuel-key fuel-key--line"></span>7-day average <span class="fuel-key fuel-key--dot"></span>weigh-ins ${p.goal && p.goal.weekly_rate_kg ? '<span class="fuel-key fuel-key--pace"></span>goal pace' : ""}</p>
              </div>`
       }
       <div class="fuel-panel fuel-chartcard">
         <span class="card__label card__label--red">${hideKcal() ? "Your protein target" : "Your calorie target"}</span>
         <div class="fuel-chart" data-target-chart></div>
       </div>
       <div class="fuel-panel fuel-chartcard">
         <span class="card__label card__label--red">Last 14 days</span>
         <div class="fuel-chartcard__head">
           <span class="fuel-row__nums">${green14}<span class="fuel-row__unit">green days</span></span>
           <span class="fuel-row__note">protein hit and ${hideKcal() ? "on target" : "calories within 10%"}</span>
         </div>
         <div class="fuel-chart" data-days-chart></div>
         <p class="fuel-readout" data-days-readout>Tap a day for the details.</p>
         <div class="fuel-week">
           <span class="fuel-row__note">This week · ${tw.greenDays}/7 green</span>
           <span class="fuel-week__dots">${weekDotsHtml(tw, p.today)}</span>
         </div>
         <p class="fuel-punch__text">${esc(punchText(p))}</p>
         ${pegsHtml(p.loyalty)}
       </div>
       <button class="fuel-btn fuel-btn--quiet" type="button" data-close>Done</button>`,
      (body) => {
        const wBox = body.querySelector("[data-weight-chart]");
        if (wBox) drawWeightChart(wBox, body.querySelector("[data-weight-readout]"));
        drawTargetChart(body.querySelector("[data-target-chart]"));
        drawDaysChart(body.querySelector("[data-days-chart]"), body.querySelector("[data-days-readout]"));
        const range = body.querySelector("[data-range]");
        if (range) {
          range.addEventListener("click", (e) => {
            const b = e.target.closest("[data-days]");
            if (!b) return;
            state.progressRange = Number(b.dataset.days);
            range.querySelectorAll("button").forEach((x) => x.classList.toggle("is-on", x === b));
            wBox.innerHTML = "";
            drawWeightChart(wBox, body.querySelector("[data-weight-readout]"));
          });
        }
        const form = body.querySelector("[data-weight-form]");
        if (form) {
          form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const kg = Number(form.kg.value);
            if (!(kg >= 30 && kg <= 300)) {
              toast("Enter your weight in kg");
              return;
            }
            const btn = form.querySelector("button");
            btn.disabled = true;
            try {
              const data = await MacroApi.call("logWeight", { kg: kg, date: MacroCore.sydneyDate() });
              state.progress.weights = data.weights;
              state.weightTrend = data.weightTrend;
              render();
              renderProgress();
              toast("Weight logged");
            } catch (err) {
              btn.disabled = false;
              toast(err.message);
            }
          });
        }
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Edit an entry
  // ---------------------------------------------------------------------------

  function isFavourite(name) {
    return state.favourites.find((f) => f.name.toLowerCase() === String(name).toLowerCase());
  }

  function openEdit(entry) {
    const draft = { name: entry.name, grams: entry.grams, meal: entry.meal, per100: entry.per100 };
    const max = Math.min(2000, Math.max(50, Math.ceil((entry.grams * 2.5) / 10) * 10));
    openSheet(
      `<input class="fuel-item__name fuel-sheet__title" id="fuelSheetTitle" value="${esc(entry.name)}" data-ename aria-label="Food name" maxlength="80" />
       <div class="fuel-item">
         <div class="fuel-item__grams">
           <input class="fuel-range" type="range" min="0" max="${max}" step="${max > 400 ? 5 : 1}" value="${Math.min(max, entry.grams)}" data-erange aria-label="Amount" />
           <label class="fuel-item__gin"><input class="fuel-input" type="number" inputmode="decimal" min="0" max="5000" value="${entry.grams}" data-egrams aria-label="Grams" /><span>g</span></label>
         </div>
         <div class="fuel-item__macros" data-emacros>${macroLine(MacroCore.scale(entry.per100, entry.grams), { bold: true })}</div>
       </div>
       <div class="fuel-seg">
         ${MacroCore.MEALS.map((m) => `<button type="button" data-emeal="${m}" class="${m === entry.meal ? "is-on" : ""}">${MEAL_SHORT[m]}</button>`).join("")}
       </div>
       <button class="fuel-btn" type="button" data-esave>Save</button>
       <div class="fuel-sheet__row">
         <button class="fuel-btn fuel-btn--quiet" type="button" data-efav>${isFavourite(entry.name) ? "★ In favourites" : "☆ Add to favourites"}</button>
         <button class="fuel-btn fuel-btn--quiet" type="button" data-edelete>Delete</button>
       </div>`,
      (body) => {
        const range = body.querySelector("[data-erange]");
        const box = body.querySelector("[data-egrams]");
        const macros = body.querySelector("[data-emacros]");
        const update = (g, from) => {
          draft.grams = Math.max(0, Math.min(5000, Number(g) || 0));
          if (from !== "range") range.value = Math.min(Number(range.max), draft.grams);
          if (from !== "box") box.value = draft.grams;
          macros.innerHTML = macroLine(MacroCore.scale(draft.per100, draft.grams), { bold: true });
        };
        range.addEventListener("input", () => update(range.value, "range"));
        box.addEventListener("input", () => update(box.value, "box"));
        body.querySelector("[data-ename]").addEventListener("input", (e) => (draft.name = e.target.value));
        body.querySelectorAll("[data-emeal]").forEach((b) =>
          b.addEventListener("click", () => {
            draft.meal = b.dataset.emeal;
            body.querySelectorAll("[data-emeal]").forEach((x) => x.classList.toggle("is-on", x === b));
          })
        );
        body.querySelector("[data-esave]").addEventListener("click", async (e) => {
          if (!(draft.grams > 0)) {
            toast("Set an amount above 0, or delete it");
            return;
          }
          e.target.disabled = true;
          try {
            const data = await MacroApi.call("updateEntry", {
              entryId: entry.id,
              grams: draft.grams,
              meal: draft.meal,
              name: draft.name,
            });
            state.day = data.day;
            render();
            closeSheet();
            toast("Saved");
          } catch (err) {
            e.target.disabled = false;
            toast(err.message);
          }
        });
        const del = body.querySelector("[data-edelete]");
        del.addEventListener("click", async () => {
          if (!del.dataset.armed) {
            del.dataset.armed = "1";
            del.textContent = "Tap again to delete";
            del.style.color = "var(--white)";
            return;
          }
          del.disabled = true;
          try {
            const data = await MacroApi.call("deleteEntry", { entryId: entry.id });
            state.day = data.day;
            render();
            closeSheet();
            toast("Deleted");
          } catch (err) {
            del.disabled = false;
            toast(err.message);
          }
        });
        const fav = body.querySelector("[data-efav]");
        fav.addEventListener("click", async () => {
          fav.disabled = true;
          try {
            const existing = isFavourite(draft.name);
            const data = existing
              ? await MacroApi.call("removeFavourite", { favouriteId: existing.id })
              : await MacroApi.call("addFavourite", {
                  item: { name: draft.name, grams: draft.grams, per100: draft.per100, source: entry.source },
                });
            state.favourites = data.favourites;
            fav.textContent = isFavourite(draft.name) ? "★ In favourites" : "☆ Add to favourites";
            render();
          } catch (err) {
            toast(err.message);
          } finally {
            fav.disabled = false;
          }
        });
      }
    );
  }

  function openFavourites() {
    const list = state.favourites;
    openSheet(
      `<h2 class="fuel-sheet__title" id="fuelSheetTitle">Favourites</h2>
       <p class="fuel-sheet__sub">Tap a favourite on the Fuel screen to log it in one go. Add more from any logged item.</p>
       <div class="fuel-panel">
         ${
           list.length
             ? list
                 .map(
                   (f) => `
           <div class="fuel-entry" style="cursor:default">
             <span><span class="fuel-entry__name">${esc(f.name)}</span><span class="fuel-entry__meta">${int(f.grams)}g · ${macroLine(MacroCore.scale(f.per100, f.grams))}</span></span>
             <button class="fuel-item__remove" type="button" data-unfav="${esc(f.id)}" aria-label="Remove ${esc(f.name)}">${ICONS.x}</button>
           </div>`
                 )
                 .join("")
             : '<p class="fuel-empty">No favourites yet.</p>'
         }
       </div>
       <button class="fuel-btn fuel-btn--quiet" type="button" data-close>Done</button>`,
      (body) => {
        body.querySelectorAll("[data-unfav]").forEach((b) =>
          b.addEventListener("click", async () => {
            b.disabled = true;
            try {
              const data = await MacroApi.call("removeFavourite", { favouriteId: b.dataset.unfav });
              state.favourites = data.favourites;
              render();
              openFavourites();
            } catch (err) {
              b.disabled = false;
              toast(err.message);
            }
          })
        );
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Targets
  // ---------------------------------------------------------------------------

  const ACTIVITY_OPTIONS = [
    ["sedentary", "Mostly sitting, little exercise"],
    ["light", "Light: training 1–3× a week"],
    ["moderate", "Moderate: training 3–5× a week"],
    ["very", "Very active: training 6–7× a week"],
    ["athlete", "Athlete: twice a day or a physical job"],
  ];

  function openTargets() {
    const g = state.targets;
    if (g && g.set_by === "coach") {
      openSheet(
        `<h2 class="fuel-sheet__title" id="fuelSheetTitle">Your targets</h2>
         <p class="fuel-sheet__sub">Set by Max</p>
         <div class="fuel-result">
           <div><b>${int(g.protein_g)}</b><span class="card__label">Protein g</span></div>
           <div><b>${int(g.carbs_g)}</b><span class="card__label">Carbs g</span></div>
           <div><b>${int(g.fat_g)}</b><span class="card__label">Fat g</span></div>
           <div><b>${hideKcal() ? "—" : int(g.kcal)}</b><span class="card__label">kcal</span></div>
         </div>
         <p class="fuel-disclaimer">Want them changed? Have a chat with Max at your next session.</p>
         <button class="fuel-btn fuel-btn--quiet" type="button" data-close>Close</button>`
      );
      return;
    }

    const prev = (g && g.calc_inputs) || {};
    const form = {
      sex: prev.sex || (state.member && state.member.sex) || "",
      age: prev.age || "",
      heightCm: prev.heightCm || "",
      weightKg: prev.weightKg || "",
      activity: prev.activity || "moderate",
      goal: prev.goal || "maintain",
      adjustPct: prev.adjustPct == null ? null : prev.adjustPct,
      goalWeightKg: (g && g.goal_weight_kg) || "",
    };

    openSheet(
      `<h2 class="fuel-sheet__title" id="fuelSheetTitle">Daily targets</h2>
       <p class="fuel-sheet__sub">A starting point. Max can fine-tune it with you.</p>
       <div class="fuel-field">
         <span class="card__label">Sex (for the energy formula)</span>
         <div class="fuel-seg" data-group="sex">
           <button type="button" data-v="F">Female</button><button type="button" data-v="M">Male</button>
         </div>
       </div>
       <div class="fuel-fields3">
         <label class="fuel-field"><span class="card__label">Age</span><input class="fuel-input" name="age" type="number" inputmode="numeric" value="${esc(form.age)}" /></label>
         <label class="fuel-field"><span class="card__label">Height cm</span><input class="fuel-input" name="heightCm" type="number" inputmode="decimal" value="${esc(form.heightCm)}" /></label>
         <label class="fuel-field"><span class="card__label">Weight kg</span><input class="fuel-input" name="weightKg" type="number" inputmode="decimal" value="${esc(form.weightKg)}" /></label>
       </div>
       <label class="fuel-field"><span class="card__label">Activity</span>
         <select class="fuel-input" name="activity">
           ${ACTIVITY_OPTIONS.map(([v, l]) => `<option value="${v}" ${v === form.activity ? "selected" : ""}>${l}</option>`).join("")}
         </select>
       </label>
       <div class="fuel-field">
         <span class="card__label">Goal</span>
         <div class="fuel-seg" data-group="goal">
           <button type="button" data-v="cut">Lose fat</button><button type="button" data-v="maintain">Maintain</button><button type="button" data-v="gain">Lean gain</button>
         </div>
       </div>
       <div class="fuel-field" data-pace-wrap>
         <span class="card__label">Pace</span>
         <div class="fuel-seg" data-group="adjustPct"></div>
         <label class="fuel-field" style="margin-top:6px"><span class="card__label">Goal weight kg (optional)</span><input class="fuel-input" name="goalWeightKg" type="number" inputmode="decimal" step="0.1" value="${esc(form.goalWeightKg)}" placeholder="For your progress chart" /></label>
       </div>
       <div data-preview></div>
       <button class="fuel-btn" type="button" data-save-targets>Save targets</button>
       <button class="fuel-btn fuel-btn--quiet" type="button" data-close>Cancel</button>`,
      (body) => {
        const preview = body.querySelector("[data-preview]");
        const saveBtn = body.querySelector("[data-save-targets]");
        const paceWrap = body.querySelector("[data-pace-wrap]");
        const paceSeg = body.querySelector('[data-group="adjustPct"]');

        const paint = () => {
          body.querySelectorAll("[data-group]").forEach((seg) => {
            const key = seg.dataset.group;
            seg.querySelectorAll("button").forEach((b) => b.classList.toggle("is-on", String(form[key]) === b.dataset.v));
          });
          if (form.goal === "maintain") {
            paceWrap.hidden = true;
          } else {
            paceWrap.hidden = false;
            const opts = form.goal === "cut" ? [["15", "Steady (−15%)"], ["20", "Faster (−20%)"]] : [["5", "Slow (+5%)"], ["10", "Faster (+10%)"]];
            if (!opts.some(([v]) => String(form.adjustPct) === v)) form.adjustPct = Number(opts[0][0]);
            paceSeg.innerHTML = opts
              .map(([v, l]) => `<button type="button" data-v="${v}" class="${String(form.adjustPct) === v ? "is-on" : ""}">${l}</button>`)
              .join("");
          }
          const r = MacroCore.calcTargets(form);
          if (!r.ok) {
            preview.innerHTML = "";
            saveBtn.disabled = true;
            return;
          }
          saveBtn.disabled = false;
          const notes = [];
          if (r.flags.floorApplied) {
            notes.push(
              `We've kept this at the ${int(MacroCore.KCAL_FLOOR[form.sex])} kcal minimum. If you need to go lower, Max can set that with you.`
            );
          }
          if (r.flags.rateCapped) notes.push("Capped so you lose no more than about 1% of bodyweight a week. Slower is easier to stick with.");
          preview.innerHTML = `
            <div class="fuel-result">
              <div><b>${int(r.protein_g)}</b><span class="card__label">Protein g</span></div>
              <div><b>${int(r.carbs_g)}</b><span class="card__label">Carbs g</span></div>
              <div><b>${int(r.fat_g)}</b><span class="card__label">Fat g</span></div>
              <div><b>${hideKcal() ? "—" : int(r.kcal)}</b><span class="card__label">kcal</span></div>
            </div>
            ${notes.map((n) => `<p class="fuel-disclaimer" style="margin-top:10px">${esc(n)}</p>`).join("")}`;
        };

        body.addEventListener("click", (e) => {
          const b = e.target.closest("[data-group] button");
          if (!b) return;
          const key = b.closest("[data-group]").dataset.group;
          form[key] = key === "adjustPct" ? Number(b.dataset.v) : b.dataset.v;
          paint();
        });
        body.addEventListener("input", (e) => {
          const name = e.target.name;
          if (!name) return;
          form[name] = name === "activity" ? e.target.value : e.target.value === "" ? "" : Number(e.target.value);
          paint();
        });
        body.addEventListener("change", (e) => {
          if (e.target.name === "activity") {
            form.activity = e.target.value;
            paint();
          }
        });
        saveBtn.addEventListener("click", async () => {
          saveBtn.disabled = true;
          saveBtn.textContent = "Saving…";
          try {
            const data = await MacroApi.call("saveTargets", { inputs: form });
            state.targets = data.targets;
            if (state.member) state.member.sex = form.sex;
            render();
            closeSheet();
            toast("Targets saved");
          } catch (err) {
            saveBtn.disabled = false;
            saveBtn.textContent = "Save targets";
            toast(err.message);
          }
        });
        paint();
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  function openSettings() {
    openSheet(
      `<h2 class="fuel-sheet__title" id="fuelSheetTitle">Fuel settings</h2>
       <label class="fuel-toggle">Hide calories, focus on protein <input type="checkbox" data-hide ${hideKcal() ? "checked" : ""} /></label>
       <label class="fuel-toggle">Hide weight <input type="checkbox" data-hide-weight ${state.member && state.member.hide_weight ? "checked" : ""} /></label>
       <button class="fuel-btn fuel-btn--ghost" type="button" data-s="targets">Daily targets</button>
       <button class="fuel-btn fuel-btn--ghost" type="button" data-s="favs">Favourites</button>
       ${
         state.aiEnabled && state.plan
           ? `<div class="fuel-panel fuel-plan">
                <span class="card__label card__label--red">Fuel AI</span>
                <span class="fuel-plan__text">${esc(planText())}</span>
                ${
                  state.plan.kind === "paid" && state.plan.portalUrl
                    ? `<a class="fuel-link" href="${esc(state.plan.portalUrl)}" target="_blank" rel="noopener">Manage subscription</a>`
                    : state.plan.kind !== "paid" && state.plan.kind !== "comp"
                    ? '<button class="fuel-link" type="button" data-s="upgrade">Upgrade to Fuel AI</button>'
                    : ""
                }
              </div>`
           : ""
       }
       <p class="fuel-disclaimer">Not medical advice. If you have a medical condition, pregnancy or a history of disordered eating, talk to your GP or an Accredited Practising Dietitian.</p>
       <button class="fuel-btn fuel-btn--quiet" type="button" data-close>Done</button>`,
      (body) => {
        body.querySelector("[data-hide]").addEventListener("change", async (e) => {
          const want = e.target.checked;
          state.member.hide_kcal = want;
          render();
          try {
            const data = await MacroApi.call("setPrefs", { hide_kcal: want });
            state.member = data.member;
          } catch (err) {
            state.member.hide_kcal = !want;
            e.target.checked = !want;
            render();
            toast(err.message);
          }
        });
        body.querySelector("[data-hide-weight]").addEventListener("change", async (e) => {
          const want = e.target.checked;
          try {
            const data = await MacroApi.call("setPrefs", { hide_weight: want });
            state.member = data.member;
            if (want) state.weightTrend = null;
            else {
              const me = await MacroApi.call("me", { date: state.viewDate });
              applyMe(me);
            }
            render();
          } catch (err) {
            e.target.checked = !want;
            toast(err.message);
          }
        });
        body.querySelector('[data-s="targets"]').addEventListener("click", openTargets);
        const up = body.querySelector('[data-s="upgrade"]');
        if (up) up.addEventListener("click", openUpsell);
        body.querySelector('[data-s="favs"]').addEventListener("click", openFavourites);
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  // A phone left open overnight should roll over to the new day.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !state.loaded) return;
    // Came back from the Stripe checkout tab: check whether it went through.
    if (state.awaitingUpgrade) {
      state.awaitingUpgrade = false;
      refreshPlan(null);
    }
    const today = MacroCore.sydneyDate();
    if (state.loadedOn && state.loadedOn !== today) {
      state.viewDate = today;
      state.loaded = false;
      if (!els.panelFuel.hidden) load();
    }
  });

  let startTab = "card";
  try {
    startTab = window.location.hash === "#fuel" ? "fuel" : localStorage.getItem(TAB_STORAGE) || "card";
  } catch (err) {
    startTab = window.location.hash === "#fuel" ? "fuel" : "card";
  }
  showTab(startTab === "fuel" ? "fuel" : "card", false);
})();
