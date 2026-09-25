/**
 * MaxFit Macros — Apps Script web app for the macro tracker on the card.
 *
 * A SEPARATE Apps Script project from the check-in one (apps-script/Code.gs),
 * with its own deployment URL, so redeploying this can never break
 * check-ins. It stores everything in its own PRIVATE Google Sheet ("MaxFit
 * Macros", not shared with anyone) — unlike the main CRM sheet, which is
 * publicly readable and so must never hold food logs.
 *
 * The project has two files:
 *   Macros.gs      — this file
 *   MacrosCore.gs  — an exact copy of card/macros-core.js (shared maths)
 *
 * Script Properties (Project Settings → Script Properties), never in git:
 *   ANTHROPIC_API_KEY  — Claude API key
 *   STAFF_PIN          — same PIN as the check-in script (coach view)
 *   MACRO_SHEET_ID     — id of the private "MaxFit Macros" sheet
 *   MAIN_SHEET_ID      — the CRM sheet (read-only here, for client names)
 *   GOLD_DAILY_AI      — optional, AI uses per day on Gold (default 10)
 *   PLATINUM_DAILY_AI  — optional, AI uses per day on Platinum (default 25)
 *   STRIPE_SECRET_KEY  — Stripe RESTRICTED key, read-only on Checkout
 *                        Sessions and Subscriptions
 *   STRIPE_FUEL_LINK   — the Stripe Payment Link for Fuel Gold ($9.99/month)
 *   STRIPE_PLATINUM_LINK — the Payment Link for Fuel Platinum ($14.99/month)
 *   STRIPE_PORTAL_LINK — Stripe customer-portal login link (manage, switch
 *                        Gold ↔ Platinum, cancel)
 *
 * Plans: Silver is free (barcodes, search, saved meals, typed-in numbers,
 * targets, totals, suggestions, progress). Gold and Platinum add Fuel AI:
 * photo and label scans, Describe it, and Ask Fuel, from one daily pool of
 * AI uses. New clients get 7 days of Gold from the first time they open
 * FUEL; after that it's a Stripe subscription or a free month from Max. A
 * subscription's tier comes from its price's lookup key ("fuel_platinum").
 *
 * Stripe is never called by webhook (Apps Script can't read webhook
 * headers to verify them). Instead syncStripe() asks Stripe's API: every
 * 15 minutes on a trigger (installStripeSync), when a client lands back
 * from checkout, and from the coach page. The Upgrade button passes
 * client_reference_id=fuel-<slug>, which is how a payment finds its client.
 *
 * Progress (free for everyone): weights (logged by the client or Max),
 * target history, green days (protein ≥ 90% and kcal within ±10%), and
 * NUTRITION PUNCHES — 5 green days in a Monday–Sunday week adds 1 to
 * "Nutrition Punches" on the CRM's Sessions Remaining tab (awardPunches,
 * daily trigger from installPunchTrigger). The card and check-in page add
 * those to Total Classes Attended; when a nutrition punch completes a card
 * of 10, "Free Session Owed" = Y and the check-in page offers the free
 * session (Code.gs clears it when it's used).
 *
 * Who can do what: every member action needs the member's id AND their
 * secret key (the &k= part of their card link), checked against the
 * Members tab. Coach actions need STAFF_PIN. A member can only ever read
 * or change rows carrying their own id.
 */

const MACROS_VERSION = "2026-09-26a";
const TIMEZONE = "Australia/Sydney";
const MAIN_SESSIONS_GID = 1169726169; // "Sessions Remaining" in the CRM sheet
const CARD_URL = "https://maxfit.now/card/";

// Claude models (checked against the Claude API model list, Sept 2026).
// Sonnet reads photos; Haiku runs the Ask Fuel chat.
const VISION_MODEL = "claude-sonnet-5";
const TEXT_MODEL = "claude-haiku-4-5";
// USD per million tokens, for the AI Usage log. Cache writes are 1.25x
// input, cache reads 0.1x input.
const PRICING = {
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

const TABS = {
  // New columns go at the END of a header list: existing sheets get them
  // appended by addMissingColumns_, and must end up in the same order.
  members: {
    name: "Members",
    headers: [
      "slug", "name", "sex", "key", "hide_kcal", "created_at",
      "trial_started", "stripe_customer", "stripe_subscription", "plan_status", "plan_until", "comp_until",
      "hide_weight", "plan_tier", "comp_tier",
    ],
    text: ["slug", "key", "trial_started", "plan_until", "comp_until"],
  },
  targets: {
    name: "Macro Targets",
    headers: [
      "slug", "kcal", "protein_g", "carbs_g", "fat_g", "set_by", "calc_inputs", "coach_approved", "updated_at",
      "goal_weight_kg", "weekly_rate_kg",
    ],
    text: ["slug"],
  },
  logs: {
    name: "Food Logs",
    headers: [
      "id", "slug", "log_date", "meal", "name", "grams", "kcal", "protein_g", "carbs_g", "fat_g",
      "kcal_100g", "protein_100g", "carbs_100g", "fat_100g", "source", "confidence", "created_at",
    ],
    text: ["id", "slug", "log_date"],
  },
  favourites: {
    name: "Favourites",
    headers: ["id", "slug", "name", "grams", "kcal_100g", "protein_100g", "carbs_100g", "fat_100g", "source", "created_at"],
    text: ["id", "slug"],
  },
  barcodes: {
    name: "Barcode Cache",
    headers: [
      "barcode", "found", "name", "brand", "kcal_100g", "protein_100g", "carbs_100g", "fat_100g",
      "serving_size", "serving_g", "unit", "quality", "fetched_at",
    ],
    text: ["barcode"],
  },
  usage: {
    name: "AI Usage",
    headers: [
      "timestamp", "log_date", "slug", "kind", "model", "input_tokens", "output_tokens",
      "cache_write", "cache_read", "est_cost_usd", "ok",
    ],
    text: ["log_date", "slug"],
  },
  weights: {
    name: "Weights",
    headers: ["id", "slug", "date", "kg", "by", "created_at"],
    text: ["id", "slug", "date"],
  },
  targetHistory: {
    name: "Target History",
    headers: ["slug", "effective_date", "kcal", "protein_g", "carbs_g", "fat_g", "set_by", "created_at"],
    text: ["slug", "effective_date"],
  },
  punches: {
    name: "Punch Awards",
    headers: ["slug", "week_start", "green_days", "awarded_at"],
    text: ["slug", "week_start"],
  },
  meals: {
    name: "Saved Meals",
    headers: ["id", "slug", "name", "items", "created_at"],
    text: ["id", "slug", "items"],
  },
  foods: {
    name: "Foods",
    headers: ["name", "category", "serve_g", "serve_label", "kcal_100g", "protein_100g", "carbs_100g", "fat_100g"],
    text: [],
  },
};

// "quick" = typed-in numbers for one serve: grams 100 means 1 serve, and
// per100 holds the per-serve values (so they can go past 100 g of macros).
const SOURCES = ["photo", "barcode", "label", "manual", "fridge", "suggestion", "quick", "describe"];
const CONFIDENCES = ["high", "medium", "low", ""];

// ---------------------------------------------------------------------------
// Setup (run once from the editor)
// ---------------------------------------------------------------------------

/**
 * Run this once from the Apps Script editor (pick it in the function
 * dropdown, press Run). Creates any missing tabs with their headers, and
 * formats the id/date/barcode columns as plain text so Sheets doesn't turn
 * "2026-09-23" into a date or strip the leading 0 off a barcode.
 */
function setupMacroSheets() {
  const ss = macroSheet_();
  Object.keys(TABS).forEach((key) => {
    const spec = TABS[key];
    const sheet = ss.getSheetByName(spec.name) || createTab_(ss, spec);
    formatTextColumns_(sheet, spec);
  });
  const usage = ss.getSheetByName(TABS.usage.name);
  usage.getRange("M1").setValue("This month (USD)");
  usage.getRange("N1").setFormula(
    '=SUMPRODUCT((LEFT(B2:B,7)=TEXT(TODAY(),"yyyy-mm"))*(J2:J))'
  );
  const blank = ss.getSheetByName("Sheet1");
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);
  return "Macro tabs ready.";
}

// ---------------------------------------------------------------------------
// Web app entry points
// ---------------------------------------------------------------------------

function doGet() {
  return json_({ ok: true, app: "maxfit-macros", version: MACROS_VERSION });
}

const MEMBER_ACTIONS = {
  me: actionMe_,
  getDay: actionGetDay_,
  analyseImage: actionAnalyseImage_,
  barcode: actionBarcode_,
  addEntries: actionAddEntries_,
  updateEntry: actionUpdateEntry_,
  deleteEntry: actionDeleteEntry_,
  saveTargets: actionSaveTargets_,
  addFavourite: actionAddFavourite_,
  removeFavourite: actionRemoveFavourite_,
  setPrefs: actionSetPrefs_,
  chat: actionChat_,
  describe: actionDescribe_,
  saveMeal: actionSaveMeal_,
  deleteMeal: actionDeleteMeal_,
  progress: actionProgress_,
  logWeight: actionLogWeight_,
  deleteWeight: actionDeleteWeight_,
};

const COACH_ACTIONS = {
  coachList: actionCoachList_,
  coachSetTargets: actionCoachSetTargets_,
  issueKey: actionIssueKey_,
  coachGiveMonth: actionCoachGiveMonth_,
  coachSyncStripe: actionCoachSyncStripe_,
  coachLogWeight: actionCoachLogWeight_,
  coachSetGoal: actionCoachSetGoal_,
};

// No key or PIN: only safe, idempotent things. stripeReturn looks up a
// checkout session by its (unguessable) id and links it to its client.
const PUBLIC_ACTIONS = {
  stripeReturn: actionStripeReturn_,
};

