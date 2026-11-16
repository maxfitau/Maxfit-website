/*
 * MaxFit membership card.
 *
 * Identity: the member's id comes from the URL — each member gets a unique
 * link like maxfit.now/card/?id=jordansmith, opens it once, and adds it to
 * their home screen. No login. The id is the member's name, lowercased and
 * stripped of spaces/punctuation (see slugify()).
 *
 * Data: fetchMemberData() reads live from the "Sessions Remaining" tab of
 * the Google Sheet CRM (docs.google.com/spreadsheets/d/1dGQyIoJ2_XrkbvvPvM2JAY0xdeYQfsCnYHal8WZojUg,
 * gid 1169726169). The sheet must stay shared as "Anyone with the link —
 * Viewer" for this fetch to work (no login, no API key involved).
 */

/*
 * iOS "Add to Home Screen" reads manifest.json and uses its start_url as
 * the icon's permanent launch URL — it ignores the actual page you were on
 * when you tapped Add. Since manifest.json's start_url is a fixed "./"
 * (no ?id=), every member's icon would otherwise open the same
 * unpersonalized card. This rewrites the manifest in-memory on every load
 * so start_url matches whoever's viewing it, before they get a chance to
 * add it to their home screen.
 *
 * Built inline (no fetch) so this runs synchronously on page load — a
 * fetch-then-swap version left a race window where "Add to Home Screen"
 * could grab the original un-personalized manifest.json if tapped before
 * the network round-trip finished, which is why the icon has been silently
 * reverting to the generic/demo card for some people.
 */
