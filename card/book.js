/*
 * Book a 1-on-1 session — opened from the membership card (card/index.html ->
 * book.html?id=<slug>). Same identity as the rest of the card: ?id= in the URL,
 * falling back to whatever the card last saved in localStorage.
 *
 * Every time on offer, every rule (notice, cancelling, sessions left) and every
 * booking comes from the Apps Script backend. This page never reads the private
 * booking sheet and never decides anything itself: it shows what the backend
 * offers and asks it to book or cancel.
 *
 * Who is asking: the first time on a phone the client types the personal
 * booking code Max texted them; it's saved here (localStorage) and sent with
 * every request. The public CRM sheet is only read for the client's Check-in
 * Token, which the backend uses if Max has switched codes off.
 *
 * All text goes onto the page with textContent, never innerHTML.
 */
(function () {
  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbya8dm8g5eC4ldAbNYmMCccDCZ6K7encj_q4IzXtKMOpd007RMYhnR3_PJ2eL2gjVDQ/exec";
  const MEMBER_ID_STORAGE_KEY = "maxfitMemberId"; // shared with card/app.js
  const CODE_STORAGE_KEY = "maxfitBookCode"; // { id, code }: the personal code, saved per phone
  const REQUEST_TIMEOUT_MS = 25000;
  const SAFE_LINK = /^(https:\/\/|sms:|tel:|mailto:)/i;

  const params = new URLSearchParams(window.location.search);
  let memberId = params.get("id");
  if (!memberId) {
    try {
      memberId = localStorage.getItem(MEMBER_ID_STORAGE_KEY);
    } catch (err) {
      // Ignore — memberId stays null, handled in init().
    }
  }

  const $ = (id) => document.getElementById(id);
  const els = {
    back: $("backLink"),
    loading: $("bookLoading"),
    notice: $("bookNotice"),
    noticeTitle: $("noticeTitle"),
    noticeText: $("noticeText"),
    noticeRetry: $("noticeRetry"),
    codeBox: $("bookCode"),
    codeForm: $("codeForm"),
    codeInput: $("codeInput"),
    codeSubmit: $("codeSubmit"),
    codeError: $("codeError"),
    content: $("bookContent"),
    intro: $("bookIntro"),
    mineSection: $("mineSection"),
    mineList: $("mineList"),
    message: $("bookMessage"),
    pickSection: $("pickSection"),
    dayGrid: $("dayGrid"),
    timesWrap: $("timesWrap"),
    timesLabel: $("timesLabel"),
    timesGrid: $("timesGrid"),
    confirmBox: $("confirmBox"),
    confirmWhen: $("confirmWhen"),
    confirmNote: $("confirmNote"),
    confirmBtn: $("confirmBtn"),
    confirmBack: $("confirmBack"),
    success: $("bookSuccess"),
    error: $("bookError"),
  };

  const state = {
    slug: "",
    name: "",
    token: "",
    code: "", // the personal booking code, once we have one
    typedCode: false, // whether the current code was typed just now (vs. saved earlier)
    contact: "", // how to message Max, from the backend (may be blank)
    screen: "loading", // loading | notice | code | content
    info: null, // the backend's last "bookingInfo" reply
    selectedDate: "",
    selectedStart: "",
    cancelingId: "", // the booking whose "Yes, cancel" is showing
    busy: false,
    flash: "", // the last thing that worked ("Booked. See you...")
    error: "", // the last thing that didn't
    retry: null,
  };

  // ---- Dates and times ----------------------------------------------------
  // The backend sends Sydney dates as "yyyy-MM-dd" and times as "HH:mm". They're
  // only ever formatted here, never converted between time zones.

  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MON_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const two = (n) => String(n).padStart(2, "0");

  function dateOf(key) {
    const p = key.split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  function keyOf(d) {
    return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate());
  }

  function addDays(key, n) {
    const d = dateOf(key);
    d.setDate(d.getDate() + n);
    return keyOf(d);
  }

  function dayLabel(key) {
    const d = dateOf(key);
    return DOW[d.getDay()] + " " + d.getDate() + " " + MON[d.getMonth()];
  }

  function dayLabelLong(key) {
    const d = dateOf(key);
    return DOW_LONG[d.getDay()] + " " + d.getDate() + " " + MON_LONG[d.getMonth()];
  }

  function clock(hhmm) {
    const p = hhmm.split(":").map(Number);
    return (p[0] % 12 || 12) + ":" + two(p[1]) + " " + (p[0] < 12 ? "AM" : "PM");
  }

  const timeRange = (b) => clock(b.start) + " – " + clock(b.end);
  const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");
  const hoursText = (h) => (Number.isInteger(h) ? String(h) : String(Math.round(h * 10) / 10)) + " hours";

  // ---- Small DOM helpers --------------------------------------------------

  function mk(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function button(className, text, onClick) {
    const b = mk("button", className, text);
    b.type = "button";
    b.disabled = state.busy;
    b.addEventListener("click", onClick);
    return b;
  }

  const show = (el, on) => {
    el.hidden = !on;
  };

  function scrollTo(el) {
    const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "nearest" });
  }

  // ---- The personal booking code ------------------------------------------

  const normalizeCode = (text) => String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  function readStoredCode() {
    try {
      const saved = JSON.parse(localStorage.getItem(CODE_STORAGE_KEY) || "null");
      return saved && saved.id === state.slug && typeof saved.code === "string" ? normalizeCode(saved.code) : "";
    } catch (err) {
      return "";
    }
  }

  function storeCode() {
    try {
      localStorage.setItem(CODE_STORAGE_KEY, JSON.stringify({ id: state.slug, code: state.code }));
    } catch (err) {
      // Storage unavailable — they'll be asked again next time.
    }
  }

  function forgetCode() {
    state.code = "";
    try {
      localStorage.removeItem(CODE_STORAGE_KEY);
    } catch (err) {
      // Nothing to forget.
    }
  }

  // ---- Messaging Max ------------------------------------------------------

  /** A "Message Max" link with the message already typed, or null if Max hasn't set a contact link. */
  function contactLink(text, message) {
    if (!state.contact || !SAFE_LINK.test(state.contact)) return null;
    const a = mk("a", "book__link", text);
    a.href = state.contact.split("{message}").join(encodeURIComponent(message));
    a.rel = "noopener";
    return a;
  }

  const firstName = () => ((state.info && state.info.client.name) || state.name || "").split(" ")[0];

  // ---- Talking to the backend ---------------------------------------------

  async function api(action, fields) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(Object.assign({ action: action, clientSlug: state.slug, token: state.token, code: state.code }, fields || {})),
        signal: controller.signal,
      });
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /** Who is asking: the client's name and Check-in Token, from the public CRM sheet. */
  async function resolveMember() {
    const { rows, col } = await fetchSheet();
    const wanted = slugify(memberId);
    const match = rows.find((r) => r[col.name] && slugify(r[col.name]) === wanted);
    if (!match) return null;
    const rowToken = col.checkInToken >= 0 ? String(match[col.checkInToken] || "").trim() : "";
    // A member with no token yet is identified by their slug, as on the card.
    return { slug: wanted, name: String(match[col.name]).trim(), token: rowToken || wanted };
  }

  // ---- Screens ------------------------------------------------------------

  function showScreen(name) {
    state.screen = name;
    show(els.loading, name === "loading");
    show(els.notice, name === "notice");
    show(els.codeBox, name === "code");
    show(els.content, name === "content");
  }

  function showNotice(title, text, retry) {
    state.retry = retry || null;
    els.noticeTitle.textContent = title;
    els.noticeText.textContent = text;
    show(els.noticeRetry, Boolean(retry));
    showScreen("notice");
  }

  function showCodeForm(errorText) {
    showScreen("code");
    els.codeError.textContent = errorText || "";
    show(els.codeError, Boolean(errorText));
    els.codeInput.value = "";
    els.codeSubmit.disabled = false;
    setTimeout(() => els.codeInput.focus(), 60);
  }

  /** Handles a reply that means "we don't know who you are (any more)". Returns true if it took over the screen. */
  function takenOverByCodeScreen(res) {
    if (res.code === "code-required") {
      showCodeForm("");
    } else if (res.code === "bad-code") {
      const typed = state.typedCode;
      forgetCode();
      showCodeForm(typed ? res.message : "Your saved code doesn't work any more. Enter your current code, or ask Max for a new one.");
    } else if (res.code === "no-code") {
      showNotice("You need a booking code", res.message);
    } else if (res.code === "locked") {
      showNotice("Too many tries", res.message);
    } else {
      return false;
    }
    return true;
  }

  function renderAll() {
    if (state.screen !== "content" || !state.info) return;
    const info = state.info;
    renderIntro(info);
    renderMine(info);
    renderMessage(info);
    renderPicker(info);
    els.success.textContent = state.flash;
    show(els.success, Boolean(state.flash));
    els.error.textContent = state.error;
    show(els.error, Boolean(state.error));
  }

  function renderIntro(info) {
    const first = firstName();
    let line = "";
    if (info.client.unlimited) {
      line = first + ", you're on an unlimited plan.";
    } else if (info.client.sessionsLeft !== null) {
      const booked = info.bookings.length;
      line = first + ", you have " + plural(info.client.sessionsLeft, "session") + " left" + (booked ? " (" + booked + " already booked)." : ".");
    }
    els.intro.textContent = line;
  }

  function renderMine(info) {
    els.mineList.textContent = "";
    show(els.mineSection, info.bookings.length > 0);
    info.bookings.forEach((b) => {
      const row = mk("div", "book__mine-row");

      const when = mk("div", "book__mine-when");
      when.appendChild(mk("span", "book__mine-day", dayLabel(b.date)));
      when.appendChild(mk("span", "book__mine-time", timeRange(b) + " · " + b.minutes + " min"));
      if (!b.canCancel) {
        when.appendChild(mk("span", "book__mine-note", "Less than " + hoursText(info.policy.cancelHours) + " away. Message Max to change it."));
        const link = contactLink("Message Max", "Hi Max, it's " + firstName() + ". I need to change my session on " + dayLabel(b.date) + " at " + clock(b.start) + ".");
        if (link) when.appendChild(link);
      }
      row.appendChild(when);

      if (b.canCancel) {
        const side = mk("div", "book__mine-actions");
        if (state.cancelingId === b.id) {
          side.appendChild(button("book__btn book__btn--small", "Yes, cancel", () => cancelBooking(b.id)));
          side.appendChild(
            button("book__btn book__btn--ghost book__btn--small", "Keep it", () => {
              state.cancelingId = "";
              renderAll();
            })
          );
        } else {
          side.appendChild(
            button("book__btn book__btn--ghost book__btn--small", "Cancel", () => {
              state.cancelingId = b.id;
              state.flash = "";
              state.error = "";
              renderAll();
            })
          );
        }
        row.appendChild(side);
      }
      els.mineList.appendChild(row);
    });
  }

  function renderMessage(info) {
    let text = "";
    let ask = "";
    if (!info.client.canBook) {
      text = info.client.message;
      ask = info.client.reason === "no-sessions" ? "I'd like to top up my 1-on-1 sessions." : "I'd like to book another session.";
    } else if (!info.slots.length) {
      text = "No times are open right now. Check back soon, or message Max.";
      ask = "I'd like to book a 1-on-1 session but I can't see any times.";
    }
    els.message.textContent = text;
    if (text) {
      const link = contactLink("Message Max", "Hi Max, it's " + firstName() + ". " + ask);
      if (link) {
        els.message.appendChild(document.createTextNode(" "));
        els.message.appendChild(link);
      }
    }
    show(els.message, Boolean(text));
  }

  function renderPicker(info) {
    const slots = info.slots;
    const open = info.client.canBook && slots.length > 0;
    show(els.pickSection, open);
    if (!open) return;

    const byDate = new Map();
    slots.forEach((s) => {
      if (!byDate.has(s.date)) byDate.set(s.date, []);
      byDate.get(s.date).push(s);
    });
    if (!byDate.has(state.selectedDate)) {
      state.selectedDate = slots[0].date;
      state.selectedStart = "";
    }

    // A month-style grid from today to the last day with a time: days with
    // times are lit, the rest are dimmed.
    const first = info.today;
    const last = slots[slots.length - 1].date;
    els.dayGrid.textContent = "";
    for (let i = dateOf(first).getDay(); i > 0; i--) els.dayGrid.appendChild(mk("span"));
    for (let d = first, n = 0; d <= last && n < 400; d = addDays(d, 1), n++) {
      const times = byDate.get(d);
      const dt = dateOf(d);
      const b = mk("button", "book__day" + (times ? "" : " book__day--off") + (d === state.selectedDate ? " is-selected" : "") + (d === first ? " book__day--today" : ""));
      b.type = "button";
      b.disabled = !times || state.busy;
      if (d === first || dt.getDate() === 1) b.appendChild(mk("span", "book__day-month", MON[dt.getMonth()]));
      b.appendChild(mk("span", "book__day-num", String(dt.getDate())));
      b.setAttribute("aria-label", dayLabelLong(d) + (times ? ", " + plural(times.length, "time") + " available" : ", nothing available"));
      b.setAttribute("aria-pressed", d === state.selectedDate ? "true" : "false");
      if (times) b.addEventListener("click", () => selectDay(d));
      els.dayGrid.appendChild(b);
    }

    const times = byDate.get(state.selectedDate);
    show(els.timesWrap, true);
    els.timesLabel.textContent = "Times on " + dayLabel(state.selectedDate);
    els.timesGrid.textContent = "";
    times.forEach((s) => {
      const b = button("book__time" + (s.start === state.selectedStart ? " is-selected" : ""), clock(s.start), () => selectTime(s.start));
      b.setAttribute("aria-pressed", s.start === state.selectedStart ? "true" : "false");
      els.timesGrid.appendChild(b);
    });

    const chosen = times.filter((s) => s.start === state.selectedStart)[0];
    show(els.confirmBox, Boolean(chosen));
    if (chosen) {
      els.confirmWhen.textContent = dayLabel(chosen.date) + " · " + timeRange(chosen) + " (" + chosen.minutes + " min)";
      els.confirmNote.textContent = "Free to cancel up to " + hoursText(info.policy.cancelHours) + " before. Your session is used when you check in, not when you book.";
      els.confirmBtn.textContent = state.busy ? "Booking…" : "Confirm booking";
      els.confirmBtn.disabled = state.busy;
      els.confirmBack.disabled = state.busy;
    }
  }

  // ---- Actions ------------------------------------------------------------

  function selectDay(date) {
    state.selectedDate = date;
    state.selectedStart = "";
    state.cancelingId = "";
    state.flash = "";
    state.error = "";
    renderAll();
    scrollTo(els.timesWrap);
  }

  function selectTime(start) {
    state.selectedStart = start;
    state.cancelingId = "";
    state.flash = "";
    state.error = "";
    renderAll();
    scrollTo(els.confirmBox);
  }

  function setBusy(on) {
    state.busy = on;
    renderAll();
  }

  /** (Re)loads the times and the client's bookings. `quiet` keeps the page on screen instead of showing "Loading". */
  async function load(quiet) {
    if (!quiet) showScreen("loading");
    let res;
    try {
      res = await api("bookingInfo");
    } catch (err) {
      if (quiet) {
        state.error = "Couldn't refresh the times. Check your connection.";
        renderAll();
      } else {
        showNotice("Can't reach booking", "Check your connection and try again.", () => load(false));
      }
      return false;
    }
    if (res.status !== "success") {
      if (takenOverByCodeScreen(res)) return false;
      if (res.code === "not-set-up") showNotice("Booking isn't open yet", res.message);
      else if (res.code === "unknown-member") showNotice("We couldn't find you", res.message);
      else showNotice("Something went wrong", res.message || "Please try again in a moment.", () => load(false));
      return false;
    }
    state.info = res;
    state.contact = typeof res.contact === "string" ? res.contact : "";
    if (state.code) storeCode(); // it worked, so remember it on this phone
    state.typedCode = false;
    if (state.cancelingId && !res.bookings.some((b) => b.id === state.cancelingId)) state.cancelingId = "";
    showScreen("content");
    renderAll();
    return true;
  }

  async function confirmBooking() {
    if (state.busy || !state.selectedDate || !state.selectedStart) return;
    state.error = "";
    setBusy(true);
    let res;
    try {
      res = await api("bookSession", { date: state.selectedDate, start: state.selectedStart });
    } catch (err) {
      setBusy(false);
      state.error = "Couldn't reach the booking system. Check your connection, then tap Confirm again. You won't be booked twice.";
      renderAll();
      return;
    }
    if (res.status === "success") {
      const b = res.booking;
      state.flash = "Booked. See you " + dayLabel(b.date) + " at " + clock(b.start) + ".";
      state.selectedStart = "";
      state.busy = false;
      await load(true);
      return;
    }
    state.busy = false;
    if (takenOverByCodeScreen(res)) return;
    state.selectedStart = "";
    await load(true); // the list may have changed under them, so show what's really free now
    state.error = res.message || "That didn't work. Please try again.";
    renderAll();
  }

  async function cancelBooking(id) {
    if (state.busy) return;
    state.error = "";
    setBusy(true);
    let res;
    try {
      res = await api("cancelBooking", { id: id });
    } catch (err) {
      setBusy(false);
      state.error = "Couldn't reach the booking system. Check your connection and try again.";
      renderAll();
      return;
    }
    state.busy = false;
    state.cancelingId = "";
    if (res.status === "success") {
      state.flash = "Cancelled. That time is open again.";
      await load(true);
      return;
    }
    if (takenOverByCodeScreen(res)) return;
    await load(true);
    state.error = res.message || "That didn't work. Please try again.";
    renderAll();
  }

  els.confirmBtn.addEventListener("click", confirmBooking);
  els.confirmBack.addEventListener("click", () => {
    state.selectedStart = "";
    renderAll();
  });
  els.noticeRetry.addEventListener("click", () => {
    if (state.retry) state.retry();
  });
  els.codeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const typed = normalizeCode(els.codeInput.value);
    if (!typed) {
      els.codeError.textContent = "Type the code Max sent you.";
      show(els.codeError, true);
      return;
    }
    state.code = typed;
    state.typedCode = true;
    els.codeSubmit.disabled = true;
    await load(false);
    els.codeSubmit.disabled = false;
  });

  async function init() {
    if (!memberId) {
      showNotice("Open this from your card", "Booking works from your membership card. Open your card, then tap Book a session.");
      return;
    }
    els.back.href = "./?id=" + encodeURIComponent(memberId);

    let member;
    try {
      member = await resolveMember();
    } catch (err) {
      showNotice("Can't load your card", "Check your connection and try again.", init);
      return;
    }
    if (!member) {
      showNotice("We couldn't find you", "Open booking from your own membership card.");
      return;
    }
    state.slug = member.slug;
    state.name = member.name;
    state.token = member.token;
    state.code = readStoredCode();
    await load(false);
  }

  init();
})();