function doPost(e) {
  let payload;
  try {
    payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return json_({ ok: false, error: "bad_request", message: "That request didn't make sense." });
  }
  const action = payload.action;
  try {
    if (MEMBER_ACTIONS[action]) {
      const member = authMember_(payload);
      return json_(Object.assign({ ok: true, version: MACROS_VERSION }, MEMBER_ACTIONS[action](payload, member)));
    }
    if (COACH_ACTIONS[action]) {
      checkCoachPin_(payload.pin);
      return json_(Object.assign({ ok: true, version: MACROS_VERSION }, COACH_ACTIONS[action](payload)));
    }
    if (PUBLIC_ACTIONS[action]) {
      return json_(Object.assign({ ok: true, version: MACROS_VERSION }, PUBLIC_ACTIONS[action](payload)));
    }
    return json_({ ok: false, error: "unknown_action", message: "Unknown action." });
  } catch (err) {
    if (err && err.userError) return json_({ ok: false, error: err.code, message: err.message });
    console.error(action, err && err.stack ? err.stack : err);
    return json_({ ok: false, error: "server_error", message: "Something went wrong on our side. Try again." });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** An error whose message is safe and friendly enough to show the client. */
function userError_(code, message) {
  const err = new Error(message);
  err.userError = true;
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
// Sheet helpers
// ---------------------------------------------------------------------------

function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

let macroSheetCache_;
function macroSheet_() {
  if (!macroSheetCache_) {
    const id = prop_("MACRO_SHEET_ID");
    if (!id) throw new Error("Set the MACRO_SHEET_ID script property first.");
    macroSheetCache_ = SpreadsheetApp.openById(id);
  }
  return macroSheetCache_;
}

const tabCache_ = {};

/**
 * The sheet for a TABS key. Tabs and header columns added in later versions
 * create themselves on first use, so an update never needs
 * setupMacroSheets() run again.
 */
function tab_(key) {
  if (tabCache_[key]) return tabCache_[key];
  const spec = TABS[key];
  const ss = macroSheet_();
  let sheet = ss.getSheetByName(spec.name);
  if (sheet) addMissingColumns_(sheet, spec);
  else sheet = createTab_(ss, spec);
  tabCache_[key] = sheet;
  return sheet;
}

function addMissingColumns_(sheet, spec) {
  const width = Math.max(1, sheet.getLastColumn());
  const header = sheet.getRange(1, 1, 1, width).getValues()[0].map((h) => String(h).trim());
  while (header.length && header[header.length - 1] === "") header.pop();
  spec.headers.forEach((h) => {
    if (header.indexOf(h) >= 0) return;
    header.push(h);
    const col = header.length;
    if (spec.text.indexOf(h) >= 0) sheet.getRange(1, col, sheet.getMaxRows(), 1).setNumberFormat("@");
    sheet.getRange(1, col).setValue(h).setFontWeight("bold");
  });
}

function createTab_(ss, spec) {
  const sheet = ss.insertSheet(spec.name);
  sheet.getRange(1, 1, 1, spec.headers.length).setValues([spec.headers]).setFontWeight("bold");
  sheet.setFrozenRows(1);
  formatTextColumns_(sheet, spec);
  return sheet;
}

function formatTextColumns_(sheet, spec) {
  spec.text.forEach((col) => {
    const idx = spec.headers.indexOf(col);
    sheet.getRange(1, idx + 1, sheet.getMaxRows(), 1).setNumberFormat("@");
  });
}

/** All rows of a tab as objects keyed by header, each with its sheet row number in _row. */
function readRows_(key) {
  const sheet = tab_(key);
  const values = sheet.getDataRange().getValues();
  const header = values[0].map((h) => String(h).trim());
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const obj = { _row: r + 1 };
    header.forEach((h, c) => {
      obj[h] = cellValue_(values[r][c]);
    });
    rows.push(obj);
  }
  return rows;
}

/**
 * Sheets turns text that looks like a date into a Date object; turn it
 * back into the text we wrote ("2026-09-23" or "2026-09-23 18:04:11").
 */
function cellValue_(v) {
  if (!(v instanceof Date)) return v;
  const full = Utilities.formatDate(v, TIMEZONE, "yyyy-MM-dd HH:mm:ss");
  return full.slice(11) === "00:00:00" ? full.slice(0, 10) : full;
}

/**
 * Appends one row and returns its row number. Text columns (ids, dates,
 * barcodes) are formatted as plain text BEFORE the value goes in, so a
 * barcode keeps its leading 0 and "2026-09-23" stays a string.
 */
function appendRow_(key, obj) {
  const spec = TABS[key];
  const sheet = tab_(key);
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map((h) => String(h).trim());
  const row = sheet.getLastRow() + 1;
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 100);
  header.forEach((h, c) => {
    if (spec.text.indexOf(h) >= 0) sheet.getRange(row, c + 1).setNumberFormat("@");
  });
  sheet
    .getRange(row, 1, 1, header.length)
    .setValues([header.map((h) => (obj[h] === undefined || obj[h] === null ? "" : obj[h]))]);
  return row;
}

function updateRow_(key, rowNumber, obj) {
  const sheet = tab_(key);
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map((h) => String(h).trim());
  const current = sheet.getRange(rowNumber, 1, 1, header.length).getValues()[0];
  const next = header.map((h, c) => (Object.prototype.hasOwnProperty.call(obj, h) ? obj[h] : current[c]));
  sheet.getRange(rowNumber, 1, 1, header.length).setValues([next]);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function nowStamp_() {
  return Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd HH:mm:ss");
}

function todaySydney_() {
  return Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");
}

function slugify_(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function validDate_(value) {
  const s = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : todaySydney_();
}

function n_(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function cleanText_(value, maxLen) {
  return String(value == null ? "" : value).replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLen);
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function authMember_(payload) {
  const slug = slugify_(payload.id);
  const key = String(payload.k || "");
  if (!slug || !key) throw userError_("bad_key", "This card link doesn't have its macro key. Ask Max for your new link.");
  const member = readRows_("members").find((m) => String(m.slug) === slug);
  if (!member || String(member.key) !== key) {
    throw userError_("bad_key", "This card link isn't set up for macros yet. Ask Max for your new link.");
  }
  return member;
}

function checkCoachPin_(pin) {
  const expected = prop_("STAFF_PIN");
  // Unlike the check-in script, a missing PIN locks the coach view rather
  // than opening it — this view can read every client's food log.
  if (!expected || String(pin || "") !== String(expected)) throw userError_("bad_pin", "Wrong PIN.");
}

// ---------------------------------------------------------------------------
// Member actions
// ---------------------------------------------------------------------------

function targetsFor_(slug) {
  const row = readRows_("targets").find((t) => String(t.slug) === slug);
  if (!row) return null;
  let inputs = null;
  try {
    inputs = row.calc_inputs ? JSON.parse(row.calc_inputs) : null;
  } catch (err) {
    inputs = null;
  }
  return {
    kcal: Number(row.kcal),
    protein_g: Number(row.protein_g),
    carbs_g: Number(row.carbs_g),
    fat_g: Number(row.fat_g),
    set_by: row.set_by,
    calc_inputs: inputs,
    updated_at: row.updated_at,
    goal_weight_kg: Number(row.goal_weight_kg) || null,
    weekly_rate_kg: Number(row.weekly_rate_kg) || null,
  };
}

function entryFromRow_(r) {
  return {
    id: String(r.id),
    log_date: String(r.log_date),
    meal: r.meal,
    name: r.name,
    grams: Number(r.grams),
    kcal: Number(r.kcal),
    protein_g: Number(r.protein_g),
    carbs_g: Number(r.carbs_g),
    fat_g: Number(r.fat_g),
    per100: {
      kcal: Number(r.kcal_100g),
      protein_g: Number(r.protein_100g),
      carbs_g: Number(r.carbs_100g),
      fat_g: Number(r.fat_100g),
    },
    source: r.source,
    confidence: r.confidence,
    created_at: String(r.created_at),
  };
}

function dayFor_(slug, date, logRows) {
  const rows = logRows || readRows_("logs");
  const entries = rows
    .filter((r) => String(r.slug) === slug && String(r.log_date) === date)
    .map(entryFromRow_);
  return { date: date, entries: entries, totals: MacroCore.sumTotals(entries) };
}

/** Last 15 different foods this member logged, newest first — for one-tap re-logging. */
function recentFor_(slug, logRows) {
  const seen = {};
  const recent = [];
  for (let i = logRows.length - 1; i >= 0 && recent.length < 15; i--) {
    const r = logRows[i];
    if (String(r.slug) !== slug) continue;
    const key = String(r.name).toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    const e = entryFromRow_(r);
    recent.push({ name: e.name, grams: e.grams, per100: e.per100, source: e.source });
  }
  return recent;
}

function favouritesFor_(slug) {
  return readRows_("favourites")
    .filter((f) => String(f.slug) === slug)
    .map((f) => ({
      id: String(f.id),
      name: f.name,
      grams: Number(f.grams),
      per100: {
        kcal: Number(f.kcal_100g),
        protein_g: Number(f.protein_100g),
        carbs_g: Number(f.carbs_100g),
        fat_g: Number(f.fat_100g),
      },
      source: f.source,
    }));
}

// Daily AI uses per tier: one pool for photo and label scans, Describe it
// and Ask Fuel messages. Override with GOLD_DAILY_AI / PLATINUM_DAILY_AI.
const DEFAULT_DAILY_AI = { gold: 10, platinum: 25 };

function dailyAiFor_(tier) {
  if (!DEFAULT_DAILY_AI[tier]) return 0; // silver
  const n = Number(prop_(tier === "platinum" ? "PLATINUM_DAILY_AI" : "GOLD_DAILY_AI"));
  return n > 0 ? Math.round(n) : DEFAULT_DAILY_AI[tier];
}

/** Today's AI uses, leaving out calls that failed before Claude billed anything. */
function aiUsedToday_(slug) {
  const today = todaySydney_();
  return readRows_("usage").filter((u) => {
    const ok = String(u.ok);
    return String(u.slug) === slug && String(u.log_date) === today && ok !== "error" && ok.indexOf("http_") !== 0;
  }).length;
}

/** { tier, used, limit, left } for the meter on the card. */
function aiToday_(member) {
  const plan = planFor_(member);
  const limit = plan.access ? dailyAiFor_(plan.tier) : 0;
  const used = aiUsedToday_(String(member.slug));
  return { tier: plan.tier, used: used, limit: limit, left: Math.max(0, limit - used) };
}

/** Photo scanning and Ask Fuel need a Claude API key on the server. */
function aiOn_() {
  return !!prop_("ANTHROPIC_API_KEY");
}

function planFor_(member) {
  return MacroCore.planState(
    {
      trial_started: member.trial_started,
      plan_status: member.plan_status,
      plan_until: member.plan_until,
      comp_until: member.comp_until,
      plan_tier: member.plan_tier,
      comp_tier: member.comp_tier,
    },
    todaySydney_()
  );
}

/** Stops a Fuel AI action (photo/label scan, chat) unless this member has the plan. */
function requireFuelAi_(member) {
  if (!aiOn_()) throw userError_("ai_off", "Fuel AI isn't switched on yet. Barcodes still work.");
  if (!planFor_(member).access) {
    throw userError_("no_plan", "That's part of Fuel Gold. Barcodes, search and saved meals stay free.");
  }
}

/** A Payment Link that tells Stripe which client is paying. */
function upgradeUrl_(slug, property) {
  const link = prop_(property || "STRIPE_FUEL_LINK");
  if (!link) return "";
  return link + (link.indexOf("?") >= 0 ? "&" : "?") + "client_reference_id=fuel-" + slug;
}

function planPayload_(member) {
  const slug = String(member.slug);
  return Object.assign({}, planFor_(member), {
    upgradeUrl: upgradeUrl_(slug, "STRIPE_FUEL_LINK"), // Gold
    platinumUrl: upgradeUrl_(slug, "STRIPE_PLATINUM_LINK"),
    portalUrl: prop_("STRIPE_PORTAL_LINK") || "",
    aiPerDay: { gold: dailyAiFor_("gold"), platinum: dailyAiFor_("platinum") },
  });
}

function actionMe_(payload, member) {
  const slug = String(member.slug);
  // The free week starts the first time they open FUEL while Fuel AI is on.
  if (aiOn_() && !member.trial_started) {
    updateRow_("members", member._row, { trial_started: todaySydney_() });
    member.trial_started = todaySydney_();
  }
  // Back from Stripe checkout, or "Already paid? Refresh": check Stripe now
  // (at most once a minute per member).
  if (payload.sync && prop_("STRIPE_SECRET_KEY")) {
    const cache = CacheService.getScriptCache();
    if (!cache.get("sync_" + slug)) {
      cache.put("sync_" + slug, "1", 60);
      try {
        syncStripe_();
      } catch (err) {
        console.error("Stripe sync failed", err && err.message);
      }
      member = readRows_("members").find((m) => String(m.slug) === slug) || member;
    }
  }
  const logRows = readRows_("logs");
  return {
    member: memberPayload_(member),
    targets: targetsFor_(slug),
    day: dayFor_(slug, validDate_(payload.date), logRows),
    weightTrend: member.hide_weight === "Y" ? null : weightTrend_(slug),
    recent: recentFor_(slug, logRows),
    favourites: favouritesFor_(slug),
    meals: mealsFor_(slug),
    foods: foodsList_(),
    aiToday: aiToday_(member),
    // No API key yet = Fuel AI is off; the card hides photo scans and Ask Fuel.
    aiEnabled: aiOn_(),
    plan: planPayload_(member),
  };
}

function actionGetDay_(payload, member) {
  return { day: dayFor_(String(member.slug), validDate_(payload.date)) };
}

/** Checks and cleans one food item from the phone. Macros are recomputed here from per-100g values and grams — never trusted as sent. */
function cleanItem_(raw) {
  const name = cleanText_(raw && raw.name, 80);
  if (!name) throw userError_("bad_item", "Every item needs a name.");
  const grams = Math.round(n_(raw.grams, 0, 5000) * 10) / 10;
  if (!(grams > 0)) throw userError_("bad_item", '"' + name + '" needs a weight above 0 g.');
  const p = raw.per100 || {};
  const quick = raw.source === "quick";
  const per100 = {
    kcal: n_(p.kcal, 0, quick ? 5000 : 950),
    protein_g: n_(p.protein_g, 0, quick ? 500 : 100),
    carbs_g: n_(p.carbs_g, 0, quick ? 500 : 100),
    fat_g: n_(p.fat_g, 0, quick ? 500 : 100),
  };
  if (quick && !(per100.kcal > 0 || per100.protein_g + per100.carbs_g + per100.fat_g > 0)) {
    throw userError_("bad_item", 'Add the calories or macros for "' + name + '".');
  }
  // 100 g of food can't hold more than 100 g of macros (a little slack for label rounding).
  if (!quick && per100.protein_g + per100.carbs_g + per100.fat_g > 105) {
    throw userError_("bad_item", 'The numbers for "' + name + '" don\'t add up. Check them against the label.');
  }
  const macros = MacroCore.scale(per100, grams);
  return {
    name: name,
    grams: grams,
    per100: per100,
    kcal: macros.kcal,
    protein_g: macros.protein_g,
    carbs_g: macros.carbs_g,
    fat_g: macros.fat_g,
    source: SOURCES.indexOf(raw.source) >= 0 ? raw.source : "manual",
    confidence: CONFIDENCES.indexOf(raw.confidence) >= 0 ? raw.confidence : "",
  };
}

function cleanMeal_(meal) {
  return MacroCore.MEALS.indexOf(meal) >= 0 ? meal : "snack";
}

function actionAddEntries_(payload, member) {
  const slug = String(member.slug);
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw userError_("no_items", "Nothing to add.");
  if (items.length > 20) throw userError_("too_many", "That's a lot of items — add up to 20 at a time.");
  const date = validDate_(payload.log_date);
  const meal = cleanMeal_(payload.meal);
  const cleaned = items.map(cleanItem_);
  withLock_(() => {
    cleaned.forEach((it) => {
      appendRow_("logs", {
        id: Utilities.getUuid(),
        slug: slug,
        log_date: date,
        meal: meal,
        name: it.name,
        grams: it.grams,
        kcal: it.kcal,
        protein_g: it.protein_g,
        carbs_g: it.carbs_g,
        fat_g: it.fat_g,
        kcal_100g: it.per100.kcal,
        protein_100g: it.per100.protein_g,
        carbs_100g: it.per100.carbs_g,
        fat_100g: it.per100.fat_g,
        source: it.source,
        confidence: it.confidence,
        created_at: nowStamp_(),
      });
    });
  });
  const logRows = readRows_("logs");
  return { day: dayFor_(slug, date, logRows), recent: recentFor_(slug, logRows) };
}

function findOwnEntry_(slug, entryId) {
  const row = readRows_("logs").find((r) => String(r.id) === String(entryId) && String(r.slug) === slug);
  if (!row) throw userError_("not_found", "That entry has already been removed.");
  return row;
}

function actionUpdateEntry_(payload, member) {
  const slug = String(member.slug);
  let date;
  withLock_(() => {
    const row = findOwnEntry_(slug, payload.entryId);
    date = String(row.log_date);
    const changes = {};
    if (payload.meal !== undefined) changes.meal = cleanMeal_(payload.meal);
    if (payload.name !== undefined) {
      const name = cleanText_(payload.name, 80);
      if (name) changes.name = name;
    }
    if (payload.grams !== undefined) {
      const grams = Math.round(n_(payload.grams, 0, 5000) * 10) / 10;
      if (!(grams > 0)) throw userError_("bad_item", "Weight needs to be above 0 g.");
      const per100 = {
        kcal: Number(row.kcal_100g),
        protein_g: Number(row.protein_100g),
        carbs_g: Number(row.carbs_100g),
        fat_g: Number(row.fat_100g),
      };
      const m = MacroCore.scale(per100, grams);
      changes.grams = grams;
      changes.kcal = m.kcal;
      changes.protein_g = m.protein_g;
      changes.carbs_g = m.carbs_g;
      changes.fat_g = m.fat_g;
    }
    updateRow_("logs", row._row, changes);
  });
  return { day: dayFor_(slug, date) };
}

function actionDeleteEntry_(payload, member) {
  const slug = String(member.slug);
  let date;
  withLock_(() => {
    const row = findOwnEntry_(slug, payload.entryId);
    date = String(row.log_date);
    tab_("logs").deleteRow(row._row);
  });
  return { day: dayFor_(slug, date) };
}

function actionSaveTargets_(payload, member) {
  const slug = String(member.slug);
  const current = targetsFor_(slug);
  if (current && current.set_by === "coach") {
    throw userError_("coach_set", "Max has set your targets. Have a chat with Max if you'd like them changed.");
  }
  const result = MacroCore.calcTargets(payload.inputs || {});
  if (!result.ok) throw userError_("bad_inputs", result.errors.join(" "));
  const inputs = payload.inputs;
  withLock_(() => {
    const row = {
      slug: slug,
      kcal: result.kcal,
      protein_g: result.protein_g,
      carbs_g: result.carbs_g,
      fat_g: result.fat_g,
      set_by: "calculator",
      calc_inputs: JSON.stringify({
        sex: inputs.sex,
        age: Number(inputs.age),
        heightCm: Number(inputs.heightCm),
        weightKg: Number(inputs.weightKg),
        activity: inputs.activity,
        goal: inputs.goal,
        adjustPct: inputs.adjustPct == null ? null : Number(inputs.adjustPct),
      }),
      coach_approved: "",
      updated_at: nowStamp_(),
      // Pace for the Progress weight chart (negative = losing), and an
      // optional goal weight the pace line stops at.
      weekly_rate_kg: result.weeklyChangeKg,
      goal_weight_kg: cleanGoalKg_(inputs.goalWeightKg),
    };
    const existing = readRows_("targets").find((t) => String(t.slug) === slug);
    if (existing) updateRow_("targets", existing._row, row);
    else appendRow_("targets", row);
    recordTargetHistory_(slug, row, "calculator");
    if (member.sex !== inputs.sex) updateRow_("members", member._row, { sex: inputs.sex });
  });
  return { targets: targetsFor_(slug), calc: result };
}

function actionAddFavourite_(payload, member) {
  const slug = String(member.slug);
  const it = cleanItem_(payload.item || {});
  withLock_(() => {
    const dup = readRows_("favourites").find(
      (f) => String(f.slug) === slug && String(f.name).toLowerCase() === it.name.toLowerCase()
    );
    const row = {
      slug: slug,
      name: it.name,
      grams: it.grams,
      kcal_100g: it.per100.kcal,
      protein_100g: it.per100.protein_g,
      carbs_100g: it.per100.carbs_g,
      fat_100g: it.per100.fat_g,
      source: it.source,
    };
    if (dup) updateRow_("favourites", dup._row, row);
    else appendRow_("favourites", Object.assign({ id: Utilities.getUuid(), created_at: nowStamp_() }, row));
  });
  return { favourites: favouritesFor_(slug) };
}

function actionRemoveFavourite_(payload, member) {
  const slug = String(member.slug);
  withLock_(() => {
    const row = readRows_("favourites").find((f) => String(f.slug) === slug && String(f.id) === String(payload.favouriteId));
    if (row) tab_("favourites").deleteRow(row._row);
  });
  return { favourites: favouritesFor_(slug) };
}

// ---------------------------------------------------------------------------
// Saved meals: a named set of items ("Protein smoothie") logged in one go
// ---------------------------------------------------------------------------

const MAX_SAVED_MEALS = 30;

function mealsFor_(slug) {
  return readRows_("meals")
    .filter((r) => String(r.slug) === slug)
    .map((r) => {
      let items = [];
      try {
        items = JSON.parse(String(r.items || "[]"));
      } catch (err) {
        items = [];
      }
      return { id: String(r.id), name: String(r.name), items: Array.isArray(items) ? items : [] };
    })
    .filter((m) => m.items.length);
}

function actionSaveMeal_(payload, member) {
  const slug = String(member.slug);
  const name = cleanText_(payload.name, 60);
  if (!name) throw userError_("bad_meal", "Give the meal a name.");
  const raw = Array.isArray(payload.items) ? payload.items : [];
  if (!raw.length) throw userError_("bad_meal", "Add at least one food first.");
  if (raw.length > 20) throw userError_("bad_meal", "A saved meal can hold up to 20 foods.");
  const items = raw.map(cleanItem_).map((it) => ({ name: it.name, grams: it.grams, per100: it.per100, source: it.source }));
  withLock_(() => {
    const mine = readRows_("meals").filter((r) => String(r.slug) === slug);
    const dup = mine.find((r) => String(r.name).toLowerCase() === name.toLowerCase());
    const row = { slug: slug, name: name, items: JSON.stringify(items) };
    if (dup) updateRow_("meals", dup._row, row);
    else if (mine.length >= MAX_SAVED_MEALS) throw userError_("too_many", "That's " + MAX_SAVED_MEALS + " saved meals. Delete one first.");
    else appendRow_("meals", Object.assign({ id: Utilities.getUuid(), created_at: nowStamp_() }, row));
  });
  return { meals: mealsFor_(slug) };
}

function actionDeleteMeal_(payload, member) {
  const slug = String(member.slug);
  withLock_(() => {
    const row = readRows_("meals").find((r) => String(r.slug) === slug && String(r.id) === String(payload.mealId));
    if (row) tab_("meals").deleteRow(row._row);
  });
  return { meals: mealsFor_(slug) };
}

function actionSetPrefs_(payload, member) {
  const changes = {};
  if (payload.hide_kcal !== undefined) changes.hide_kcal = payload.hide_kcal ? "Y" : "N";
  if (payload.hide_weight !== undefined) changes.hide_weight = payload.hide_weight ? "Y" : "N";
  if (Object.keys(changes).length) updateRow_("members", member._row, changes);
  Object.assign(member, changes);
  return { member: memberPayload_(member) };
}

function memberPayload_(member) {
  return {
    slug: String(member.slug),
    name: member.name,
    sex: member.sex,
    hide_kcal: member.hide_kcal === "Y",
    hide_weight: member.hide_weight === "Y",
  };
}

// ---------------------------------------------------------------------------
// Barcodes (Open Food Facts, cached in the Barcode Cache tab)
// ---------------------------------------------------------------------------

const BARCODE_CACHE_DAYS = 30;
const BARCODE_MISS_CACHE_DAYS = 3; // retry "not found" sooner — OFF gets new products daily

function productFromCacheRow_(row) {
  if (row.found !== "Y") return { found: false, barcode: String(row.barcode) };
  return {
    found: true,
    barcode: String(row.barcode),
    name: row.name,
    brand: row.brand,
    per100: {
      kcal: Number(row.kcal_100g),
      protein_g: Number(row.protein_100g),
      carbs_g: Number(row.carbs_100g),
      fat_g: Number(row.fat_100g),
    },
    serving_size: row.serving_size,
    serving_g: Number(row.serving_g) || null,
    unit: row.unit || "g",
    quality: row.quality || "ok",
  };
}

function actionBarcode_(payload) {
  const code = String(payload.code || "").replace(/\D/g, "");
  if (!/^\d{6,14}$/.test(code)) throw userError_("bad_barcode", "That doesn't look like a barcode number.");

  const cached = readRows_("barcodes").find((b) => String(b.barcode) === code);
  if (cached) {
    const ageDays = (Date.now() - new Date(String(cached.fetched_at).replace(" ", "T")).getTime()) / 86400000;
    const maxAge = cached.found === "Y" ? BARCODE_CACHE_DAYS : BARCODE_MISS_CACHE_DAYS;
    if (ageDays < maxAge) return { product: productFromCacheRow_(cached), cached: true };
  }

  const url =
    "https://world.openfoodfacts.org/api/v2/product/" + code + ".json" +
    "?fields=product_name,product_name_en,generic_name,generic_name_en,brands,nutriments,serving_size,serving_quantity,quantity";
  const res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { "User-Agent": "MaxFit/1.0 (maxfit.now; personal-training macro tracker)" },
  });
  const status = res.getResponseCode();
  let body = null;
  try {
    body = JSON.parse(res.getContentText());
  } catch (err) {
    body = null;
  }
  // 404 with a JSON body is OFF's normal "no such product"; anything else
  // (rate limit, outage) is a temporary failure we shouldn't cache.
  if (!body || (status !== 200 && status !== 404)) {
    throw userError_("lookup_failed", "Couldn't reach the food database. Try again, or snap the label.");
  }
  const product = MacroCore.normaliseOffProduct(body, code);

  withLock_(() => {
    const row = {
      barcode: code,
      found: product.found ? "Y" : "N",
      name: product.name || "",
      brand: product.brand || "",
      kcal_100g: product.found ? product.per100.kcal : "",
      protein_100g: product.found ? product.per100.protein_g : "",
      carbs_100g: product.found ? product.per100.carbs_g : "",
      fat_100g: product.found ? product.per100.fat_g : "",
      serving_size: product.serving_size || "",
      serving_g: product.serving_g || "",
      unit: product.unit || "",
      quality: product.quality || "",
      fetched_at: nowStamp_(),
    };
    const again = readRows_("barcodes").find((b) => String(b.barcode) === code);
    if (again) updateRow_("barcodes", again._row, row);
    else appendRow_("barcodes", row);
  });
  return { product: product, cached: false };
}

// ---------------------------------------------------------------------------
// AI photo analysis (Claude)
// ---------------------------------------------------------------------------

// Kept byte-for-byte stable so the prompt cache hits: nothing per-request
// (dates, names, limits) may go in here. It also needs to stay over ~1,024
// tokens, the minimum Sonnet will cache.
const FOOD_SYSTEM_PROMPT = [
  "You are the nutrition estimator inside MaxFit, an Australian personal trainer's client app.",
  "Clients photograph meals, packaged food labels, or their fridge, and you return structured estimates they will log against daily protein, carbohydrate, fat and calorie targets.",
  "",
  "General rules",
  "- Assume Australian foods, brands, cafe and takeaway portions, and metric units. Clients are mostly adults in Sydney.",
  "- Base values on standard references: the Australian Food Composition Database (FSANZ AUSNUT / AFCD) for whole foods, and manufacturer panels for branded products you can identify.",
  "- Report every value for the portion you can SEE, not per 100 g, unless the schema asks for per-100 g values.",
  "- Calories must be consistent with the macros: kcal ≈ 4 × protein + 4 × carbs + 9 × fat (alcohol adds 7 kcal per gram; mention it in notes).",
  "- Round grams to the nearest 5 g and macros to one decimal place.",
  "- Be honest about uncertainty. If you cannot tell what something is, or how much of it there is, say so with confidence \"low\" and a short note, rather than inventing detail. Never guess a brand you cannot read.",
  "- Keep names short and plain (\"Grilled chicken breast\", \"White rice, cooked\", \"Avocado\"). No marketing words.",
  "",
  "Meal photos",
  "- List each distinct food as its own item, with estimated_grams for the amount on the plate or in the container.",
  "- Hidden fats matter: list cooking oil, butter, dressings, mayonnaise, aioli and sauces as SEPARATE items whenever they are visible or very likely (e.g. a stir-fry, fried rice, a cafe salad, fries, a burger). Typical amounts: 1 tsp oil ≈ 5 g, 1 tbsp ≈ 14 g; a cafe salad dressing ≈ 20–30 g; aioli on a burger ≈ 15–20 g.",
  "- Estimate cooked weights for cooked foods (cooked rice ≈ 130 kcal/100 g, cooked pasta ≈ 155 kcal/100 g).",
  "- Use visual anchors to size portions: a standard dinner plate is ~26 cm, a fork ~19 cm, a can 375 ml, a palm-sized piece of meat ~100–120 g cooked.",
  "- Typical Australian portions to anchor on: a cafe smashed avo on sourdough ≈ 1 thick slice sourdough (60 g) + 80 g avocado + 2 poached eggs (100 g); a Guzman y Gomez burrito bowl ≈ 450–550 g; a Subway 6-inch sub ≈ 230–260 g; a meat pie ≈ 175 g; a sausage roll ≈ 150 g; a large flat white ≈ 350 ml full-cream milk unless skim/oat is visible; a Chobani pouch 140 g; 2 Weet-Bix ≈ 33 g dry.",
  "- If the photo is not food (a person, a room, a screenshot), return an empty items array and explain in meal_guess.",
  "- meal_guess is a short, friendly name for the whole meal (\"Chicken burrito bowl\").",
  "",
  "Confidence",
  "- \"high\": the food and amount are clear (a packaged item with a visible size, a single piece of fruit).",
  "- \"medium\": the food is clear but the amount is an estimate — the usual case for plated meals.",
  "- \"low\": the food is unclear, mostly hidden, mixed into something else, or the amount could easily be off by half or more. Say why in notes.",
  "",
  "Written descriptions",
  "- Sometimes the client types what they ate instead of sending a photo (\"chicken wrap from Subway and a flat white\"). Return the same items format as for a meal photo.",
  "- Trust any amounts they give. Where they don't give one, use a typical Australian portion for that food or venue and set confidence to \"medium\" (or \"low\" if it could easily be off by half).",
  "- Add cooking oil, spreads, dressings or milk in coffee as separate items only when they're mentioned or almost certainly there, and say so in notes.",
  "",
  "Nutrition labels",
  "- Australian labels have a Nutrition Information Panel with 'Avg Quantity per Serving' and 'per 100 g' (or 'per 100 mL') columns.",
  "- Always return the per-100 g (or per-100 mL) column as per100. If only the per-serve column is readable, divide by the serving size to get per-100 values and say so in notes.",
  "- Energy is usually printed in kJ. Convert with kcal = kJ ÷ 4.184. If both kJ and Cal are printed, use the Cal figure.",
  "- 'Carbohydrate' means total carbohydrate (not just sugars). 'Fat, total' is the fat value. Ignore saturated fat, sugars and sodium sub-rows.",
  "- serving_g is the serving size printed on the panel in g or mL; use 0 if it isn't shown.",
  "- If the panel is cut off, blurry or unreadable, set confidence to \"low\" and explain which numbers you couldn't read.",
  "",
  "Tone",
  "- Notes are short, neutral and practical (\"Assumed 1 tbsp olive oil for cooking\"). Never comment on whether the food is good or bad, and never moralise about eating.",
].join("\n");

const MEAL_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          estimated_grams: { type: "number" },
          kcal: { type: "number" },
          protein_g: { type: "number" },
          carbs_g: { type: "number" },
          fat_g: { type: "number" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          notes: { type: "string" },
        },
        required: ["name", "estimated_grams", "kcal", "protein_g", "carbs_g", "fat_g", "confidence", "notes"],
        additionalProperties: false,
      },
    },
    meal_guess: { type: "string" },
  },
  required: ["items", "meal_guess"],
  additionalProperties: false,
};

