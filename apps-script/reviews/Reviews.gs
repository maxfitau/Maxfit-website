/**
 * MaxFit Reviews: saves reviews left on the website into a private Google
 * Sheet, and serves the approved ones back to the site.
 *
 * It is its own small Apps Script project (see SETUP.md), so it can't affect
 * check-ins, the membership card or the FUEL macro tracker.
 *
 * Nothing shows on the website until Max sets a review's Status to
 * "approved" in the sheet.
 *
 * Reviews can't be posted to Google from here. Google only lets the reviewer
 * post their own review, so after a review is sent the site offers a button
 * that copies their text and opens Google's own review page (see
 * js/reviews.js).
 */

const REVIEWS_VERSION = "2026-09-27a";
const REVIEWS_TAB = "Reviews";
const REVIEW_HEADERS = ["Received", "Name", "Rating", "Review", "Status", "Consent", "ID"];
const COL_STATUS = 5;

const STATUS_PENDING = "pending";
const STATUS_APPROVED = "approved";
const STATUS_HIDDEN = "hidden";

const NAME_MAX = 40;
const TEXT_MIN = 10;
const TEXT_MAX = 600;
const MIN_FILL_MS = 1500; // a person can't write a review faster than this
const PUBLIC_LIMIT = 30; // newest approved reviews sent to the site
const DEFAULT_DAILY_LIMIT = 30; // submissions per day, a brake on spam
const TZ = "Australia/Sydney";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---------------------------------------------------------------------------
// One-time setup: run this once from the editor (see SETUP.md)
// ---------------------------------------------------------------------------

function setupReviewSheet() {
  const ss = ss_();
  let sh = ss.getSheetByName(REVIEWS_TAB);
  if (!sh) sh = ss.insertSheet(REVIEWS_TAB);

  const rows = sh.getMaxRows();
  // Plain text everywhere, so a review that starts with "=" can never run as a formula.
  sh.getRange(1, 1, rows, REVIEW_HEADERS.length).setNumberFormat("@");
  sh.getRange(1, 1, 1, REVIEW_HEADERS.length).setValues([REVIEW_HEADERS]).setFontWeight("bold");
  sh.setFrozenRows(1);

  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList([STATUS_PENDING, STATUS_APPROVED, STATUS_HIDDEN], true)
    .setAllowInvalid(false)
    .build();
  sh.getRange(2, COL_STATUS, rows - 1, 1).setDataValidation(statusRule);
  sh.getRange(2, 4, rows - 1, 1).setWrap(true);
  [130, 140, 60, 520, 90, 70, 250].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });

  const blank = ss.getSheetByName("Sheet1");
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);
  return "Reviews tab ready.";
}

// A menu in the sheet, so approving is one click (needs the sheet opened once after pasting the code).
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu("Reviews")
      .addItem("Approve selected rows", "approveSelected")
      .addItem("Hide selected rows", "hideSelected")
      .addToUi();
  } catch (err) {
    // Not opened from the sheet, nothing to do.
  }
}

function approveSelected() {
  setStatusOfSelection_(STATUS_APPROVED);
}

function hideSelected() {
  setStatusOfSelection_(STATUS_HIDDEN);
}

function setStatusOfSelection_(status) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getActiveSheet();
  if (sh.getName() !== REVIEWS_TAB) {
    SpreadsheetApp.getUi().alert("Open the Reviews tab and select the review rows first.");
    return;
  }
  const range = sh.getActiveRange();
  const first = Math.max(range.getRow(), 2);
  const last = range.getLastRow();
  for (let r = first; r <= last; r++) sh.getRange(r, COL_STATUS).setValue(status);
  CacheService.getScriptCache().remove("public_reviews");
}

// ---------------------------------------------------------------------------
// Web app entry points
// ---------------------------------------------------------------------------

function doGet(e) {
  const action = e && e.parameter && e.parameter.action;
  if (action === "reviews") {
    try {
      return json_({ ok: true, reviews: publicReviews_() });
    } catch (err) {
      console.error("reviews", err && err.stack ? err.stack : err);
      return json_({ ok: false, error: "server_error" });
    }
  }
  return json_({ ok: true, app: "maxfit-reviews", version: REVIEWS_VERSION });
}

