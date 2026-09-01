/*
 * MaxFit public sign-up page.
 *
 * Anyone can open this — shared as a plain link, or with a referral code
 * appended (?ref=CODE) that a friend shares. If the code matches a row in
 * the "Referrals" tab, a banner shows who referred them. Submitting posts
 * to the same Apps Script Web App the check-in page uses, with
 * action: "signup" so it's routed differently server-side. This only ever
 * adds a new row to Sessions Remaining as an "Enquiry" — it doesn't turn
 * someone into a real paying member on its own; that's still done by hand,
 * same as any other sign-up today.
 *
 * *** Uses the same Apps Script Web App URL as checkin.js — keep in sync. ***
 */
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbya8dm8g5eC4ldAbNYmMCccDCZ6K7encj_q4IzXtKMOpd007RMYhnR3_PJ2eL2gjVDQ/exec";

const params = new URLSearchParams(window.location.search);
const referralCode = (params.get("ref") || "").trim();
const prefillProgram = (params.get("program") || "").trim();

const els = {
  referral: document.getElementById("joinReferral"),
  form: document.getElementById("joinForm"),
  name: document.getElementById("joinName"),
  phone: document.getElementById("joinPhone"),
  email: document.getElementById("joinEmail"),
  program: document.getElementById("joinProgram"),
  time: document.getElementById("joinTime"),
  goals: document.getElementById("joinGoals"),
  website: document.getElementById("joinWebsite"),
  submit: document.getElementById("joinSubmit"),
  error: document.getElementById("joinError"),
  success: document.getElementById("joinSuccess"),
  successText: document.getElementById("joinSuccessText"),
};

// A CTA on the main site can link here with ?program=Group%20Classes to
// arrive with the right option already selected, one less field to fill in.
if (prefillProgram && els.program) {
  const hasOption = Array.from(els.program.options).some((o) => o.value === prefillProgram);
  if (hasOption) els.program.value = prefillProgram;
}

async function showReferralBanner() {
  if (!referralCode) return;

  try {
    const { rows, col } = await fetchReferrals();
    if (col.code < 0) return;
    const match = rows.find(
      (r) => r[col.code] && r[col.code].trim().toLowerCase() === referralCode.toLowerCase()
    );
    if (!match) return;

    const friendName = col.friendName >= 0 ? match[col.friendName] : "";
    const discount = col.discount >= 0 ? match[col.discount] : "";
    els.referral.textContent = friendName
      ? `Referred by ${friendName}${discount ? ` — ${discount}` : ""}`
      : discount || "Referral code applied.";
    els.referral.hidden = false;
  } catch (err) {
    // Sheet unreachable — just skip the banner, don't block sign-up.
  }
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = els.name.value.trim();
  const phone = els.phone.value.trim();
  const email = els.email.value.trim();
  const program = els.program.value.trim();
  const preferredTime = els.time.value.trim();
  const goals = els.goals.value.trim();
  els.error.hidden = true;

  if (!name || (!phone && !email)) {
    els.error.textContent = "Add your name and at least a phone number or email.";
    els.error.hidden = false;
    return;
  }

  els.submit.disabled = true;
  els.submit.textContent = "Signing Up…";

  let result;
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight
      body: JSON.stringify({
        action: "signup",
        name,
        phone,
        email,
        program,
        preferredTime,
        goals,
        referralCode,
        website: els.website.value, // honeypot — real visitors never fill this
      }),
    });
    result = await res.json();
  } catch (err) {
    els.error.textContent = "Couldn't reach the sign-up system. Check your connection and try again.";
    els.error.hidden = false;
    els.submit.disabled = false;
    els.submit.textContent = "Sign Me Up";
    return;
  }

  if (result.status === "duplicate") {
    els.error.textContent = "Looks like you've already signed up — I'll be in touch.";
    els.error.hidden = false;
    els.submit.disabled = false;
    els.submit.textContent = "Sign Me Up";
    return;
  }

  if (result.status !== "success") {
    els.error.textContent = "Something went wrong — try again, or just text me directly.";
    els.error.hidden = false;
    els.submit.disabled = false;
    els.submit.textContent = "Sign Me Up";
    return;
  }

  els.successText.textContent = result.referrerName
    ? `Thanks to ${result.referrerName} for the referral — I'll be in touch shortly.`
    : "I'll be in touch shortly.";
  els.form.hidden = true;
  els.success.hidden = false;
});

showReferralBanner();
