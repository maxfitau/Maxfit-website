/*
 * MaxFit referral partner card.
 *
 * A friend's own version of the membership card — same shell, red instead
 * of black. Its QR encodes their personal join link
 * (maxfit.now/join.html?ref=CODE), so a prospective client scans it
 * directly instead of anyone typing a link in by hand.
 *
 * Identity: ?code=<their Referral Code from the Referrals tab>, remembered
 * in localStorage after the first open (mirrors card/app.js's memberId
 * handling) so the icon works the same way on repeat opens. No code in
 * the URL or storage falls back to a name picker, same pattern as the
 * membership card's — never a visible list of every friend's name.
 */
const REFERRER_CODE_STORAGE_KEY = "maxfitReferrerCode";
const JOIN_URL_BASE = "https://maxfit.now/join.html";

const params = new URLSearchParams(window.location.search);
let referralCode = params.get("code");

if (referralCode) {
  try {
    localStorage.setItem(REFERRER_CODE_STORAGE_KEY, referralCode);
  } catch (err) {
    // Private browsing or storage disabled — nothing to fall back on later.
  }
} else {
  try {
    referralCode = localStorage.getItem(REFERRER_CODE_STORAGE_KEY);
  } catch (err) {
    // Ignore — referralCode stays null, picker shows as normal.
  }
}

const els = {
  name: document.getElementById("referrerName"),
  count: document.getElementById("referrerCount"),
  bonus: document.getElementById("referrerBonus"),
  bonusWrap: document.getElementById("referrerBonusWrap"),
  discount: document.getElementById("referrerDiscount"),
  qr: document.getElementById("qrCode"),
  status: document.getElementById("status"),
  picker: document.getElementById("picker"),
  pickerForm: document.getElementById("pickerForm"),
  pickerInput: document.getElementById("pickerInput"),
  pickerError: document.getElementById("pickerError"),
};

function showStatus(message, isError) {
  els.status.textContent = message;
  els.status.hidden = false;
  els.status.classList.toggle("status--error", Boolean(isError));
}

function renderQR(value) {
  els.qr.innerHTML = "";
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  els.qr.innerHTML = qr.createSvgTag({ scalable: true });
}

async function loadCard(code) {
  let match;
  let col;
  try {
    const referrals = await fetchReferrals();
    col = referrals.col;
    match = referrals.rows.find(
      (r) => r[col.code] && r[col.code].trim().toLowerCase() === code.toLowerCase()
    );
  } catch (err) {
    showStatus("Couldn't load your card. Check your connection and reopen.", true);
    return;
  }

  if (!match) {
    showStatus("Referral code not recognized — check with the gym owner.", true);
    return;
  }

  els.name.textContent = col.friendName >= 0 ? match[col.friendName] || "—" : "—";

  const count = col.clientsReferred >= 0 ? String(match[col.clientsReferred] || "").trim() : "";
  els.count.textContent = count || "0";

  const bonus = col.bonusOwed >= 0 ? String(match[col.bonusOwed] || "").trim() : "";
  els.bonus.textContent = bonus || "$0";

  const discount = col.discount >= 0 ? String(match[col.discount] || "").trim() : "";
  if (discount) {
    els.discount.textContent = discount;
    els.discount.hidden = false;
  }

  renderQR(`${JOIN_URL_BASE}?ref=${encodeURIComponent(code)}`);
}

els.bonusWrap.addEventListener("click", () => {
  els.bonusWrap.classList.toggle("card__sessions--revealed");
});

/**
 * Same self-contained fallback as the membership card: if no code is in
 * the URL or remembered locally, ask once (by name, not a visible list of
 * every friend), then remember the answer in this storage container.
 */
function showPicker() {
  els.picker.hidden = false;
  els.pickerInput.focus();

  els.pickerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const typed = els.pickerInput.value.trim();
    if (!typed) return;

    els.pickerError.hidden = true;

    let matchCode = "";
    try {
      const { rows, col } = await fetchReferrals();
      const match = rows.find(
        (r) => r[col.friendName] && r[col.friendName].trim().toLowerCase() === typed.toLowerCase()
      );
      if (match) matchCode = (match[col.code] || "").trim();
    } catch (err) {
      els.pickerError.textContent = "Couldn't check that — check your connection and try again.";
      els.pickerError.hidden = false;
      return;
    }

    if (!matchCode) {
      els.pickerError.textContent = "Couldn't find that name — check the spelling and try again.";
      els.pickerError.hidden = false;
      return;
    }

    try {
      localStorage.setItem(REFERRER_CODE_STORAGE_KEY, matchCode);
    } catch (err) {
      // Storage unavailable — card still works for this session.
    }
    els.picker.hidden = true;
    loadCard(matchCode);
  });
}

if (referralCode) {
  loadCard(referralCode);
} else {
  showPicker();
}