const LABEL_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    brand: { type: "string" },
    per100: {
      type: "object",
      properties: {
        kcal: { type: "number" },
        protein_g: { type: "number" },
        carbs_g: { type: "number" },
        fat_g: { type: "number" },
      },
      required: ["kcal", "protein_g", "carbs_g", "fat_g"],
      additionalProperties: false,
    },
    per100_unit: { type: "string", enum: ["g", "ml"] },
    serving_g: { type: "number" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    notes: { type: "string" },
  },
  required: ["name", "brand", "per100", "per100_unit", "serving_g", "confidence", "notes"],
  additionalProperties: false,
};

const MODE_PROMPTS = {
  meal: "Estimate every food in this meal photo. List hidden oils and sauces as separate items.",
  label: "Read this Australian Nutrition Information Panel. Return the per-100 g (or per-100 mL) values, the serving size, and the product name if it's visible.",
};

/**
 * Reserves one of today's AI calls under a lock, so two quick taps can't
 * both slip past the daily limit. kind is "meal" / "label" (photo scans)
 * or "chat". Returns the AI Usage row number, filled in by recordUsage_.
 */
function reserveAi_(member, kind, model) {
  const slug = String(member.slug);
  return withLock_(() => {
    const today = aiToday_(member);
    if (today.left <= 0) {
      const more = today.tier === "platinum" ? "" : " Platinum gives you " + dailyAiFor_("platinum") + " a day.";
      throw userError_(
        "limit",
        "That's all " + today.limit + " AI uses for today. They reset at midnight, and barcodes, search and saved meals still work." + more
      );
    }
    return appendRow_("usage", {
      timestamp: nowStamp_(),
      log_date: todaySydney_(),
      slug: slug,
      kind: kind,
      model: model,
      ok: "pending",
    });
  });
}

