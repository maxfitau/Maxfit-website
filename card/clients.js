/*
 * My clients (coach's phone, card/clients.html): the people Max trains in person
 * (Client = Yes on the Sessions Remaining tab; see card/people.js). Each shows
 * sessions left, last check-in and this month's goal, with a nudge after 30 days
 * without a check-in. Log workout opens that client's workouts to log for them
 * (the normal logger in coach mode, ?coach=1, which comes back here), and
 * "Move to app members" is a button with its own in-page "Are you sure?".
 * Everything is put on the page with textContent.
 */
(function () {
  const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const $ = (id) => document.getElementById(id);
  const els = {
    gate: $("gate"), pageStatus: $("pageStatus"), listView: $("listView"), detailView: $("detailView"),
    switchHost: $("switchHost"), listStatus: $("listStatus"), list: $("clientList"), change: $("changeClient"),
    name: $("detailName"), nudge: $("detailNudge"), meta: $("detailMeta"), workouts: $("workoutList"),
    workoutStatus: $("workoutStatus"), actions: $("actionList"), move: $("detailMove"),
  };
  const el = People.el;
  let pin = "";
  let data = null;

  function sessionsText(c) {
    const part = (label, v) => (Number.isFinite(v) ? `${label} ${v}` : null);
    return [part("Group", c.group), part("1-on-1", c.oneOnOne), c.duo > 0 ? part("Duo", c.duo) : null].filter(Boolean).join(" · ") || "No sessions tracked";
  }

  /** True when there's been no check-in for 30 days (or none at all since they joined 30+ days ago). */
  function needsNudge(c) {
    const since = People.daysSince(c.lastAttended || c.signupDate);
    return Number.isFinite(since) && since >= People.NUDGE_DAYS;
  }

  const NUDGE_TEXT = "Hasn't trained with you in 30 days";

  function lastCheckIn(c) {
    return c.lastAttended ? People.ago(c.lastAttended) : "No check-in yet";
  }

  function clientsNow() {
    return data.people.filter((p) => p.isClient);
  }

  function renderSwitch() {
    els.switchHost.textContent = "";
    els.switchHost.appendChild(People.switcher("clients", data.people.filter((p) => !p.isClient && p.asked).length));
  }

  function renderList() {
    renderSwitch();
    els.list.textContent = "";
    els.listStatus.textContent = "";
    if (!data.hasClientColumn) {
      els.list.appendChild(People.needsSetupNote());
      return;
    }
    const clients = clientsNow();
    if (!clients.length) {
      els.listStatus.textContent = "No clients yet. Make someone a client from App members.";
      return;
    }
    clients.forEach((c) => {
      const card = el("div", "pcard");
      card.appendChild(el("h2", "pcard__name", c.name));
      if (needsNudge(c)) card.appendChild(el("p", "pcard__nudge", NUDGE_TEXT));
      const facts = el("dl", "pfacts");
      facts.appendChild(People.fact("Sessions left", sessionsText(c)));
      facts.appendChild(People.fact("Last check-in", lastCheckIn(c)));
      facts.appendChild(People.fact("This month's goal", c.goalText || "No goal set this month", true));
      card.appendChild(facts);
      const row = el("div", "prow");
      row.appendChild(People.button("Log workout", "", () => openClient(c)));
      row.appendChild(People.linkButton("Open card", "./?id=" + encodeURIComponent(c.slug), "ghost"));
      card.appendChild(row);
      els.list.appendChild(card);
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
    els.nudge.hidden = !needsNudge(c);
    els.nudge.textContent = NUDGE_TEXT;
    els.meta.textContent = `${sessionsText(c)} · Last check-in: ${lastCheckIn(c)}`;
    els.workouts.textContent = "";
    els.actions.textContent = "";
    els.move.textContent = "";
    els.workoutStatus.textContent = "Loading their workouts…";

    const back = window.location.origin + window.location.pathname + "?c=" + encodeURIComponent(c.slug);
    if (c.token) actionRow("Check in", "Count today's session, no QR scan needed", "../checkin.html?token=" + encodeURIComponent(c.token));
    actionRow("Strength progress", "Their best lifts over time", "../workout/progress.html?id=" + encodeURIComponent(c.slug));
    actionRow("Book them in", "Create a booking for them", "book-staff.html");
    actionRow("Open their card", "See what they see", "./?id=" + encodeURIComponent(c.slug));

    const moveHost = els.move;
    moveHost.appendChild(People.button("Move to app members", "ghost", () => {
      const first = c.name.split(" ")[0];
      People.confirmSheet(moveHost, {
        title: `Move ${first} to app members?`,
        text: `${first} will leave My clients and show under App members. Their sessions, workouts and history stay exactly as they are, and you can move them back any time.`,
        yesLabel: "Yes, move to app members",
        onYes: async () => {
          await People.setClient(pin, c, false);
          c.isClient = false;
          showList(`${first} is now an app member. Find them under App members.`);
        },
      });
    }));

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

  function showList(message) {
    history.replaceState(null, "", window.location.pathname);
    els.detailView.hidden = true;
    els.listView.hidden = false;
    renderList();
    if (message) els.listStatus.textContent = message;
    window.scrollTo(0, 0);
  }

  els.change.addEventListener("click", () => showList());

  People.open(els.gate, els.pageStatus, (thePin, loaded, again) => {
    pin = thePin;
    data = loaded;
    if (again && els.listView.hidden) return; // a detail is open; leave it alone
    els.listView.hidden = false;
    const wasMessage = again ? els.listStatus.textContent : "";
    renderList();
    if (wasMessage) els.listStatus.textContent = wasMessage;
    data.notes.forEach((n) => { if (!again) els.listStatus.textContent = els.listStatus.textContent || n; });
    const wanted = new URLSearchParams(window.location.search).get("c");
    const match = !again && wanted && clientsNow().find((c) => c.slug === wanted);
    if (match) openClient(match);
  });
})();