function doPost(e) {
  let payload;
  try {
    payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return json_({ ok: false, error: "bad_request", message: "That request didn't make sense." });
  }
  try {
    if (payload.action === "submitReview") return json_(submitReview_(payload));
    return json_({ ok: false, error: "unknown_action", message: "Unknown action." });
  } catch (err) {
    if (err && err.userError) return json_({ ok: false, error: err.code, message: err.message });
    console.error("submitReview", err && err.stack ? err.stack : err);
    return json_({ ok: false, error: "server_error", message: "Something went wrong on our side. Please try again." });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** An error whose message is safe and friendly enough to show the reviewer. */
function userError_(code, message) {
  const err = new Error(message);
  err.userError = true;
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
// Submitting a review
// ---------------------------------------------------------------------------

function submitReview_(p) {
  // Bots. The honeypot field is hidden from people, and nobody writes a real
  // review in under a couple of seconds. Answer "ok" without saving anything,
  // so a bot learns nothing.
  if (p.website) return { ok: true };
  if (typeof p.elapsedMs === "number" && p.elapsedMs < MIN_FILL_MS) return { ok: true };

  if (p.consent !== true) {
    throw userError_("consent", "Please tick the box so we can show your review.");
  }
  const rating = Number(p.rating);
  if (!(rating >= 1 && rating <= 5) || Math.floor(rating) !== rating) {
    throw userError_("rating", "Please choose a star rating.");
  }
  const name = cleanLine_(p.name).slice(0, NAME_MAX);
  if (!name) {
    throw userError_("name", "Please add your name. First name and last initial is fine.");
  }
  const text = cleanText_(p.text);
  if (text.length < TEXT_MIN) {
    throw userError_("text", "Please write a little more, at least " + TEXT_MIN + " characters.");
  }
  if (text.length > TEXT_MAX) {
    throw userError_("text", "That's a bit long. Please keep it under " + TEXT_MAX + " characters.");
  }
  if (looksLikeLink_(text) || looksLikeLink_(name)) {
    throw userError_("links", "Please leave links out of your review.");
  }

  const cache = CacheService.getScriptCache();
  const dupKey = "dup_" + Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, name.toLowerCase() + "|" + text)
  );
  if (cache.get(dupKey)) return { ok: true }; // the same review sent twice

  let saved;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const props = PropertiesService.getScriptProperties();
    const today = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd");
    const countKey = "count_" + today;
    const used = Number(props.getProperty(countKey) || 0);
    const limit = Number(prop_("DAILY_REVIEW_LIMIT") || DEFAULT_DAILY_LIMIT);
    if (used >= limit) {
      throw userError_("busy", "We've had a lot of reviews today. Please try again tomorrow.");
    }

    const ss = ss_();
    const sh = reviewsSheet_(ss);
    const received = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH:mm");
    const range = sh.getRange(sh.getLastRow() + 1, 1, 1, REVIEW_HEADERS.length);
    range.setNumberFormat("@"); // plain text first, so nothing can be read as a formula
    range.setValues([[received, name, String(rating), text, STATUS_PENDING, "yes", Utilities.getUuid()]]);

    props.setProperty(countKey, String(used + 1));
    props.getKeys().forEach(function (k) {
      if (k.indexOf("count_") === 0 && k !== countKey) props.deleteProperty(k);
    });
    cache.put(dupKey, "1", 21600);
    saved = { name: name, rating: rating, text: text, sheetUrl: ss.getUrl() };
  } finally {
    lock.releaseLock();
  }

  notifyMax_(saved);
  return { ok: true };
}

function notifyMax_(r) {
  try {
    const to = prop_("NOTIFY_EMAIL");
    if (!to) return;
    MailApp.sendEmail({
      to: to,
      subject: "New MaxFit review: " + r.rating + " out of 5 from " + r.name,
      body:
        r.name + " left " + r.rating + " out of 5:\n\n" + r.text + "\n\n" +
        'It is NOT on the website yet. To publish it, open the sheet, find this row, and change Status from "pending" to "approved":\n' +
        r.sheetUrl,
    });
  } catch (err) {
    console.error("notify failed", err && err.message ? err.message : err);
  }
}

// ---------------------------------------------------------------------------
// Serving approved reviews to the site
// ---------------------------------------------------------------------------

function publicReviews_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get("public_reviews");
  if (hit) return JSON.parse(hit);

  const sh = reviewsSheet_(ss_());
  const last = sh.getLastRow();
  let out = [];
  if (last >= 2) {
    out = sh
      .getRange(2, 1, last - 1, REVIEW_HEADERS.length)
      .getValues()
      .filter(function (r) {
        return String(r[COL_STATUS - 1]).trim().toLowerCase() === STATUS_APPROVED;
      })
      .map(function (r) {
        return { received: String(r[0]), name: String(r[1]), rating: Number(r[2]), text: String(r[3]) };
      })
      .filter(function (r) {
        return r.name && r.text && r.rating >= 1 && r.rating <= 5;
      })
      .sort(function (a, b) {
        return a.received < b.received ? 1 : a.received > b.received ? -1 : 0;
      })
      .slice(0, PUBLIC_LIMIT)
      .map(function (r) {
        // Only these four fields ever leave the sheet.
        return { name: r.name, rating: r.rating, text: r.text, date: prettyDate_(r.received) };
      });
  }
  cache.put("public_reviews", JSON.stringify(out), 60);
  return out;
}

// "2026-09-27 08:15" -> "27 Sep 2026"
function prettyDate_(received) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(received);
  if (!m) return "";
  return Number(m[3]) + " " + MONTHS[Number(m[2]) - 1] + " " + m[1];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

// The sheet this script is attached to, or one named by the REVIEWS_SHEET_ID property.
function ss_() {
  const id = prop_("REVIEWS_SHEET_ID");
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function reviewsSheet_(ss) {
  const sh = ss.getSheetByName(REVIEWS_TAB);
  if (!sh) throw new Error('No "' + REVIEWS_TAB + '" tab. Run setupReviewSheet once (see SETUP.md).');
  return sh;
}

// A single line: control characters gone, runs of spaces collapsed.
function cleanLine_(s) {
  return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

// Free text: keeps line breaks (at most one blank line in a row), drops control characters.
function cleanText_(s) {
  return String(s == null ? "" : s)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Links are the main thing spammers want to post.
function looksLikeLink_(s) {
  return /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|au|info|biz|xyz|app|dev)\b)/i.test(s);
}
