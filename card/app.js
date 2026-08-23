/*
 * MaxFit membership card.
 *
 * Identity: the member's id comes from the URL — each member gets a unique
 * link like maxfit.now/card/?id=abc123, opens it once, and adds it to their
 * home screen. No login.
 *
 * Data: fetchMemberData() is the one function to rewire once a CRM endpoint
 * exists. Today it returns placeholder data so the screen is fully
 * demoable before that wiring lands.
 */

/*
 * Weekly class schedule — mirrors the timetable on maxfit.now/#programs
 * (index.html, "Group Classes" section). Keep these two in sync until the
 * schedule has a single real source (CRM/booking system).
 */
const WEEKLY_SCHEDULE = {
  "heart-hustle": { day: "Monday", time: "06:00", label: "Heart & Hustle", tag: "Circuit" },
  "slimpossible-wed": { day: "Wednesday", time: "06:00", label: "Mission: Slimpossible", tag: "EMOM" },
  "strong-sculpted": { day: "Thursday", time: "06:00", label: "Strong & Sculpted", tag: "Tabata" },
  "heart-hustle-fri": { day: "Friday", time: "06:00", label: "Heart & Hustle", tag: "Circuit" },
  "slimpossible-sat": { day: "Saturday", time: "08:00", label: "Mission: Slimpossible", tag: "EMOM" },
};

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

function formatUpcoming(session) {
  const when = nextOccurrence(session.day, session.time);
  const dayLabel = when.getDate() === new Date().getDate() && when.getMonth() === new Date().getMonth()
    ? "Today"
    : DAY_SHORT[when.getDay()];
  const time = when
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
    .toUpperCase();
  return `${dayLabel} · ${time} — ${session.label}`;
}

const params = new URLSearchParams(window.location.search);
const memberId = params.get("id");

const els = {
  sessions: document.getElementById("sessionsNum"),
  name: document.getElementById("memberName"),
  tier: document.getElementById("memberTier"),
  qr: document.getElementById("qrCode"),
  status: document.getElementById("status"),
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

function render(data) {
  els.sessions.textContent = data.sessionsRemaining;
  els.name.textContent = data.memberName;
  els.tier.textContent = data.tier;
  renderQR(data.checkInCode);

  const session = WEEKLY_SCHEDULE[data.classId];
  if (session) {
    els.upcomingValue.textContent = formatUpcoming(session);
  } else {
    els.upcomingValue.textContent = "See full schedule";
  }
}

const DEMO_MEMBER = {
  memberName: "Alex Morgan",
  tier: "Founding Member",
  sessionsRemaining: 12,
  classId: "slimpossible-wed",
};

/**
 * Looks the member up in members.json by their URL id. That file is the
 * whole "database" for now — edit it (e.g. via GitHub's web editor) and
 * push to update anyone's sessions/tier/class, no code changes needed.
 *
 * To replace this with a live CRM lookup instead, swap the fetch below for
 * a call to a backend/proxy endpoint, e.g.:
 *   const res = await fetch(`https://api.maxfit.now/members/${id}`);
 *   if (!res.ok) throw new Error("lookup failed");
 *   return res.json();
 *
 * The CRM call must go through a backend/proxy, not a client-side request
 * straight to monday.com (or any CRM) with an embedded API key — that key
 * would be readable by anyone who opens dev tools on the card.
 */
async function fetchMemberData(id) {
  const res = await fetch("members.json", { cache: "no-store" });
  const members = res.ok ? await res.json() : {};
  const member = id ? members[id] : undefined;

  if (!member) {
    return { ...DEMO_MEMBER, checkInCode: id || "DEMO-0000" };
  }
  return { ...member, checkInCode: id };
}

async function init() {
  if (!memberId) {
    showStatus("No member link detected — showing demo card.");
  }

  try {
    const data = await fetchMemberData(memberId);
    render(data);
  } catch (err) {
    showStatus("Couldn't load your card. Check your connection and reopen.", true);
  }
}

init();
