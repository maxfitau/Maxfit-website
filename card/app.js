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

const params = new URLSearchParams(window.location.search);
const memberId = params.get("id");

const els = {
  sessions: document.getElementById("sessionsNum"),
  name: document.getElementById("memberName"),
  tier: document.getElementById("memberTier"),
  qr: document.getElementById("qrCode"),
  status: document.getElementById("status"),
  upcomingLabel: document.getElementById("upcomingLabel"),
  upcomingValue: document.getElementById("upcomingValue"),
  upcomingLink: document.getElementById("upcomingLink"),
};

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

async function render(data) {
  els.sessions.textContent = data.sessionsRemaining;
  els.name.textContent = data.memberName;
  els.tier.textContent = data.tier;
  renderQR(data.checkInCode);

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
  sessionsRemaining: 12,
  programType: "group",
  classLabel: "Mission: Slimpossible",
};

const SHEET_ID = "1dGQyIoJ2_XrkbvvPvM2JAY0xdeYQfsCnYHal8WZojUg";
const SHEET_GID = "1169726169"; // "Sessions Remaining" tab
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Minimal RFC4180 CSV parser — handles quoted fields with commas inside. */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Looks the member up by name-slug in the "Sessions Remaining" tab of the
 * Google Sheet CRM. The sheet is the whole database — update a session
 * count or package there and the card reflects it on next open, no code
 * changes needed. Falls back to a demo card if the id isn't found or the
 * sheet can't be reached (e.g. sharing got switched back to private).
 */
/** Case/whitespace-insensitive header lookup — sheet column naming won't always match exactly. */
function findColumn(header, name) {
  return header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
}

async function fetchMemberData(id) {
  const res = await fetch(SHEET_CSV_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("sheet fetch failed");

  const [header, ...rows] = parseCSV(await res.text());
  const col = {
    name: findColumn(header, "Name"),
    package: findColumn(header, "Package Type"),
    sessions: findColumn(header, "Sessions Remaining"),
    programType: findColumn(header, "Program Type"),
    class: findColumn(header, "Class"),
    programDoc: findColumn(header, "Program Doc"),
  };

  const wantedSlug = id ? slugify(id) : undefined;
  const match = wantedSlug
    ? rows.find((r) => r[col.name] && slugify(r[col.name]) === wantedSlug)
    : undefined;
  if (!match) {
    return { ...DEMO_MEMBER, checkInCode: id || "DEMO-0000" };
  }

  const sessionsRaw = (match[col.sessions] || "").trim();
  const sessions = Number(sessionsRaw);
  const programType = ((col.programType >= 0 && match[col.programType]) || "").trim().toLowerCase();

  return {
    memberName: match[col.name],
    tier: match[col.package] || "Member",
    sessionsRemaining: Number.isFinite(sessions) ? sessions : sessionsRaw || "N/A",
    checkInCode: id,
    programType: programType === "self-guided" ? "self-guided" : "group",
    classLabel: col.class >= 0 ? match[col.class] : undefined,
    programDoc: col.programDoc >= 0 ? match[col.programDoc] : undefined,
  };
}

async function init() {
  if (!memberId) {
    showStatus("No member link detected — showing demo card.");
  }

  try {
    const data = await fetchMemberData(memberId);
    await render(data);
  } catch (err) {
    showStatus("Couldn't load your card. Check your connection and reopen.", true);
  }
}

init();
