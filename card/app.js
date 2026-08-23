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

const params = new URLSearchParams(window.location.search);
const memberId = params.get("id");

const els = {
  sessions: document.getElementById("sessionsNum"),
  name: document.getElementById("memberName"),
  tier: document.getElementById("memberTier"),
  qr: document.getElementById("qrCode"),
  status: document.getElementById("status"),
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
}

/**
 * Replace this with a real CRM lookup, e.g.:
 *   const res = await fetch(`https://api.maxfit.now/members/${id}`);
 *   if (!res.ok) throw new Error("lookup failed");
 *   return res.json();
 *
 * The CRM call must go through a backend/proxy endpoint, not a client-side
 * request straight to monday.com (or any CRM) with an embedded API key —
 * that key would be readable by anyone who opens dev tools on the card.
 */
async function fetchMemberData(id) {
  await new Promise((resolve) => setTimeout(resolve, 300));
  return {
    memberName: "Alex Morgan",
    tier: "Founding Member",
    sessionsRemaining: 12,
    checkInCode: id || "DEMO-0000",
  };
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