(function personalizeManifest() {
  const link = document.querySelector('link[rel="manifest"]');
  if (!link || !window.location.search) return;
  const manifest = {
    name: "MaxFit",
    short_name: "MaxFit",
    start_url: window.location.href,
    scope: new URL("./", document.baseURI).href,
    display: "standalone",
    orientation: "portrait",
    background_color: "#111111",
    theme_color: "#111111",
    icons: [
      { src: new URL("icons/icon-192.png", document.baseURI).href, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: new URL("icons/icon-512.png", document.baseURI).href, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: new URL("icons/icon-512-maskable.png", document.baseURI).href, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  const blob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
  link.href = URL.createObjectURL(blob);
})();

/*
 * Weekly class schedule — mirrors the timetable on maxfit.now/#programs
 * (index.html, "Group Classes" section). Keep these two in sync until the
 * schedule has a single real source (CRM/booking system). Matched against
 * the sheet's "Class" column by label text, case-insensitive, so the sheet
 * can hold the same names shown on the timetable rather than internal ids.
 */
const WEEKLY_SCHEDULE = [
  { day: "Monday", time: "06:00", label: "Heart & Hustle", tag: "Circuit" },
  { day: "Wednesday", time: "06:00", label: "Mission: Slimpossible", tag: "EMOM" },
  { day: "Thursday", time: "06:00", label: "Strong & Sculpted", tag: "Tabata" },
  { day: "Friday", time: "06:00", label: "Heart & Hustle", tag: "Circuit" },
  { day: "Saturday", time: "08:00", label: "Mission: Slimpossible", tag: "EMOM" },
];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Next Date/time this class occurs, given day name + 24h "HH:MM". */
function nextOccurrence(dayName, timeStr) {
  const targetDow = DAY_NAMES.indexOf(dayName);
  const [hours, minutes] = timeStr.split(":").map(Number);
  const now = new Date();
  const result = new Date(now);
  result.setHours(hours, minutes, 0, 0);
  let daysAhead = (targetDow - now.getDay() + 7) % 7;
  if (daysAhead === 0 && result <= now) daysAhead = 7;
  result.setDate(now.getDate() + daysAhead);
  return result;
}

/** Earliest upcoming occurrence of a class, matched by label (case-insensitive). */
function findNextGroupSession(classLabel) {
  if (!classLabel) return undefined;
  const matches = WEEKLY_SCHEDULE.filter(
    (entry) => entry.label.toLowerCase() === classLabel.trim().toLowerCase()
  );
  if (!matches.length) return undefined;

  let best;
  for (const entry of matches) {
    const when = nextOccurrence(entry.day, entry.time);
    if (!best || when < best.when) best = { entry, when };
  }
  return best;
}

function formatUpcoming(when, label) {
  const dayLabel = when.getDate() === new Date().getDate() && when.getMonth() === new Date().getMonth()
    ? "Today"
    : DAY_SHORT[when.getDay()];
  const time = when
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
    .toUpperCase();
  return `${dayLabel} · ${time} — ${label}`;
}

/** Extracts a Google Doc id from any of its share/edit URL forms. */
function extractDocId(url) {
  const match = /\/document\/d\/([a-zA-Z0-9_-]+)/.exec(url || "");
  return match ? match[1] : undefined;
}

/**
 * Reads a self-guided client's personal program doc and pulls out today's
 * workout name. Expects a line starting with the day name, e.g.
 * "Wednesday: Push Day" or "Wednesday — Push Day". If that line has no
 * label after the day name, the next non-blank line is used instead.
 * Returns undefined if the doc can't be read or no line matches today.
 *
 * Wrapped in its own try/catch — a doc that isn't shared publicly, a
 * network hiccup, or a redirect to a Google sign-in page (which fetch()
 * can throw on due to CORS) used to blow up the whole render() call
 * partway through, leaving "Today's Workout" as a label with a stale "—"
 * for a value. Any failure here just falls back to undefined instead, same
 * as a doc that simply doesn't mention today.
 */
async function fetchTodaysWorkout(docUrl) {
  const docId = extractDocId(docUrl);
  if (!docId) return undefined;

  try {
    const res = await fetch(`https://docs.google.com/document/d/${docId}/export?format=txt`, {
      cache: "no-store",
    });
    if (!res.ok) return undefined;

    const lines = (await res.text()).split("\n").map((l) => l.trim());
    const today = DAY_NAMES[new Date().getDay()];
    const dayLine = new RegExp(`^${today}\\s*[:\\-–—]?\\s*(.*)$`, "i");

    for (let i = 0; i < lines.length; i++) {
      const match = dayLine.exec(lines[i]);
      if (!match) continue;
      if (match[1]) return match[1];
      const next = lines.slice(i + 1).find((l) => l.length > 0);
      return next;
    }
    return undefined;
  } catch (err) {
    return undefined;
  }
}

/*
 * iOS's Add to Home Screen behavior around manifest start_url is unreliable
 * in practice across versions — some builds save the personalized ?id= URL,
 * others fall back to a generic one. To not depend on that: remember the id
 * locally the first time someone opens their real link, then fall back to
 * it whenever the URL doesn't carry one (e.g. an icon that saved the bare
 * URL). Each phone only ever holds one member's id, matching how these
 * links are actually used — one phone, one card.
 */
const MEMBER_ID_STORAGE_KEY = "maxfitMemberId";

const params = new URLSearchParams(window.location.search);
let memberId = params.get("id");

if (memberId) {
  try {
    localStorage.setItem(MEMBER_ID_STORAGE_KEY, memberId);
  } catch (err) {
    // Private browsing or storage disabled — nothing to fall back on later.
  }
} else {
  try {
    memberId = localStorage.getItem(MEMBER_ID_STORAGE_KEY);
  } catch (err) {
    // Ignore — memberId stays null, demo card shows as before.
  }
  if (memberId) keepIdInAddress(memberId);
}

/**
 * The card link Max texts can carry the booking code too
 * (?id=jordansmith&b=ABC123, the Clients tab's Card Link). Phones wipe
 * localStorage (iPhone Safari after about a week of not opening the site),
 * so a code that only lived there had to be typed again; one in the link
 * comes back every time the link or its home-screen icon is opened.
 * book.js reads this same entry.
 */
const BOOK_CODE_STORAGE_KEY = "maxfitBookCode"; // { id, code }, shared with card/book.js
const BOOK_CODE_REFUSED_KEY = "maxfitCardCodeRefused"; // "slug|code" the backend turned down, so the card doesn't keep trying it
const BOOKING_API_URL = "https://script.google.com/macros/s/AKfycbya8dm8g5eC4ldAbNYmMCccDCZ6K7encj_q4IzXtKMOpd007RMYhnR3_PJ2eL2gjVDQ/exec"; // same backend as book.js
const linkBookCode = String(params.get("b") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
if (memberId && linkBookCode) {
  try {
    const id = String(memberId).toLowerCase().replace(/[^a-z0-9]/g, "");
    localStorage.setItem(BOOK_CODE_STORAGE_KEY, JSON.stringify({ id: id, code: linkBookCode }));
  } catch (err) {
    // Storage unavailable — book.js still reads ?b= when it's passed along.
  }
}

/** Puts ?id= back in the address when it came from storage, so a Safari tab, bookmark or new home-screen icon keeps it even after the phone clears storage. */
function keepIdInAddress(id) {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("id")) return;
    url.searchParams.set("id", id);
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  } catch (err) {
    // Old browser — nothing lost, storage still has it.
  }
}

const els = {
  greeting: document.getElementById("homeGreeting"),
  dateLine: document.getElementById("homeDate"),
  todayCard: document.getElementById("todayCard"),
  todayLabel: document.getElementById("todayLabel"),
  todayTitle: document.getElementById("todayTitle"),
  todayDone: document.getElementById("todayDone"),
  todayMeta: document.getElementById("todayMeta"),
  todayBtn: document.getElementById("todayBtn"),
  todayBtnText: document.getElementById("todayBtnText"),
  coachRow: document.getElementById("coachRow"),
  clientsTile: document.getElementById("clientsTile"),
  sessionsCard: document.getElementById("sessionsCard"),
  balanceRows: document.getElementById("balanceRows"),
  loyaltyBlock: document.getElementById("loyaltyBlock"),
  loyaltyText: document.getElementById("loyaltyText"),
  loyaltyBar: document.getElementById("loyaltyBar"),
  nextRow: document.getElementById("nextRow"),
  nextWhen: document.getElementById("nextWhen"),
  bookBtn: document.getElementById("bookBtn"),
  becomeBlock: document.getElementById("becomeBlock"),
  homeActions: document.getElementById("homeActions"),
  referLink: document.getElementById("referLink"),
  progressLink: document.getElementById("progressLink"),
  replayTourLink: document.getElementById("replayTourLink"),
  qr: document.getElementById("qrCode"),
  status: document.getElementById("status"),
  cardLoading: document.getElementById("cardLoading"),
  cardLoadingBarFill: document.getElementById("cardLoadingBarFill"),
  qrModal: document.getElementById("qrModal"),
  qrModalBackdrop: document.getElementById("qrModalBackdrop"),
  qrModalClose: document.getElementById("qrModalClose"),
  coachToolsTile: document.getElementById("coachToolsTile"),
  coachToolsModal: document.getElementById("coachToolsModal"),
  coachToolsBackdrop: document.getElementById("coachToolsBackdrop"),
  coachToolsClose: document.getElementById("coachToolsClose"),
  picker: document.getElementById("picker"),
  pickerForm: document.getElementById("pickerForm"),
  pickerInput: document.getElementById("pickerInput"),
  pickerError: document.getElementById("pickerError"),
  celebrate: document.getElementById("celebrate"),
  confetti: document.getElementById("confetti"),
};

/**
 * Pure client-side celebration — no sheet write, nothing tracked. The
 * "Workout Completed" button that used to call this was removed on
 * 2026-11-16 (logging a workout already marks today as done), so nothing
 * calls it now; it stays so confetti can be hooked up to something else.
 */
const CONFETTI_COLORS = ["#e00000", "#ffffff", "#cccccc", "#a80000"];

function celebrate() {
  els.confetti.innerHTML = "";
  const pieceCount = 60;
  for (let i = 0; i < pieceCount; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    piece.style.animationDuration = `${1.4 + Math.random() * 1.2}s`;
    piece.style.animationDelay = `${Math.random() * 0.3}s`;
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    els.confetti.appendChild(piece);
  }

  els.celebrate.hidden = false;
  setTimeout(() => {
    els.celebrate.hidden = true;
  }, 2200);
}

/**
 * Logging a workout (workout/app.js) stores today's date under this key.
 * The Today card reads it to show "Done today ✓" — it stays through the rest
 * of the day and is simply not equal to the date tomorrow, so there's no
 * reset logic. (The old "Workout Completed" tick box that also wrote this
 * key was removed 2026-11-16.)
 */
const WORKOUT_COMPLETE_STORAGE_KEY = "maxfitWorkoutCompleteDate";

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function workoutDoneToday() {
  try {
    return localStorage.getItem(WORKOUT_COMPLETE_STORAGE_KEY) === todayString();
  } catch (err) {
    return false;
  }
}

/** The check-in QR modal. Nothing on the card opens it any more (the Check In tile was removed 2026-11-16, Max doesn't use it) — to bring it back, add a button that calls openQrModal(). */
function openQrModal() {
  els.qrModal.hidden = false;
}

function closeQrModal() {
  els.qrModal.hidden = true;
}

els.qrModalBackdrop.addEventListener("click", closeQrModal);
els.qrModalClose.addEventListener("click", closeQrModal);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.qrModal.hidden) closeQrModal();
});

