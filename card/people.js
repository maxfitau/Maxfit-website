/*
 * Shared by the two coach pages that split Max's people (2026-11-05):
 *   card/clients.html  "My clients"   (Client = Yes on the Sessions Remaining tab)
 *   card/members.html  "App members"  (everyone else)
 * Max decides who is a client; nothing here moves anyone automatically.
 *
 * Needs sheet.js, macros-core.js and macros-api.js loaded first. The staff PIN
 * is the same one check-in uses (remembered on this phone), because the plan,
 * goal and "asked to train" details come from private data.
 * Everything from the sheet is put on the page with textContent.
 */
const People = (function () {
  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbya8dm8g5eC4ldAbNYmMCccDCZ6K7encj_q4IzXtKMOpd007RMYhnR3_PJ2eL2gjVDQ/exec";
  const PIN_KEY = "maxfitStaffPin"; // shared with checkin.js, book-staff.js and the workout builder
  const MAX_SLUG = "maxfrench"; // Max's own card row isn't a person to coach
  const NUDGE_DAYS = 30;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const TIER_NAMES = { gold: "Gold", platinum: "Diamond", diamond: "Diamond" };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function today() {
    return MacroCore.sydneyDate();
  }

  function dayNumber(iso) {
    const p = String(iso).slice(0, 10).split("-").map(Number);
    return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000);
  }

  /** Whole days from iso to today (0 = today). NaN for a blank date. */
  function daysSince(iso) {
    return iso ? dayNumber(today()) - dayNumber(iso) : NaN;
  }

  /** "3 Nov" (and the year when it isn't this one). */
  function niceDate(iso) {
    if (!iso) return "";
    const p = String(iso).slice(0, 10).split("-").map(Number);
    return p[2] + " " + MONTHS[p[1] - 1] + (p[0] !== Number(today().slice(0, 4)) ? " " + p[0] : "");
  }

  /** "Today", "Yesterday", "5 days ago", then a plain date. */
  function ago(iso) {
    const n = daysSince(iso);
    if (!Number.isFinite(n)) return "";
    if (n <= 0) return "Today";
    if (n === 1) return "Yesterday";
    if (n < 14) return n + " days ago";
    return niceDate(iso);
  }

  /** "today, 8:42 am" / "yesterday, 6:10 pm" / "3 Nov, 8:42 am" from the log's "yyyy-MM-dd HH:mm". */
  function agoWithTime(stamp) {
    const m = String(stamp || "").match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})/);
    if (!m) return ago(String(stamp || "").slice(0, 10));
    const n = daysSince(m[1]);
    let h = Number(m[2]);
    const ampm = h >= 12 ? "pm" : "am";
    h = h % 12 || 12;
    const time = h + ":" + m[3] + " " + ampm;
    return (n <= 0 ? "today" : n === 1 ? "yesterday" : niceDate(m[1])) + ", " + time;
  }

  function latest(dates) {
    return dates.filter(Boolean).sort().pop() || "";
  }

  function planText(c, hasFuel) {
    const p = c && c.plan;
    if (!hasFuel || !p) return "Silver (free)";
    const tier = TIER_NAMES[p.tier];
    if (!tier || !p.access) return "Silver (free)";
    if (p.kind === "paid") return tier + " (paying)";
    if (p.kind === "comp") return tier + " (free from you)";
    if (p.kind === "trial") return tier + " (free trial)";
    return tier;
  }

  // --- Staff PIN ------------------------------------------------------------

  function getPin() {
    try { return localStorage.getItem(PIN_KEY) || ""; } catch (err) { return ""; }
  }
  function savePin(pin) {
    try { localStorage.setItem(PIN_KEY, pin); } catch (err) { /* asks again next time */ }
  }
  function forgetPin() {
    try { localStorage.removeItem(PIN_KEY); } catch (err) { /* nothing to forget */ }
  }

  /** Max's Apps Script (check-in project). */
  async function api(action, pin, fields) {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({ action: action, pin: pin }, fields || {})),
    });
    const data = await res.json();
    if (data.status === "unauthorized") {
      const err = new Error("Wrong PIN.");
      err.code = "bad_pin";
      throw err;
    }
    if (data.status !== "success") throw new Error(data.message || "That didn't work. Try again.");
    return data;
  }

  /** Builds the PIN form into `host`; resolves with the PIN once Max submits it. */
  function askPin(host, message) {
    return new Promise((resolve) => {
      host.textContent = "";
      const form = el("form", "people-pin");
      form.autocomplete = "off";
      form.appendChild(el("label", "card__label card__label--red", "Staff PIN"));
      const input = el("input", "picker__input");
      input.type = "password";
      input.inputMode = "numeric";
      input.autocomplete = "off";
      form.appendChild(input);
      if (message) form.appendChild(el("p", "clients__error", message));
      const go = el("button", "pbtn", "Open");
      go.type = "submit";
      form.appendChild(go);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const pin = input.value.trim();
        if (pin) resolve(pin);
      });
      host.appendChild(form);
    });
  }

  // --- Loading everyone -------------------------------------------------------

  function personFromRow(r, col) {
    const name = String(r[col.name]).trim();
    const text = (i) => (i >= 0 ? String(r[i] || "").trim() : "");
    const num = (i) => { const v = i >= 0 ? parseSessions(r[i], NaN) : NaN; return typeof v === "number" ? v : NaN; };
    return {
      name: name,
      slug: slugify(name),
      isClient: isClientRow(r, col),
      group: num(col.groupSessions),
      oneOnOne: num(col.oneOnOneSessions),
      duo: num(col.duoSessions),
      token: text(col.checkInToken),
      phone: text(col.phone).replace(/[^\d+]/g, ""),
      signupDate: parseSheetDate(text(col.signupDate)),
      lastAttended: parseSheetDate(text(col.lastAttended)),
      joinedVia: text(col.joinedVia),
      referredBy: text(col.referredBy),
      // Filled in from Fuel and the request log below.
      goal: null, goalText: "", plan: "Silver (free)", lastLog: "", lastSet: "", asked: null,
    };
  }

  /**
   * Everyone on the sheet (minus Max's own row), with plan and goal from Fuel and
   * "asked to train" from the request log. Returns { people, columns, notes }, or
   * throws an Error with code "bad_pin".
   */
  async function load(pin) {
    const [sheet, fuel, info] = await Promise.all([
      fetchSheet(),
      MacroApi.coach("coachList", pin).catch((e) => e),
      api("peopleInfo", pin).catch((e) => e),
    ]);
    if ((fuel && fuel.code === "bad_pin") || (info && info.code === "bad_pin")) {
      const err = new Error("Wrong PIN.");
      err.code = "bad_pin";
      throw err;
    }
    const col = sheet.col;
    const notes = [];
    const people = sheet.rows
      .filter((r) => String(r[col.name] || "").trim() && slugify(r[col.name]) !== MAX_SLUG)
      .map((r) => personFromRow(r, col))
      .sort((a, b) => a.name.localeCompare(b.name));
    const bySlug = {};
    people.forEach((p) => { bySlug[p.slug] = p; });

    if (fuel instanceof Error) {
      notes.push("Plans and goals didn't load. Check your signal and reopen.");
    } else {
      (fuel.clients || []).forEach((c) => {
        const p = bySlug[c.slug];
        if (!p) return;
        p.plan = planText(c, !!c.hasKey);
        p.lastLog = String(c.lastLog || "").slice(0, 10);
        const g = c.goal;
        if (g && g.end_date && g.end_date >= today()) {
          p.goal = g;
          p.goalText = MacroCore.goalSentence(g);
        }
      });
    }
    if (info instanceof Error) {
      notes.push("Who asked to train didn't load. Check your signal and reopen.");
    } else {
      Object.keys(info.requests || {}).forEach((slug) => {
        if (bySlug[slug]) bySlug[slug].asked = info.requests[slug];
      });
    }
    return { people: people, columns: col, notes: notes, hasClientColumn: col.client >= 0 };
  }

  /** The latest workout set each person logged, for "last active". Lazy: the page is already showing. */
  async function loadLastSets(people) {
    const { rows, col } = await fetchLoggedSets();
    const by = {};
    rows.forEach((r) => {
      const d = parseSheetDate(String(r[col.date] || "").trim());
      const s = String(r[col.client] || "").trim().toLowerCase();
      if (d && (!by[s] || d > by[s])) by[s] = d;
    });
    people.forEach((p) => { p.lastSet = by[p.slug] || ""; });
  }

  function lastActive(p) {
    return latest([p.lastLog, p.lastSet, p.lastAttended]);
  }

  /** Why the page can't tell clients from app members yet. */
  function needsSetupNote() {
    const box = el("div", "pcard");
    box.appendChild(el("h2", "pcard__name", "One step first"));
    box.appendChild(el("p", "clients__meta", "The Client column isn't on your Sheet yet. In the Apps Script editor, run setupClientStatus once, then reopen this page."));
    return box;
  }

  // --- Small page pieces ------------------------------------------------------

  /** My clients | App members switch, with a count of requests waiting. */
  function switcher(active, askedCount) {
    const nav = el("nav", "people-switch");
    nav.setAttribute("aria-label", "People");
    const mine = el("a", active === "clients" ? "on" : "", "My clients");
    mine.href = "clients.html";
    const apps = el("a", active === "members" ? "on" : "", "App members ");
    apps.href = "members.html";
    if (askedCount > 0) apps.appendChild(el("span", "badge", String(askedCount)));
    nav.appendChild(mine);
    nav.appendChild(apps);
    return nav;
  }

  /** A label above a value, as a <dl> group item. */
  function fact(label, value, wide) {
    const d = el("div", wide ? "wide" : "");
    d.appendChild(el("dt", "", label));
    d.appendChild(el("dd", "", value));
    return d;
  }

  function button(label, kind, onClick) {
    const b = el("button", "pbtn" + (kind ? " pbtn--" + kind : ""), label);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  function linkButton(label, href, kind) {
    const a = el("a", "pbtn" + (kind ? " pbtn--" + kind : ""), label);
    a.href = href;
    return a;
  }

  /**
   * An in-page "Are you sure?" (never a browser pop-up), added to `host`.
   * onYes() returns a promise; on failure the message shows and Max can retry.
   */
  function confirmSheet(host, o) {
    const old = host.querySelector(".sheetmock");
    if (old) old.remove();
    const box = el("div", "sheetmock");
    box.setAttribute("role", "alertdialog");
    box.appendChild(el("h3", "", o.title));
    box.appendChild(el("p", "", o.text));
    const err = el("p", "clients__error");
    err.hidden = true;
    const yes = el("button", "pbtn", o.yesLabel);
    yes.type = "button";
    const no = el("button", "pbtn pbtn--ghost", "Cancel");
    no.type = "button";
    no.addEventListener("click", () => box.remove());
    yes.addEventListener("click", async () => {
      yes.disabled = no.disabled = true;
      yes.textContent = "Saving…";
      err.hidden = true;
      try {
        await o.onYes();
      } catch (e) {
        err.textContent = e.message || "That didn't work. Try again.";
        err.hidden = false;
        yes.disabled = no.disabled = false;
        yes.textContent = o.yesLabel;
      }
    });
    box.appendChild(err);
    box.appendChild(yes);
    box.appendChild(no);
    host.appendChild(box);
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  /** Sets Client = Yes or No on the Sheet (needs the PIN). */
  function setClient(pin, person, isClient) {
    return api("setClientStatus", pin, { slug: person.slug, client: isClient });
  }

  /** The page's PIN flow: remembered PIN, else a form; calls start(pin, data) once loaded. */
  async function open(host, status, start) {
    let pin = getPin();
    let message = "";
    for (;;) {
      if (!pin) pin = await askPin(host, message);
      host.textContent = "";
      status.textContent = "Loading…";
      try {
        const data = await load(pin);
        savePin(pin);
        status.textContent = "";
        start(pin, data);
        loadLastSets(data.people).then(() => start(pin, data, true)).catch(() => {});
        return;
      } catch (e) {
        if (e.code === "bad_pin") {
          forgetPin();
          pin = "";
          message = "Wrong PIN.";
          status.textContent = "";
          continue;
        }
        status.textContent = "Couldn't load. Check your signal and try again.";
        return;
      }
    }
  }

  return { el, today, daysSince, niceDate, ago, agoWithTime, lastActive, fact, button, linkButton, confirmSheet, setClient, switcher, needsSetupNote, open, NUDGE_DAYS };
})();
