/*
 * MaxFit membership card — FUEL tab (macro tracker, Phase 1).
 *
 * Draws everything inside #panelFuel plus the bottom sheet (#fuelSheet):
 *   home     — the rings header (day switcher, plan button, protein/
 *              carbs/fat rings, calorie bar), LOG FOOD + Ask Fuel, the
 *              four meals, and meal plan/shopping/progress/settings tiles
 *   scan     — Photo (AI), Barcode (Open Food Facts) or Label (AI)
 *   confirm  — editable grams per item, live macros, ADD TO TODAY
 *   edit     — change grams/meal/name, favourite, delete
 *   targets  — Max's targets (read-only) or the calculator
 *   settings — hide calories, Fuel AI plan, disclaimer
 *   suggest  — "what to eat next" from Max's Foods list (free, no AI)
 *   fridge   — What can I make? photos of the fridge/cupboard → 3 ideas
 *              that fit what's left today (Gold and Diamond, 2 AI uses)
 *   chat     — Ask Fuel, the AI copilot (Diamond only)
 *   upsell   — Fuel plans: Silver free, Gold $5.99 or Diamond
 *              $9.99 a month (or yearly) via Stripe
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
    panelCard: $("panelCard"),
    panelFuel: $("panelFuel"),
    sheet: $("fuelSheet"),
    sheetBody: $("fuelSheetBody"),
    toast: $("fuelToast"),
    photoInput: $("fuelPhotoInput"),
    libraryInput: $("fuelLibraryInput"),
  };
  if (!els.panelFuel || !els.sheet) return;

  const MEAL_LABELS = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snacks" };
  const MEAL_SHORT = { breakfast: "Brekky", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

  // Every loading moment in FUEL (initial load, AI scans, barcode lookups,
  // suggestions, progress) shares this one spinner markup — swapping it here
  // swaps the animation everywhere at once. All three layers are the SAME
  // flame outline at three sizes, anchored to the same base, so every stage
  // of the build is a complete flame, not a slice of one (see macros.css).
  const FUEL_FLAME_PATH =
    "M12 2 C 9.8 6, 6.5 9.5, 6.5 14 C 6.5 18.5, 8.8 22, 12 22 " +
    "C 15.2 22, 17.5 18.5, 17.5 14 C 17.5 10.5, 15.5 8.5, 14.8 6 " +
    "C 14.5 8, 13.2 9, 12.3 8 C 11.7 7.2, 12 4.5, 12 2 Z";
  const FUEL_FLAME_SVG =
    '<svg class="fuel-flame" viewBox="0 0 24 24" aria-hidden="true">' +
    `<path class="flame__layer flame__layer--1" d="${FUEL_FLAME_PATH}"/>` +
    `<path class="flame__layer flame__layer--2" d="${FUEL_FLAME_PATH}"/>` +
    `<path class="flame__layer flame__layer--3" d="${FUEL_FLAME_PATH}"/>` +
    "</svg>";

  /** Shared markup for every one of Fuel's loading moments (renderLoading, sheetLoading) — the flame plus a fake progress bar (window.startFakeProgress, app.js). */
  function fuelLoadingHtml_(text) {
    return (
      '<div class="fuel-loading">' +
      `<div class="fuel-spinner">${FUEL_FLAME_SVG}</div>` +
      `<span class="fuel-loading__text">${esc(text)}</span>` +
      '<div class="fuel-loading__bar"><div class="fuel-loading__bar-fill"></div></div>' +
      "</div>"
    );
  }

  const state = {
    loaded: false,
    loading: false,
    member: null,
    targets: null,
    day: null,
    viewDate: MacroCore.sydneyDate(),
    recent: [],
    favourites: [],
    meals: [], // saved meals: { id, name, items }
    aiToday: null, // { tier, used, limit, left } from the server
    toBuy: null, // shopping list items not yet ticked (week.js and mealplan.js tell us)
    addMeal: null, // the meal whose + was tapped, until that food is logged
    busy: false,
    confirm: null,
    pendingPhotoMode: null,
    loadedOn: null,
    aiEnabled: true,
    plan: null, // { access, tier, kind, until, daysLeft, interval, links: { gold: { month, year }, … }, portalUrl, aiPerDay } from the server
    foods: [],
    moreIdeas: false,
    chat: [], // Ask Fuel messages, this visit only: { role, content, foods? }
    awaitingUpgrade: false,
    weightTrend: null, // { kg, date, change7 } from the server
    progress: null, // the last `progress` response
    progressRange: 84, // days shown on the weight chart; 0 = all
    progressWeek: "this", // which week the Progress week chart shows: "this" or "last"
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

  /** The meal a new log goes into: the one whose + was tapped, else by the time of day. */
  function defaultMeal() {
    if (state.addMeal) return state.addMeal;
    return isToday() ? MacroCore.mealForHour(sydneyHour()) : "snack";
  }

  const ICONS = {
    camera:
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    // Log Food on the home screen: a plus, not a camera, since it opens every way in (photo, describe, label, barcode, search).
    add: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
    fridge:
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="2.5" width="14" height="19" rx="2.5"/><path d="M5 9.5h14M8.5 5.5v2M8.5 12.5v3"/></svg>',
    // Ask Fuel on the home screen: a chat bubble with a sparkle, so it reads as the AI.
    askFuel:
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12.5a7.5 7.5 0 0 1-11.1 6.6L4 20.5l1.4-4.6A7.5 7.5 0 1 1 20 12.5z"/><path d="M12.5 8.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" fill="currentColor" stroke="none"/></svg>',
    barcode:
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 5v14M7 5v14M11 5v14M14 5v14M18 5v14M20 5v14"/></svg>',
    label:
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
    pen:
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
    bowl:
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11h18a9 9 0 0 1-18 0z"/><path d="M8 7c0-1 1-2 2-2M13 7c0-1 1-2 2-2"/></svg>',
    search:
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
    plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
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
    chat: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    calendar: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    cart: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5h2.8l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.4a1.5 1.5 0 0 0 1.5-1.1l1.7-6.8H6.4"/></svg>',
  };

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------

  /** Which panel shows — picked once on load from the URL (see the bottom of this file), no in-page switcher any more. */
  function showTab(name) {
    const fuel = name === "fuel";
    document.body.classList.toggle("is-fuel", fuel); // full-bleed Fuel layout, see macros.css
    els.panelCard.hidden = fuel;
    els.panelFuel.hidden = !fuel;
    if (fuel && !state.loaded && !state.loading) load(returnedSession ? { sync: true } : undefined);
  }

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
    els.panelFuel.innerHTML = fuelLoadingHtml_(text || "Loading");
    if (window.startFakeProgress) window.startFakeProgress(els.panelFuel.querySelector(".fuel-loading__bar-fill"));
  }

  function applyMe(data) {
    state.member = data.member;
    state.targets = data.targets;
    state.day = data.day;
    state.recent = data.recent || [];
    state.favourites = data.favourites || [];
    state.meals = data.meals || [];
    state.foods = data.foods || [];
    state.aiToday = data.aiToday || null;
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
    // Last time's reply first, so Fuel is on screen straight away; the
    // server's fresh copy (a few seconds) then replaces it.
    const cached = !returnedSession && state.viewDate === MacroCore.sydneyDate() ? readMeCache() : null;
    if (returnedSession) renderLoading("Switching on Fuel AI");
    else if (cached) {
      applyMe(cached);
      state.loaded = true;
      state.loadedOn = MacroCore.sydneyDate();
      render();
    } else renderSkeleton();
    const dayAtStart = state.day;
    try {
      if (returnedSession) await confirmStripeReturn();
      const data = await MacroApi.call("me", { date: state.viewDate, sync: !!(opts && opts.sync) });
      saveMeCache(data);
      // Anything logged, edited or day-switched while this was on its way
      // already holds the newer day: keep it.
      const keepDay = cached && state.day !== dayAtStart ? state.day : null;
      applyMe(data);
      if (keepDay) state.day = keepDay;
      state.loaded = true;
      state.loadedOn = MacroCore.sydneyDate();
      render();
      if (returnedSession && state.plan && state.plan.kind === "paid") toast(`${TIER_NAMES[tier()]} is on. Welcome!`);
    } catch (err) {
      if (err.code === "bad_key") {
        clearMeCache();
        state.loaded = false;
        renderUnlock(err.message + " If Max has sent you one, paste it below.");
      } else if (cached) {
        toast("Couldn't refresh just now. Showing what's saved on this phone.");
      } else {
        renderNotice("Couldn't load", esc(err.message), '<button class="fuel-btn fuel-btn--ghost" type="button" data-act="retry">Try again</button>');
      }
    } finally {
      state.loading = false;
    }
  }

  // The last `me` reply, saved on this phone (Speed, 2026-10-15). Only for
  // the same person's link; a saved copy from an earlier day keeps their
  // targets, foods and plan but starts the day empty with all AI uses back.
  const ME_CACHE_KEY = "maxfitFuelMe";

  function readMeCache() {
    try {
      const c = JSON.parse(localStorage.getItem(ME_CACHE_KEY) || "null");
      if (!c || !c.data || c.id !== MacroApi.identity().id) return null;
      const data = c.data;
      if (c.date !== MacroCore.sydneyDate()) {
        data.day = { date: state.viewDate, entries: [], totals: MacroCore.sumTotals([]) };
        if (data.aiToday) data.aiToday = Object.assign({}, data.aiToday, { used: 0, left: data.aiToday.limit });
      }
      return data;
    } catch (err) {
      return null;
    }
  }

  function saveMeCache(data) {
    try {
      localStorage.setItem(ME_CACHE_KEY, JSON.stringify({ id: MacroApi.identity().id, date: MacroCore.sydneyDate(), data }));
    } catch (err) {
      // Full or blocked storage: Fuel just loads the slow way next time.
    }
  }

  function clearMeCache() {
    try {
      localStorage.removeItem(ME_CACHE_KEY);
    } catch (err) {
      // ignore
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
  // Home view: the "concentric rings" layout (2026-10-13). A header panel
  // (day switcher, plan button, protein/carbs/fat rings, calorie bar), then
  // Log Food + Ask Fuel, the four meals, and the plan-ahead tiles.
  // ---------------------------------------------------------------------------

  // Ring radii in the 180-unit SVG: protein outside, fat inside.
  const RINGS = [
    { key: "protein_g", id: "p", r: 82 },
    { key: "carbs_g", id: "c", r: 66 },
    { key: "fat_g", id: "f", r: 50 },
  ];

  // What the rings and calorie bar last showed. A re-render (food logged,
  // day changed) draws them here first, then paintRings() moves them to the
  // new values so they animate instead of jumping. Starts empty, so the
  // first paint grows in.
  const shown = { p: 0, c: 0, f: 0, sp: 0, sc: 0, sf: 0 };

  // Plan button icons, outlines in the plan's own colour (see macros.css).
  const TIER_OUTLINES = {
    silver: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5 L19 5.5 V11 C19 15.8 15.8 19.6 12 21.5 C8.2 19.6 5 15.8 5 11 V5.5 Z"/></svg>',
    gold: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8 L14.6 9 L21.2 9.5 L16.2 13.9 L17.8 20.5 L12 16.9 L6.2 20.5 L7.8 13.9 L2.8 9.5 L9.4 9 Z"/></svg>',
    diamond: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 9 L7.5 4 H16.5 L20.5 9 L12 20.5 Z M3.5 9 H20.5 M9.5 4 L8 9 L12 20.5 L16 9 L14.5 4"/></svg>',
  };

  /** "Tue 13 Oct" or "Monday", for the day switcher. */
  function dayText(ymd, opts) {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", Object.assign({ timeZone: "UTC" }, opts)).replace(",", "");
  }

  /** "7:40am" from an entry's created_at ("2026-10-13 07:40:00", or a date the sheet turned it into). */
  function firstTime(items) {
    const times = items
      .map((e) => String(e.created_at || "").match(/(\d{1,2}):(\d{2})/))
      .filter(Boolean)
      .map((m) => m[1].padStart(2, "0") + ":" + m[2])
      .sort();
    if (!times.length) return "";
    const h = Number(times[0].slice(0, 2));
    return `${h % 12 || 12}:${times[0].slice(3)}${h < 12 ? "am" : "pm"}`;
  }

  function ringsSvg(label) {
    const circles = RINGS.map((ring) => {
      const c = 2 * Math.PI * ring.r;
      return (
        `<circle class="fx-ring fx-ring--track fx-ring--${ring.id}" cx="90" cy="90" r="${ring.r}"></circle>` +
        `<circle class="fx-ring fx-ring--bar fx-ring--${ring.id}" data-ring="${ring.id}" cx="90" cy="90" r="${ring.r}" ` +
        `stroke-dasharray="${c.toFixed(2)}" transform="rotate(-90 90 90)" style="stroke-dashoffset:${(c * (1 - shown[ring.id])).toFixed(2)}"></circle>`
      );
    }).join("");
    return `<svg class="fx-rings__svg" viewBox="0 0 180 180" role="img" aria-label="${esc(label)}">${circles}</svg>`;
  }

  /**
   * MacroHeader: day switcher + plan button, the rings with what's left in
   * the middle, the legend, and the calorie bar. `skeleton` draws the same
   * shapes empty while the day loads, so nothing jumps when it arrives.
   * Hidden calories: the middle shows protein left and there's no calorie
   * bar, same rule as the rest of Fuel.
   */
  function headerHtml(skeleton) {
    const g = skeleton ? null : state.targets;
    const t = state.day && !skeleton ? state.day.totals : MacroCore.sumTotals([]);
    const today = isToday();
    const fracs = {};
    RINGS.forEach((ring) => (fracs[ring.id] = g && g[ring.key] > 0 ? Math.max(0, t[ring.key] / g[ring.key]) : 0));
    const pct = (f) => Math.round(f * 100);

    let num = "–";
    let unit = skeleton ? "" : "No targets yet";
    if (g && hideKcal()) {
      const left = Math.round(g.protein_g - t.protein_g);
      num = `${int(Math.abs(left))}g`;
      unit = left >= 0 ? "Protein left" : "Protein over";
    } else if (g) {
      const left = Math.round(g.kcal - t.kcal);
      num = int(Math.abs(left));
      unit = left >= 0 ? "Kcal left" : "Kcal over";
    }

    const legend = RINGS.map((ring) => {
      const label = { p: "Protein", c: "Carbs", f: "Fat" }[ring.id];
      const eaten = Math.round(t[ring.key]);
      const over = g ? eaten - Math.round(g[ring.key]) : 0;
      return `
        <div class="fx-legend__item fx-legend__item--${ring.id}">
          <span class="fx-legend__label">${label}${over > 0 ? `<span class="fx-over">+${int(over)}g</span>` : ""}</span>
          <span class="fx-legend__nums">${skeleton ? "<b>–</b>" : g ? `<b>${int(eaten)}</b> / ${int(g[ring.key])}g` : `<b>${int(eaten)}</b>g`}</span>
        </div>`;
    }).join("");

    let below = "";
    if (g && !hideKcal()) {
      // Each macro's share of the calorie goal (4/4/9 kcal a gram), squeezed
      // to fit if they add up past 100%.
      const raw = { p: (t.protein_g * 4) / g.kcal, c: (t.carbs_g * 4) / g.kcal, f: (t.fat_g * 9) / g.kcal };
      const sum = raw.p + raw.c + raw.f;
      const k = sum > 1 ? 1 / sum : 1;
      const seg = (id) =>
        `<span class="fx-seg fx-seg--${id}" data-seg="${id}" data-frac="${(raw[id] * k).toFixed(4)}" style="width:${(shown["s" + id] * 100).toFixed(2)}%"></span>`;
      below = `
        <div class="fx-kcal">
          <div class="fx-kcal__row"><span>${int(t.kcal)} / ${int(g.kcal)} kcal</span><span>${pct(g.kcal > 0 ? t.kcal / g.kcal : 0)}%</span></div>
          <div class="fx-kcal__bar" aria-hidden="true">${seg("p")}${seg("c")}${seg("f")}</div>
        </div>`;
    } else if (!g && !skeleton) {
      below = '<button class="fx-settargets" type="button" data-act="targets">Set my daily targets</button>';
    } else if (skeleton) {
      below = '<div class="fx-kcal" aria-hidden="true"><div class="fx-kcal__row"><span class="fx-skel fx-skel--text"></span></div><div class="fx-kcal__bar"></div></div>';
    }

    const tierBtn = skeleton
      ? '<span class="fx-tier fx-tier--skel" aria-hidden="true"></span>'
      : state.aiEnabled
      ? `<button class="fx-tier fx-tier--${tier()}" type="button" data-act="plans" aria-label="${TIER_NAMES[tier()]} membership">${TIER_OUTLINES[tier()]}</button>`
      : "";

    return `
      <section class="fx-head" aria-label="Today's macros">
        <div class="fx-head__top">
          <div class="fx-day">
            <button class="fx-day__btn" type="button" data-act="day-prev" aria-label="Previous day"${skeleton ? " disabled" : ""}>${ICONS.left}</button>
            <div class="fx-day__text">
              <h1 class="fx-day__name">${today ? "Today" : esc(dayText(state.viewDate, { weekday: "long" }))}</h1>
              <span class="fx-day__date">${esc(dayText(state.viewDate, { weekday: "short", day: "numeric", month: "short" }))}</span>
            </div>
            <button class="fx-day__btn" type="button" data-act="day-next" aria-label="Next day"${today || skeleton ? " disabled" : ""}>${ICONS.right}</button>
          </div>
          ${tierBtn}
        </div>
        <div class="fx-rings-row">
          <div class="fx-rings" data-fracs="${fracs.p.toFixed(4)},${fracs.c.toFixed(4)},${fracs.f.toFixed(4)}">
            ${ringsSvg(skeleton ? "Loading your macros" : `Protein ${pct(fracs.p)}%, carbs ${pct(fracs.c)}%, fat ${pct(fracs.f)}% of goal`)}
            <div class="fx-rings__centre">
              <span class="fx-rings__num${num.length >= 5 ? " fx-rings__num--long" : ""}">${num}</span>
              ${unit ? `<span class="fx-rings__unit">${unit}</span>` : ""}
            </div>
          </div>
          <div class="fx-legend">${legend}</div>
        </div>
        ${below}
      </section>`;
  }

  /** Moves the rings and calorie bar from where they were drawn to their real values (CSS animates it). */
  function paintRings() {
    const box = els.panelFuel.querySelector("[data-fracs]");
    if (!box) return;
    const fr = box.dataset.fracs.split(",").map(Number);
    box.getBoundingClientRect(); // commit the starting point first, or there's nothing to animate from
    els.panelFuel.querySelectorAll("[data-ring]").forEach((el, i) => {
      const f = Math.min(1, fr[i] || 0);
      el.style.strokeDashoffset = (2 * Math.PI * RINGS[i].r * (1 - f)).toFixed(2);
      shown[el.dataset.ring] = f;
    });
    els.panelFuel.querySelectorAll("[data-seg]").forEach((el) => {
      const f = Math.min(1, Number(el.dataset.frac) || 0);
      el.style.width = (f * 100).toFixed(2) + "%";
      shown["s" + el.dataset.seg] = f;
    });
  }

  /** ActionsRow: Log Food, Ask Fuel, and today's AI scans left. */
  function actionsHtml(skeleton) {
    const ai = state.aiEnabled;
    const usedUp = !skeleton && aiUsedUp();
    let caption = "";
    if (skeleton) caption = "&nbsp;";
    else if (ai && !fuelAi()) caption = "Barcode and search are free · AI scans come with Gold";
    else if (usedUp) caption = "Out of AI scans · resets at midnight";
    else if (ai && state.aiToday && state.aiToday.limit) caption = `${state.aiToday.left} of ${state.aiToday.limit} AI scans left today`;
    // Out of AI scans still opens the chooser: barcode and search are free.
    return `
      <div class="fx-actions">
        <button class="fx-scan${usedUp ? " is-out" : ""}" type="button" data-act="scan"${skeleton ? " disabled" : ""}>${ICONS.add}<span>Log Food</span></button>
        ${ai || skeleton ? `<button class="fx-ask" type="button" data-act="ask" aria-label="Ask Fuel, your AI nutrition copilot"${skeleton ? " disabled" : ""}>${ICONS.askFuel}<span>Ask Fuel</span></button>` : ""}
      </div>
      ${caption ? `<p class="fx-caption">${caption}</p>` : ""}`;
  }

  /** MealList: Breakfast, Lunch, Dinner, Snacks. Logged ones open their foods; empty ones get a + to add straight into that meal. */
  function mealListHtml(skeleton) {
    const entries = state.day && !skeleton ? state.day.entries : [];
    const rows = MacroCore.MEALS.map((meal) => {
      const name = MEAL_LABELS[meal];
      if (skeleton) {
        return '<div class="fx-meal" aria-hidden="true"><span class="fx-skel fx-skel--name"></span><span class="fx-skel fx-skel--btn"></span></div>';
      }
      const items = entries.filter((e) => e.meal === meal);
      if (!items.length) {
        return `
          <div class="fx-meal">
            <span class="fx-meal__name fx-meal__name--empty">${name}</span>
            <button class="fx-add" type="button" data-act="meal-add" data-meal="${meal}" aria-label="Add ${name}">${ICONS.plus}</button>
          </div>`;
      }
      const sum = MacroCore.sumTotals(items);
      const time = firstTime(items);
      return `
        <button class="fx-meal" type="button" data-act="meal-open" data-meal="${meal}">
          <span class="fx-meal__main">
            <span class="fx-meal__name">${name}${time ? `<span class="fx-meal__time"> · ${time}</span>` : ""}</span>
            <span class="fx-chips">
              <span class="fx-chip fx-chip--p">P ${int(sum.protein_g)}g</span>
              <span class="fx-chip fx-chip--c">C ${int(sum.carbs_g)}g</span>
              <span class="fx-chip fx-chip--f">F ${int(sum.fat_g)}g</span>
            </span>
          </span>
          ${hideKcal() ? "" : `<span class="fx-meal__kcal">${int(sum.kcal)}<small>kcal</small></span>`}
        </button>`;
    }).join("");
    return `<section class="fx-meals" aria-label="Meals"><h2 class="fx-h2">Meals</h2>${rows}</section>`;
  }

  function tileHtml(act, tone, icon, title, sub) {
    return `
      <button class="fx-tile fx-tile--${tone}" type="button" data-act="${act}">
        <span class="fx-tile__icon">${icon}</span>
        <span class="fx-tile__text">
          <span class="fx-tile__title">${title}</span>
          <span class="fx-tile__sub">${esc(sub)}</span>
        </span>
      </button>`;
  }

  /**
   * PlanAhead: meal plan (Diamond) and shopping list (Gold and Diamond),
   * then Progress and Settings, which used to live in Today's Log. Locked
   * tiles name the plan they come with and open the plans sheet. The
   * screens are card/mealplan.js.
   */
  function planAheadHtml() {
    let html = "";
    if (state.aiEnabled && typeof MealPlan !== "undefined") {
      const t = tier();
      const planOn = fuelAi() && t === "diamond";
      const listOn = fuelAi() && MacroCore.tierRank(t) >= MacroCore.tierRank("gold");
      const n = state.toBuy;
      const listSub = !listOn ? "Gold plan" : n == null ? "Your list" : n ? `${n} item${n === 1 ? "" : "s"}` : "Empty";
      html += `
        <section class="fx-tiles" aria-label="Plan ahead">
          ${tileHtml("mealplan", "plan", ICONS.calendar, "Meal plan", planOn ? "Plan my week" : "Diamond plan")}
          ${tileHtml("shopping", "list", ICONS.cart, "Shopping", listSub)}
        </section>`;
    }
    const w = state.weightTrend;
    const weight = w && w.kg ? `${kgText(w.kg)} kg${w.change7 != null && Math.abs(w.change7) >= 0.1 ? ` · ${w.change7 < 0 ? "↓" : "↑"}${kgText(Math.abs(w.change7))}` : ""}` : "Weight & streaks";
    html += `
      <nav class="fx-tiles" aria-label="More">
        ${tileHtml("progress", "progress", ICONS.chart, "Progress", weight)}
        ${tileHtml("settings", "settings", ICONS.gear, "Settings", "Targets & favourites")}
      </nav>`;
    return html;
  }

  /**
   * Typed-in numbers ("Enter the numbers") are per serve: grams 100 means
   * 1 serve, and per100 holds the per-serve values. Everything else is grams.
   */
  function isServes(item) {
    return item && item.source === "quick";
  }

  function servesText(grams) {
    const n = Math.round(Number(grams)) / 100;
    const shown = n === 0.5 ? "½" : String(n);
    return `${shown} serve${n > 1 ? "s" : ""}`;
  }

  /** "150g", "250ml" or "1 serve". */
  function amountText(item) {
    return isServes(item) ? servesText(item.grams) : `${int(item.grams)}${item.unit || "g"}`;
  }

  function mealTotals(meal) {
    return MacroCore.sumTotals(meal.items.map((it) => MacroCore.scale(it.per100, it.grams)));
  }

  /** What mealplan.js needs from Fuel: hidden calories, logging, the plans sheet and the list count. */
  function mealPlanCtx() {
    return {
      hideKcal: hideKcal(),
      logMeal: (items, slot) => addItems(items, slot),
      upsell: (reason, message) => openUpsell({ reason, message }),
      onChange: (toBuy) => {
        state.toBuy = toBuy;
        render();
      },
      onAi: setAiToday,
    };
  }

  /** One meal's foods (tap a logged meal row): each opens the editor, plus "Add to" that meal. */
  function openMealView(meal) {
    const items = (state.day ? state.day.entries : []).filter((e) => e.meal === meal);
    if (!items.length) {
      addToMeal(meal);
      return;
    }
    const sum = MacroCore.sumTotals(items);
    openSheet(
      `<h2 class="fuel-sheet__title" id="fuelSheetTitle">${MEAL_LABELS[meal]}</h2>
       <p class="fuel-sheet__sub">${esc(dayLabel(state.viewDate))} · ${macroLine(sum)}</p>
       <div class="fuel-panel">
         ${items
           .map(
             (e) => `
           <button class="fuel-entry" type="button" data-id="${esc(e.id)}">
             <span>
               <span class="fuel-entry__name">${esc(e.name)}</span>
               <span class="fuel-entry__meta">${amountText(e)} · ${int(e.carbs_g)}C · ${int(e.fat_g)}F${hideKcal() ? "" : ` · ${int(e.kcal)} kcal`}</span>
             </span>
             <span class="fuel-entry__p">${int(e.protein_g)}<small>P</small></span>
           </button>`
           )
           .join("")}
       </div>
       <button class="fuel-btn" type="button" data-add>+ Add to ${MEAL_LABELS[meal]}</button>`,
      (body) => {
        body.addEventListener("click", (e) => {
          const row = e.target.closest("[data-id]");
          if (row) {
            const entry = state.day.entries.find((x) => x.id === row.dataset.id);
            if (entry) openEdit(entry);
          } else if (e.target.closest("[data-add]")) addToMeal(meal);
        });
      }
    );
  }

  /** "+" on a meal: the usual Add food chooser, with that meal already picked on the confirm screen. */
  function addToMeal(meal) {
    state.addMeal = meal;
    openScanChooser();
  }

  function render() {
    if (!state.loaded) return;
    els.panelFuel.innerHTML = `
      <div class="fx">
        ${headerHtml(false)}
        <div class="fx-body">
          ${actionsHtml(false)}
          ${mealListHtml(false)}
          ${planAheadHtml()}
        </div>
      </div>`;
    paintRings();
  }

  /** The same layout, empty, while the day loads. */
  function renderSkeleton() {
    els.panelFuel.innerHTML = `
      <div class="fx" aria-busy="true">
        ${headerHtml(true)}
        <div class="fx-body">
          ${actionsHtml(true)}
          ${mealListHtml(true)}
        </div>
      </div>`;
  }

  // The shopping list count comes with the card's weekly tiles (week.js
  // already asks the server for it on every load), so Fuel doesn't ask twice.
  document.addEventListener("maxfit:tobuy", (e) => {
    state.toBuy = Number(e.detail) || 0;
    if (state.loaded) render();
  });

  els.panelFuel.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "retry") load();
    else if (act === "day-prev" || act === "day-next") changeDay(act === "day-prev" ? -1 : 1);
    else if (act === "scan") {
      state.addMeal = null;
      openScanChooser();
    } else if (act === "meal-add") addToMeal(btn.dataset.meal);
    else if (act === "meal-open") openMealView(btn.dataset.meal);
    else if (act === "ask") openChat();
    else if (act === "mealplan") {
      if (fuelAi() && tier() === "diamond") MealPlan.open(mealPlanCtx());
      else openUpsell({ reason: "plan" });
    } else if (act === "shopping") {
      if (fuelAi() && MacroCore.tierRank(tier()) >= MacroCore.tierRank("gold")) MealPlan.openList(mealPlanCtx());
      else openUpsell({ reason: "list" });
    }
    else if (act === "progress") openProgress();
    else if (act === "settings") openSettings();
    else if (act === "targets") openTargets();
    else if (act === "plans") openUpsell();
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
    state.addMeal = null;
    if (data.recent) state.recent = data.recent;
    render();
    return data.day.entries.filter((x) => !before.has(x.id)).map((x) => x.id);
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
    openSheet(fuelLoadingHtml_(text));
    if (window.startFakeProgress) window.startFakeProgress(els.sheetBody.querySelector(".fuel-loading__bar-fill"));
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
            else if (kind === "describe") openDescribe(lastDescribed);
            else pickPhoto(kind, true);
          })
        );
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Scan chooser + photos
  // ---------------------------------------------------------------------------

  /** Fuel AI (scans, Describe it): API key on the server AND Gold or Diamond (paid, free month or trial). */
  function fuelAi() {
    return state.aiEnabled && !!(state.plan && state.plan.access);
  }

  const TIER_NAMES = { silver: "Silver", gold: "Gold", diamond: "Diamond" };
  // What the plans sheet shows. Yearly is 3 months free (pay for 9, get 12);
  // `save` is 12 months minus the yearly price. Keep in step with Stripe.
  const TIER_PRICES = {
    gold: { month: "$5.99", year: "$53.99", save: "$17.89" },
    diamond: { month: "$9.99", year: "$89.99", save: "$29.89" },
  };
  const PAID_TIERS = ["gold", "diamond"];

  /** "silver" | "gold" | "diamond". An old "platinum" (retired 10 Oct 2026) is Diamond. */
  function tier() {
    const t = (state.plan && state.plan.tier) || (fuelAi() ? "gold" : "silver");
    return t === "platinum" ? "diamond" : t;
  }

  /** Ask Fuel is Diamond only (paying, a free month from Max, or the free week). */
  function askFuelOn() {
    return fuelAi() && tier() === "diamond";
  }

  /** Any paid plan with none of today's AI uses left. */
  function aiUsedUp() {
    return fuelAi() && !!state.aiToday && state.aiToday.left <= 0;
  }

  /** After any AI call: the server's fresh count, onto the meter. */
  function setAiToday(ai) {
    if (!ai) return;
    state.aiToday = ai;
    if (state.plan && ai.tier) state.plan.tier = ai.tier;
    render();
  }

  /** "3 of 5 AI uses left today". */
  function aiLeftText() {
    const a = state.aiToday;
    if (!a || !a.limit) return "";
    return a.left > 0 ? `${a.left} of ${a.limit} AI uses left today` : `All ${a.limit} AI uses used today · back at midnight`;
  }

  /** "23 Oct", or "23 Oct 2027" when it isn't this year (yearly plans). */
  function fmtDate(ymd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) return "";
    const [y, m, d] = ymd.split("-").map(Number);
    const opts = { day: "numeric", month: "short", timeZone: "UTC" };
    if (String(y) !== MacroCore.sydneyDate().slice(0, 4)) opts.year = "numeric";
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", opts);
  }

  /** "Diamond free trial · 5 days left", "Gold · renews 23 Oct", … or "" when Fuel AI is off for everyone. */
  function planText() {
    const p = state.plan;
    if (!state.aiEnabled || !p) return "";
    const name = TIER_NAMES[tier()] || "Gold";
    if (p.kind === "paid") {
      const yearly = p.interval === "year" ? " · yearly" : "";
      return p.until ? `${name} · renews ${fmtDate(p.until)}${yearly}` : `${name} is on${yearly}`;
    }
    if (p.kind === "comp") return `${name} · free until ${fmtDate(p.until)} (from Max)`;
    if (p.kind === "trial") return `${name} free trial · ${p.daysLeft} day${p.daysLeft === 1 ? "" : "s"} left`;
    if (p.kind === "lapsed") return "Your subscription has ended, so you're on Silver";
    if (p.kind === "trial_over") return "Your free week has finished, so you're on Silver";
    return "Silver";
  }

  function openScanChooser() {
    // Photo, label and Describe it need the Claude API key on the server;
    // without it only the free ways in (barcode and search) are shown.
    const ai = state.aiEnabled;
    const locked = ai && !fuelAi();
    const usedUp = aiUsedUp();
    const sub = !ai
      ? "Scan a barcode, or search for it and set the amount."
      : locked
      ? "Barcodes, search and saved meals are free. Photo, label and Describe it come with Gold."
      : [planText(), aiLeftText()].filter(Boolean).join(" · ");
    const aiTag = (label) => (locked ? "Gold" : usedUp ? "None left today" : label);
    const aiClass = locked || usedUp ? " is-locked" : "";
    openSheet(
      `<h2 class="fuel-sheet__title" id="fuelSheetTitle">Add food</h2>
       <p class="fuel-sheet__sub">${esc(sub)}</p>
       <div class="fuel-modes">
         ${ai ? `<button class="fuel-mode${aiClass}" type="button" data-mode="meal">${ICONS.camera}Photo<small>${aiTag("Snap your meal")}</small></button>` : ""}
         ${ai ? `<button class="fuel-mode${aiClass}" type="button" data-mode="describe">${ICONS.pen}Describe<small>${aiTag("Type what you ate")}</small></button>` : ""}
         ${ai ? `<button class="fuel-mode${aiClass}" type="button" data-mode="label">${ICONS.label}Label<small>${aiTag("Nutrition panel")}</small></button>` : ""}
         <button class="fuel-mode" type="button" data-mode="barcode">${ICONS.barcode}Barcode<small>Packaged food</small></button>
         <button class="fuel-mode" type="button" data-mode="search">${ICONS.search}Search<small>Foods &amp; saved meals</small></button>
         ${ai ? `<button class="fuel-mode${aiClass}" type="button" data-mode="fridge">${ICONS.fridge}What can I make?<small>${aiTag("Photo of your fridge")}</small></button>` : ""}
       </div>
       ${ai && !locked && !usedUp ? '<button class="fuel-btn fuel-btn--quiet" type="button" data-mode="library">Choose a meal photo from your library</button>' : ""}`,
      (body) => {
        body.querySelectorAll("[data-mode]").forEach((b) =>
          b.addEventListener("click", () => {
            const mode = b.dataset.mode;
            // input.click() has to happen inside this tap handler, or
            // iOS Safari won't open the camera.
            if (mode === "barcode") openBarcode();
            else if (mode === "search") openSearch();
            else if (locked || usedUp) openUpsell(usedUp ? { reason: "limit" } : undefined);
            else if (mode === "fridge") openFridge();
            else if (mode === "describe") openDescribe();
            else if (mode === "library") pickPhoto("meal", false);
            else pickPhoto(mode, true);
          })
        );
      }
    );
  }

  /** "Describe it": type what you ate, and the AI estimates it (1 AI use, the cheaper text model). */
  function openDescribe(text) {
    openSheet(
      `<h2 class="fuel-sheet__title" id="fuelSheetTitle">Describe it</h2>
       <p class="fuel-sheet__sub">What did you eat? Add amounts or where it's from if you know them.</p>
       <textarea class="fuel-input fuel-note" data-describe rows="3" maxlength="300" placeholder="e.g. Chicken wrap from Subway and a large flat white" aria-label="What you ate">${esc(text || "")}</textarea>
       <button class="fuel-btn" type="button" data-go>Work it out</button>
       <p class="fuel-disclaimer">${esc(aiLeftText())}</p>`,
      (body) => {
        const box = body.querySelector("[data-describe]");
        body.querySelector("[data-go]").addEventListener("click", () => {
          const t = box.value.trim();
          if (!t) {
            box.focus();
            return;
          }
          describeMeal(t);
        });
      }
    );
  }

  let lastDescribed = ""; // so "Try again" keeps what they typed

  async function describeMeal(text) {
    lastDescribed = text;
    sheetLoading("Working it out");
    let data;
    try {
      data = await MacroApi.call("describe", { text: text }, { timeoutMs: 60000 });
    } catch (err) {
      if (err.code === "no_plan" || err.code === "limit") {
        if (err.code === "no_plan" && state.plan) state.plan.access = false;
        openUpsell({ reason: err.code === "limit" ? "limit" : "", message: err.message });
        return;
      }
      sheetError("Hmm", err.message, '<button class="fuel-btn" type="button" data-retry="describe">Try again</button>');
      return;
    }
    setAiToday(data.aiToday);
    const meal = data.meal;
    if (!meal.items.length) {
      sheetError("Nothing to log", meal.meal_guess || "Couldn't find any food in that.", '<button class="fuel-btn" type="button" data-retry="describe">Try again</button>');
      return;
    }
    openConfirm({ title: meal.meal_guess || "Your meal", source: "describe", items: meal.items });
  }

  // ---------------------------------------------------------------------------
  // Search and "Enter the numbers" (free, no AI)
  // ---------------------------------------------------------------------------

  /** Saved meals, favourites, recent foods, then Max's Foods list, each name once. */
  function searchPool() {
    const seen = {};
    const out = [];
    (state.meals || []).forEach((m) => out.push({ kind: "meal", name: m.name, meal: m }));
    const add = (kind, name, item, meta) => {
      const key = String(name).toLowerCase();
      if (!name || seen[key]) return;
      seen[key] = true;
      out.push({ kind: kind, name: String(name), item: item, meta: meta });
    };
    const fromLog = (x) => ({ name: x.name, grams: x.grams, per100: x.per100, source: isServes(x) ? "quick" : "manual" });
    (state.favourites || []).forEach((f) => add("fav", f.name, fromLog(f)));
    (state.recent || []).forEach((r) => add("recent", r.name, fromLog(r)));
    (state.foods || []).forEach((f) =>
      add(
        "food",
        f.name,
        { name: f.name, grams: f.serve_g || 100, per100: f.per100, serving_g: f.serve_g || 0, source: "manual" },
        f.serve_label || ""
      )
    );
    return out;
  }

  function searchRowHtml(row, i) {
    if (row.kind === "meal") {
      const t = mealTotals(row.meal);
      return `
      <button class="fuel-entry" type="button" data-pick="${i}">
        <span>
          <span class="fuel-entry__name"><span style="color:var(--red)">${ICONS.bowl}</span> ${esc(row.name)}</span>
          <span class="fuel-entry__meta">Saved meal · ${row.meal.items.length} food${row.meal.items.length === 1 ? "" : "s"}${hideKcal() ? "" : ` · ${int(t.kcal)} kcal`}</span>
        </span>
        <span class="fuel-entry__p">${int(t.protein_g)}<small>P</small></span>
      </button>`;
    }
    const m = MacroCore.scale(row.item.per100, row.item.grams);
    const amount = row.meta ? `${row.meta} (${amountText(row.item)})` : amountText(row.item);
    return `
      <button class="fuel-entry" type="button" data-pick="${i}">
        <span>
          <span class="fuel-entry__name">${row.kind === "fav" ? `<span style="color:var(--red)">${ICONS.star}</span> ` : ""}${esc(row.name)}</span>
          <span class="fuel-entry__meta">${esc(amount)}${hideKcal() ? "" : ` · ${int(m.kcal)} kcal`}</span>
        </span>
        <span class="fuel-entry__p">${int(m.protein_g)}<small>P</small></span>
      </button>`;
  }

  /**
   * Search favourites, recent foods and Max's Foods list. opts.into = add the
   * pick to the confirm sheet that's already open ("+ Add another food").
   */
  function openSearch(opts) {
    const into = !!(opts && opts.into && state.confirm);
    const pool = searchPool();
    let shown = [];
    openSheet(
      `<h2 class="fuel-sheet__title" id="fuelSheetTitle">${into ? "Add another food" : "Search food"}</h2>
       <input class="fuel-input" type="search" data-q placeholder="Chicken, rice, banana…" aria-label="Search foods" autocomplete="off" autocapitalize="off" spellcheck="false" />
       <div class="fuel-panel fuel-search" data-results></div>
       <button class="fuel-btn fuel-btn--ghost" type="button" data-quick>Can't find it? Enter the numbers</button>
       <button class="fuel-btn fuel-btn--quiet" type="button" data-back>${into ? "Back" : "Cancel"}</button>`,
      (body) => {
        const q = body.querySelector("[data-q]");
        const results = body.querySelector("[data-results]");
        const draw = () => {
          const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
          if (words.length) {
            shown = pool.filter((r) => words.every((w) => r.name.toLowerCase().indexOf(w) >= 0)).slice(0, 40);
          } else {
            const mine = pool.filter((r) => r.kind !== "food").slice(0, 8);
            shown = mine.concat(pool.filter((r) => r.kind === "food"));
          }
          results.innerHTML = shown.length
            ? shown.map(searchRowHtml).join("")
            : `<p class="fuel-empty">Nothing called "${esc(q.value.trim())}" yet. Enter the numbers below.</p>`;
        };
        draw();
        q.addEventListener("input", draw);
        results.addEventListener("click", (e) => {
          const b = e.target.closest("[data-pick]");
          const row = b && shown[Number(b.dataset.pick)];
          if (row && row.kind === "meal") openSavedMeal(row.meal, into);
          else if (row) pickFood(Object.assign({}, row.item), into);
        });
        body.querySelector("[data-quick]").addEventListener("click", () => openQuickAdd({ into: into, name: q.value.trim() }));
        body.querySelector("[data-back]").addEventListener("click", () => (into ? renderConfirm() : closeSheet()));
      }
    );
  }

  /** A food from search or "Enter the numbers": into the open confirm sheet, or a new one. */
  function pickFood(item, into) {
    if (into && state.confirm) {
      const c = state.confirm;
      // A one-food confirm is titled after that food; with more, it's a meal.
      if (c.items.length === 1 && c.title === c.items[0].name) c.title = "Your meal";
      c.items.push(Object.assign({}, item, { grams: Math.round(Number(item.grams) || 100) }));
      renderConfirm();
    } else {
      openConfirm({ title: item.name, source: "manual", items: [item] });
    }
  }

  /** A saved meal into the confirm sheet, so today's amounts can differ. */
  function openSavedMeal(meal, into) {
    const items = meal.items.map((it) => Object.assign({}, it, { per100: Object.assign({}, it.per100) }));
    if (into && state.confirm) {
      const c = state.confirm;
      if (c.items.length === 1 && c.title === c.items[0].name) c.title = "Your meal";
      items.forEach((it) => c.items.push(Object.assign(it, { grams: Math.round(Number(it.grams) || 100) })));
      renderConfirm();
    } else {
      openConfirm({ title: meal.name, source: "manual", items: items, savedMealId: meal.id });
    }
  }

  /** For food that isn't in the list: the numbers for one serve, off a menu or pack. */
  function openQuickAdd(opts) {
    const into = !!(opts && opts.into);
    const kcalField = hideKcal()
      ? ""
      : `<label class="fuel-field"><span class="card__label">Calories</span><input class="fuel-input" name="kcal" type="number" inputmode="decimal" min="0" max="5000" placeholder="kcal" /></label>`;
    openSheet(
      `<h2 class="fuel-sheet__title" id="fuelSheetTitle">Enter the numbers</h2>
       <p class="fuel-sheet__sub">For one serve, as it says on the menu or pack. Leave out anything you don't know.</p>
       <form class="fuel-form" data-quick-form autocomplete="off">
         <label class="fuel-field"><span class="card__label">Food</span><input class="fuel-input" name="name" maxlength="80" placeholder="e.g. Chicken burrito bowl" value="${esc((opts && opts.name) || "")}" /></label>
         ${kcalField}
         <div class="fuel-fields3">
           <label class="fuel-field"><span class="card__label">Protein</span><input class="fuel-input" name="protein_g" type="number" inputmode="decimal" min="0" max="500" placeholder="g" /></label>
           <label class="fuel-field"><span class="card__label">Carbs</span><input class="fuel-input" name="carbs_g" type="number" inputmode="decimal" min="0" max="500" placeholder="g" /></label>
           <label class="fuel-field"><span class="card__label">Fat</span><input class="fuel-input" name="fat_g" type="number" inputmode="decimal" min="0" max="500" placeholder="g" /></label>
         </div>
         <p class="fuel-error" data-quick-error hidden></p>
         <button class="fuel-btn" type="submit">Next</button>
       </form>
       <button class="fuel-btn fuel-btn--quiet" type="button" data-back>Back</button>`,
      (body) => {
        const form = body.querySelector("[data-quick-form]");
        const error = body.querySelector("[data-quick-error]");
        const num = (name, max) => {
          const el = form.elements[name];
          const v = el ? Number(el.value) : 0;
          return v > 0 ? Math.min(max, Math.round(v * 10) / 10) : 0;
        };
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          const name = form.elements.name.value.trim();
          const p = num("protein_g", 500);
          const c = num("carbs_g", 500);
          const f = num("fat_g", 500);
          const kcal = num("kcal", 5000) || Math.round(4 * p + 4 * c + 9 * f);
          const problem = !name ? "Give it a name." : !(kcal > 0) ? "Add the calories, or at least one of protein, carbs or fat." : "";
          if (problem) {
            error.textContent = problem;
            error.hidden = false;
            return;
          }
          pickFood({ name: name, grams: 100, per100: { kcal: kcal, protein_g: p, carbs_g: c, fat_g: f }, source: "quick" }, into);
        });
        body.querySelector("[data-back]").addEventListener("click", () => openSearch({ into: into }));
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Fuel AI upsell (Stripe)
  // ---------------------------------------------------------------------------

  /**
   * The plans: Silver (free), Gold and Diamond, each monthly or yearly
   * (3 months free). opts.reason "limit" = they just ran out of today's AI
   * uses (opts.message is the server's wording); "ask" = they tapped Ask
   * Fuel, which needs Diamond.
   *
   * Anyone not paying buys through that plan's Payment Link. A paying
   * client changes plan (or monthly ↔ yearly) in Stripe's billing page,
   * never through a second checkout, so nobody pays twice.
   */
  let plansInterval = null; // the Monthly / Yearly switch while the sheet is open

  function openUpsell(opts) {
    opts = opts || {};
    const p = state.plan || {};
    const t = tier();
    const paying = p.kind === "paid";
    const perDay = p.aiPerDay || { gold: 5, diamond: 20 };
    const links = p.links || {};
    const hasYear = PAID_TIERS.some((k) => links[k] && links[k].year);
    plansInterval = hasYear && paying && p.interval === "year" ? "year" : "month";
    const sub =
      opts.reason === "limit"
        ? opts.message || "That's all your AI uses for today."
        : opts.reason === "ask"
        ? "Ask Fuel, your AI nutrition coach, comes with Diamond."
        : opts.reason === "plan"
        ? "Weekly meal plans with a shopping list come with Diamond."
        : opts.reason === "list"
        ? "Your shopping list comes with Gold and Diamond."
        : p.kind === "trial_over" || p.kind === "lapsed"
        ? planText() + "."
        : "Your AI nutrition coach, in your pocket. Cancel any time.";
    const badge = (text) => `<span class="fuel-plan-card__badge">${esc(text)}</span>`;
    const days = (n) => `${n} day${n === 1 ? "" : "s"} left`;
    const portalBtn = (k, label) =>
      p.portalUrl ? `<a class="fuel-btn fuel-btn--${k}" href="${esc(p.portalUrl)}" target="_blank" rel="noopener" data-upgrade>${esc(label)}</a>` : "";

    const DESCRIPTIONS = {
      gold: `<p><b>${perDay.gold} AI uses a day:</b> snap a meal, scan a label or Describe it. <b>Plus your shopping list.</b></p>`,
      diamond: `<p><b>${perDay.diamond} AI uses a day, plus Ask Fuel</b>, your AI nutrition coach, <b>and a weekly meal plan</b> that fills your shopping list.</p>`,
    };

    function action(k, iv) {
      const name = TIER_NAMES[k];
      const url = links[k] && links[k][iv];
      const buy = (label) =>
        url ? `<a class="fuel-btn fuel-btn--${k}" href="${esc(url)}" target="_blank" rel="noopener" data-upgrade>${esc(label)}</a>` : "";
      if (paying) {
        if (k === t) {
          const mine = badge(p.interval === "year" ? "Your plan · yearly" : "Your plan · monthly");
          return iv === "year" && p.interval !== "year" ? mine + portalBtn(k, "Switch to yearly") : mine;
        }
        return MacroCore.tierRank(k) > MacroCore.tierRank(t) ? portalBtn(k, `Switch to ${name}`) : "";
      }
      if (k === t && p.kind === "trial") return badge(`Free trial · ${days(p.daysLeft)}`) + buy(`Keep ${name}`);
      if (k === t && p.kind === "comp") return badge(`Free from Max until ${fmtDate(p.until)}`) + buy(`Keep ${name}`);
      return buy(`Get ${name}`);
    }

    function cardHtml(k, iv) {
      const price = iv === "year" ? `<b>${TIER_PRICES[k].year}</b> a year` : `<b>${TIER_PRICES[k].month}</b> a month`;
      const save = iv === "year" ? `<p class="fuel-plan-card__save">Save ${TIER_PRICES[k].save} · 3 months free</p>` : "";
      return `
        <div class="fuel-plan-card fuel-plan-card--${k}${t === k ? " is-current" : ""}">
          <div class="fuel-plan-card__head"><span class="fuel-tier fuel-tier--${k}">${TIER_NAMES[k]}</span><span class="fuel-plan-card__price">${price}</span></div>
          ${save}
          ${DESCRIPTIONS[k]}
          ${action(k, iv)}
        </div>`;
    }

    function plansHtml(iv) {
      const anyLink = PAID_TIERS.some((k) => links[k] && links[k][iv]);
      return `
        <div class="fuel-plan-card fuel-plan-card--silver${t === "silver" ? " is-current" : ""}">
          <div class="fuel-plan-card__head"><span class="fuel-tier fuel-tier--silver">Silver</span><span class="fuel-plan-card__price">Free</span></div>
          <p>Barcodes, search, saved meals, typed-in numbers, what-to-eat ideas and your progress.</p>
          ${t === "silver" ? badge("Your plan") : ""}
        </div>
        ${PAID_TIERS.map((k) => cardHtml(k, iv)).join("")}
        ${!anyLink && !paying ? '<p class="fuel-error">Sign-ups open soon. Ask Max about it at your next session.</p>' : ""}
        ${
          paying && p.portalUrl
            ? '<p class="fuel-plan-card__note">Switching opens Stripe\'s billing page: choose Update plan. Stripe adjusts your bill for the rest of the period.</p>'
            : ""
        }`;
    }

    const toggle = hasYear
      ? `<div class="fuel-interval" role="radiogroup" aria-label="How often you pay">
           <button type="button" role="radio" data-interval="month">Monthly</button>
           <button type="button" role="radio" data-interval="year">Yearly <small>3 months free</small></button>
         </div>`
      : "";

    openSheet(
      `<h2 class="fuel-sheet__title" id="fuelSheetTitle">Fuel plans</h2>
       <p class="fuel-sheet__sub">${esc(sub)}</p>
       ${toggle}
       <div class="fuel-plans" data-plans></div>
       ${paying && p.portalUrl ? `<a class="fuel-link fuel-plans__manage" href="${esc(p.portalUrl)}" target="_blank" rel="noopener">Manage or cancel your subscription</a>` : ""}
       <button class="fuel-btn fuel-btn--quiet" type="button" data-refresh>Already paid? Tap to refresh</button>`,
      (body) => {
        const paint = () => {
          body.querySelector("[data-plans]").innerHTML = plansHtml(plansInterval);
          body.querySelectorAll("[data-interval]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.interval === plansInterval)));
        };
        body.addEventListener("click", (e) => {
          const iv = e.target.closest("[data-interval]");
          if (iv) {
            plansInterval = iv.dataset.interval;
            paint();
          } else if (e.target.closest("[data-upgrade]")) state.awaitingUpgrade = true;
        });
        body.querySelector("[data-refresh]").addEventListener("click", (e) => refreshPlan(e.target));
        paint();
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
      if (state.plan && state.plan.kind === "paid") {
        closeSheet();
        toast(`${TIER_NAMES[tier()]} is on`);
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
    else if (mode === "meal") openPhotoNote(file);
    else if (mode === "fridge") addFridgePhoto(file);
    else analysePhoto(file, mode);
  }
  els.photoInput.addEventListener("change", onPhotoChosen);
  els.libraryInput.addEventListener("change", onPhotoChosen);

  /** Before a meal photo goes to the AI: an optional note on what's in it and how much. */
  function openPhotoNote(file) {
    const url = URL.createObjectURL(file);
    openSheet(
      `<h2 class="fuel-sheet__title" id="fuelSheetTitle">What's in it?</h2>
       <p class="fuel-sheet__sub">Optional, but it helps. Name the foods and any amounts you know.</p>
       <img class="fuel-photo" src="${url}" alt="Your meal photo" />
       <textarea class="fuel-input fuel-note" data-note rows="2" maxlength="300" placeholder="e.g. 200g chicken breast, 1 cup rice, cooked in olive oil" aria-label="What's in your meal"></textarea>
       <button class="fuel-btn" type="button" data-go>Read my meal</button>
       <button class="fuel-btn fuel-btn--quiet" type="button" data-retake>Retake photo</button>`,
      (body) => {
        const done = () => URL.revokeObjectURL(url);
        body.querySelector("[data-go]").addEventListener("click", () => {
          const note = body.querySelector("[data-note]").value.trim();
          done();
          analysePhoto(file, "meal", note);
        });
        body.querySelector("[data-retake]").addEventListener("click", () => {
          done();
          pickPhoto("meal", true);
        });
      }
    );
  }

  // ---------------------------------------------------------------------------
  // What can I make? (Gold and Diamond, 2026-10-15): photos of the fridge,
  // freezer or cupboard, what it's for, and 3 ideas that fit what's left
  // today. One request counts as 2 AI uses (Macros.gs actionFridgeIdeas_).
  // ---------------------------------------------------------------------------

  const FRIDGE_PURPOSES = [
    ["breakfast", "Breakfast"],
    ["lunch", "Lunch"],
    ["dinner", "Dinner"],
    ["snack", "Snack"],
    ["preworkout", "Before a workout"],
    ["postworkout", "After a workout"],
    ["quick", "Quick (10 min)"],
  ];
  const FRIDGE_AI_USES = 2;
  const FRIDGE_MAX_PHOTOS = 3;
  // Kept for this visit only, so "Try different ideas" can reuse the photos.
  // The photos only ever leave the phone inside the request itself.
  const fridge = { photos: [], purposes: new Set(), note: "", result: null, seen: [] };

  function openFridge() {
    if (!fridge.purposes.size) fridge.purposes.add(defaultMeal());
    openSheet(fridgeSetupHtml(), wireFridgeSetup);
  }

  function fridgeSetupHtml() {
    const r = state.targets ? remainingToday() : null;
    const a = state.aiToday;
    const photos = fridge.photos
      .map(
        (p, i) => `
        <div class="fr-photo">
          <img src="${p.url}" alt="Photo ${i + 1}" />
          <button class="fr-photo__x" type="button" data-remove="${i}" aria-label="Remove photo ${i + 1}">${ICONS.x}</button>
        </div>`
      )
      .join("");
    const add =
      fridge.photos.length < FRIDGE_MAX_PHOTOS
        ? `<button class="fr-photo fr-photo--add" type="button" data-add><span aria-hidden="true">+</span>${fridge.photos.length ? "Add another" : "Add a photo"}</button>`
        : "";
    const when = isToday() ? "today" : esc(dayLabel(state.viewDate).toLowerCase());
    const p = `<b>${int(Math.max(0, r ? r.protein_g : 0))}g protein</b>`;
    const left = r
      ? `You've got ${p}${hideKcal() ? "" : ` and <b>${int(Math.max(0, r.kcal))} kcal</b>`} left ${when}. Ideas will fit that.`
      : "";
    return `
      <h2 class="fuel-sheet__title" id="fuelSheetTitle">What can I make?</h2>
      <p class="fr-hint">Take photos of your fridge, freezer or cupboard, up to ${FRIDGE_MAX_PHOTOS}. Open the door wide.</p>
      <div class="fr-photos">${photos}${add}</div>
      <div>
        <p class="mp-q mp-tight">What's it for?</p>
        <div class="mp-chips">${FRIDGE_PURPOSES.map(
          ([key, label]) =>
            `<button class="mp-chip${fridge.purposes.has(key) ? " is-on" : ""}" type="button" data-purpose="${key}" aria-pressed="${fridge.purposes.has(key)}">${label}</button>`
        ).join("")}</div>
      </div>
      <div>
        <p class="mp-q mp-tight">Anything else?</p>
        <input class="fr-text" type="text" data-note maxlength="200" value="${esc(fridge.note)}" placeholder="e.g. I'm training in an hour" aria-label="Anything else" />
      </div>
      ${left ? `<p class="fr-left">${left}</p>` : ""}
      <button class="week-btn" type="button" data-go${fridge.photos.length ? "" : " disabled"}>Find ideas</button>
      <p class="mp-cost">Uses ${FRIDGE_AI_USES} of your AI scans${a && a.limit ? ` · ${a.left} left today` : ""}</p>`;
  }

  function wireFridgeSetup(body) {
    body.querySelector("[data-note]").addEventListener("input", (e) => {
      fridge.note = e.target.value;
    });
    body.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.remove !== undefined) {
        const [gone] = fridge.photos.splice(Number(b.dataset.remove), 1);
        if (gone) URL.revokeObjectURL(gone.url);
        openFridge();
      } else if (b.dataset.add !== undefined) {
        // No capture attribute, so the phone offers the camera or the photo library.
        pickPhoto("fridge", false);
      } else if (b.dataset.purpose) {
        const key = b.dataset.purpose;
        if (fridge.purposes.has(key)) fridge.purposes.delete(key);
        else fridge.purposes.add(key);
        b.classList.toggle("is-on", fridge.purposes.has(key));
        b.setAttribute("aria-pressed", String(fridge.purposes.has(key)));
      } else if (b.dataset.go !== undefined) findFridgeIdeas(false);
    });
  }

  async function addFridgePhoto(file) {
    try {
      const b64 = await resizeImage(file);
      if (fridge.photos.length < FRIDGE_MAX_PHOTOS) fridge.photos.push({ b64, url: URL.createObjectURL(file) });
    } catch (err) {
      toast("Couldn't read that photo. Try another one.");
    }
    openFridge();
  }

  async function findFridgeIdeas(more) {
    if (state.busy || !fridge.photos.length) return;
    state.busy = true;
    sheetLoading(more ? "Thinking of something different" : "Looking in your fridge");
    const r = state.targets ? remainingToday() : null;
    try {
      const data = await MacroApi.call("fridgeIdeas", {
        images: fridge.photos.map((p) => p.b64),
        purposes: [...fridge.purposes],
        note: fridge.note.trim(),
        left: r ? { kcal: Math.round(r.kcal), protein_g: Math.round(r.protein_g) } : null,
        avoid: more ? fridge.seen : [],
      });
      fridge.result = data;
      fridge.seen = (more ? fridge.seen : []).concat(data.ideas.map((i) => i.name)).slice(-6);
      setAiToday(data.aiToday);
      showFridgeIdeas();
    } catch (err) {
      if (err.code === "limit" || err.code === "no_plan") openUpsell({ reason: "limit", message: err.message });
      else {
        openSheet(
          `<h2 class="fuel-sheet__title" id="fuelSheetTitle">Couldn't find ideas</h2>
           <p class="fuel-error">${esc(err.message)}</p>
           <button class="fuel-btn" type="button" data-again>Try again</button>
           <button class="fuel-btn fuel-btn--quiet" type="button" data-back>Change photos</button>`,
          (body) => {
            body.querySelector("[data-again]").addEventListener("click", () => findFridgeIdeas(more));
            body.querySelector("[data-back]").addEventListener("click", openFridge);
          }
        );
      }
    } finally {
      state.busy = false;
    }
  }

  function fridgeIdeaHtml(idea, i, listOn) {
    const t = MacroCore.sumTotals(idea.items);
    const meta = [idea.minutes ? `<b>${idea.minutes} min</b>` : "", `${int(t.protein_g)}g protein`, hideKcal() ? "" : `${int(t.kcal)} kcal`]
      .filter(Boolean)
      .join(" · ");
    return `
      <div class="week-card">
        <div class="mp-meal__top">
          <span class="mp-meal__emoji" aria-hidden="true">${esc(idea.emoji || "🍽️")}</span>
          <div><div class="mp-meal__name">${esc(idea.name)}</div><div class="fr-meta">${meta}</div></div>
        </div>
        ${idea.why ? `<p class="fr-why">${esc(idea.why)}</p>` : ""}
        <ul class="mp-items">${idea.items.map((it) => `<li><span>${esc(it.name)}</span><span>${esc(it.amount_text || `${int(it.grams)}g`)}</span></li>`).join("")}</ul>
        ${idea.need
          .map(
            (n) => `
          <div class="fr-need">
            <span>You'd need: <b>${esc(n)}</b></span>
            ${listOn ? `<button class="mp-btn mp-snack__add" type="button" data-need="${esc(n)}">+ List</button>` : ""}
          </div>`
          )
          .join("")}
        ${idea.steps.length ? `<ol class="fr-steps">${idea.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
        <button class="mp-btn mp-btn--red fr-log" type="button" data-log="${i}">Log it</button>
      </div>`;
  }

  function showFridgeIdeas() {
    const res = fridge.result;
    const listOn = MacroCore.tierRank(tier()) >= MacroCore.tierRank("gold");
    const shownSpotted = res.spotted.slice(0, 12);
    const moreSpotted = res.spotted.length - shownSpotted.length;
    openSheet(
      `<h2 class="fuel-sheet__title" id="fuelSheetTitle">What you could make</h2>
       ${
         res.spotted.length
           ? `<div>
                <p class="week-dates">Spotted in your photos</p>
                <div class="fr-spotted">${shownSpotted.map((s) => `<span>${esc(s)}</span>`).join("")}${moreSpotted > 0 ? `<span>+${moreSpotted} more</span>` : ""}</div>
              </div>`
           : ""
       }
       ${res.ideas.map((idea, i) => fridgeIdeaHtml(idea, i, listOn)).join("")}
       <button class="week-btn week-btn--ghost" type="button" data-more>Try different ideas</button>
       <p class="mp-cost">Uses ${FRIDGE_AI_USES} more AI scans</p>
       <button class="fuel-btn fuel-btn--quiet" type="button" data-back>Change photos or what it's for</button>`,
      (body) => {
        body.addEventListener("click", async (e) => {
          const b = e.target.closest("button");
          if (!b) return;
          if (b.dataset.log !== undefined) logFridgeIdea(res.ideas[Number(b.dataset.log)]);
          else if (b.dataset.more !== undefined) findFridgeIdeas(true);
          else if (b.dataset.back !== undefined) openFridge();
          else if (b.dataset.need) {
            b.disabled = true;
            try {
              const data = await MacroApi.call("shoppingAdd", { name: b.dataset.need });
              state.toBuy = data.list.filter((i) => !i.done).length;
              b.textContent = "✓ On list";
              b.classList.add("mp-btn--done");
            } catch (err) {
              b.disabled = false;
              toast(err.message);
            }
          }
        });
      }
    );
  }

  /** Into the usual confirm screen, so amounts can change first. A meal they picked goes straight into that meal. */
  function logFridgeIdea(idea) {
    if (!idea) return;
    const slot =
      ["breakfast", "lunch", "dinner", "snack"].find((k) => fridge.purposes.has(k)) ||
      (fridge.purposes.has("preworkout") || fridge.purposes.has("postworkout") ? "snack" : null);
    if (slot) state.addMeal = slot;
    openConfirm({
      title: idea.name,
      source: "fridge",
      items: idea.items.map((it) => ({ name: it.name, grams: it.grams, per100: MacroCore.per100From(it, it.grams), source: "fridge" })),
    });
  }

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

  async function analysePhoto(file, mode, note) {
    sheetLoading(mode === "label" ? "Reading the label" : "Reading your meal");
    let data;
    try {
      const image = await resizeImage(file);
      const fields = { image: image, mode: mode };
      if (note) fields.note = note;
      data = await MacroApi.call("analyseImage", fields, { timeoutMs: 90000 });
    } catch (err) {
      if (err.code === "no_plan" || err.code === "limit") {
        if (err.code === "no_plan" && state.plan) state.plan.access = false;
        openUpsell({ reason: err.code === "limit" ? "limit" : "", message: err.message });
        return;
      }
      const again = `<button class="fuel-btn" type="button" data-retry="${mode}">Try another photo</button>`;
      const alt = mode === "meal" ? '<button class="fuel-btn fuel-btn--ghost" type="button" data-retry="barcode">Scan a barcode instead</button>' : "";
      sheetError("Hmm", err.message, again + alt);
      return;
    }
    setAiToday(data.aiToday);

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
    if (isServes(item)) {
      return `<div class="fuel-serves">
        ${[50, 100, 150, 200].map((g) => `<button type="button" data-serve="${i}" data-g="${g}">${servesText(g)}</button>`).join("")}
      </div>`;
    }
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
    if (item.source !== "photo" && item.source !== "describe") return "";
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
          ${
            isServes(item)
              ? `<label class="fuel-item__gin fuel-item__gin--serves"><input class="fuel-input" type="number" inputmode="decimal" min="0" max="50" step="0.5" value="${item.grams / 100}" data-grams="${i}" data-per="100" aria-label="Serves" /><span>serves</span></label>`
              : `<input class="fuel-range" type="range" min="0" max="${max}" step="${step}" value="${Math.min(max, item.grams)}" data-range="${i}" aria-label="Amount" />
          <label class="fuel-item__gin"><input class="fuel-input" type="number" inputmode="decimal" min="0" max="5000" step="1" value="${item.grams}" data-grams="${i}" aria-label="Grams" /><span>${esc(item.unit || "g")}</span></label>`
          }
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
    if (c.source === "manual") return "Set how much you had, then add it.";
    if (c.source === "describe") return "Estimated from your description, so check the amounts. A photo or a search is usually closer.";
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
       <button class="fuel-btn fuel-btn--ghost fuel-add-more" type="button" data-more>${ICONS.plus} Add another food</button>
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
       <div class="fuel-save-meal" data-save-area>
         <button class="fuel-btn fuel-btn--quiet" type="button" data-save-meal>☆ Save as a meal for next time</button>
       </div>
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
          if (range && from !== "range") range.value = Math.min(Number(range.max), g);
          if (from !== "box") box.value = g / (Number(box.dataset.per) || 1); // serves boxes show grams / 100
          if (from) body.querySelectorAll(`[data-serve="${i}"]`).forEach((b) => b.classList.remove("is-on"));
          refresh(i);
        };
        body.addEventListener("input", (e) => {
          const t = e.target;
          if (t.dataset.range !== undefined) setGrams(Number(t.dataset.range), t.value, "range");
          else if (t.dataset.grams !== undefined) setGrams(Number(t.dataset.grams), t.value * (Number(t.dataset.per) || 1), "box");
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
          if (e.target.closest("[data-more]")) {
            openSearch({ into: true });
            return;
          }
          if (e.target.closest("[data-save-meal]")) {
            const generic = /^(your meal|food)$/i.test(String(c.title).trim());
            const area = body.querySelector("[data-save-area]");
            area.innerHTML = `
              <form class="fuel-inline" data-save-form autocomplete="off">
                <input class="fuel-input" name="mealName" maxlength="60" placeholder="Name it, e.g. Protein smoothie" value="${esc(generic ? "" : c.title)}" aria-label="Meal name" />
                <button class="fuel-btn" type="submit">Save</button>
              </form>`;
            const form = area.querySelector("[data-save-form]");
            form.elements.mealName.focus();
            form.addEventListener("submit", async (ev) => {
              ev.preventDefault();
              const name = form.elements.mealName.value.trim();
              const items = c.items.filter((it) => Number(it.grams) > 0 && String(it.name).trim());
              if (!name || !items.length) {
                form.elements.mealName.focus();
                return;
              }
              const saveBtn = form.querySelector("button");
              saveBtn.disabled = true;
              try {
                const data = await MacroApi.call("saveMeal", { name: name, items: items.map(payloadItem) });
                state.meals = data.meals || [];
                area.innerHTML = `<p class="fuel-save-meal__done">★ Saved as "${esc(name)}". It's under Tap to log again.</p>`;
                render();
              } catch (err) {
                saveBtn.disabled = false;
                toast(err.message);
              }
            });
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
      // "What to eat next" lived on the main screen until the 2026-10-02
      // redesign moved it in here — same ideasFor()/shownIdeas plumbing,
      // just at the top of Ask Fuel's empty state instead.
      const ideas = isToday() ? suggestionsHtml(3, false) : "";
      return `${ideas}
        <p class="fuel-disclaimer">Ask anything about food and your macros today. Fuel can see what you've logged and what's left.</p>
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
    if (!askFuelOn()) {
      openUpsell({ reason: "ask" });
      return;
    }
    openSheet(
      `<h2 class="fuel-sheet__title" id="fuelSheetTitle">Ask Fuel</h2>
       <p class="fuel-sheet__sub" data-chat-left>${esc(aiLeftText() || planText())}</p>
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
            setAiToday(data.aiToday);
            const left = body.querySelector("[data-chat-left]");
            if (left) left.textContent = aiLeftText();
          } catch (err) {
            // "platinum" is the code an older backend sends for the same thing.
            const needsDiamond = err.code === "diamond" || err.code === "platinum";
            if (err.code === "no_plan" || err.code === "limit" || needsDiamond) {
              state.chat.pop();
              state.chat.pop(); // their question too: it didn't go anywhere
              state.busy = false;
              if (err.code === "no_plan" && state.plan) state.plan.access = false;
              openUpsell({ reason: err.code === "limit" ? "limit" : needsDiamond ? "ask" : "", message: err.message });
              render();
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
          const ideaBtn = e.target.closest('[data-act="log-idea"]');
          if (ideaBtn) {
            await logIdea(ideaBtn);
            paint();
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
  // Progress (free): this week (Screen Time style), weight vs goal, punches
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
    const H = 190, L = 42, R = W - 8, T = 14, B = H - 32;
    const span = Math.max(1, MacroCore.daysBetween(x0, x1));
    const x = (d) => L + ((R - L) * MacroCore.daysBetween(x0, d)) / span;
    const y = (v) => T + ((B - T) * (hi - v)) / (hi - lo || 1);
    const root = svg(box, "svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": "Weight trend" });
    ticks(lo, hi, 3).forEach((v) => {
      svg(root, "line", { x1: L, x2: R, y1: y(v), y2: y(v), class: "fuel-grid" });
      svg(root, "text", { x: L - 8, y: y(v) + 5, "text-anchor": "end" }, v);
    });
    if (goalNear) {
      svg(root, "line", { x1: L, x2: R, y1: y(g.goal_weight_kg), y2: y(g.goal_weight_kg), class: "fuel-goal" });
      svg(root, "text", { x: R, y: y(g.goal_weight_kg) - 7, "text-anchor": "end", class: "fuel-chart__strong" }, `Goal ${kgText(g.goal_weight_kg)} kg`);
    }
    if (pace.length) svg(root, "line", { x1: x(pace[0].date), y1: y(pace[0].kg), x2: x(pace[1].date), y2: y(pace[1].kg), class: "fuel-pace" });
    pts.forEach((q) => svg(root, "circle", { cx: x(q.date), cy: y(q.kg), r: 3.5, class: "fuel-dot" }));
    if (trend.length > 1) {
      svg(root, "polyline", { points: trend.map((q) => `${x(q.date)},${y(q.kg)}`).join(" "), class: "fuel-line" });
    }
    const last = trend[trend.length - 1];
    svg(root, "circle", { cx: x(last.date), cy: y(last.kg), r: 6, class: "fuel-dot--now" });
    svg(root, "text", { x: L, y: H - 6 }, shortDate(x0));
    svg(root, "text", { x: x(today), y: H - 6, "text-anchor": x1 > today ? "middle" : "end" }, "Today");
    if (x1 > today) svg(root, "text", { x: R, y: H - 6, "text-anchor": "end" }, pace[1].goalReached ? "Goal" : shortDate(x1));
    // Tap/hover targets bigger than the dots.
    pts.forEach((q) => {
      const avg = trendAll.find((t) => t.date === q.date);
      const hit = svg(root, "circle", { cx: x(q.date), cy: y(q.kg), r: 16, class: "fuel-hit" });
      const show = () => (readout.textContent = `${shortDate(q.date)} · ${kgText(q.kg)} kg${avg ? ` · 7-day average ${kgText(avg.kg)} kg` : ""}${q.by === "coach" ? " · logged by Max" : ""}`);
      hit.addEventListener("pointerenter", show);
      hit.addEventListener("click", show);
    });
  }

  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  /** "Thursday 1 Oct" */
  function longDate(ymd) {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
  }

  /** Monday to Sunday of the week starting `weekStart`, from the last 14 days the server sends (always enough for this week and last). Days after today are `future`. */
  function weekDays(weekStart) {
    const p = state.progress;
    const out = [];
    for (let i = 0; i < 7; i++) {
      const date = MacroCore.addDays(weekStart, i);
      const d = (p.days || []).find((x) => x.date === date);
      out.push(Object.assign({ date: date, kcal: 0, protein_g: 0, target_kcal: null, green: false }, d || {}, { future: date > p.today }));
    }
    return out;
  }

  /** What one day's bar means, in words: shown under the chart when it's tapped. */
  function dayReadout(d) {
    if (!(d.kcal > 0)) return `${longDate(d.date)} · nothing logged`;
    const amount = hideKcal() ? (d.target_kcal ? `${Math.round((d.kcal / d.target_kcal) * 100)}% of your target` : "") : `${int(d.kcal)} kcal`;
    return [longDate(d.date), amount, `${int(d.protein_g)}g protein`, d.green ? "Green day ✓" : ""].filter(Boolean).join(" · ");
  }

  /**
   * The week, like iPhone Screen Time: one bar per day, Monday to Sunday,
   * as tall as what was eaten, green on a green day, grey otherwise, with
   * the target as a dashed line. Tap a day for its numbers. Big text on
   * purpose: plenty of Max's clients don't have young eyes.
   */
  function drawWeek(box) {
    const p = state.progress;
    const hide = hideKcal();
    const last = state.progressWeek === "last";
    const week = last ? p.lastWeek : p.thisWeek;
    const days = weekDays(week.weekStart);
    const logged = days.filter((d) => !d.future && d.kcal > 0);
    const greens = days.filter((d) => d.green).length;
    const withTarget = days.filter((d) => d.target_kcal > 0);
    const target = withTarget.length ? withTarget[withTarget.length - 1].target_kcal : null;
    const top = Math.max(target ? target * 1.2 : 0, ...days.map((d) => d.kcal || 0), 1);
    const frac = (v) => Math.min(1, v / top);
    const avg = logged.length ? logged.reduce((sum, d) => sum + (hide ? d.protein_g : d.kcal), 0) / logged.length : null;
    const cols = days
      .map((d, i) => {
        const bar = d.kcal > 0 ? `<span class="fuel-wk__bar${d.green ? " is-green" : ""}" style="height:${Math.max(2, frac(d.kcal) * 100).toFixed(1)}%"></span>` : "";
        const label = d.date === p.today ? "Today" : DAY_NAMES[i];
        return `<button type="button" class="fuel-wk__col${d.date === p.today ? " is-today" : ""}" data-day="${d.date}"${d.future ? " disabled" : ""} aria-label="${esc(d.future ? `${longDate(d.date)}, still to come` : dayReadout(d))}">
            <span class="fuel-wk__track">${bar}</span>
            <span class="fuel-wk__day">${label}</span>
          </button>`;
      })
      .join("");
    const line = target
      ? `<span class="fuel-wk__target" style="bottom:calc(var(--wk-day) + var(--wk-h) * ${frac(target).toFixed(3)})" aria-hidden="true"><span>${hide ? "Target" : `Target ${int(target)}`}</span></span>`
      : "";
    const startText = days[0].date === p.today ? "" : "Tap a day to see its numbers.";
    box.innerHTML = `
      <div class="fuel-seg fuel-seg--big" data-week-pick>
        <button type="button" data-week="this" class="${last ? "" : "is-on"}">This week</button>
        <button type="button" data-week="last" class="${last ? "is-on" : ""}">Last week</button>
      </div>
      <div class="fuel-wk__head">
        <span class="fuel-wk__big">${greens}<span class="fuel-wk__unit">green day${greens === 1 ? "" : "s"}</span></span>
        <span class="fuel-wk__avg">${avg != null ? `Daily average ${hide ? `${int(avg)}g protein` : `${int(avg)} kcal`}` : last ? "Nothing logged last week" : "Nothing logged yet this week"}</span>
      </div>
      <div class="fuel-wk__plot">${line}${cols}</div>
      <p class="fuel-wk__readout" data-wk-readout aria-live="polite">${esc(startText)}</p>
      <p class="fuel-wk__key"><span class="fuel-wk__swatch" aria-hidden="true"></span>Green day = protein hit and ${hide ? "on target" : "calories within 10% of your target"}.</p>`;
    const readout = box.querySelector("[data-wk-readout]");
    const pick = (date) => {
      const d = days.find((x) => x.date === date);
      if (!d || d.future) return;
      box.querySelectorAll(".fuel-wk__col").forEach((c) => c.classList.toggle("is-picked", c.dataset.day === date));
      readout.textContent = dayReadout(d);
    };
    box.querySelector(".fuel-wk__plot").addEventListener("click", (e) => {
      const col = e.target.closest("[data-day]");
      if (col) pick(col.dataset.day);
    });
    box.querySelector("[data-week-pick]").addEventListener("click", (e) => {
      const b = e.target.closest("[data-week]");
      if (!b || b.dataset.week === state.progressWeek) return;
      state.progressWeek = b.dataset.week;
      drawWeek(box);
    });
    // Open on today, so the numbers you came for are already there.
    if (!last && days.some((d) => d.date === p.today)) pick(p.today);
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
        <span class="fuel-row__note">${int(loyalty.attended)} class${loyalty.attended === 1 ? "" : "es"} + ${int(loyalty.punches)} bonus punch${loyalty.punches === 1 ? "" : "es"} (Fuel and referrals)</span>
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
    const lastTrend = MacroCore.movingAverage(p.weights || [], 7).pop();
    const ranges = [[28, "4 wks"], [84, "12 wks"], [0, "All"]];
    openSheet(
      `<h2 class="fuel-sheet__title" id="fuelSheetTitle">Progress</h2>
       <div class="fuel-panel fuel-chartcard">
         <span class="card__label card__label--red">Your week</span>
         <div class="fuel-wk" data-week-chart></div>
         <p class="fuel-punch__text">${esc(punchText(p))}</p>
         ${pegsHtml(p.loyalty)}
       </div>
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
                <div class="fuel-seg fuel-seg--big" data-range>${ranges.map(([d, l]) => `<button type="button" data-days="${d}" class="${state.progressRange === d ? "is-on" : ""}">${l}</button>`).join("")}</div>
                <div class="fuel-chart" data-weight-chart></div>
                <p class="fuel-readout" data-weight-readout>Tap a dot for the details.</p>
                <p class="fuel-legend"><span class="fuel-key fuel-key--line"></span>7-day average <span class="fuel-key fuel-key--dot"></span>weigh-ins ${p.goal && p.goal.weekly_rate_kg ? '<span class="fuel-key fuel-key--pace"></span>goal pace' : ""}</p>
              </div>`
       }
       <button class="fuel-btn fuel-btn--quiet" type="button" data-close>Done</button>`,
      (body) => {
        const wBox = body.querySelector("[data-weight-chart]");
        if (wBox) drawWeightChart(wBox, body.querySelector("[data-weight-readout]"));
        drawWeek(body.querySelector("[data-week-chart]"));
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
    const serves = isServes(entry);
    openSheet(
      `<input class="fuel-item__name fuel-sheet__title" id="fuelSheetTitle" value="${esc(entry.name)}" data-ename aria-label="Food name" maxlength="80" />
       <div class="fuel-item">
         <div class="fuel-item__grams">
           ${
             serves
               ? `<label class="fuel-item__gin fuel-item__gin--serves"><input class="fuel-input" type="number" inputmode="decimal" min="0" max="50" step="0.5" value="${entry.grams / 100}" data-egrams aria-label="Serves" /><span>serves</span></label>`
               : `<input class="fuel-range" type="range" min="0" max="${max}" step="${max > 400 ? 5 : 1}" value="${Math.min(max, entry.grams)}" data-erange aria-label="Amount" />
           <label class="fuel-item__gin"><input class="fuel-input" type="number" inputmode="decimal" min="0" max="5000" value="${entry.grams}" data-egrams aria-label="Grams" /><span>g</span></label>`
           }
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
        const per = serves ? 100 : 1; // a serves box shows grams / 100
        const update = (g, from) => {
          draft.grams = Math.max(0, Math.min(5000, Number(g) || 0));
          if (range && from !== "range") range.value = Math.min(Number(range.max), draft.grams);
          if (from !== "box") box.value = draft.grams / per;
          macros.innerHTML = macroLine(MacroCore.scale(draft.per100, draft.grams), { bold: true });
        };
        if (range) range.addEventListener("input", () => update(range.value, "range"));
        box.addEventListener("input", () => update(box.value * per, "box"));
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
    const meals = state.meals || [];
    openSheet(
      `<h2 class="fuel-sheet__title" id="fuelSheetTitle">Favourites</h2>
       <p class="fuel-sheet__sub">Tap a favourite on the Fuel screen to log it in one go. Add more from any logged item.</p>
       <span class="card__label">Saved meals</span>
       <div class="fuel-panel">
         ${
           meals.length
             ? meals
                 .map((m) => {
                   const t = mealTotals(m);
                   return `
           <div class="fuel-entry" style="cursor:default">
             <span><span class="fuel-entry__name">${esc(m.name)}</span><span class="fuel-entry__meta">${esc(m.items.map((it) => it.name).join(", "))} · ${macroLine(t)}</span></span>
             <button class="fuel-item__remove" type="button" data-unmeal="${esc(m.id)}" aria-label="Delete ${esc(m.name)}">${ICONS.x}</button>
           </div>`;
                 })
                 .join("")
             : '<p class="fuel-empty">No saved meals yet. Build one with Add food, then tap "Save as a meal".</p>'
         }
       </div>
       <span class="card__label">Foods</span>
       <div class="fuel-panel">
         ${
           list.length
             ? list
                 .map(
                   (f) => `
           <div class="fuel-entry" style="cursor:default">
             <span><span class="fuel-entry__name">${esc(f.name)}</span><span class="fuel-entry__meta">${amountText(f)} · ${macroLine(MacroCore.scale(f.per100, f.grams))}</span></span>
             <button class="fuel-item__remove" type="button" data-unfav="${esc(f.id)}" aria-label="Remove ${esc(f.name)}">${ICONS.x}</button>
           </div>`
                 )
                 .join("")
             : '<p class="fuel-empty">No favourites yet.</p>'
         }
       </div>
       <button class="fuel-btn fuel-btn--quiet" type="button" data-close>Done</button>`,
      (body) => {
        body.querySelectorAll("[data-unmeal]").forEach((b) =>
          b.addEventListener("click", async () => {
            b.disabled = true;
            try {
              const data = await MacroApi.call("deleteMeal", { mealId: b.dataset.unmeal });
              state.meals = data.meals || [];
              render();
              openFavourites();
            } catch (err) {
              b.disabled = false;
              toast(err.message);
            }
          })
        );
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
       <button class="fuel-btn fuel-btn--ghost" type="button" data-s="favs">Favourites &amp; saved meals</button>
       ${
         state.aiEnabled && state.plan
           ? `<div class="fuel-panel fuel-plan">
                <span class="card__label card__label--red">Your plan</span>
                <span class="fuel-tier fuel-tier--${tier()}">${TIER_NAMES[tier()]}</span>
                <span class="fuel-plan__text">${esc(planText())}</span>
                ${fuelAi() ? `<span class="fuel-plan__text">${esc(aiLeftText())}</span>` : ""}
                ${
                  state.plan.kind === "paid" && state.plan.portalUrl
                    ? `<a class="fuel-link" href="${esc(state.plan.portalUrl)}" target="_blank" rel="noopener">Manage subscription</a>`
                    : ""
                }
                <button class="fuel-link" type="button" data-s="upgrade">See plans</button>
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

  // Which view opens is decided entirely by how they got here (the bottom
  // nav's Profile vs Macros link) — never a remembered last tab, which used
  // to mean tapping Profile could land back on Fuel. No in-page Card/Fuel
  // switcher any more either (2026-10-02): the bottom nav already does that.
  showTab(window.location.hash === "#fuel" ? "fuel" : "card");
})();