/**
 * "Coach Tools" — Max's own quick-links to the tools he reaches for mid-
 * session (the workout builder, Coach · Fuel, the CRM sheet, the Handbook).
 * Shown only on his own card (render() checks clientSlug === "maxfrench"),
 * never anyone else's — the tile itself stays hidden otherwise. Each link
 * already has its own protection where it matters (builder.html/coach.html
 * are PIN-gated on load; the CRM sheet is already public-read by design),
 * so this is just a shortcut to places already reachable, nothing new.
 */
function openCoachToolsModal() {
  els.coachToolsModal.hidden = false;
}

function closeCoachToolsModal() {
  els.coachToolsModal.hidden = true;
}

els.coachToolsTile.addEventListener("click", openCoachToolsModal);
els.coachToolsBackdrop.addEventListener("click", closeCoachToolsModal);
els.coachToolsClose.addEventListener("click", closeCoachToolsModal);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.coachToolsModal.hidden) closeCoachToolsModal();
});

function showStatus(message, isError) {
  els.status.textContent = message;
  els.status.hidden = false;
  els.status.classList.toggle("status--error", Boolean(isError));
}

/**
 * Drives a fake progress bar: fast at first, then slows as it creeps up on
 * `cap` (default 94%) and never quite gets there on its own — a real finish
 * always has to call .finish() to snap it to 100%. The classic "almost
 * done" trick (2026-10-26, Max's call) so a wait reads as nearly-over
 * rather than stalled, on every loading moment that shows a bar, not just
 * this one. Self-stops if `fill` leaves the DOM (its loading screen got
 * replaced/hidden), so nothing has to remember to clean it up.
 * Shared with macros.js (window.startFakeProgress) — app.js loads first.
 */
