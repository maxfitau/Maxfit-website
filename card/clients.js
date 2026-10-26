/*
 * Clients (coach's phone): pick a client from a list, then the workout to log for them.
 * No personal link needed: the list comes from the same public sheet the check-in page
 * reads, and the workout opens the normal logger in coach mode (?coach=1), which comes
 * back to this page when it's done. Everything is put on the page with textContent.
 */
(function () {
  const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const $ = (id) => document.getElementById(id);
  const els = {
    listView: $("listView"), detailView: $("detailView"), search: $("clientSearch"),
    listStatus: $("listStatus"), list: $("clientList"), change: $("changeClient"),
    name: $("detailName"), meta: $("detailMeta"), workouts: $("workoutList"),
    workoutStatus: $("workoutStatus"), actions: $("actionList"),
  };
  let clients = [];
  let sheetCol = null;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function sessionsText(c) {
    const part = (label, v) => (Number.isFinite(v) ? `${label} ${v}` : null);
    return [part("Group", c.group), part("1-on-1", c.oneOnOne)].filter(Boolean).join(" · ") || "No sessions tracked";
  }

  function renderList() {
    const q = els.search.value.trim().toLowerCase();
    els.list.textContent = "";
    const shown = clients.filter((c) => !q || c.name.toLowerCase().includes(q));
    els.listStatus.textContent = shown.length ? "" : clients.length ? "No one matches that." : "";
    shown.forEach((c) => {
      const row = el("button", "clients__row");
      row.type = "button";
      row.appendChild(el("b", "", c.name));
      row.appendChild(el("small", "", sessionsText(c)));
      row.addEventListener("click", () => openClient(c));
      els.list.appendChild(row);
    });
  }

  /** This client's workouts in builder order, with the one scheduled for today first (same rule as check-in and the card). */
  async function loadWorkouts(slug) {
    const { rows, col } = await fetchWorkoutExercises();
    const groups = new Map();
    for (const r of rows) {
      if (String(r[col.client] || "").trim().toLowerCase() !== slug) continue;
      if (!(r[col.exercise] || "").trim() || parseSessions(r[col.sets], 0) <= 0) continue;
      const name = (col.workoutName >= 0 ? String(r[col.workoutName] || "").trim() : "") || "Today's Workout";
      if (!groups.has(name)) groups.set(name, { name, count: 0, order: NaN, days: new Set() });
      const g = groups.get(name);
      g.count++;
      if (!Number.isFinite(g.order) && col.workoutOrder >= 0) g.order = Number(r[col.workoutOrder]);
      if (col.days >= 0) String(r[col.days] || "").split(",").map((d) => d.trim()).filter(Boolean).forEach((d) => g.days.add(d));
    }
    const UNORDERED = Number.MAX_SAFE_INTEGER;
    const list = Array.from(groups.values()).sort((a, b) => (Number.isFinite(a.order) ? a.order : UNORDERED) - (Number.isFinite(b.order) ? b.order : UNORDERED));
    const today = DAY_ABBR[new Date().getDay()];
    const scheduled = list.filter((g) => g.days.has(today));
    const todayGroup = scheduled.length === 1 ? scheduled[0] : null;
    if (todayGroup) { list.splice(list.indexOf(todayGroup), 1); list.unshift(todayGroup); }
    return { list, todayName: todayGroup ? todayGroup.name : "" };
  }

  function actionRow(label, hint, href) {
    const a = el("a", "coach-links__row");
    a.href = href;
    const text = el("span", "coach-links__text");
    text.appendChild(el("b", "", label));
    text.appendChild(el("small", "", hint));
    a.appendChild(text);
    a.appendChild(el("span", "coach-links__chevron", "›"));
    els.actions.appendChild(a);
  }

  async function openClient(c) {
    history.replaceState(null, "", "?c=" + encodeURIComponent(c.slug));
    els.listView.hidden = true;
    els.detailView.hidden = false;
    window.scrollTo(0, 0);
    els.name.textContent = c.name;
    els.meta.textContent = sessionsText(c);
    els.workouts.textContent = "";
    els.actions.textContent = "";
    els.workoutStatus.textContent = "Loading their workouts…";

    const back = window.location.origin + window.location.pathname + "?c=" + encodeURIComponent(c.slug);
    if (c.token) actionRow("Check in", "Count today's session, no QR scan needed", "../checkin.html?token=" + encodeURIComponent(c.token));
    actionRow("Strength progress", "Their best lifts over time", "../workout/progress.html?id=" + encodeURIComponent(c.slug));
    actionRow("Book them in", "Create a booking for them", "book-staff.html");

    try {
      const { list, todayName } = await loadWorkouts(c.slug);
      els.workoutStatus.textContent = "";
      if (!list.length) {
        els.workoutStatus.textContent = "No workout assigned yet. Use the workout builder to make one.";
        return;
      }
      list.forEach((g) => {
        const isToday = g.name === todayName;
        const a = el("a", "clients__workout" + (isToday ? " clients__workout--today" : ""));
        a.href = "../workout/?" + new URLSearchParams({ id: c.slug, workout: g.name, coach: "1", name: c.name, back }).toString();
        a.appendChild(el("b", "", g.name));
        a.appendChild(el("span", "", isToday ? "Today" : `${g.count} exercise${g.count === 1 ? "" : "s"}`));
        els.workouts.appendChild(a);
      });
    } catch (err) {
      els.workoutStatus.textContent = "Couldn't load their workouts. Check your signal and try again.";
    }
  }

  els.change.addEventListener("click", () => {
    history.replaceState(null, "", window.location.pathname);
    els.detailView.hidden = true;
    els.listView.hidden = false;
  });
  els.search.addEventListener("input", renderList);

  (async function init() {
    try {
      const sheet = await fetchSheet();
      sheetCol = sheet.col;
      clients = sheet.rows
        .filter((r) => String(r[sheetCol.name] || "").trim())
        .map((r) => {
          const name = String(r[sheetCol.name]).trim();
          const num = (i) => { const v = i >= 0 ? parseSessions(r[i], NaN) : NaN; return typeof v === "number" ? v : NaN; };
          return { name, slug: slugify(name), group: num(sheetCol.groupSessions), oneOnOne: num(sheetCol.oneOnOneSessions), token: sheetCol.checkInToken >= 0 ? String(r[sheetCol.checkInToken] || "").trim() : "" };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      els.listStatus.textContent = clients.length ? "" : "No clients found.";
      renderList();
      const wanted = new URLSearchParams(window.location.search).get("c");
      const match = wanted && clients.find((c) => c.slug === wanted);
      if (match) openClient(match);
    } catch (err) {
      els.listStatus.textContent = "Couldn't load clients. Check your signal and try again.";
    }
  })();
})();