function recordUsage_(rowNumber, usage, ok, model) {
  const u = usage || {};
  const price = PRICING[model || VISION_MODEL] || PRICING[VISION_MODEL];
  const input = Number(u.input_tokens) || 0;
  const output = Number(u.output_tokens) || 0;
  const cacheWrite = Number(u.cache_creation_input_tokens) || 0;
  const cacheRead = Number(u.cache_read_input_tokens) || 0;
  const cost =
    (input * price.input + output * price.output + cacheWrite * price.input * 1.25 + cacheRead * price.input * 0.1) /
    1e6;
  updateRow_("usage", rowNumber, {
    input_tokens: input,
    output_tokens: output,
    cache_write: cacheWrite,
    cache_read: cacheRead,
    est_cost_usd: Math.round(cost * 100000) / 100000,
    ok: ok,
  });
}

/** The meal prompt, plus the client's own note about what's in the photo (if any). */
function mealPrompt_(note) {
  const clean = cleanText_(note, 300);
  if (!clean) return MODE_PROMPTS.meal;
  return (
    MODE_PROMPTS.meal +
    '\n\nThe person who ate this added a note describing it: "' +
    clean.replace(/"/g, "'") +
    '"\nTrust the note for what the foods are and any amounts it gives. Use the photo for everything else, and still list anything visible that the note leaves out.'
  );
}

function callClaude_(image, mode, note) {
  const apiKey = prop_("ANTHROPIC_API_KEY");
  if (!apiKey) throw userError_("ai_off", "Photo scanning isn't switched on yet. Barcodes still work.");
  const body = {
    model: VISION_MODEL,
    max_tokens: 4000,
    system: [{ type: "text", text: FOOD_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: mode === "label" ? LABEL_SCHEMA : MEAL_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
          { type: "text", text: mode === "meal" ? mealPrompt_(note) : MODE_PROMPTS[mode] },
        ],
      },
    ],
  };
  const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "post",
    contentType: "application/json",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  let data = null;
  try {
    data = JSON.parse(res.getContentText());
  } catch (err) {
    data = null;
  }
  return { status: res.getResponseCode(), data: data };
}

function actionAnalyseImage_(payload, member) {
  const slug = String(member.slug);
  const mode = payload.mode === "label" ? "label" : "meal";
  const image = String(payload.image || "").replace(/^data:image\/\w+;base64,/, "");
  if (!image) throw userError_("no_image", "No photo came through. Try again.");
  // A 1024px JPEG at 0.8 is ~100–300 KB; 2 MB of base64 means resizing was skipped.
  if (image.length > 2000000) throw userError_("too_big", "That photo is too large. Try again.");
  requireFuelAi_(member);

  const usageRow = reserveAi_(member, mode, VISION_MODEL);
  const fail = (usage, ok, message) => {
    recordUsage_(usageRow, usage, ok);
    return userError_("ai_failed", message);
  };
  let result;
  try {
    result = callClaude_(image, mode, payload.note);
  } catch (err) {
    throw fail(null, "error", "Couldn't read that photo just now. Try again in a moment.");
  }
  const data = result.data || {};
  if (result.status !== 200) {
    console.error("Claude error", result.status, JSON.stringify(data).slice(0, 500));
    throw fail(data.usage, "http_" + result.status, "Couldn't read that photo just now. Try again in a moment.");
  }
  if (data.stop_reason === "refusal" || data.stop_reason === "max_tokens") {
    throw fail(data.usage, data.stop_reason, "Couldn't make sense of that photo. Try a clearer shot from above.");
  }
  const textBlock = (data.content || []).find((b) => b.type === "text");
  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (err) {
    throw fail(data.usage, "bad_json", "Couldn't make sense of that photo. Try again.");
  }
  recordUsage_(usageRow, data.usage, "Y");

  const counts = { aiToday: aiToday_(member) };
  if (mode === "label") return Object.assign({ mode: mode, label: cleanLabel_(parsed), ai: parsed }, counts);
  return Object.assign({ mode: mode, meal: cleanAiMeal_(parsed), ai: parsed }, counts);
}