function startFakeProgress(fill, cap) {
  let pct = 0;
  const target = cap || 94;
  const id = setInterval(() => {
    if (!fill.isConnected) {
      clearInterval(id);
      return;
    }
    // ~75% by about 1.2s, then visibly slower each second after — tuned to
    // read as "fast, then creeping" rather than one steady decay the whole way.
    pct += (target - pct) * 0.18;
    fill.style.width = pct.toFixed(1) + "%";
  }, 150);
  return {
    finish() {
      clearInterval(id);
      if (fill.isConnected) fill.style.width = "100%";
    },
  };
}
window.startFakeProgress = startFakeProgress;

let cardLoadingProgress_ = null;

/** Hides the boot-time loading screen — called once real data is on screen, or immediately if there's nothing to fetch yet (the name picker). Safe to call more than once. */
function hideCardLoading() {
  if (cardLoadingProgress_) {
    cardLoadingProgress_.finish();
    cardLoadingProgress_ = null;
  }
  els.cardLoading.hidden = true;
}

function renderQR(value) {
  els.qr.innerHTML = "";
  const qr = qrcode(0, "M"); // type 0 = auto-size, M = ~15% error correction
  qr.addData(value);
  qr.make();
  els.qr.innerHTML = qr.createSvgTag({ scalable: true });
}

/**
 * 1-in-10 loyalty punchcard — mirrors the auto-tick logic on checkin.html.
 * `punches` is class visits plus nutrition punches (5 green days in FUEL =
 * 1). `freeOwed` means a nutrition punch just completed a card, so the
 * free session is waiting for their next check-in. The pegs stay as they
 * were; the sentence under them replaces the old "9/10".
 */
function renderLoyalty(punches, freeOwed) {
  const progress = freeOwed ? 10 : punches % 10;
  const left = 10 - progress;
  els.loyaltyText.textContent = freeOwed ? "Your next session is free!" : `${left} more and your next one's free`;
  els.loyaltyBar.innerHTML = "";
  for (let i = 0; i < 10; i++) {
    const peg = document.createElement("div");
    peg.className = "card__loyalty-peg";
    if (i < progress) peg.classList.add("card__loyalty-peg--filled");
    else if (i === 9) peg.classList.add("card__loyalty-peg--next");
    els.loyaltyBar.appendChild(peg);
  }
}

/**
 * How many exercises are in this client's currently assigned workout, if
 * any — this is what decides whether "Today's Workout" points at the new
 * interactive logger or falls back to the legacy self-guided Doc link.
 * Same defensive pattern as fetchTodaysWorkout: a client with no assigned
 * workout yet (or the "Workout Exercises" tab not existing yet) is a normal
 * outcome, not an error, so this never throws — it just returns 0 and lets
 * render() fall through to whatever came before this feature existed.
 */
const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * How many exercises are in this client's currently assigned workout, if
 * any — this is what decides whether "Today's Workout" points at the new
 * interactive logger or falls back to the legacy self-guided Doc link.
 * Same defensive pattern as fetchTodaysWorkout: a client with no assigned
 * workout yet (or the "Workout Exercises" tab not existing yet) is a normal
 * outcome, not an error, so this never throws — it just returns 0 and lets
 * render() fall through to whatever came before this feature existed.
 *
 * When a client has more than one named workout, todayName names whichever
 * one the builder scheduled for today's weekday (its "Days" column) — but
 * only when that's unambiguous (exactly one workout claims today); with
 * zero or several matches there's no single right answer, so it's left
 * null and the card falls back to letting them choose.
 */
