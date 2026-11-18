/*
 * Add a client (coach laptop/phone page, card/add-client.html, 2026-11-18).
 * Four steps (Who, Client or app member, Extras, Check and add), then the
 * backend's "addClient" action (Code.gs handleAddClient_) makes the whole row
 * on the Sessions Remaining tab, the check-in token, the booking code and the
 * card link, and emails the person their card link. Nothing is typed into the
 * sheet by hand. Needs sheet.js and people.js loaded first; the staff PIN is
 * the shared one (People.getPin). Everything shown is put on the page with
 * textContent, never innerHTML.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const el = People.el;
  const gate = $("gate");
  const statusEl = $("pageStatus");
  const wizard = $("wizard");

  const EMAIL_OK = /^[A-Za-z0-9][A-Za-z0-9._%+'-]*@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
  const STEPS = ["Who is it?", "Client or app member?", "A few extras", "Check and add"];

  let existing = []; // [{ name, slug }] from the sheet, for the referrer list and a duplicate warning
  let step = 0;
  let state;
  let error = "";
  let busy = false;

  function fresh() {
    return { name: "", email: "", phone: "", type: "client", oneOnOne: 0, group: 0, firstFree: true, referredBy: "", sendEmail: true };
  }

  function field(label, input, hint) {
    const wrap = el("label", "addc__field");
    wrap.appendChild(el("span", "addc__label", label));
    wrap.appendChild(input);
    if (hint) wrap.appendChild(el("span", "addc__hint", hint));
    return wrap;
  }

  function textInput(type, value, attrs) {
    const i = el("input", "picker__input addc__input");
    i.type = type;
    i.value = value;
    i.autocomplete = "off";
    Object.keys(attrs || {}).forEach((k) => i.setAttribute(k, attrs[k]));
    return i;
  }

  function tick(label, sub, checked, onChange, disabled) {
    const row = el("label", "addc__tick" + (disabled ? " is-off" : ""));
    const box = el("input");
    box.type = "checkbox";
    box.checked = checked && !disabled;
    box.disabled = !!disabled;
    box.addEventListener("change", () => onChange(box.checked));
    row.appendChild(box);
    const t = el("span", "addc__tick-text");
    t.appendChild(el("b", "", label));
    if (sub) t.appendChild(el("small", "", sub));
    row.appendChild(t);
    return row;
  }

  function stepper(label, value, onChange) {
    const wrap = el("div", "addc__stepper");
    wrap.appendChild(el("span", "addc__label", label));
    const row = el("div", "addc__stepper-row");
    const num = el("span", "addc__stepper-num", String(value));
    const mk = (sign, delta) => {
      const b = el("button", "addc__step", sign);
      b.type = "button";
      b.setAttribute("aria-label", (delta < 0 ? "One less " : "One more ") + label);
      b.addEventListener("click", () => {
        const next = Math.max(0, Math.min(200, Number(num.textContent) + delta));
        num.textContent = String(next);
        onChange(next);
      });
      return b;
    };
    row.appendChild(mk("−", -1));
    row.appendChild(num);
    row.appendChild(mk("+", 1));
    wrap.appendChild(row);
    return wrap;
  }

  function choice(title, sub, on, onClick) {
    const b = el("button", "addc__choice" + (on ? " is-on" : ""));
    b.type = "button";
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.appendChild(el("b", "", title));
    b.appendChild(el("small", "", sub));
    b.addEventListener("click", onClick);
    return b;
  }

  function slug(name) {
    return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  // ---- Validation per step ----------------------------------------------------

  function problemOnStep(n) {
    if (n === 0) {
      if (!state.name.trim()) return "Type their name.";
      const dupe = existing.find((p) => p.slug === slug(state.name));
      if (dupe) return dupe.name + " is already on the sheet.";
      if (state.email.trim() && !EMAIL_OK.test(state.email.trim())) return "That email doesn't look right. Check it, or leave it blank.";
    }
    if (n === 2 && state.referredBy.trim() && !existing.some((p) => p.slug === slug(state.referredBy))) {
      return "I can't find " + state.referredBy.trim() + " on the sheet. Pick a name from the list, or clear the box.";
    }
    return "";
  }

  // ---- Drawing ----------------------------------------------------------------

  function header() {
    const h = el("div", "addc__head");
    h.appendChild(el("p", "addc__count", "Step " + (step + 1) + " of " + STEPS.length));
    const dots = el("div", "addc__dots");
    STEPS.forEach((_, i) => dots.appendChild(el("span", i <= step ? "on" : "")));
    h.appendChild(dots);
    h.appendChild(el("h2", "addc__title", STEPS[step]));
    return h;
  }

  function nav(nextLabel, onNext) {
    const row = el("div", "addc__nav");
    if (step > 0) {
      const back = el("button", "pbtn pbtn--ghost", "Back");
      back.type = "button";
      back.addEventListener("click", () => { error = ""; step--; draw(); });
      row.appendChild(back);
    }
    const next = el("button", "pbtn", nextLabel);
    next.type = "button";
    next.disabled = busy;
    next.addEventListener("click", onNext);
    row.appendChild(next);
    return row;
  }

  function go() {
    const p = problemOnStep(step);
    if (p) { error = p; draw(); return; }
    error = "";
    step++;
    draw();
  }

  function draw() {
    wizard.textContent = "";
    wizard.hidden = false;
    const box = el("div", "addc__box");
    box.appendChild(header());

    if (step === 0) {
      const name = textInput("text", state.name, { autocapitalize: "words", placeholder: "Full name" });
      name.addEventListener("input", () => (state.name = name.value));
      const email = textInput("email", state.email, { inputmode: "email", autocapitalize: "none", placeholder: "name@example.com" });
      email.addEventListener("input", () => (state.email = email.value));
      const phone = textInput("tel", state.phone, { inputmode: "tel", placeholder: "04…" });
      phone.addEventListener("input", () => (state.phone = phone.value));
      box.appendChild(field("Name", name));
      box.appendChild(field("Email", email, "Their card link is emailed here. You can leave it blank and text it yourself."));
      box.appendChild(field("Phone (optional)", phone));
      for (const i of [name, email, phone]) i.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
    } else if (step === 1) {
      const two = el("div", "addc__choices");
      two.appendChild(choice("Client", "You train them in person", state.type === "client", () => { state.type = "client"; draw(); }));
      two.appendChild(choice("App member", "They just use the app", state.type === "member", () => { state.type = "member"; draw(); }));
      box.appendChild(two);
      box.appendChild(el("p", "addc__hint", "You can switch this any time from My clients or App members."));
      const steppers = el("div", "addc__steppers");
      steppers.appendChild(stepper("1-on-1 sessions to start with", state.oneOnOne, (v) => (state.oneOnOne = v)));
      steppers.appendChild(stepper("Group classes to start with", state.group, (v) => (state.group = v)));
      box.appendChild(steppers);
    } else if (step === 2) {
      box.appendChild(tick("Their first session is free", "Check-in will offer it as a free session.", state.firstFree, (v) => (state.firstFree = v)));
      const ref = textInput("text", state.referredBy, { placeholder: "Start typing a name", list: "addcPeople" });
      ref.addEventListener("input", () => (state.referredBy = ref.value));
      const list = el("datalist");
      list.id = "addcPeople";
      existing.forEach((p) => { const o = el("option"); o.value = p.name; list.appendChild(o); });
      box.appendChild(field("Referred by (optional)", ref, "Every session they pay for then earns that person a loyalty punch."));
      box.appendChild(list);
      const hasEmail = !!state.email.trim();
      box.appendChild(tick("Email them their card link", hasEmail ? state.email.trim() : "You didn't give an email, so there's nothing to send to.", state.sendEmail, (v) => (state.sendEmail = v), !hasEmail));
    } else {
      const dl = el("dl", "addc__review");
      const row = (k, v) => { dl.appendChild(el("dt", "", k)); dl.appendChild(el("dd", "", v)); };
      row("Name", state.name.trim());
      row("Email", state.email.trim() || "none");
      row("Phone", state.phone.trim() || "none");
      row("Type", state.type === "client" ? "Client (you train them in person)" : "App member");
      row("Starting sessions", state.oneOnOne + " 1-on-1, " + state.group + " group");
      row("First session free", state.firstFree ? "Yes" : "No");
      row("Referred by", state.referredBy.trim() || "nobody");
      row("Card link emailed", state.email.trim() && state.sendEmail ? "Yes, to " + state.email.trim() : "No (you'll get a text to send)");
      box.appendChild(dl);
    }

    if (error) box.appendChild(el("p", "clients__error", error));
    box.appendChild(step < STEPS.length - 1 ? nav("Next", go) : nav(busy ? "Adding…" : "Add " + (state.name.trim().split(/\s+/)[0] || "them"), submit));
    wizard.appendChild(box);
    const first = box.querySelector("input[type=text], input[type=email]");
    if (first && step === 0 && !state.name) first.focus();
  }

  // ---- Saving -----------------------------------------------------------------

  async function submit() {
    if (busy) return;
    busy = true;
    error = "";
    draw();
    for (;;) {
      let pin = People.getPin();
      if (!pin) {
        wizard.hidden = true;
        pin = await People.askPin(gate, error || "Enter your staff PIN to add them.");
        gate.textContent = "";
        wizard.hidden = false;
      }
      try {
        const res = await People.api("addClient", pin, {
          name: state.name.trim(),
          email: state.email.trim(),
          phone: state.phone.trim(),
          client: state.type === "client",
          oneOnOne: state.oneOnOne,
          group: state.group,
          firstFree: state.firstFree,
          referredBy: state.referredBy.trim(),
          sendEmail: state.sendEmail && !!state.email.trim(),
        });
        People.savePin(pin);
        busy = false;
        done(res);
        return;
      } catch (e) {
        if (e.code === "bad_pin") {
          People.forgetPin();
          error = "Wrong PIN.";
          continue;
        }
        busy = false;
        error = e.message || "That didn't work. Try again.";
        draw();
        return;
      }
    }
  }

  function copyButton(label, text) {
    const b = el("button", "pbtn pbtn--ghost", label);
    b.type = "button";
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        b.textContent = "Copied";
      } catch (err) {
        b.textContent = "Select the text above and copy it";
      }
      setTimeout(() => (b.textContent = label), 2000);
    });
    return b;
  }

  function done(res) {
    wizard.textContent = "";
    const box = el("div", "addc__box");
    box.appendChild(el("p", "addc__count", "Done"));
    box.appendChild(el("h2", "addc__title", "Added " + res.name));
    const sheetLine = res.client ? "They're on the Sessions Remaining tab as a client." : "They're on the Sessions Remaining tab as an app member.";
    box.appendChild(el("p", "addc__line", sheetLine));
    box.appendChild(el("p", "addc__line", res.emailed ? "Their card link has been emailed to " + state.email.trim() + "." : "No email was sent, so text them the message below."));
    if (res.bookingCode) box.appendChild(el("p", "addc__line", "Booking code: " + res.bookingCode + " (it's already in their link, so they never type it)."));
    box.appendChild(el("label", "addc__label", "Message to text them"));
    const ta = el("textarea", "addc__text");
    ta.readOnly = true;
    ta.rows = 3;
    ta.value = res.text;
    box.appendChild(ta);
    const row = el("div", "addc__nav");
    row.appendChild(copyButton("Copy message", res.text));
    const again = el("button", "pbtn", "Add another");
    again.type = "button";
    again.addEventListener("click", () => { existing.push({ name: res.name, slug: res.slug }); state = fresh(); step = 0; error = ""; draw(); });
    row.appendChild(again);
    box.appendChild(row);
    const links = el("div", "addc__nav");
    links.appendChild(People.linkButton(res.client ? "See My clients" : "See App members", res.client ? "clients.html" : "members.html", "ghost"));
    links.appendChild(People.linkButton("Open their card", "./?id=" + encodeURIComponent(res.slug), "ghost"));
    box.appendChild(links);
    wizard.appendChild(box);
    wizard.scrollIntoView({ block: "start" });
  }

  // ---- Start ------------------------------------------------------------------

  state = fresh();
  fetchSheet()
    .then(({ rows, col }) => {
      existing = rows
        .filter((r) => String(r[col.name] || "").trim())
        .map((r) => ({ name: String(r[col.name]).trim(), slug: slug(r[col.name]) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    })
    .catch(() => { /* the form still works; the backend refuses a duplicate or an unknown referrer */ })
    .then(() => {
      statusEl.textContent = "";
      draw();
    });
  statusEl.textContent = "Loading…";
})();
