/*
 * Book a Client In — Max creating a booking himself (card/index.html's Coach
 * Tools -> Book a Client In, his own card only). Same backend, same slot/
 * calendar-busy/eligibility rules as a client booking themselves on
 * card/book.html — the only difference is who's asking: a Staff PIN instead
 * of a personal booking code, and any client picked from a dropdown instead
 * of whoever the card link belongs to. The client still gets the exact same
 * confirmation email and calendar sync a self-made booking would trigger.
 *
 * All text goes onto the page with textContent, never innerHTML.
 */
(function () {
  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbya8dm8g5eC4ldAbNYmMCccDCZ6K7encj_q4IzXtKMOpd007RMYhnR3_PJ2eL2gjVDQ/exec";
  const STAFF_PIN_STORAGE_KEY = "maxfitStaffPin"; // shared with checkin.js / workout/builder.js
  const REQUEST_TIMEOUT_MS = 25000;

  const $ = (id) => document.getElementById(id);
  const els = {
    pinRow: $("pinRow"),
    pinInput: $("pinInput"),
    clientSelect: $("clientSelect"),
    loading: $("bookLoading"),
    content: $("bookContent"),
    message: $("bookMessage"),
    pickSection: $("pickSection"),
    dayGrid: $("dayGrid"),
    timesWrap: $("timesWrap"),
    timesLabel: $("timesLabel"),
    timesGrid: $("timesGrid"),
    confirmBox: $("confirmBox"),
    confirmWhen: $("confirmWhen"),
    locationBox: $("locationBox"),
    locationList: $("locationList"),
    locationError: $("locationError"),
    confirmBtn: $("confirmBtn"),
    confirmBack: $("confirmBack"),
    typeSection: $("typeSection"),
    typeSwitch: $("typeSwitch"),
    partnerBox: $("partnerBox"),
    partnerInput: $("partnerInput"),
    partnerError: $("partnerError"),
    partnerNames: $("partnerNames"),
    success: $("bookSuccess"),
    error: $("bookError"),
  };

  const state = {
    pin: "",
    clientSlug: "",
    clientName: "",
    info: null,
    selectedDate: "",
    selectedStart: "",
    location: "",
    type: "one-on-one",
    partner: "",
    busy: false,
    flash: "",
    error: "",
  };

  // ---- Dates and times (same formatting rules as card/book.js) ------------

  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
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
    return DOW[d.getDay()] + " " + d.getDate() + " " + MON[d.getMonth()];
  }
  function clock(hhmm) {
    const p = hhmm.split(":").map(Number);
    return (p[0] % 12 || 12) + ":" + two(p[1]) + " " + (p[0] < 12 ? "AM" : "PM");
  }
  const timeRange = (b) => clock(b.start) + " – " + clock(b.end);

  // ---- Small DOM helpers ----------------------------------------------------

  function mk(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  const show = (el, on) => {
    el.hidden = !on;
  };
  function scrollTo(el) {
    const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "nearest" });
  }

  function rememberPin(pin) {
    if (!pin) return;
    try {
      localStorage.setItem(STAFF_PIN_STORAGE_KEY, pin);
    } catch (err) {
      // Ignore — just asks again next time.
    }
  }
  function forgetPin() {
    try {
      localStorage.removeItem(STAFF_PIN_STORAGE_KEY);
    } catch (err) {
      // Nothing to forget.
    }
  }

  // ---- Talking to the backend -----------------------------------------------

  async function api(action, fields) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(Object.assign({ action: action, pin: state.pin, clientSlug: state.clientSlug }, fields || {})),
        signal: controller.signal,
      });
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadClientList() {
    try {
      const { rows, col } = await fetchSheet();
      const names = rows
        .map((r) => (col.name >= 0 ? String(r[col.name] || "").trim() : ""))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      els.clientSelect.innerHTML = '<option value="">Choose a client…</option>';
      els.partnerNames.textContent = "";
      for (const name of names) {
        const suggestion = document.createElement("option");
        suggestion.value = name;
        els.partnerNames.appendChild(suggestion);
        const option = document.createElement("option");
        option.value = slugify(name);
        option.textContent = name;
        els.clientSelect.appendChild(option);
      }
    } catch (err) {
      els.clientSelect.innerHTML = '<option value="">Couldn\'t load clients</option>';
    }
  }

  // ---- Rendering --------------------------------------------------------

  function renderAll() {
    els.message.textContent = "";
    show(els.message, false);
    const who = state.info ? (state.type === "duo" ? state.info.client.duo : state.info.client) : null;
    show(els.typeSection, Boolean(state.info));
    Array.from(els.typeSwitch.querySelectorAll("[data-type]")).forEach((b) => b.setAttribute("aria-pressed", b.dataset.type === state.type ? "true" : "false"));
    show(els.partnerBox, Boolean(state.info) && state.type === "duo");
    if (who && !who.canBook) {
      els.message.textContent = who.message || "This client can't book right now.";
      show(els.message, true);
    }

    show(els.pickSection, Boolean(who && who.canBook && state.info.slots.length));
    if (who && who.canBook) renderPicker(state.info);

    els.success.textContent = state.flash;
    show(els.success, Boolean(state.flash));
    els.error.textContent = state.error;
    show(els.error, Boolean(state.error));
  }

  function renderPicker(info) {
    const slots = info.slots;
    const byDate = new Map();
    slots.forEach((s) => {
      if (!byDate.has(s.date)) byDate.set(s.date, []);
      byDate.get(s.date).push(s);
    });
    if (!byDate.has(state.selectedDate)) {
      state.selectedDate = slots[0].date;
      state.selectedStart = "";
    }

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
      b.setAttribute("aria-label", dayLabelLong(d) + (times ? ", " + times.length + " times available" : ", nothing available"));
      b.setAttribute("aria-pressed", d === state.selectedDate ? "true" : "false");
      if (times) b.addEventListener("click", () => selectDay(d));
      els.dayGrid.appendChild(b);
    }

    const times = byDate.get(state.selectedDate);
    show(els.timesWrap, true);
    els.timesLabel.textContent = "Times on " + dayLabel(state.selectedDate);
    els.timesGrid.textContent = "";
    times.forEach((s) => {
      const b = mk("button", "book__time" + (s.start === state.selectedStart ? " is-selected" : ""), clock(s.start));
      b.type = "button";
      b.disabled = state.busy;
      b.setAttribute("aria-pressed", s.start === state.selectedStart ? "true" : "false");
      b.addEventListener("click", () => selectTime(s.start));
      els.timesGrid.appendChild(b);
    });

    const chosen = times.filter((s) => s.start === state.selectedStart)[0];
    show(els.confirmBox, Boolean(chosen));
    if (chosen) {
      els.confirmWhen.textContent = state.clientName + " · " + dayLabel(chosen.date) + " · " + timeRange(chosen) + " (" + chosen.minutes + " min)";

      const locations = info.locations || [];
      show(els.locationBox, locations.length > 0);
      if (locations.length > 0) {
        if (!locations.some((l) => l.name === state.location)) {
          state.location = locations.length === 1 ? locations[0].name : "";
        }
        els.locationList.textContent = "";
        locations.forEach((loc) => {
          const opt = mk("button", "book__location-opt" + (loc.name === state.location ? " is-selected" : ""));
          opt.type = "button";
          opt.disabled = state.busy;
          opt.appendChild(mk("b", "", loc.name));
          if (loc.address) opt.appendChild(mk("span", "", loc.address));
          opt.setAttribute("aria-pressed", loc.name === state.location ? "true" : "false");
          opt.addEventListener("click", () => selectLocation(loc.name));
          els.locationList.appendChild(opt);
        });
      }

      els.confirmBtn.textContent = state.busy ? "Booking…" : "Book it in";
      els.confirmBtn.disabled = state.busy;
      els.confirmBack.disabled = state.busy;
    }
  }

  // ---- Actions ----------------------------------------------------------

  function selectDay(date) {
    state.selectedDate = date;
    state.selectedStart = "";
    state.flash = "";
    state.error = "";
    renderAll();
    scrollTo(els.timesWrap);
  }
  function selectTime(start) {
    state.selectedStart = start;
    state.flash = "";
    state.error = "";
    renderAll();
    scrollTo(els.confirmBox);
  }
  function selectLocation(name) {
    state.location = name;
    showLocationError("");
    renderAll();
  }
  function showLocationError(text) {
    els.locationError.textContent = text;
    show(els.locationError, Boolean(text));
  }
  function setBusy(on) {
    state.busy = on;
    renderAll();
  }

  /** Reloads this client's slots/eligibility. Clears the picked day/time, since they're for whoever was chosen before. */
  async function loadForClient() {
    state.info = null;
    state.selectedDate = "";
    state.selectedStart = "";
    state.location = "";
    state.flash = "";
    state.error = "";
    if (!state.pin || !state.clientSlug) {
      show(els.content, false);
      renderAll();
      return;
    }
    show(els.loading, true);
    show(els.content, false);
    let res;
    try {
      res = await api("coachBookingInfo");
    } catch (err) {
      show(els.loading, false);
      state.error = "Couldn't reach the booking system. Check your connection.";
      show(els.content, true);
      renderAll();
      return;
    }
    show(els.loading, false);
    show(els.content, true);
    if (res.status !== "success") {
      if (res.code === "bad-pin") {
        forgetPin();
        els.pinRow.hidden = false;
        els.pinInput.value = "";
        els.pinInput.focus();
      }
      state.error = res.message || "Something went wrong. Please try again.";
      renderAll();
      return;
    }
    rememberPin(state.pin);
    els.pinRow.hidden = true;
    state.info = res;
    renderAll();
  }

  async function confirmBooking() {
    if (state.busy || !state.selectedDate || !state.selectedStart) return;
    state.error = "";

    const locations = (state.info && state.info.locations) || [];
    if (locations.length > 0 && !locations.some((l) => l.name === state.location)) {
      showLocationError("Pick where you'll meet.");
      scrollTo(els.locationBox);
      return;
    }
    showLocationError("");

    setBusy(true);
    let res;
    try {
      const fields = { date: state.selectedDate, start: state.selectedStart, location: state.location };
      if (state.type === "duo") {
        fields.type = "duo";
        fields.partner = state.partner.trim();
      }
      res = await api("coachBookSession", fields);
    } catch (err) {
      setBusy(false);
      state.error = "Couldn't reach the booking system. Check your connection, then try again. They won't be booked twice.";
      renderAll();
      return;
    }
    state.busy = false;
    if (res.status === "success") {
      const b = res.booking;
      const successMsg = "Booked " + state.clientName + (b.type === "duo" && b.partner ? " and " + b.partner + " (duo)" : "") + " for " + dayLabel(b.date) + " at " + clock(b.start) + "." + (res.emailedTo ? " A confirmation is on its way to " + res.emailedTo + "." : "");
      state.selectedStart = "";
      await loadForClient(); // resets state.flash internally, so it's restored below rather than passed in
      state.flash = successMsg;
      renderAll();
      return;
    }
    if (res.code === "bad-pin") {
      forgetPin();
      els.pinRow.hidden = false;
      els.pinInput.value = "";
      els.pinInput.focus();
    }
    state.selectedStart = "";
    await loadForClient();
    state.error = res.message || "That didn't work. Please try again.";
    renderAll();
  }

  // ---- Wiring -------------------------------------------------------------

  els.confirmBtn.addEventListener("click", confirmBooking);
  els.confirmBack.addEventListener("click", () => {
    state.selectedStart = "";
    state.flash = "";
    state.error = "";
    renderAll();
  });

  els.pinInput.addEventListener("input", () => {
    state.pin = els.pinInput.value.trim();
  });
  els.pinInput.addEventListener("blur", () => {
    if (state.pin) loadForClient();
  });
  els.pinInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      state.pin = els.pinInput.value.trim();
      loadForClient();
    }
  });

  els.typeSwitch.addEventListener("click", (event) => {
    const b = event.target.closest("[data-type]");
    if (!b || state.busy || b.dataset.type === state.type) return;
    state.type = b.dataset.type;
    state.selectedStart = "";
    state.error = "";
    renderAll();
  });
  els.partnerInput.addEventListener("input", () => {
    state.partner = els.partnerInput.value;
    els.partnerError.hidden = true;
  });

  els.clientSelect.addEventListener("change", () => {
    state.clientSlug = els.clientSelect.value;
    state.clientName = state.clientSlug ? els.clientSelect.options[els.clientSelect.selectedIndex].textContent : "";
    loadForClient();
  });

  (function init() {
    let rememberedPin = "";
    try {
      rememberedPin = localStorage.getItem(STAFF_PIN_STORAGE_KEY) || "";
    } catch (err) {
      // Ignore — the PIN row just shows as normal.
    }
    if (rememberedPin) {
      state.pin = rememberedPin;
      els.pinRow.hidden = true;
    }
    loadClientList();
  })();
})();