async function assignedWorkoutSummary_(clientSlug) {
  if (!clientSlug) return { count: 0, names: [], todayName: null, counts: {} };
  try {
    const { rows, col } = await fetchWorkoutExercises();
    if (col.client < 0) return { count: 0, names: [], todayName: null, counts: {} };
    const mine = rows.filter((r) => String(r[col.client] || "").trim().toLowerCase() === clientSlug);
    const names = [
      ...new Set(
        mine
          .map((r) => (col.workoutName >= 0 ? String(r[col.workoutName] || "").trim() : ""))
          .filter(Boolean)
      ),
    ];

    let todayName = null;
    if (col.days >= 0) {
      const todayAbbr = DAY_ABBR[new Date().getDay()];
      const scheduledToday = names.filter((name) =>
        mine.some((r) => {
          if ((col.workoutName >= 0 ? String(r[col.workoutName] || "").trim() : "") !== name) return false;
          const days = String(r[col.days] || "").split(",").map((d) => d.trim());
          return days.includes(todayAbbr);
        })
      );
      if (scheduledToday.length === 1) todayName = scheduledToday[0];
    }

    // Exercises per named workout, for the Today card's "6 exercises".
    const counts = {};
    mine.forEach((r) => {
      const name = col.workoutName >= 0 ? String(r[col.workoutName] || "").trim() : "";
      counts[name] = (counts[name] || 0) + 1;
    });

    return { count: mine.length, names, todayName, counts };
  } catch (err) {
    return { count: 0, names: [], todayName: null, counts: {} };
  }
}

/**
 * "Become a member" (2026-11-05): app members only. Never for a client, for Max's
 * own card, for the demo card, or before the Client column exists. The button
 * opens a ready-written text to Max (which they can edit) and quietly logs the
 * tap so it shows on Max's App members page; "Message Max" is the same chat with
 * nothing typed. No pop-ups. (2026-11-16: it now takes the sessions card's place.)
 */
const MAX_SMS_NUMBER = "+61490952388";
const MEMBER_REQUEST_URL = "https://script.google.com/macros/s/AKfycbya8dm8g5eC4ldAbNYmMCccDCZ6K7encj_q4IzXtKMOpd007RMYhnR3_PJ2eL2gjVDQ/exec";
function renderBecomeMember(data) {
  const block = els.becomeBlock;
  const show = !data.isDemo && data.hasClientColumn && !data.isClient && data.clientSlug !== "maxfrench";
  block.hidden = !show;
  els.sessionsCard.hidden = show;
  if (!show) return;
  const body = `Hi Max, it's ${data.memberName} from the MaxFit app. I'd like to find out about training with you.`;
  const btn = document.getElementById("becomeBtn");
  btn.href = `sms:${MAX_SMS_NUMBER}?&body=${encodeURIComponent(body)}`;
  document.getElementById("becomeMsg").href = `sms:${MAX_SMS_NUMBER}`;
  if (btn.dataset.wired) return;
  btn.dataset.wired = "1";
  btn.addEventListener("click", () => {
    try {
      fetch(MEMBER_REQUEST_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "memberRequest", slug: data.clientSlug }),
        keepalive: true,
      }).catch(() => {});
    } catch (err) {
      // The text still opens; Max just doesn't get the tap recorded.
    }
  });
}

// ---------------------------------------------------------------------------
// Home screen (redesigned 2026-11-16)
// ---------------------------------------------------------------------------

/** "Monday 16 November", in Sydney time whatever the phone's own zone says. */
function sydneyDateLine_() {
  try {
    const parts = {};
    new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", weekday: "long", day: "numeric", month: "long" })
      .formatToParts(new Date())
      .forEach((p) => (parts[p.type] = p.value));
    return `${parts.weekday} ${parts.day} ${parts.month}`;
  } catch (err) {
    return `${DAY_NAMES[new Date().getDay()]} ${new Date().getDate()}`;
  }
}

/** Shrinks a single-line heading until it fits its box (never below minPx); if it still can't, it's allowed to wrap rather than be cut off. */
function fitHeading_(el, minPx) {
  if (!el || !el.isConnected) return;
  el.style.fontSize = "";
  el.classList.remove("home__today-title--wrap");
  let px = parseFloat(getComputedStyle(el).fontSize) || 34;
  while (el.scrollWidth > el.clientWidth + 1 && px > minPx) {
    px -= 1;
    el.style.fontSize = px + "px";
  }
  if (el.scrollWidth > el.clientWidth + 1) el.classList.add("home__today-title--wrap");
}

function refitHeadings_() {
  fitHeading_(els.todayTitle, 26);
}
window.addEventListener("resize", refitHeadings_);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(refitHeadings_);

/** Sets the Today card. `done` shows "Done today ✓" and turns the red button into an outlined one. */
function setToday_(opts) {
  els.todayLabel.textContent = opts.label || "Today's workout";
  els.todayTitle.textContent = opts.title;
  els.todayMeta.textContent = opts.meta || "";
  els.todayDone.hidden = !opts.done;
  els.todayMeta.hidden = !!opts.done || !opts.meta;
  els.todayBtnText.textContent = opts.done ? "View workout" : opts.button;
  els.todayBtn.href = opts.href;
  els.todayBtn.target = opts.external ? "_blank" : "_self";
  els.todayBtn.rel = opts.external ? "noopener" : "";
  els.todayBtn.classList.toggle("home__start--outline", !!opts.done);
  refitHeadings_();
}

const pluralEx_ = (n) => `${n} exercise${n === 1 ? "" : "s"}`;