/** "Describe it": the client types what they ate and Claude (the cheaper text model) estimates it. */
function actionDescribe_(payload, member) {
  const text = cleanText_(payload.text, 300);
  if (!text) throw userError_("no_text", "Type what you ate first.");
  requireFuelAi_(member);
  const usageRow = reserveAi_(member, "describe", TEXT_MODEL);
  const failMessage = "Couldn't work that out just now. Try again in a moment, or search for it instead.";
  let res;
  try {
    res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "post",
      contentType: "application/json",
      headers: { "x-api-key": prop_("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" },
      payload: JSON.stringify({
        model: TEXT_MODEL,
        max_tokens: 2000,
        system: [{ type: "text", text: FOOD_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        output_config: { format: { type: "json_schema", schema: MEAL_SCHEMA } },
        messages: [
          {
            role: "user",
            content:
              'Estimate every food in this written description of what someone ate (no photo): "' +
              text.replace(/"/g, "'") +
              '"',
          },
        ],
      }),
      muteHttpExceptions: true,
    });
  } catch (err) {
    recordUsage_(usageRow, null, "error", TEXT_MODEL);
    throw userError_("ai_failed", failMessage);
  }
  let data = {};
  try {
    data = JSON.parse(res.getContentText());
  } catch (err) {
    data = {};
  }
  if (res.getResponseCode() !== 200 || data.stop_reason === "refusal" || data.stop_reason === "max_tokens") {
    recordUsage_(usageRow, data.usage, res.getResponseCode() !== 200 ? "http_" + res.getResponseCode() : data.stop_reason, TEXT_MODEL);
    console.error("Describe error", res.getResponseCode(), JSON.stringify(data).slice(0, 500));
    throw userError_("ai_failed", failMessage);
  }
  let parsed;
  try {
    parsed = JSON.parse((data.content || []).find((b) => b.type === "text").text);
  } catch (err) {
    recordUsage_(usageRow, data.usage, "bad_json", TEXT_MODEL);
    throw userError_("ai_failed", failMessage);
  }
  recordUsage_(usageRow, data.usage, "Y", TEXT_MODEL);
  const meal = cleanAiMeal_(parsed);
  meal.items.forEach((it) => (it.source = "describe"));
  return { meal: meal, aiToday: aiToday_(member) };
}

/** AI meal → items the confirm sheet can edit: grams, per-100g values, and kcal that agree with 4/4/9. */
function cleanAiMeal_(parsed) {
  const items = (parsed.items || [])
    .map((it) => {
      const grams = Math.round(n_(it.estimated_grams, 0, 3000));
      if (!(grams > 0)) return null;
      const fixed = {
        protein_g: n_(it.protein_g, 0, 1000),
        carbs_g: n_(it.carbs_g, 0, 1000),
        fat_g: n_(it.fat_g, 0, 1000),
      };
      fixed.kcal = MacroCore.reconcileKcal({ kcal: n_(it.kcal, 0, 10000), protein_g: fixed.protein_g, carbs_g: fixed.carbs_g, fat_g: fixed.fat_g });
      const per100 = MacroCore.per100From(fixed, grams);
      const scaled = MacroCore.scale(per100, grams);
      return {
        name: cleanText_(it.name, 80) || "Food",
        grams: grams,
        per100: per100,
        kcal: scaled.kcal,
        protein_g: scaled.protein_g,
        carbs_g: scaled.carbs_g,
        fat_g: scaled.fat_g,
        confidence: CONFIDENCES.indexOf(it.confidence) >= 0 ? it.confidence : "low",
        notes: cleanText_(it.notes, 200),
        source: "photo",
      };
    })
    .filter(Boolean);
  return { items: items, meal_guess: cleanText_(parsed.meal_guess, 80) };
}

function cleanLabel_(parsed) {
  const p = parsed.per100 || {};
  const per100 = {
    kcal: n_(p.kcal, 0, 950),
    protein_g: n_(p.protein_g, 0, 100),
    carbs_g: n_(p.carbs_g, 0, 100),
    fat_g: n_(p.fat_g, 0, 100),
  };
  const servingG = n_(parsed.serving_g, 0, 3000);
  const name = [cleanText_(parsed.brand, 40), cleanText_(parsed.name, 60)].filter(Boolean).join(" ") || "Packaged food";
  return {
    name: name,
    per100: per100,
    serving_g: servingG > 0 ? servingG : null,
    unit: parsed.per100_unit === "ml" ? "ml" : "g",
    confidence: CONFIDENCES.indexOf(parsed.confidence) >= 0 ? parsed.confidence : "low",
    notes: cleanText_(parsed.notes, 200),
  };
}

// ---------------------------------------------------------------------------
// Coach actions (STAFF_PIN)
// ---------------------------------------------------------------------------

/** Client names from the CRM's Sessions Remaining tab, so Max sees everyone — not just clients who already have a key. */
function crmClients_() {
  const id = prop_("MAIN_SHEET_ID");
  if (!id) return [];
  const sheet = SpreadsheetApp.openById(id).getSheets().find((s) => s.getSheetId() === MAIN_SESSIONS_GID);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  const nameCol = values[0].findIndex((h) => String(h).trim().toLowerCase() === "name");
  if (nameCol < 0) return [];
  return values
    .slice(1)
    .map((r) => String(r[nameCol] || "").trim())
    .filter(Boolean)
    .map((name) => ({ slug: slugify_(name), name: name }));
}

function actionCoachList_() {
  const members = readRows_("members");
  const targets = readRows_("targets");
  const logs = readRows_("logs");
  const lastLog = {};
  logs.forEach((r) => {
    const s = String(r.slug);
    const d = String(r.log_date);
    if (!lastLog[s] || d > lastLog[s]) lastLog[s] = d;
  });

  const bySlug = {};
  crmClients_().forEach((c) => {
    bySlug[c.slug] = { slug: c.slug, name: c.name };
  });
  members.forEach((m) => {
    const s = String(m.slug);
    bySlug[s] = Object.assign(bySlug[s] || { slug: s, name: m.name }, {
      hasKey: !!m.key,
      sex: m.sex,
      link: m.key ? CARD_URL + "?id=" + encodeURIComponent(s) + "&k=" + encodeURIComponent(m.key) : "",
      plan: planFor_(m),
    });
  });
  targets.forEach((t) => {
    const s = String(t.slug);
    if (!bySlug[s]) return;
    bySlug[s].targets = {
      kcal: Number(t.kcal),
      protein_g: Number(t.protein_g),
      carbs_g: Number(t.carbs_g),
      fat_g: Number(t.fat_g),
      set_by: t.set_by,
      coach_approved: t.coach_approved === "Y",
      goal_weight_kg: Number(t.goal_weight_kg) || null,
      weekly_rate_kg: Number(t.weekly_rate_kg) || null,
    };
  });
  const weightRows = readRows_("weights");
  const crm = crmIndex_();
  const history = readRows_("targetHistory");
  const thisMonday = MacroCore.mondayOf(todaySydney_());
  Object.keys(bySlug).forEach((s) => {
    const mine = weightRows.filter((w) => String(w.slug) === s).sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1));
    const last = mine[mine.length - 1];
    bySlug[s].lastWeight = last ? { date: String(last.date), kg: Number(last.kg) } : null;
    const c = crm.bySlug[s];
    bySlug[s].punches = c ? c.punches : 0;
    bySlug[s].freeOwed = c ? c.owed : false;
    if (bySlug[s].hasKey) {
      const week = MacroCore.weekSummary(dayTotalsFor_(s, thisMonday, logs), historyFor_(s, history), thisMonday);
      bySlug[s].greenThisWeek = week.greenDays;
    }
  });
  const clients = Object.keys(bySlug)
    .map((s) => Object.assign({ lastLog: lastLog[s] || "" }, bySlug[s]))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return {
    clients: clients,
    aiEnabled: aiOn_(),
    stripeReady: !!(prop_("STRIPE_SECRET_KEY") && prop_("STRIPE_FUEL_LINK")),
    lastStripeSync: prop_("STRIPE_LAST_SYNC_AT") || "",
  };
}

function actionIssueKey_(payload) {
  const slug = slugify_(payload.slug);
  if (!slug) throw userError_("bad_slug", "Pick a client.");
  const sex = payload.sex === "F" ? "F" : payload.sex === "M" ? "M" : "";
  let link;
  withLock_(() => {
    const existing = readRows_("members").find((m) => String(m.slug) === slug);
    let key = existing && existing.key ? String(existing.key) : "";
    if (!key || payload.rotate) key = Utilities.getUuid().replace(/-/g, "").slice(0, 16);
    if (existing) {
      const changes = { key: key };
      if (sex) changes.sex = sex;
      if (payload.name) changes.name = cleanText_(payload.name, 80);
      updateRow_("members", existing._row, changes);
    } else {
      appendRow_("members", {
        slug: slug,
        name: cleanText_(payload.name, 80) || slug,
        sex: sex,
        key: key,
        hide_kcal: "N",
        created_at: nowStamp_(),
      });
    }
    link = CARD_URL + "?id=" + encodeURIComponent(slug) + "&k=" + encodeURIComponent(key);
  });
  const member = readRows_("members").find((m) => String(m.slug) === slug);
  return { slug: slug, link: link, plan: planFor_(member) };
}

function actionCoachSetTargets_(payload) {
  const slug = slugify_(payload.slug);
  const member = readRows_("members").find((m) => String(m.slug) === slug);
  if (!member) throw userError_("no_member", "Issue this client a link first.");
  if (payload.clear) {
    withLock_(() => {
      const row = readRows_("targets").find((t) => String(t.slug) === slug);
      if (row) tab_("targets").deleteRow(row._row);
      recordTargetHistory_(slug, { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }, "cleared");
    });
    return { targets: null };
  }
  const sex = payload.sex === "F" || payload.sex === "M" ? payload.sex : member.sex;
  const check = MacroCore.checkCoachTargets(payload.protein_g, payload.carbs_g, payload.fat_g, sex);
  if (!(check.kcal > 0)) throw userError_("bad_targets", "Enter protein, carbs and fat in grams.");
  if (check.belowFloor && !payload.approveBelowFloor) {
    throw userError_(
      "below_floor",
      "That's " + check.kcal + " kcal, under the " + check.floor + " kcal floor. Tick 'I approve' to save it anyway."
    );
  }
  withLock_(() => {
    const row = {
      slug: slug,
      kcal: check.kcal,
      protein_g: check.protein_g,
      carbs_g: check.carbs_g,
      fat_g: check.fat_g,
      set_by: "coach",
      calc_inputs: "",
      coach_approved: check.belowFloor ? "Y" : "",
      updated_at: nowStamp_(),
    };
    const existing = readRows_("targets").find((t) => String(t.slug) === slug);
    if (existing) updateRow_("targets", existing._row, row);
    else appendRow_("targets", row);
    recordTargetHistory_(slug, row, "coach");
    if (sex && sex !== member.sex) updateRow_("members", member._row, { sex: sex });
  });
  return { targets: targetsFor_(slug) };
}

function actionCoachGiveMonth_(payload) {
  const slug = slugify_(payload.slug);
  let plan;
  withLock_(() => {
    const member = readRows_("members").find((m) => String(m.slug) === slug);
    if (!member) throw userError_("no_member", "Create this client's Fuel link first.");
    const today = todaySydney_();
    const current = /^\d{4}-\d{2}-\d{2}$/.test(String(member.comp_until)) ? String(member.comp_until) : "";
    // Stack onto an existing free month rather than overlapping it.
    const from = current && current >= today ? MacroCore.addDays(current, 1) : today;
    const until = MacroCore.addDays(from, 29);
    const tier = payload.tier === "platinum" ? "platinum" : "gold";
    updateRow_("members", member._row, { comp_until: until, comp_tier: tier });
    member.comp_until = until;
    member.comp_tier = tier;
    plan = planFor_(member);
  });
  return { slug: slug, plan: plan };
}

function actionCoachSyncStripe_() {
  if (!prop_("STRIPE_SECRET_KEY")) throw userError_("no_stripe", "Add STRIPE_SECRET_KEY in Script Properties first.");
  return { sync: syncStripe_() };
}

// ---------------------------------------------------------------------------
// Stripe (read-only; see the notes at the top of this file)
// ---------------------------------------------------------------------------

function stripeGet_(path, params) {
  const key = prop_("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
  const qs = Object.keys(params || {})
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(params[k]))
    .join("&");
  const res = UrlFetchApp.fetch("https://api.stripe.com/v1/" + path + (qs ? "?" + qs : ""), {
    headers: { Authorization: "Bearer " + key },
    muteHttpExceptions: true,
  });
  let body = null;
  try {
    body = JSON.parse(res.getContentText());
  } catch (err) {
    body = null;
  }
  if (res.getResponseCode() !== 200 || !body) {
    const msg = body && body.error && body.error.message ? body.error.message : "HTTP " + res.getResponseCode();
    throw new Error("Stripe " + path + ": " + msg);
  }
  return body;
}

