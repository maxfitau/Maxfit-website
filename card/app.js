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
 */
(function personalizeManifest() {
  const link = document.querySelector('link[rel="manifest"]');
  if (!link) return;
  fetch(link.href)
    .then((res) => res.json())
    .then((manifest) => {
      manifest.start_url = window.location.href;
      manifest.scope = new URL("./", document.baseURI).href;
      manifest.icons = (manifest.icons || []).map((icon) => ({
        ...icon,
        src: new URL(icon.src, document.baseURI).href,
      }));
      const blob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
      link.href = URL.createObjectURL(blob);
    })
    .catch(() => {
      // If this fails, the static manifest.json is still linked as a fallback.
    });
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
 */
async function fetchTodaysWorkout(docUrl) {
  const docId = extractDocId(docUrl);
  if (!docId) return undefined;

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
}

const els = {
  groupSessions: document.getElementById("groupSessionsNum"),
  oneOnOneSessions: document.getElementById("oneOnOneSessionsNum"),
  name: document.getElementById("memberName"),
  tier: document.getElementById("memberTier"),
  qr: document.getElementById("qrCode"),
  status: document.getElementById("status"),
  upcomingLabel: document.getElementById("upcomingLabel"),
  upcomingValue: document.getElementById("upcomingValue"),
  upcomingLink: document.getElementById("upcomingLink"),
  loyaltyCount: document.getElementById("loyaltyCount"),
  loyaltyBar: document.getElementById("loyaltyBar"),
  picker: document.getElementById("picker"),
  pickerForm: document.getElementById("pickerForm"),
  pickerInput: document.getElementById("pickerInput"),
  pickerError: document.getElementById("pickerError"),
  completeButton: document.getElementById("completeButton"),
  celebrate: document.getElementById("celebrate"),
  confetti: document.getElementById("confetti"),
};

/**
 * Pure client-side celebration for the "Workout Completed" button — no
 * sheet write, nothing tracked. Just a dopamine hit for tapping through
 * after a session.
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

els.completeButton.addEventListener("click", celebrate);

function showStatus(message, isError) {
  els.status.textContent = message;
  els.status.hidden = false;
  els.status.classList.toggle("status--error", Boolean(isError));
}

function renderQR(value) {
  els.qr.innerHTML = "";
  const qr = qrcode(0, "M"); // type 0 = auto-size, M = ~15% error correction
  qr.addData(value);
  qr.make();
  els.qr.innerHTML = qr.createSvgTag({ scalable: true });
}

/** 1-in-10 loyalty punchcard — mirrors the auto-tick logic on checkin.html. */
function renderLoyalty(totalAttended) {
  const progress = totalAttended % 10;
  els.loyaltyCount.textContent = `${progress}/10`;
  els.loyaltyBar.innerHTML = "";
  for (let i = 0; i < 10; i++) {
    const peg = document.createElement("div");
    peg.className = "card__loyalty-peg";
    if (i < progress) peg.classList.add("card__loyalty-peg--filled");
    else if (i === 9) peg.classList.add("card__loyalty-peg--next");
    els.loyaltyBar.appendChild(peg);
  }
}

async function render(data) {
  els.groupSessions.textContent = data.groupSessionsRemaining;
  els.oneOnOneSessions.textContent = data.oneOnOneSessionsRemaining;
  els.name.textContent = data.memberName;
  els.tier.textContent = data.tier;
  renderQR(data.checkInUrl);
  renderLoyalty(data.totalAttended);

  if (data.programType === "self-guided" && data.programDoc) {
    els.upcomingLabel.textContent = "Today's Workout";
    els.upcomingLink.href = data.programDoc;
    const workout = await fetchTodaysWorkout(data.programDoc);
    els.upcomingValue.textContent = workout || "View your program";
    return;
  }

  els.upcomingLabel.textContent = "Upcoming Session";
  els.upcomingLink.href = "https://www.maxfit.now/#programs";
  const next = findNextGroupSession(data.classLabel);
  els.upcomingValue.textContent = next
    ? formatUpcoming(next.when, next.entry.label)
    : "See full schedule";
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
    return { ...DEMO_MEMBER, checkInUrl: `https://maxfit.now/checkin.html?token=${id || "DEMO-0000"}` };
  }

  const programType = ((col.programType >= 0 && match[col.programType]) || "").trim().toLowerCase();
  const token = (col.checkInToken >= 0 && match[col.checkInToken]) || id || "";

  return {
    memberName: match[col.name],
    tier: match[col.package] || "Member",
    groupSessionsRemaining: parseSessions(match[col.groupSessions], "N/A"),
    oneOnOneSessionsRemaining: parseSessions(match[col.oneOnOneSessions], "N/A"),
    totalAttended: parseSessions(match[col.totalAttended], 0),
    checkInUrl: `https://maxfit.now/checkin.html?token=${encodeURIComponent(token)}`,
    programType: programType === "self-guided" ? "self-guided" : "group",
    classLabel: col.class >= 0 ? match[col.class] : undefined,
    programDoc: col.programDoc >= 0 ? match[col.programDoc] : undefined,
  };
}

async function loadCard(id) {
  try {
    const data = await fetchMemberData(id);
    await render(data);
  } catch (err) {
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
    els.picker.hidden = true;
    loadCard(id);
  });
}

if (memberId) {
  loadCard(memberId);
} else {
  showPicker();
}