/** The big "Today" card: which workout, how many exercises, and one button into it. */
async function renderToday_(data, workoutSummary) {
  const { count: assignedCount, names: workoutNames, todayName, counts } = workoutSummary;
  if (assignedCount > 0) {
    const href = `../workout/?id=${encodeURIComponent(data.clientSlug)}`;
    const pick = workoutNames.length > 1 && !todayName;
    if (pick) {
      setToday_({ title: "Pick today's workout", button: "Choose workout", href });
      return;
    }
    const name = workoutNames.length === 1 ? workoutNames[0] : todayName;
    const n = name ? counts[name] || assignedCount : assignedCount;
    setToday_({ title: name || "Your workout", meta: pluralEx_(n), button: "Start workout", href, done: workoutDoneToday() });
    return;
  }

  if (data.programType === "self-guided" && data.programDoc) {
    setToday_({ title: "Loading…", button: "Open program", href: data.programDoc, external: true });
    const workout = await fetchTodaysWorkout(data.programDoc);
    setToday_({ title: workout || "Your program", button: "Open program", href: data.programDoc, external: true });
    return;
  }

  const next = findNextGroupSession(data.classLabel);
  const when = next
    ? `${next.when.getDate() === new Date().getDate() && next.when.getMonth() === new Date().getMonth() ? "Today" : DAY_SHORT[next.when.getDay()]} ${next.when
        .toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true })
        .replace(/\s/g, "")
        .toLowerCase()}`
    : "";
  setToday_({
    label: "Next class",
    title: next ? next.entry.label : "Group classes",
    meta: when,
    button: "See schedule",
    href: "https://www.maxfit.now/#programs",
    external: true,
  });
}

/** Sessions card's balance rows: only balances the person has above 0 (or Unlimited), one row each; "No sessions left" when there's nothing. */
function renderBalances_(data) {
  const has = (n) => typeof n === "number" && Number.isFinite(n) && n > 0;
  const rows = [];
  if (data.unlimited) rows.push({ num: "Unlimited", label: "1-on-1 sessions" });
  else if (has(data.oneOnOneSessionsRemaining)) {
    const n = data.oneOnOneSessionsRemaining;
    rows.push({ num: n, label: n === 1 ? "1-on-1 session left" : "1-on-1 sessions left" });
  }
  if (has(data.groupSessionsRemaining)) {
    const n = data.groupSessionsRemaining;
    rows.push({ num: n, label: n === 1 ? "Group class left" : "Group classes left" });
  }
  if (has(data.duoSessionsRemaining)) {
    const n = data.duoSessionsRemaining;
    rows.push({ num: n, label: n === 1 ? "Duo session left" : "Duo sessions left" });
  }
  if (!rows.length) rows.push({ num: 0, label: "No sessions left" });
  els.balanceRows.innerHTML = "";
  rows.forEach((r) => {
    const row = document.createElement("div");
    row.className = "home__balance";
    const num = document.createElement("span");
    num.className = "home__balance-num" + (typeof r.num === "string" ? " home__balance-num--word" : "");
    num.textContent = r.num;
    const label = document.createElement("span");
    label.className = "home__balance-label";
    label.textContent = r.label;
    row.appendChild(num);
    row.appendChild(label);
    els.balanceRows.appendChild(row);
  });
}

/** The client's booking code on this phone (card/book.js and the Card Link save the same entry), or "" when there isn't one for this client. */
function savedBookCode_(clientSlug) {
  try {
    const saved = JSON.parse(localStorage.getItem(BOOK_CODE_STORAGE_KEY) || "null");
    if (saved && saved.id === clientSlug && saved.code) return String(saved.code);
  } catch (err) {
    // No storage: same as no code.
  }
  return "";
}

/** "Thu 20 Nov · 9:00am" from the backend's "2026-11-20" and "09:00". */
function formatBookingWhen_(dateKey, hhmm) {
  const d = String(dateKey).split("-").map(Number);
  const t = String(hhmm).split(":").map(Number);
  if (d.length !== 3 || !d[0] || t.length < 2 || isNaN(t[0])) return "";
  const date = new Date(Date.UTC(d[0], d[1] - 1, d[2], 12));
  const day = date.toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).replace(",", "");
  const h = t[0] % 12 || 12;
  return `${day} · ${h}:${String(t[1]).padStart(2, "0")}${t[0] < 12 ? "am" : "pm"}`;
}

/**
 * The next booking, from the existing read-only "bookingInfo" action (it
 * hands back this client's upcoming bookings soonest first). Needs the
 * booking code saved on this phone; without one, or when nothing is booked,
 * or on any error, the row just says "None booked". It runs after the rest
 * of the page is drawn and never blocks it (2026-11-16).
 */