/** Every page of a Stripe list endpoint (capped, to stay well inside Apps Script's time limit). */
function stripeList_(path, params, maxPages) {
  const out = [];
  let after = null;
  for (let page = 0; page < (maxPages || 5); page++) {
    const p = Object.assign({ limit: 100 }, params || {});
    if (after) p.starting_after = after;
    const res = stripeGet_(path, p);
    (res.data || []).forEach((x) => out.push(x));
    if (!res.has_more || !res.data.length) break;
    after = res.data[res.data.length - 1].id;
  }
  return out;
}

/** "fuel-jordansmith" → the Members row for jordansmith, or null. */
function memberForSession_(session, members) {
  const m = /^fuel-([a-z0-9]+)$/.exec(String(session.client_reference_id || ""));
  if (!m || session.status !== "complete" || !session.subscription) return null;
  return members.find((x) => String(x.slug) === m[1]) || null;
}

function linkSubscription_(member, session) {
  const sub = String(session.subscription);
  if (String(member.stripe_subscription) === sub) return false;
  updateRow_("members", member._row, { stripe_subscription: sub, stripe_customer: String(session.customer || "") });
  member.stripe_subscription = sub;
  return true;
}

/** Copies a Stripe subscription's status and renewal date onto the member. */
function applySubscription_(member, sub) {
  // Newer Stripe API versions keep the period end on the subscription item.
  const item = sub.items && sub.items.data && sub.items.data[0];
  const end = sub.current_period_end || (item && item.current_period_end);
  const until = end ? Utilities.formatDate(new Date(end * 1000), TIMEZONE, "yyyy-MM-dd") : "";
  // The Platinum price has the lookup key "fuel_platinum"; anything else is Gold.
  const lookup = String((item && item.price && item.price.lookup_key) || "");
  const tier = lookup.indexOf("platinum") >= 0 ? "platinum" : "gold";
  if (String(member.plan_status) === sub.status && String(member.plan_until) === until && String(member.plan_tier) === tier) {
    return false;
  }
  updateRow_("members", member._row, { plan_status: sub.status, plan_until: until, plan_tier: tier });
  member.plan_status = sub.status;
  member.plan_until = until;
  member.plan_tier = tier;
  return true;
}

/**
 * Links new Fuel AI checkouts to their clients, then refreshes every
 * linked client's subscription status. Two to a few Stripe calls — fine
 * for ~30 clients. Returns { linked, updated }.
 */
function syncStripe_() {
  return withLock_(() => {
    const props = PropertiesService.getScriptProperties();
    const since = Number(props.getProperty("STRIPE_SYNCED_TO")) || 0;
    const startedAt = Math.floor(Date.now() / 1000);
    const members = readRows_("members");
    let linked = 0;
    let updated = 0;

    // An hour of overlap, so a checkout finishing mid-sync is never missed.
    const sessions = stripeList_("checkout/sessions", { status: "complete", "created[gte]": Math.max(0, since - 3600) });
    sessions.forEach((session) => {
      const member = memberForSession_(session, members);
      if (member && linkSubscription_(member, session)) linked++;
    });

    if (members.some((m) => m.stripe_subscription)) {
      const subs = {};
      stripeList_("subscriptions", { status: "all" }).forEach((sub) => (subs[sub.id] = sub));
      members.forEach((member) => {
        const sub = subs[String(member.stripe_subscription)];
        if (sub && applySubscription_(member, sub)) updated++;
      });
    }
    props.setProperty("STRIPE_SYNCED_TO", String(startedAt));
    props.setProperty("STRIPE_LAST_SYNC_AT", nowStamp_());
    return { linked: linked, updated: updated };
  });
}

/** Run by the 15-minute trigger (and safe to run by hand from the editor). */
function syncStripe() {
  if (!prop_("STRIPE_SECRET_KEY")) return "Add STRIPE_SECRET_KEY first.";
  return JSON.stringify(syncStripe_());
}

/** Run ONCE from the editor: checks Stripe every 15 minutes from now on. */
function installStripeSync() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "syncStripe")
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("syncStripe").timeBased().everyMinutes(15).create();
  return "Stripe sync will run every 15 minutes.";
}

/**
 * The Payment Link redirects to maxfit.now/card/?paid={CHECKOUT_SESSION_ID}.
 * The card sends that id here; we fetch the session from Stripe (so it
 * can't be faked) and switch the client's Fuel AI on straight away.
 */
function actionStripeReturn_(payload) {
  const id = String(payload.session_id || "");
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) throw userError_("bad_session", "That payment link didn't come back properly.");
  if (!prop_("STRIPE_SECRET_KEY")) return { linked: false };
  let session;
  try {
    session = stripeGet_("checkout/sessions/" + id, {});
  } catch (err) {
    return { linked: false }; // not a real session (or Stripe hiccup): the 15-minute sync is the backstop
  }
  let linked = false;
  withLock_(() => {
    const member = memberForSession_(session, readRows_("members"));
    if (!member) return;
    linkSubscription_(member, session);
    applySubscription_(member, stripeGet_("subscriptions/" + session.subscription, {}));
    linked = planFor_(member).access;
  });
  return { linked: linked };
}

// ---------------------------------------------------------------------------
// Foods: the curated list behind "what to eat next"
// ---------------------------------------------------------------------------

// About 80 Australian staples, per 100 g (or 100 ml). Whole foods follow
// AUSNUT/FSANZ-style reference values; takeaway items are approximate
// published figures. Seeded into the Foods tab once — Max edits them there.
// [name, category, serve_g, serve_label, kcal, protein, carbs, fat]
const FOOD_SEED = [
  ["Chicken breast, grilled", "protein", 150, "", 165, 31, 0, 3.6],
  ["Chicken thigh, grilled (skin off)", "protein", 150, "", 190, 26, 0, 9.5],
  ["Roast chicken with skin", "protein", 150, "", 215, 27, 0, 11.5],
  ["Lean beef mince, cooked", "protein", 150, "", 175, 27, 0, 7.5],
  ["Rump steak, lean, grilled", "protein", 180, "", 180, 30, 0, 6.5],
  ["Pork loin, lean, grilled", "protein", 150, "", 165, 30, 0, 4.5],
  ["Lamb, lean, grilled", "protein", 150, "", 190, 28, 0, 8.5],
  ["Kangaroo steak, grilled", "protein", 150, "", 105, 24, 0, 1.2],
  ["Salmon fillet, baked", "protein", 150, "", 206, 22, 0, 13],
  ["White fish (barramundi), baked", "protein", 150, "", 110, 23, 0, 1.8],
  ["Prawns, cooked", "protein", 150, "", 99, 24, 0.2, 0.3],
  ["Tuna in springwater, drained", "protein", 95, "1 small tin", 110, 25, 0, 1],
  ["Eggs", "protein", 104, "2 eggs", 143, 12.6, 0.7, 9.5],
  ["Egg whites", "protein", 150, "", 52, 11, 0.7, 0.2],
  ["Turkey breast, deli sliced", "protein", 80, "", 105, 21, 2, 1.5],
  ["Ham, lean, deli sliced", "protein", 60, "", 110, 18, 2, 3.5],
  ["Firm tofu", "protein", 150, "", 144, 15.8, 2.8, 8.7],
  ["Lentils, cooked", "protein", 150, "", 116, 9, 20, 0.4],
  ["Chickpeas, canned, drained", "protein", 125, "", 139, 7, 19, 2.6],
  ["Beef jerky", "snack", 40, "", 280, 45, 11, 5],

  ["Whey protein shake (water)", "shake", 30, "1 scoop", 370, 88, 3, 1.5],
  ["Greek yoghurt, low fat (e.g. Chobani Fit)", "dairy", 170, "", 59, 10, 4, 0.2],
  ["High-protein yoghurt pouch (e.g. YoPRO)", "dairy", 160, "1 pouch", 60, 10, 4, 0.2],
  ["Natural yoghurt, full fat", "dairy", 150, "", 95, 4.5, 6.5, 5.5],
  ["Cottage cheese, low fat", "dairy", 100, "", 80, 12.5, 3, 1.5],
  ["Skim milk", "dairy", 250, "1 glass", 36, 3.5, 5, 0.1],
  ["Full-cream milk", "dairy", 250, "1 glass", 65, 3.4, 4.8, 3.6],
  ["Cheddar cheese", "snack", 25, "1 slice", 400, 25, 0.1, 33],

  ["White rice, cooked", "carb", 180, "1 cup", 130, 2.4, 28.6, 0.3],
  ["Microwave rice cup", "carb", 125, "1 cup", 146, 2.8, 32, 0.5],
  ["Brown rice, cooked", "carb", 180, "1 cup", 123, 2.7, 25.6, 1],
  ["Pasta, cooked", "carb", 180, "1 cup", 157, 5.8, 30.9, 0.9],
  ["Potato, boiled", "carb", 200, "", 77, 2, 17, 0.1],
  ["Sweet potato, baked", "carb", 200, "", 90, 2, 20.7, 0.2],
  ["Wholemeal bread", "carb", 80, "2 slices", 240, 10, 40, 3],
  ["Sourdough", "carb", 70, "1 thick slice", 250, 9, 48, 1.5],
  ["Wholemeal wrap", "carb", 64, "1 wrap", 300, 9, 50, 7],
  ["Rolled oats (dry)", "cereal", 40, "", 375, 13, 58, 8.5],
  ["Weet-Bix", "cereal", 33, "2 biscuits", 353, 12.4, 65.9, 1.3],
  ["Quinoa, cooked", "carb", 150, "", 120, 4.4, 21.3, 1.9],
  ["Rice cakes", "snack", 20, "2 cakes", 385, 8, 80, 3],
  ["Crumpets", "snack", 100, "2 crumpets", 190, 6, 38, 1],
  ["Natural muesli", "cereal", 45, "", 380, 10, 58, 11],

  ["Banana", "fruit", 120, "1 banana", 89, 1.1, 22.8, 0.3],
  ["Apple", "fruit", 150, "1 apple", 52, 0.3, 13.8, 0.2],
  ["Mixed berries", "fruit", 100, "", 45, 0.8, 9.5, 0.3],
  ["Orange", "fruit", 150, "1 orange", 47, 0.9, 11.8, 0.1],
  ["Mango", "fruit", 150, "", 60, 0.8, 15, 0.4],
  ["Grapes", "fruit", 100, "", 69, 0.7, 18, 0.2],
  ["Watermelon", "fruit", 200, "", 30, 0.6, 7.6, 0.2],

  ["Mixed salad leaves", "veg", 50, "", 17, 1.5, 2, 0.2],
  ["Broccoli, steamed", "veg", 100, "", 35, 2.4, 7, 0.4],
  ["Stir-fry vegetables", "veg", 150, "", 35, 2, 6, 0.3],
  ["Green beans", "veg", 100, "", 31, 1.8, 7, 0.1],
  ["Carrot", "veg", 80, "1 carrot", 41, 0.9, 9.6, 0.2],
  ["Cucumber", "veg", 100, "", 15, 0.7, 3.6, 0.1],
  ["Edamame", "veg", 100, "", 121, 11.9, 8.9, 5.2],

  ["Avocado", "fat", 50, "1/4 avocado", 160, 2, 8.5, 14.7],
  ["Olive oil", "fat", 5, "1 tsp", 884, 0, 0, 100],
  ["Almonds", "snack", 30, "small handful", 580, 21, 22, 50],
  ["Peanut butter", "snack", 20, "1 tbsp", 590, 25, 20, 50],
  ["Protein bar", "snack", 60, "1 bar", 380, 33, 35, 13],
  ["Popcorn, plain", "snack", 20, "", 387, 12.9, 77.8, 4.5],
  ["Hummus", "snack", 40, "", 260, 7, 14, 19],
  ["Rice crackers", "snack", 20, "", 400, 7, 80, 4],
  ["Dark chocolate (70%)", "snack", 20, "", 600, 7.8, 46, 43],

  ["Flat white, full cream (regular)", "drink", 250, "1 coffee", 45, 2.5, 3.6, 2.3],
  ["Flat white, skim (regular)", "drink", 250, "1 coffee", 25, 2.6, 3.8, 0.1],
  ["Orange juice", "drink", 250, "1 glass", 45, 0.7, 10.4, 0.2],

  ["Guzman y Gomez chicken burrito bowl", "meal", 480, "1 bowl", 117, 9, 12.1, 3.3],
  ["Subway 6-inch chicken breast sub (no sauce)", "meal", 240, "1 sub", 137, 10.4, 17.9, 2.1],
  ["Nando's quarter chicken breast (plain)", "meal", 170, "1 serve", 135, 23.5, 0.5, 4.1],
  ["Salmon poke bowl", "meal", 450, "1 bowl", 133, 6.7, 15.6, 4.4],
  ["Sushi hand roll (chicken avocado)", "meal", 110, "1 roll", 180, 5.5, 32, 3.5],
  ["McDonald's cheeseburger", "meal", 118, "1 burger", 254, 13.6, 27, 10.6],
  ["Meat pie", "meal", 175, "1 pie", 257, 7.4, 21.7, 15.4],
  ["Chicken & salad wrap (cafe)", "meal", 250, "1 wrap", 170, 11, 18, 6],
];

