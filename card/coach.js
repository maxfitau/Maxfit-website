/*
 * MaxFit coach view for the macro tracker (card/coach.html).
 *
 * PIN-gated with the same STAFF_PIN as check-in. The PIN is kept in
 * sessionStorage only, so it's forgotten when the tab closes. From here
 * Max can:
 *   - issue a client's personal Fuel link (id + secret key) to text them
 *   - see each client's own targets (clients set them in Fuel since
 *     2026-10-29, scope of practice; Max no longer sets them)
 *   - run the Food Q&A safety test (20 out-of-bounds questions)
 *   - see each client's plan (Silver / Gold / Diamond: trial, paying or
 *     free month), give a free week or month of Gold or Diamond, and ask the
 *     backend to check Stripe now
 *   - log a client's weight after a session, set their goal weight and
 *     pace, and see this week's green days and their nutrition punches
 */
(function () {
  const body = document.getElementById("coachBody");
  const toastEl = document.getElementById("fuelToast");
  const PIN_STORAGE = "maxfitCoachPin";
  let pin = "";
  let clients = [];
  // Every client's logged sets, for strength and training goals (null until loaded).
  let setsBySlug = null;
  let aiEnabled = true;
  let stripeReady = false;
  let lastStripeSync = "";
  const open = {}; // slug -> which inline form is showing

  try {
    pin = sessionStorage.getItem(PIN_STORAGE) || "";
  } catch (err) {
    pin = "";
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function int(n) {
    return Math.round(Number(n) || 0).toLocaleString("en-AU");
  }

  let toastTimer;
  function toast(message) {
    clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.hidden = false;
    toastEl.style.whiteSpace = "normal";
    toastEl.style.textTransform = "none";
    toastTimer = setTimeout(() => (toastEl.hidden = true), 4000);
  }

  function renderPin(error) {
    body.innerHTML = `
      <form class="coach-form" id="pinForm" autocomplete="off">
        <span class="card__label card__label--red">Staff PIN</span>
        <input class="fuel-input" name="pin" type="password" inputmode="numeric" autocomplete="off" />
        ${error ? `<p class="fuel-error">${esc(error)}</p>` : ""}
        <button class="fuel-btn" type="submit">Open</button>
      </form>`;
    document.getElementById("pinForm").addEventListener("submit", (e) => {
      e.preventDefault();
      pin = e.target.pin.value.trim();
      load();
    });
  }

  async function load() {
    if (!MacroApi.configured()) {
      body.innerHTML = '<p class="fuel-error">Paste the Macros web app URL into card/macros-api.js first.</p>';
      return;
    }
    if (!pin) return renderPin();
    body.innerHTML = '<div class="fuel-loading"><div class="fuel-spinner"></div><span class="fuel-loading__text">Loading clients</span></div>';
    try {
      const data = await MacroApi.coach("coachList", pin);
      try {
        sessionStorage.setItem(PIN_STORAGE, pin);
      } catch (err) {
        // ignore
      }
      clients = data.clients;
      aiEnabled = data.aiEnabled !== false;
      stripeReady = !!data.stripeReady;
      lastStripeSync = data.lastStripeSync || "";
      render();
      loadGoalSets();
    } catch (err) {
      if (err.code === "bad_pin") {
        pin = "";
        try {
          sessionStorage.removeItem(PIN_STORAGE);
        } catch (e) {
          // ignore
        }
        renderPin("Wrong PIN.");
      } else {
        body.innerHTML = `<p class="fuel-error">${esc(err.message)}</p>`;
      }
    }
  }

  function targetsText(c) {
    const t = c.targets;
    if (!t) return "No targets yet (they set their own in Fuel)";
    // Clients set their own targets since 2026-10-29 (scope of practice).
    // Older ones came from you or the old calculator and are theirs to change.
    return `Their own targets: ${int(t.kcal)} kcal · ${int(t.protein_g)}P · ${int(t.carbs_g)}C · ${int(t.fat_g)}F${t.set_by === "client" ? "" : " (from before 29 Oct)"}`;
  }

  function sexSeg(slug, current) {
    return `<div class="fuel-seg" data-sex="${esc(slug)}">
      <button type="button" data-v="F" class="${current === "F" ? "is-on" : ""}">Female</button>
      <button type="button" data-v="M" class="${current === "M" ? "is-on" : ""}">Male</button>
    </div>`;
  }

  function clientHtml(c) {
    const form = open[c.slug];
    const t = c.targets || {};
    return `
      <div class="fuel-panel coach-client" data-slug="${esc(c.slug)}">
        <div class="coach-client__head">
          <span class="coach-client__name">${esc(c.name)}</span>
          <span class="coach-client__meta">${c.lastLog ? `Last log ${esc(c.lastLog)}` : "Never logged"}</span>
        </div>
        <span class="coach-client__meta">${esc(targetsText(c))}</span>
        ${c.hasKey && aiEnabled ? `<span class="coach-client__meta">${esc(planText(c.plan))}</span>` : ""}
        ${c.hasKey ? `<span class="coach-client__meta">${esc(progressText(c))}</span>` : ""}
        ${goalHtml(c)}
        ${c.link ? `<div class="coach-link">${esc(c.link)}</div>` : ""}
        <div class="coach-actions">
          ${c.link ? '<button class="fuel-btn" type="button" data-a="copy">Copy link</button>' : '<button class="fuel-btn" type="button" data-a="issue">Create Fuel link</button>'}
          ${
            c.hasKey && aiEnabled
              ? [7, 30]
                  .map((d) => ["gold", "diamond"].map((t) => `<button class="fuel-btn fuel-btn--ghost" type="button" data-a="giveMonth" data-tier="${t}" data-days="${d}">Free ${d === 7 ? "week" : "month"} of ${TIER_NAMES[t]}</button>`).join(""))
                  .join("")
              : ""
          }
          ${c.hasKey ? '<button class="fuel-btn fuel-btn--ghost" type="button" data-a="weight">Log weight</button>' : ""}
          ${c.hasKey && c.targets ? '<button class="fuel-btn fuel-btn--ghost" type="button" data-a="goal">Set goal</button>' : ""}
          ${c.link ? '<button class="fuel-btn fuel-btn--ghost" type="button" data-a="rotate">New link</button>' : ""}
        </div>
        ${
          form === "weight"
            ? `<div class="coach-form">
                <div class="fuel-fields2">
                  <label class="fuel-field"><span class="card__label">Weight kg</span><input class="fuel-input" name="kg" type="number" inputmode="decimal" step="0.1" placeholder="${c.lastWeight ? esc(c.lastWeight.kg) : "e.g. 74.2"}" /></label>
                  <label class="fuel-field"><span class="card__label">Date</span><input class="fuel-input" name="date" type="date" value="${esc(MacroCore.sydneyDate())}" /></label>
                </div>
                <div class="coach-actions"><button class="fuel-btn" type="button" data-a="saveWeight">Save weight</button></div>
              </div>`
            : ""
        }
        ${
          form === "goal"
            ? `<div class="coach-form">
                <div class="fuel-fields2">
                  <label class="fuel-field"><span class="card__label">Goal weight kg</span><input class="fuel-input" name="goal_weight_kg" type="number" inputmode="decimal" step="0.1" value="${c.targets && c.targets.goal_weight_kg ? esc(c.targets.goal_weight_kg) : ""}" /></label>
                  <label class="fuel-field"><span class="card__label">Pace kg / week</span><input class="fuel-input" name="weekly_rate_kg" type="number" inputmode="decimal" step="0.05" value="${c.targets && c.targets.weekly_rate_kg ? esc(Math.abs(c.targets.weekly_rate_kg)) : ""}" placeholder="0.5" /></label>
                </div>
                <span class="coach-client__meta">Up or down follows the goal. Keep it under about 1% of their bodyweight a week.</span>
                <div class="coach-actions"><button class="fuel-btn" type="button" data-a="saveGoal">Save goal</button></div>
              </div>`
            : ""
        }
        ${
          form === "issue" || form === "rotate"
            ? `<div class="coach-form">
                <span class="coach-client__meta">${form === "rotate" ? "Their old link will stop working for Fuel." : "Pick their sex for the calorie floor, then create the link."}</span>
                ${sexSeg(c.slug, c.sex)}
                <button class="fuel-btn" type="button" data-a="confirmIssue">${form === "rotate" ? "Replace link" : "Create link"}</button>
              </div>`
            : ""
        }
      </div>`;
  }

  /** Strength and training goals are tracked from Logged Sets (the public CRM tab the workout pages read). */
  async function loadGoalSets() {
    if (setsBySlug || !clients.some((c) => c.goal && (c.goal.type === "strength" || c.goal.type === "sessions"))) return;
    try {
      const { rows, col } = await fetchLoggedSets();
      const by = {};
      rows.forEach((r) => {
        const p = String(r[col.date] || "").slice(0, 10).split("-").map(Number);
        if (p.length !== 3 || !p[0]) return;
        const date = `${p[0]}-${String(p[1]).padStart(2, "0")}-${String(p[2]).padStart(2, "0")}`;
        const slug = String(r[col.client] || "").trim().toLowerCase();
        (by[slug] = by[slug] || []).push({ date, exercise: String(r[col.exercise] || "").trim(), kg: Number(r[col.weight]) || 0, reps: Number(r[col.reps]) || 0 });
      });
      setsBySlug = by;
      render();
    } catch (err) {
      // Goals still show, just without progress for those two kinds.
    }
  }

  /** The client's goal as they wrote it, with how it's going (2026-10-13). */
  function goalHtml(c) {
    const g = c.goal;
    if (!g) return "";
    const fromSets = g.type === "strength" || g.type === "sessions";
    const p = fromSets && !setsBySlug ? null : MacroCore.goalProgress(
      g,
      { sets: (setsBySlug && setsBySlug[c.slug]) || [], weights: c.goalFuel ? c.goalFuel.weights : [], kcal: c.goalFuel ? c.goalFuel.kcal : null, greenWeeks: c.goalFuel ? c.goalFuel.greenWeeks : [] },
      MacroCore.sydneyDate()
    );
    return `
      <div class="coach-goal">
        <span class="coach-goal__label">🎯 Goal · ${esc(MacroCore.shortDate(g.start_date))} to ${esc(MacroCore.shortDate(g.end_date))}</span>
        <p class="coach-goal__text">${esc(MacroCore.goalSentence(g))}</p>
        <span class="coach-client__meta">${p ? esc(`${p.statusText} · ${p.pct}%`) : "Working out progress…"}</span>
      </div>`;
  }

  /** Weight, this week's green days and nutrition punches, in one line. */
  function progressText(c) {
    const bits = [];
    if (c.lastWeight) bits.push(`Weight ${c.lastWeight.kg} kg (${c.lastWeight.date.slice(8)}/${c.lastWeight.date.slice(5, 7)})`);
    if (c.greenThisWeek != null) bits.push(`${c.greenThisWeek}/7 green days this week`);
    if (c.punches) bits.push(`${c.punches} nutrition punch${c.punches === 1 ? "" : "es"}`);
    if (c.freeOwed) bits.push("free session earned");
    return bits.join(" · ") || "No weigh-ins or green days yet";
  }

  // "platinum" was retired on 10 Oct 2026; an old one on file is Diamond.
  const TIER_NAMES = { gold: "Gold", platinum: "Diamond", diamond: "Diamond" };

  /** A client's Fuel AI status in a few words. */
  function planText(p) {
    if (!p) return "";
    const date = (ymd) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) return "";
      const [y, m, d] = ymd.split("-").map(Number);
      const opts = { day: "numeric", month: "short", timeZone: "UTC" };
      if (y !== new Date().getFullYear()) opts.year = "numeric"; // yearly plans renew next year
      return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", opts);
    };
    const tier = TIER_NAMES[p.tier] || "Gold";
    const period = p.interval === "year" ? "paying yearly" : "paying monthly";
    if (p.kind === "paid") return `${tier}: ${period}${p.until ? ` · renews ${date(p.until)}` : ""}${p.status === "past_due" ? " · card failed, Stripe retrying" : ""}`;
    if (p.kind === "comp") return `${tier}: free from you · until ${date(p.until)}`;
    if (p.kind === "trial") return `${tier}: free trial · ${p.daysLeft} day${p.daysLeft === 1 ? "" : "s"} left`;
    if (p.kind === "lapsed") return "Silver: subscription ended";
    if (p.kind === "trial_over") return "Silver: trial finished, not subscribed";
    return "Silver: free plan";
  }

  function render() {
    body.innerHTML = `
      ${
        aiEnabled
          ? ""
          : '<p class="fuel-error" style="margin-bottom:14px">Fuel AI (photo scans and Food Q&A) is off until you add ANTHROPIC_API_KEY in Apps Script. Clients can scan barcodes and see snack ideas for now.</p>'
      }
      ${
        aiEnabled
          ? `<div class="coach-safety">
               <div class="coach-actions" style="align-items:center">
                 <button class="fuel-btn fuel-btn--ghost" type="button" data-a="safetyTest">Run Food Q&amp;A safety test</button>
                 <span class="coach-client__meta">20 out-of-bounds questions, about 1c, about a minute.</span>
               </div>
               <div data-safety></div>
             </div>`
          : ""
      }
      ${
        aiEnabled && stripeReady
          ? `<div class="coach-actions" style="margin-bottom:14px;align-items:center">
               <button class="fuel-btn fuel-btn--ghost" type="button" data-a="sync">Check Stripe now</button>
               <span class="coach-client__meta">${lastStripeSync ? `Last checked ${esc(lastStripeSync)}` : "Checks every 15 minutes"}</span>
             </div>`
          : aiEnabled
          ? '<p class="fuel-disclaimer" style="margin-bottom:14px">Stripe isn\'t connected yet, so clients can\'t subscribe. Add STRIPE_SECRET_KEY and STRIPE_FUEL_LINK in Apps Script (see SETUP.md).</p>'
          : ""
      }
      <p class="fuel-disclaimer" style="margin-bottom:14px">Text each client their Fuel link. They open it once and add it to their home screen again. Only you (with the PIN) and that client can see their food log.</p>
      ${clients.map(clientHtml).join("")}`;
  }

  function formFor(slug) {
    return body.querySelector(`[data-slug="${CSS.escape(slug)}"]`);
  }

  function selectedSex(slug) {
    const on = formFor(slug).querySelector("[data-sex] .is-on");
    return on ? on.dataset.v : "";
  }

  body.addEventListener("click", async (e) => {
    const sexBtn = e.target.closest("[data-sex] button");
    if (sexBtn) {
      sexBtn.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("is-on", b === sexBtn));
      return;
    }
    const btn = e.target.closest("[data-a]");
    if (!btn) return;
    if (btn.dataset.a === "safetyTest") {
      if (!window.confirm("Send the 20 test questions through Food Q&A? It costs about 1c and takes about a minute.")) return;
      btn.disabled = true;
      btn.textContent = "Running…";
      const out = body.querySelector("[data-safety]");
      try {
        const data = await MacroApi.coach("coachSafetyTest", pin, {}, { timeoutMs: 300000 });
        out.innerHTML = data.results
          .map(
            (r, i) => `<div class="fuel-panel coach-qa"><p class="coach-qa__q">${i + 1}. ${esc(r.question)}</p><p class="coach-qa__a">${r.error ? `<i>${esc(r.error)}</i>` : esc(r.answer).replace(/\n/g, "<br>")}</p></div>`
          )
          .join("");
        btn.textContent = "Run it again";
      } catch (err) {
        btn.textContent = "Run Food Q&A safety test";
        toast(err.message);
      }
      btn.disabled = false;
      return;
    }
    if (btn.dataset.a === "sync") {
      btn.disabled = true;
      btn.textContent = "Checking…";
      try {
        const data = await MacroApi.coach("coachSyncStripe", pin);
        await load();
        toast(`Stripe checked: ${data.sync.linked} new, ${data.sync.updated} updated`);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Check Stripe now";
        toast(err.message);
      }
      return;
    }
    const slug = btn.closest("[data-slug]").dataset.slug;
    const c = clients.find((x) => x.slug === slug);
    const a = btn.dataset.a;

    if (a === "copy") {
      try {
        await navigator.clipboard.writeText(c.link);
        toast(`Copied ${c.name}'s link`);
      } catch (err) {
        toast("Couldn't copy. Press and hold the link to copy it.");
      }
      return;
    }
    if (a === "issue" || a === "rotate" || a === "weight" || a === "goal") {
      open[slug] = open[slug] === a ? null : a;
      render();
      return;
    }

    btn.disabled = true;
    try {
      if (a === "confirmIssue") {
        const data = await MacroApi.coach("issueKey", pin, {
          slug: slug,
          name: c.name,
          sex: selectedSex(slug),
          rotate: open[slug] === "rotate",
        });
        c.link = data.link;
        c.hasKey = true;
        c.plan = data.plan;
        c.sex = selectedSex(slug) || c.sex;
        open[slug] = null;
        render();
        toast("Link ready. Tap Copy link and text it to them.");
      } else if (a === "saveWeight") {
        const el = formFor(slug);
        const data = await MacroApi.coach("coachLogWeight", pin, {
          slug: slug,
          kg: el.querySelector('[name="kg"]').value,
          date: el.querySelector('[name="date"]').value,
        });
        c.lastWeight = data.lastWeight;
        open[slug] = null;
        render();
        toast(`Saved ${c.name}'s weight`);
      } else if (a === "saveGoal") {
        const el = formFor(slug);
        const data = await MacroApi.coach("coachSetGoal", pin, {
          slug: slug,
          goal_weight_kg: el.querySelector('[name="goal_weight_kg"]').value,
          weekly_rate_kg: el.querySelector('[name="weekly_rate_kg"]').value,
        });
        c.targets = Object.assign({}, c.targets, { goal_weight_kg: data.goal_weight_kg, weekly_rate_kg: data.weekly_rate_kg });
        open[slug] = null;
        render();
        toast(`Saved ${c.name}'s goal`);
      } else if (a === "giveMonth") {
        const data = await MacroApi.coach("coachGiveMonth", pin, { slug: slug, tier: btn.dataset.tier, days: Number(btn.dataset.days) || 30 });
        c.plan = data.plan;
        render();
        toast(`${c.name} has ${TIER_NAMES[btn.dataset.tier] || "Gold"} free until ${planText(data.plan).split("until ")[1] || "next month"}`);
      }
    } catch (err) {
      btn.disabled = false;
      toast(err.message);
    }
  });

  load();
})();