async function loadNextBooking_(data) {
  const code = savedBookCode_(data.clientSlug);
  // The backend locks booking for 15 minutes after 5 wrong codes, so a code that was refused once is never tried again from here until the saved code changes.
  let refused = "";
  try { refused = localStorage.getItem(BOOK_CODE_REFUSED_KEY) || ""; } catch (err) { /* no storage: just tries */ }
  if (!code || refused === data.clientSlug + "|" + code) {
    els.nextWhen.textContent = "None booked";
    return;
  }
  els.nextWhen.textContent = "Checking…";
  let text = "None booked";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(BOOKING_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "bookingInfo", clientSlug: data.clientSlug, token: data.token, code: code }),
      signal: controller.signal,
    });
    const info = await res.json();
    if (!info || info.status !== "success") {
      try { localStorage.setItem(BOOK_CODE_REFUSED_KEY, data.clientSlug + "|" + code); } catch (err) { /* fine */ }
    }
    const first = info && info.status === "success" && Array.isArray(info.bookings) ? info.bookings[0] : null;
    const when = first ? formatBookingWhen_(first.date, first.start) : "";
    if (when) text = when;
  } catch (err) {
    // Offline, slow or a wrong code: "None booked" is the safe thing to say.
  } finally {
    clearTimeout(timer);
  }
  els.nextWhen.textContent = text;
}

async function render(data, workoutSummary) {
  els.greeting.textContent = `Hi ${String(data.memberName || "").trim().split(/\s+/)[0] || "there"}`;
  els.dateLine.textContent = sydneyDateLine_();
  renderBalances_(data);
  renderQR(data.checkInUrl); // not shown on the card any more, kept ready for when the QR comes back
  renderLoyalty(data.totalAttended + (data.nutritionPunches || 0) + (data.referralPunches || 0) + (data.manualPunches || 0), !!data.freeOwed);

  // Booking and referring are for real members: the demo card has no membership behind either.
  els.nextRow.hidden = !!data.isDemo;
  if (!data.isDemo) {
    els.bookBtn.href = `book.html?id=${encodeURIComponent(data.clientSlug)}${linkBookCode ? "&b=" + linkBookCode : ""}`;
    els.referLink.href = `refer.html?id=${encodeURIComponent(data.clientSlug)}`;
    els.progressLink.href = `../workout/progress.html?id=${encodeURIComponent(data.clientSlug)}`;
    els.homeActions.hidden = false;
    renderBecomeMember(data);
    // Last week's recap and this month's goal (week.js, 2026-10-13). A
    // first-time client sees the welcome tour first — it's also a
    // full-screen takeover, so WeekCard (which can open its own goal-setup
    // popup) only starts once the tour is closed. A returning client skips
    // straight to WeekCard, same as before the tour existed.
    const startWeekCard = () => {
      if (typeof WeekCard !== "undefined") WeekCard.init(data.clientSlug);
    };
    if (typeof Tour !== "undefined" && !Tour.hasSeen()) {
      Tour.show(startWeekCard);
    } else {
      startWeekCard();
    }
    // "Coach Tools" (2026-10-13) — Max's own card only, never a client's.
    if (data.clientSlug === "maxfrench") {
      els.coachRow.hidden = false;
      els.coachToolsTile.hidden = false;
      els.clientsTile.hidden = false;
    }
  }

  // Everything that matters at a glance is on screen now — don't make the
  // loading screen wait on the slower "Today's Workout" lookup below too.
  hideCardLoading();

  await renderToday_(data, workoutSummary);
  if (!data.isDemo) loadNextBooking_(data); // last of all, and not awaited
}

const DEMO_MEMBER = {
  memberName: "Alex Morgan",
  tier: "Founding Member",
  groupSessionsRemaining: 8,
  oneOnOneSessionsRemaining: 4,
  totalAttended: 6,
  programType: "group",
  classLabel: "Mission: Slimpossible",
};

/**
 * Looks the member up by name-slug in the "Sessions Remaining" tab of the
 * Google Sheet CRM (fetchSheet(), shared with checkin.html — see sheet.js).
 * The sheet is the whole database — update a session count or package
 * there and the card reflects it on next open, no code changes needed.
 * Falls back to a demo card if the id isn't found or the sheet can't be
 * reached (e.g. sharing got switched back to private).
 */