/** The Foods tab as objects the card and MacroCore understand (seeds it on first use). */
function foodsList_() {
  let rows = readRows_("foods");
  if (!rows.length) {
    withLock_(() => {
      if (readRows_("foods").length) return;
      const sheet = tab_("foods");
      const values = FOOD_SEED.map((r) => r.slice());
      sheet.getRange(2, 1, values.length, values[0].length).setValues(values);
    });
    rows = readRows_("foods");
  }
  return rows
    .map((r) => ({
      name: String(r.name || "").trim(),
      category: String(r.category || "").trim().toLowerCase(),
      serve_g: Number(r.serve_g) || 0,
      serve_label: String(r.serve_label || "").trim(),
      per100: {
        kcal: Number(r.kcal_100g) || 0,
        protein_g: Number(r.protein_100g) || 0,
        carbs_g: Number(r.carbs_100g) || 0,
        fat_g: Number(r.fat_100g) || 0,
      },
    }))
    .filter((f) => f.name && f.serve_g > 0 && f.per100.kcal > 0);
}

// ---------------------------------------------------------------------------
// Ask Fuel: the AI copilot chat (Fuel AI plan)
// ---------------------------------------------------------------------------

const CHAT_SYSTEM_PROMPT = [
  "You are Fuel, the nutrition copilot inside MaxFit, the app of Max, an Australian personal trainer in Sydney.",
  "You help one of Max's clients decide what to eat next so they hit their daily protein, carbohydrate, fat and calorie targets.",
  "",
  "How to answer",
  "- Be brief, warm and practical: 2–5 short sentences, like a supportive coach texting. No lectures, no headings.",
  "- Use the client's numbers in the context (targets, what they've eaten, what's left). Suggest concrete foods and amounts in grams that fit what's left.",
  "- Think Australian: supermarket staples (Woolworths, Coles, Aldi), cafe orders, and takeaway like Guzman y Gomez, Subway, Nando's, sushi, poke, Maccas.",
  "- Put every specific food you recommend eating in `foods`, with realistic grams and macros for that amount (kcal ≈ 4×protein + 4×carbs + 9×fat). Leave `foods` empty if you're not recommending specific foods.",
  "- If the client hides calories, talk about protein and portions and don't quote calorie numbers in `reply`.",
  "",
  "Tone and safety",
  "- Supportive, never shaming. Going over is information, not failure: say 'no stress' and offer high-protein, lower-calorie options if they're still hungry.",
  "- Never suggest skipping meals, purging, fasting to compensate, or eating less in a day than the calorie floor given in the context.",
  "- You're not a doctor or dietitian. If the client mentions a medical condition, medication, pregnancy, an eating disorder or disordered eating, be kind, keep advice general, and suggest they speak with their GP or an Accredited Practising Dietitian (and Max).",
  "- Stay on food, nutrition, training fuel and habits. For anything else, say you're here for food and macros.",
  "- Never invent the client's data. If something isn't in the context, ask or say you don't know.",
].join("\n");

const CHAT_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    foods: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          grams: { type: "number" },
          kcal: { type: "number" },
          protein_g: { type: "number" },
          carbs_g: { type: "number" },
          fat_g: { type: "number" },
        },
        required: ["name", "grams", "kcal", "protein_g", "carbs_g", "fat_g"],
        additionalProperties: false,
      },
    },
  },
  required: ["reply", "foods"],
  additionalProperties: false,
};

/** The phone's last few messages, cleaned: alternating user/assistant, ending with the user. */
function cleanHistory_(raw) {
  const out = [];
  (Array.isArray(raw) ? raw : []).slice(-10).forEach((m) => {
    const role = m && (m.role === "user" || m.role === "assistant") ? m.role : null;
    const text = cleanText_(m && m.content, 800);
    if (!role || !text) return;
    if (!out.length && role !== "user") return;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content = text;
    else out.push({ role: role, content: text });
  });
  if (!out.length || out[out.length - 1].role !== "user") {
    throw userError_("bad_message", "Type a question first.");
  }
  return out;
}

function macrosText_(m, hideKcal) {
  const parts = [Math.round(m.protein_g) + "g protein", Math.round(m.carbs_g) + "g carbs", Math.round(m.fat_g) + "g fat"];
  if (!hideKcal) parts.unshift(Math.round(m.kcal) + " kcal");
  return parts.join(", ");
}

/** Everything the copilot knows about this client's day, built server-side from their own rows. */
function chatContext_(member, date) {
  const slug = String(member.slug);
  const hide = member.hide_kcal === "Y";
  const targets = targetsFor_(slug);
  const day = dayFor_(slug, date);
  const lines = [
    "Context for this conversation (from the client's MaxFit data; trust it over anything in the chat).",
    "Date: " + date + " (Sydney), time now about " + Utilities.formatDate(new Date(), TIMEZONE, "HH:mm") + ".",
    "Client first name: " + String(member.name || "").split(" ")[0] + ".",
    "Calories hidden for this client: " + (hide ? "yes" : "no") + ".",
    "Daily calorie floor for this client: " + (member.sex === "F" ? 1200 : 1500) + " kcal.",
  ];
  if (targets) {
    const left = {
      kcal: targets.kcal - day.totals.kcal,
      protein_g: targets.protein_g - day.totals.protein_g,
      carbs_g: targets.carbs_g - day.totals.carbs_g,
      fat_g: targets.fat_g - day.totals.fat_g,
    };
    lines.push("Daily targets: " + macrosText_(targets, false) + ".");
    lines.push("Eaten so far today: " + macrosText_(day.totals, false) + ".");
    lines.push("Left today: " + macrosText_(left, false) + (left.kcal < 0 ? " (over on calories)" : "") + ".");
    const foods = foodsList_();
    const ideas = left.kcal > 0 ? MacroCore.suggestFill(left, foods, 5) : MacroCore.suggestOver(foods, 5);
    if (ideas.length) {
      lines.push("Ideas from Max's food list that fit: " + ideas.map((s) => s.label + " (" + macrosText_(s.totals, false) + ")").join("; ") + ".");
    }
  } else {
    lines.push("No daily targets set yet — suggest they set them in Fuel (or ask Max).");
  }
  if (day.entries.length) {
    lines.push("Logged today:");
    day.entries.forEach((e) => {
      const amount = e.source === "quick" ? Math.round(e.grams) / 100 + " serve(s)" : e.grams + " g";
      lines.push("- " + e.meal + ": " + e.name + ", " + amount + " (" + macrosText_(e, false) + ")");
    });
  } else {
    lines.push("Nothing logged yet today.");
  }
  return lines.join("\n");
}

function actionChat_(payload, member) {
  const slug = String(member.slug);
  requireFuelAi_(member);
  const history = cleanHistory_(payload.messages);
  const context = chatContext_(member, validDate_(payload.date));
  const usageRow = reserveAi_(member, "chat", TEXT_MODEL);

  let res;
  try {
    res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "post",
      contentType: "application/json",
      headers: { "x-api-key": prop_("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" },
      payload: JSON.stringify({
        model: TEXT_MODEL,
        max_tokens: 1200,
        system: [
          { type: "text", text: CHAT_SYSTEM_PROMPT },
          { type: "text", text: context },
        ],
        output_config: { format: { type: "json_schema", schema: CHAT_SCHEMA } },
        messages: history,
      }),
      muteHttpExceptions: true,
    });
  } catch (err) {
    recordUsage_(usageRow, null, "error", TEXT_MODEL);
    throw userError_("ai_failed", "Fuel couldn't answer just now. Try again in a moment.");
  }
  let data = {};
  try {
    data = JSON.parse(res.getContentText());
  } catch (err) {
    data = {};
  }
  if (res.getResponseCode() !== 200 || data.stop_reason === "refusal" || data.stop_reason === "max_tokens") {
    recordUsage_(usageRow, data.usage, res.getResponseCode() !== 200 ? "http_" + res.getResponseCode() : data.stop_reason, TEXT_MODEL);
    console.error("Chat error", res.getResponseCode(), JSON.stringify(data).slice(0, 500));
    throw userError_("ai_failed", "Fuel couldn't answer just now. Try again in a moment.");
  }
  let parsed;
  try {
    parsed = JSON.parse((data.content || []).find((b) => b.type === "text").text);
  } catch (err) {
    recordUsage_(usageRow, data.usage, "bad_json", TEXT_MODEL);
    throw userError_("ai_failed", "Fuel couldn't answer just now. Try again in a moment.");
  }
  recordUsage_(usageRow, data.usage, "Y", TEXT_MODEL);

  const foods = (parsed.foods || [])
    .slice(0, 5)
    .map((f) => {
      const grams = Math.round(n_(f.grams, 0, 2000));
      if (!(grams > 0)) return null;
      const macros = { protein_g: n_(f.protein_g, 0, 500), carbs_g: n_(f.carbs_g, 0, 500), fat_g: n_(f.fat_g, 0, 500) };
      macros.kcal = MacroCore.reconcileKcal(Object.assign({ kcal: n_(f.kcal, 0, 5000) }, macros));
      const per100 = MacroCore.per100From(macros, grams);
      return Object.assign({ name: cleanText_(f.name, 80) || "Food", grams: grams, per100: per100 }, MacroCore.scale(per100, grams));
    })
    .filter(Boolean);
  return {
    reply: String(parsed.reply || "").trim().slice(0, 1500), // keeps line breaks; the card escapes it
    foods: foods,
    aiToday: aiToday_(member),
  };
}

// ---------------------------------------------------------------------------
// Progress: weights, target history, green days, nutrition punches
// ---------------------------------------------------------------------------

function cleanGoalKg_(value) {
  const n = Number(value);
  return n >= 30 && n <= 300 ? Math.round(n * 10) / 10 : "";
}

/** Appends a row to Target History, so past days are judged against the target they had. */
function recordTargetHistory_(slug, row, setBy) {
  appendRow_("targetHistory", {
    slug: slug,
    effective_date: todaySydney_(),
    kcal: Number(row.kcal) || 0,
    protein_g: Number(row.protein_g) || 0,
    carbs_g: Number(row.carbs_g) || 0,
    fat_g: Number(row.fat_g) || 0,
    set_by: setBy,
    created_at: nowStamp_(),
  });
}

/**
 * A member's target history, oldest first. Members whose targets predate
 * the history tab get one row seeded from their current target, dated the
 * day it was last set.
 */
function historyFor_(slug, rows) {
  let mine = (rows || readRows_("targetHistory")).filter((h) => String(h.slug) === slug);
  if (!mine.length) {
    const t = readRows_("targets").find((r) => String(r.slug) === slug);
    if (t && Number(t.kcal) > 0) {
      const since = /^\d{4}-\d{2}-\d{2}/.test(String(t.updated_at)) ? String(t.updated_at).slice(0, 10) : todaySydney_();
      const seed = {
        slug: slug,
        effective_date: since,
        kcal: Number(t.kcal),
        protein_g: Number(t.protein_g),
        carbs_g: Number(t.carbs_g),
        fat_g: Number(t.fat_g),
        set_by: String(t.set_by || "") + " (seeded)",
        created_at: nowStamp_(),
      };
      appendRow_("targetHistory", seed);
      mine = [seed];
    }
  }
  return mine
    .map((h) => ({
      effective_date: String(h.effective_date),
      kcal: Number(h.kcal) || 0,
      protein_g: Number(h.protein_g) || 0,
      carbs_g: Number(h.carbs_g) || 0,
      fat_g: Number(h.fat_g) || 0,
      set_by: String(h.set_by || ""),
    }))
    .sort((a, b) => (a.effective_date < b.effective_date ? -1 : a.effective_date > b.effective_date ? 1 : 0));
}

