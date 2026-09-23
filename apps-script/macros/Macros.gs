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
 *   DAILY_AI_LIMIT     — optional, AI scans per member per day (default 25)
 *   CENTS_PER_SCAN     — optional, what a client pays per photo scan in
 *                        Australian cents (default 5, so $10 = 200 scans)
 *   FREE_SCANS         — optional, free photo scans for each new client
 *                        (default 10)
 *
 * Photo scans are prepaid by clients: Max records a payment on the coach
 * page, it becomes scans at CENTS_PER_SCAN, and each successful photo or
 * label scan uses one. The "Scan Credits" tab is the ledger; a client's
 * balance is the sum of their "change" column, so a wrong top-up can be
 * fixed by deleting its row.
 *
 * Who can do what: every member action needs the member's id AND their
 * secret key (the &k= part of their card link), checked against the
 * Members tab. Coach actions need STAFF_PIN. A member can only ever read
 * or change rows carrying their own id.
 */

const MACROS_VERSION = "2026-09-23c";
const TIMEZONE = "Australia/Sydney";
const MAIN_SESSIONS_GID = 1169726169; // "Sessions Remaining" in the CRM sheet
const CARD_URL = "https://maxfit.now/card/";

// Claude models (checked against the Claude API model list, Sept 2026).
// Sonnet reads photos; Haiku is kept for cheap text-only wording later.
const VISION_MODEL = "claude-sonnet-5";
const TEXT_MODEL = "claude-haiku-4-5";
// USD per million tokens, for the AI Usage log. Cache writes are 1.25x
// input, cache reads 0.1x input.
const PRICING = {
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

const TABS = {
  members: { name: "Members", headers: ["slug", "name", "sex", "key", "hide_kcal", "created_at"], text: ["slug", "key"] },
  targets: {
    name: "Macro Targets",
    headers: ["slug", "kcal", "protein_g", "carbs_g", "fat_g", "set_by", "calc_inputs", "coach_approved", "updated_at"],
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
  credits: {
    name: "Scan Credits",
    headers: ["timestamp", "slug", "change", "amount_aud", "note", "by"],
    text: ["slug"],
  },
};

const DEFAULT_CENTS_PER_SCAN = 5;
const DEFAULT_FREE_SCANS = 10;

const SOURCES = ["photo", "barcode", "label", "manual", "fridge", "suggestion"];
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
};

const COACH_ACTIONS = {
  coachList: actionCoachList_,
  addCredit: actionAddCredit_,
  coachSetTargets: actionCoachSetTargets_,
  issueKey: actionIssueKey_,
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

function tab_(key) {
  const spec = TABS[key];
  const ss = macroSheet_();
  // Tabs added in later versions (e.g. Scan Credits) create themselves on
  // first use, so an update never needs setupMacroSheets() run again.
  return ss.getSheetByName(spec.name) || createTab_(ss, spec);
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

function aiLimit_() {
  const n = Number(prop_("DAILY_AI_LIMIT"));
  return n > 0 ? n : 25;
}

function centsPerScan_() {
  const n = Number(prop_("CENTS_PER_SCAN"));
  return n > 0 ? n : DEFAULT_CENTS_PER_SCAN;
}

function freeScans_() {
  const raw = prop_("FREE_SCANS");
  const n = Number(raw);
  return raw !== null && raw !== "" && n >= 0 ? Math.round(n) : DEFAULT_FREE_SCANS;
}

/** Every member's prepaid photo-scan balance: the sum of their rows in Scan Credits. */
function creditBalances_() {
  const out = {};
  readRows_("credits").forEach((r) => {
    const s = String(r.slug);
    out[s] = (out[s] || 0) + (Number(r.change) || 0);
  });
  return out;
}

function creditBalance_(slug) {
  return creditBalances_()[slug] || 0;
}

function addCreditRow_(slug, change, amountAud, note, by) {
  return appendRow_("credits", {
    timestamp: nowStamp_(),
    slug: slug,
    change: change,
    amount_aud: amountAud,
    note: note,
    by: by,
  });
}

function scansUsedToday_(slug) {
  const today = todaySydney_();
  return readRows_("usage").filter((u) => String(u.slug) === slug && String(u.log_date) === today).length;
}

function actionMe_(payload, member) {
  const slug = String(member.slug);
  const logRows = readRows_("logs");
  return {
    member: { slug: slug, name: member.name, sex: member.sex, hide_kcal: member.hide_kcal === "Y" },
    targets: targetsFor_(slug),
    day: dayFor_(slug, validDate_(payload.date), logRows),
    recent: recentFor_(slug, logRows),
    favourites: favouritesFor_(slug),
    scansLeft: Math.max(0, aiLimit_() - scansUsedToday_(slug)),
    scanLimit: aiLimit_(),
    scanCredits: creditBalance_(slug),
    scanPriceCents: centsPerScan_(),
    // No API key yet = photo/label scanning is off; the card hides those buttons.
    aiEnabled: !!prop_("ANTHROPIC_API_KEY"),
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
  const per100 = {
    kcal: n_(p.kcal, 0, 950),
    protein_g: n_(p.protein_g, 0, 100),
    carbs_g: n_(p.carbs_g, 0, 100),
    fat_g: n_(p.fat_g, 0, 100),
  };
  // 100 g of food can't hold more than 100 g of macros (a little slack for label rounding).
  if (per100.protein_g + per100.carbs_g + per100.fat_g > 105) {
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
    };
    const existing = readRows_("targets").find((t) => String(t.slug) === slug);
    if (existing) updateRow_("targets", existing._row, row);
    else appendRow_("targets", row);
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

function actionSetPrefs_(payload, member) {
  const hide = payload.hide_kcal ? "Y" : "N";
  updateRow_("members", member._row, { hide_kcal: hide });
  return { member: { slug: String(member.slug), name: member.name, sex: member.sex, hide_kcal: hide === "Y" } };
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
 * Takes one prepaid scan and one of today's scans under a lock, so two
 * quick taps can't both slip past the balance or the daily limit. Returns
 * the row numbers so a failed scan can be handed back (refundScan_).
 */
function reserveScan_(slug, kind, model) {
  return withLock_(() => {
    if (creditBalance_(slug) < 1) {
      throw userError_("no_credits", "You're out of photo scans. Top up with Max. Barcodes are always free.");
    }
    if (scansUsedToday_(slug) >= aiLimit_()) {
      throw userError_(
        "limit",
        "You've used all " + aiLimit_() + " photo scans for today. Barcodes still work, and scans reset at midnight."
      );
    }
    const usageRow = appendRow_("usage", {
      timestamp: nowStamp_(),
      log_date: todaySydney_(),
      slug: slug,
      kind: kind,
      model: model,
      ok: "pending",
    });
    const creditRow = addCreditRow_(slug, -1, "", kind === "label" ? "Label scan" : "Photo scan", "scan");
    return { usageRow: usageRow, creditRow: creditRow };
  });
}

/** A scan that failed doesn't cost the client: zero out the scan's credit row (it stays as a record). */
function refundScan_(reservation) {
  updateRow_("credits", reservation.creditRow, { change: 0, note: "Scan failed, not charged" });
}

function recordUsage_(rowNumber, usage, ok) {
  const u = usage || {};
  const price = PRICING[VISION_MODEL];
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

function callClaude_(image, mode) {
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
          { type: "text", text: MODE_PROMPTS[mode] },
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
  if (!prop_("ANTHROPIC_API_KEY")) throw userError_("ai_off", "Photo scanning isn't switched on yet. Barcodes still work.");

  const reservation = reserveScan_(slug, mode, VISION_MODEL);
  const fail = (usage, ok, message) => {
    recordUsage_(reservation.usageRow, usage, ok);
    refundScan_(reservation);
    return userError_("ai_failed", message);
  };
  let result;
  try {
    result = callClaude_(image, mode);
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
  recordUsage_(reservation.usageRow, data.usage, "Y");

  const counts = {
    scansLeft: Math.max(0, aiLimit_() - scansUsedToday_(slug)),
    scanCredits: creditBalance_(slug),
  };
  if (mode === "label") return Object.assign({ mode: mode, label: cleanLabel_(parsed), ai: parsed }, counts);
  return Object.assign({ mode: mode, meal: cleanAiMeal_(parsed), ai: parsed }, counts);
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
    };
  });
  const balances = creditBalances_();
  const clients = Object.keys(bySlug)
    .map((s) => Object.assign({ lastLog: lastLog[s] || "", credits: balances[s] || 0 }, bySlug[s]))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { clients: clients, centsPerScan: centsPerScan_(), aiEnabled: !!prop_("ANTHROPIC_API_KEY") };
}

/**
 * Max records a payment: dollars become photo scans at CENTS_PER_SCAN.
 * A negative amount takes scans back (e.g. a typo), or delete the row in
 * the Scan Credits tab.
 */
function actionAddCredit_(payload) {
  const slug = slugify_(payload.slug);
  const member = readRows_("members").find((m) => String(m.slug) === slug);
  if (!member) throw userError_("no_member", "Create this client's Fuel link first.");
  const dollars = Math.round(Number(payload.dollars) * 100) / 100;
  if (!Number.isFinite(dollars) || dollars === 0 || Math.abs(dollars) > 1000) {
    throw userError_("bad_amount", "Enter the amount they paid, in dollars (up to $1,000).");
  }
  const scans = Math.round((dollars * 100) / centsPerScan_());
  if (scans === 0) throw userError_("bad_amount", "That's less than one scan.");
  let balance;
  withLock_(() => {
    addCreditRow_(slug, scans, dollars, cleanText_(payload.note, 80) || (dollars > 0 ? "Top-up" : "Correction"), "coach");
    balance = creditBalance_(slug);
  });
  return { slug: slug, scans: scans, balance: balance };
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
      // New clients get a few photo scans to try it before paying.
      if (freeScans_() > 0) addCreditRow_(slug, freeScans_(), 0, "Free trial", "coach");
    }
    link = CARD_URL + "?id=" + encodeURIComponent(slug) + "&k=" + encodeURIComponent(key);
  });
  return { slug: slug, link: link, credits: creditBalance_(slug) };
}

function actionCoachSetTargets_(payload) {
  const slug = slugify_(payload.slug);
  const member = readRows_("members").find((m) => String(m.slug) === slug);
  if (!member) throw userError_("no_member", "Issue this client a link first.");
  if (payload.clear) {
    withLock_(() => {
      const row = readRows_("targets").find((t) => String(t.slug) === slug);
      if (row) tab_("targets").deleteRow(row._row);
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
    if (sex && sex !== member.sex) updateRow_("members", member._row, { sex: sex });
  });
  return { targets: targetsFor_(slug) };
}