async function fetchMemberData(id) {
  const { rows, col } = await fetchSheet();

  const wantedSlug = id ? slugify(id) : undefined;
  const match = wantedSlug
    ? rows.find((r) => r[col.name] && slugify(r[col.name]) === wantedSlug)
    : undefined;
  if (!match) {
    return {
      ...DEMO_MEMBER,
      isDemo: true,
      clientSlug: wantedSlug || "demo",
      checkInUrl: `https://maxfit.now/checkin.html?token=${id || "DEMO-0000"}`,
    };
  }

  const programType = ((col.programType >= 0 && match[col.programType]) || "").trim().toLowerCase();
  const token = (col.checkInToken >= 0 && match[col.checkInToken]) || id || "";

  return {
    memberName: match[col.name],
    clientSlug: wantedSlug || slugify(match[col.name]),
    // What the booking page sends as "who is asking": the sheet's Check-in Token, or the slug when there isn't one (same as book.js).
    token: (col.checkInToken >= 0 ? String(match[col.checkInToken] || "").trim() : "") || wantedSlug || slugify(match[col.name]),
    tier: match[col.package] || "Member",
    // An unlimited plan (Code.gs treats any Package containing "unlimited" so) shows "Unlimited" instead of a count.
    unlimited: /unlimited/i.test(String(match[col.package] || "")),
    groupSessionsRemaining: parseSessions(match[col.groupSessions], "N/A"),
    oneOnOneSessionsRemaining: parseSessions(match[col.oneOnOneSessions], "N/A"),
    duoSessionsRemaining: col.duoSessions >= 0 ? parseSessions(match[col.duoSessions], 0) : 0,
    totalAttended: parseSessions(match[col.totalAttended], 0),
    nutritionPunches: col.nutritionPunches >= 0 ? parseSessions(match[col.nutritionPunches], 0) : 0,
    referralPunches: col.referralPunches >= 0 ? parseSessions(match[col.referralPunches], 0) : 0,
    manualPunches: col.manualPunches >= 0 ? parseSessions(match[col.manualPunches], 0) : 0,
    // Clients vs app members (2026-11-05): "hasClientColumn" is false until
    // Max has run setupClientStatus, and the Become a member block stays hidden then.
    hasClientColumn: col.client >= 0,
    isClient: isClientRow(match, col),
    freeOwed: col.freeOwed >= 0 && String(match[col.freeOwed] || "").trim().toUpperCase() === "Y",
    checkInUrl: `https://maxfit.now/checkin.html?token=${encodeURIComponent(token)}`,
    programType: programType === "self-guided" ? "self-guided" : "group",
    classLabel: col.class >= 0 ? match[col.class] : undefined,
    programDoc: col.programDoc >= 0 ? match[col.programDoc] : undefined,
  };
}

async function loadCard(id) {
  if (cardLoadingProgress_) cardLoadingProgress_.finish(); // a re-run via showPicker() shouldn't leave an old one ticking
  cardLoadingProgress_ = startFakeProgress(els.cardLoadingBarFill);
  try {
    // Kicked off together, not one after the other — fetchMemberData() and
    // the workout lookup hit two different sheet tabs, and the workout one
    // only needs this id's slug, which is known before either fetch starts.
    const memberPromise = fetchMemberData(id);
    const workoutPromise = assignedWorkoutSummary_(slugify(id));
    const data = await memberPromise;
    await render(data, await workoutPromise);
  } catch (err) {
    hideCardLoading();
    showStatus("Couldn't load your card. Check your connection and reopen.", true);
  }
}

/**
 * Standalone home screen apps on iOS can run in a storage container that's
 * isolated from the Safari tab the id was originally saved from — so
 * localStorage set while browsing normally doesn't always carry over to the
 * installed icon. When that happens (no id in the URL, none in this
 * container's storage either), ask once, right here, and save the answer
 * in *this* storage container so it's available on every future open of
 * this exact icon — no dependency on how iOS handles the URL or manifest.
 *
 * Deliberately a type-your-name field, not a list of every member — a
 * scrollable roster of everyone's real name behind an unlabeled link would
 * leak who trains here to anyone who opened it, which isn't worth avoiding
 * one storage quirk for.
 */
function showPicker() {
  hideCardLoading();
  els.picker.hidden = false;
  els.pickerInput.focus();

  els.pickerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const typed = els.pickerInput.value.trim();
    if (!typed) return;

    const id = slugify(typed);
    els.pickerError.hidden = true;

    let found = false;
    try {
      const { rows, col } = await fetchSheet();
      found = rows.some((r) => r[col.name] && slugify(r[col.name]) === id);
    } catch (err) {
      els.pickerError.textContent = "Couldn't check that — check your connection and try again.";
      els.pickerError.hidden = false;
      return;
    }

    if (!found) {
      els.pickerError.textContent = "Couldn't find that name — check the spelling and try again.";
      els.pickerError.hidden = false;
      return;
    }

    try {
      localStorage.setItem(MEMBER_ID_STORAGE_KEY, id);
    } catch (err) {
      // Storage unavailable — card still works for this session.
    }
    keepIdInAddress(id);
    els.picker.hidden = true;
    els.cardLoading.hidden = false;
    loadCard(id);
  });
}

// The Macros tab draws its own loading layout (macros.js), so it doesn't
// wait behind this cover for the card's data, which it never shows.
if (window.location.hash === "#fuel") hideCardLoading();

if (memberId) {
  loadCard(memberId);
} else {
  showPicker();
}