/** { "YYYY-MM-DD": totals } for a member's logs on or after fromDate. */
function dayTotalsFor_(slug, fromDate, logRows) {
  const byDate = {};
  (logRows || readRows_("logs")).forEach((r) => {
    if (String(r.slug) !== slug) return;
    const d = String(r.log_date);
    if (d < fromDate) return;
    (byDate[d] = byDate[d] || []).push({ kcal: r.kcal, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g });
  });
  const out = {};
  Object.keys(byDate).forEach((d) => (out[d] = MacroCore.sumTotals(byDate[d])));
  return out;
}

/** A member's weigh-ins, oldest first. */
function weightsFor_(slug, rows) {
  return (rows || readRows_("weights"))
    .filter((w) => String(w.slug) === slug && Number(w.kg) > 0)
    .map((w) => ({ date: String(w.date), kg: Number(w.kg), by: String(w.by || "") }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Latest 7-day-average weight and how it moved over the past week, or null. */
function weightTrend_(slug) {
  const since = MacroCore.addDays(todaySydney_(), -60);
  const trend = MacroCore.movingAverage(weightsFor_(slug).filter((w) => w.date >= since), 7);
  if (!trend.length) return null;
  const last = trend[trend.length - 1];
  const weekAgo = MacroCore.addDays(last.date, -7);
  const earlier = trend.filter((p) => p.date <= weekAgo).pop();
  return {
    kg: MacroCore.round1(last.kg),
    date: last.date,
    change7: earlier ? MacroCore.round1(last.kg - earlier.kg) : null,
  };
}

// --- CRM (the main MaxFit sheet): loyalty counts ---------------------------------

const CRM_PUNCH_COLUMNS = ["Nutrition Punches", "Free Session Owed"];

/** The CRM's Sessions Remaining tab, with the two loyalty columns added if missing. */
function crmSheet_() {
  const id = prop_("MAIN_SHEET_ID");
  if (!id) return null;
  const sheet = SpreadsheetApp.openById(id).getSheets().find((s) => s.getSheetId() === MAIN_SESSIONS_GID);
  if (!sheet) return null;
  const width = Math.max(1, sheet.getLastColumn());
  const header = sheet.getRange(1, 1, 1, width).getValues()[0].map((h) => String(h).trim());
  while (header.length && header[header.length - 1] === "") header.pop();
  CRM_PUNCH_COLUMNS.forEach((name) => {
    if (header.some((h) => h.toLowerCase() === name.toLowerCase())) return;
    header.push(name);
    sheet.getRange(1, header.length).setValue(name);
  });
  return sheet;
}

/** Loyalty numbers for every CRM client, by name slug. */
function crmIndex_() {
  const sheet = crmSheet_();
  const out = { sheet: sheet, bySlug: {}, col: {} };
  if (!sheet) return out;
  const values = sheet.getDataRange().getValues();
  const header = values[0].map((h) => String(h).trim().toLowerCase());
  const col = {
    name: header.indexOf("name"),
    attended: header.indexOf("total classes attended"),
    punches: header.indexOf("nutrition punches"),
    owed: header.indexOf("free session owed"),
  };
  out.col = col;
  if (col.name < 0) return out;
  for (let r = 1; r < values.length; r++) {
    const slug = slugify_(values[r][col.name]);
    if (!slug) continue;
    out.bySlug[slug] = {
      row: r + 1,
      attended: col.attended >= 0 ? Number(values[r][col.attended]) || 0 : 0,
      punches: col.punches >= 0 ? Number(values[r][col.punches]) || 0 : 0,
      owed: col.owed >= 0 && String(values[r][col.owed]).trim().toUpperCase() === "Y",
    };
  }
  return out;
}

// --- member actions -----------------------------------------------------------------

function actionProgress_(payload, member) {
  const slug = String(member.slug);
  const today = todaySydney_();
  const thisMonday = MacroCore.mondayOf(today);
  const lastMonday = MacroCore.addDays(thisMonday, -7);
  const history = historyFor_(slug);
  const dayTotals = dayTotalsFor_(slug, MacroCore.addDays(thisMonday, -21));
  const slim = (w) => ({
    weekStart: w.weekStart,
    greenDays: w.greenDays,
    earnsPunch: w.earnsPunch,
    days: w.days.map((d) => ({ date: d.date, logged: d.logged, green: d.green })),
  });
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const date = MacroCore.addDays(today, -i);
    const totals = dayTotals[date] || { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
    const target = MacroCore.targetOn(history, date);
    days.push({
      date: date,
      kcal: totals.kcal,
      protein_g: totals.protein_g,
      target_kcal: target ? target.kcal : null,
      green: MacroCore.isGreenDay(totals, target),
    });
  }
  const targets = targetsFor_(slug);
  const crm = crmIndex_().bySlug[slug] || null;
  const lastWeek = slim(MacroCore.weekSummary(dayTotals, history, lastMonday));
  lastWeek.awarded = readRows_("punches").some((p) => String(p.slug) === slug && String(p.week_start) === lastMonday);
  const hideWeight = member.hide_weight === "Y";
  return {
    progress: {
      today: today,
      hideWeight: hideWeight,
      weights: hideWeight ? [] : weightsFor_(slug),
      history: history,
      days: days,
      thisWeek: slim(MacroCore.weekSummary(dayTotals, history, thisMonday)),
      lastWeek: lastWeek,
      goal: {
        goal_weight_kg: targets ? targets.goal_weight_kg : null,
        weekly_rate_kg: targets ? targets.weekly_rate_kg : null,
        kind: targets && targets.calc_inputs ? targets.calc_inputs.goal : null,
      },
      loyalty: crm ? { attended: crm.attended, punches: crm.punches, owed: crm.owed } : null,
      punchEvery: MacroCore.GREEN_DAYS_FOR_PUNCH,
    },
  };
}

function cleanWeightInput_(payload) {
  const kg = Math.round(Number(payload.kg) * 10) / 10;
  if (!(kg >= 30 && kg <= 300)) throw userError_("bad_weight", "Enter your weight in kg (between 30 and 300).");
  const today = todaySydney_();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.date || "")) ? String(payload.date) : today;
  if (date > today) throw userError_("bad_date", "That date's in the future.");
  if (date < MacroCore.addDays(today, -366)) throw userError_("bad_date", "That's more than a year ago.");
  return { kg: kg, date: date };
}

/** One weigh-in per member per day: a second one that day replaces the first. */
function upsertWeight_(slug, date, kg, by) {
  withLock_(() => {
    const existing = readRows_("weights").find((w) => String(w.slug) === slug && String(w.date) === date);
    if (existing) updateRow_("weights", existing._row, { kg: kg, by: by, created_at: nowStamp_() });
    else appendRow_("weights", { id: Utilities.getUuid(), slug: slug, date: date, kg: kg, by: by, created_at: nowStamp_() });
  });
}

function actionLogWeight_(payload, member) {
  const slug = String(member.slug);
  const w = cleanWeightInput_(payload);
  upsertWeight_(slug, w.date, w.kg, "client");
  return { weights: weightsFor_(slug), weightTrend: weightTrend_(slug) };
}

function actionDeleteWeight_(payload, member) {
  const slug = String(member.slug);
  const date = String(payload.date || "");
  withLock_(() => {
    const row = readRows_("weights").find((w) => String(w.slug) === slug && String(w.date) === date);
    if (row) tab_("weights").deleteRow(row._row);
  });
  return { weights: weightsFor_(slug), weightTrend: weightTrend_(slug) };
}

// --- coach actions ----------------------------------------------------------------------

function actionCoachLogWeight_(payload) {
  const slug = slugify_(payload.slug);
  if (!readRows_("members").some((m) => String(m.slug) === slug)) {
    throw userError_("no_member", "Create this client's Fuel link first.");
  }
  const w = cleanWeightInput_(payload);
  upsertWeight_(slug, w.date, w.kg, "coach");
  const last = weightsFor_(slug).pop();
  return { slug: slug, lastWeight: last ? { date: last.date, kg: last.kg } : null };
}

/** Max sets a goal weight and a pace in kg/week; the direction follows the goal. */
function actionCoachSetGoal_(payload) {
  const slug = slugify_(payload.slug);
  const row = readRows_("targets").find((t) => String(t.slug) === slug);
  if (!row) throw userError_("no_targets", "Set this client's targets first.");
  const goal = cleanGoalKg_(payload.goal_weight_kg);
  const pace = Math.abs(Number(payload.weekly_rate_kg) || 0);
  if (pace > 2) throw userError_("bad_rate", "Keep the pace under 2 kg a week.");
  let rate = "";
  if (pace > 0) {
    const latest = weightsFor_(slug).pop();
    let sign = -1;
    if (goal && latest) sign = goal > latest.kg ? 1 : -1;
    else {
      let calc = null;
      try {
        calc = row.calc_inputs ? JSON.parse(row.calc_inputs) : null;
      } catch (err) {
        calc = null;
      }
      if (calc && calc.goal === "gain") sign = 1;
    }
    rate = Math.round(sign * pace * 100) / 100;
  }
  updateRow_("targets", row._row, { goal_weight_kg: goal, weekly_rate_kg: rate });
  return { slug: slug, goal_weight_kg: goal || null, weekly_rate_kg: rate === "" ? null : rate };
}

// --- weekly nutrition punches -----------------------------------------------------------

/**
 * For each Fuel member, looks at the last two finished Monday–Sunday weeks;
 * any week with 5+ green days that hasn't been awarded adds 1 to their
 * "Nutrition Punches" in the CRM (and sets "Free Session Owed" when that
 * completes a card of 10). Safe to run any time and as often as you like.
 */
function awardPunches_() {
  const thisMonday = MacroCore.mondayOf(todaySydney_());
  const weeks = [MacroCore.addDays(thisMonday, -14), MacroCore.addDays(thisMonday, -7)];
  const members = readRows_("members");
  const logs = readRows_("logs");
  const history = readRows_("targetHistory");
  const awarded = [];
  withLock_(() => {
    const done = readRows_("punches").map((p) => String(p.slug) + "|" + String(p.week_start));
    const crm = crmIndex_();
    if (!crm.sheet || crm.col.punches < 0) return;
    members.forEach((m) => {
      const slug = String(m.slug);
      const client = crm.bySlug[slug];
      if (!client) return;
      const mine = historyFor_(slug, history); // once per member: it may seed a row
      weeks.forEach((weekStart) => {
        if (done.indexOf(slug + "|" + weekStart) >= 0) return;
        const week = MacroCore.weekSummary(dayTotalsFor_(slug, weekStart, logs), mine, weekStart);
        if (!week.earnsPunch) return;
        client.punches += 1;
        crm.sheet.getRange(client.row, crm.col.punches + 1).setValue(client.punches);
        if ((client.attended + client.punches) % 10 === 0 && crm.col.owed >= 0) {
          crm.sheet.getRange(client.row, crm.col.owed + 1).setValue("Y");
          client.owed = true;
        }
        appendRow_("punches", { slug: slug, week_start: weekStart, green_days: week.greenDays, awarded_at: nowStamp_() });
        done.push(slug + "|" + weekStart);
        awarded.push({ slug: slug, weekStart: weekStart, greenDays: week.greenDays, freeSessionOwed: client.owed });
      });
    });
  });
  return awarded;
}

/** Run by the daily trigger (and safe to run by hand from the editor). */
function awardPunches() {
  return JSON.stringify(awardPunches_());
}

/** Run ONCE from the editor: checks for earned nutrition punches every morning. */
function installPunchTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "awardPunches")
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("awardPunches").timeBased().everyDays(1).atHour(3).create();
  return "Nutrition punches will be checked every morning.";
}
