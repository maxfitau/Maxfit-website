/*
 * MaxFit self-serve account creation (2026-10-26).
 *
 * Different from join.html: join.html captures an ENQUIRY (a Leads row Max
 * reviews before deciding whether to onboard someone by hand). This page
 * creates a REAL client straight away — a Sessions Remaining row, a
 * Check-in Token, and a personal booking code, with zero action from Max —
 * for the specific case he asked for: people he doesn't know or train who
 * want to use the app themselves. They start at 0 sessions and buy their
 * first package from their own card once it's open (the Buy-anytime flow
 * already there), same as any client topping up.
 *
 * *** Uses the same Apps Script Web App URL as join.js/checkin.js. ***
 */
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbya8dm8g5eC4ldAbNYmMCccDCZ6K7encj_q4IzXtKMOpd007RMYhnR3_PJ2eL2gjVDQ/exec";

const els = {
  form: document.getElementById("signupForm"),
  name: document.getElementById("signupName"),
  email: document.getElementById("signupEmail"),
  phone: document.getElementById("signupPhone"),
  website: document.getElementById("signupWebsite"),
  submit: document.getElementById("signupSubmit"),
  error: document.getElementById("signupError"),
  success: document.getElementById("signupSuccess"),
  successText: document.getElementById("signupSuccessText"),
  cardLink: document.getElementById("signupCardLink"),
};

const EMAIL_OK = /^[A-Za-z0-9][A-Za-z0-9._%+'-]*@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = els.name.value.trim();
  const email = els.email.value.trim();
  const phone = els.phone.value.trim();
  els.error.hidden = true;

  if (!name) {
    els.error.textContent = "Enter your name.";
    els.error.hidden = false;
    return;
  }
  if (!email || !EMAIL_OK.test(email)) {
    els.error.textContent = "Enter a valid email — that's where your card link goes.";
    els.error.hidden = false;
    return;
  }

  els.submit.disabled = true;
  els.submit.textContent = "Creating Your Account…";

  let result;
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight
      body: JSON.stringify({
        action: "selfSignup",
        name,
        email,
        phone,
        website: els.website.value, // honeypot — real visitors never fill this
      }),
    });
    result = await res.json();
  } catch (err) {
    els.error.textContent = "Couldn't reach the sign-up system. Check your connection and try again.";
    els.error.hidden = false;
    els.submit.disabled = false;
    els.submit.textContent = "Create My Account";
    return;
  }

  if (result.status === "duplicate") {
    els.error.textContent = result.message || "Looks like you already have an account — check your email, or message Max.";
    els.error.hidden = false;
    els.submit.disabled = false;
    els.submit.textContent = "Create My Account";
    return;
  }

  if (result.status !== "success") {
    els.error.textContent = result.message || "Something went wrong — try again, or message Max directly.";
    els.error.hidden = false;
    els.submit.disabled = false;
    els.submit.textContent = "Create My Account";
    return;
  }

  if (result.cardUrl) els.cardLink.href = result.cardUrl;
  els.form.hidden = true;
  els.success.hidden = false;
});
