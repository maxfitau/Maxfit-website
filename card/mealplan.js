/*
 * Fuel's weekly meal plan and shopping list (2026-10-13, Max).
 *
 *   - Plan my week (Diamond only): variety, what they don't eat, how many
 *     people they shop for (and whether they share dinners), and a weekly
 *     budget for the whole shop. One AI call (counts as 3 AI uses) writes a
 *     few meals per slot plus two alternatives each, so Swap is free.
 *   - The plan: Today (each meal with Log it and Swap) or the whole week,
 *     high-protein snack ideas (a fixed list, free), and one tap to put it
 *     all on the shopping list.
 *   - The shopping list (Gold and Diamond): grouped by aisle, big tick boxes
 *     for the shop, the client's own items and snack ideas too.
 *
 * Which meal is on which day, amounts and costs are MacroCore maths
 * (planDays, planShopping, planCost...). The backend is Macros.gs
 * (mealPlan, makeMealPlan, swapMeal, shopping*). Opened from Fuel's rows
 * (macros.js) and the card's shopping tile (week.js), each passing a ctx:
 *   { hideKcal, logMeal(items, slot), upsell(reason, message), onChange(toBuy), onAi(aiToday) }
 * Big text throughout: many clients are older.
 */
const MealPlan = (function () {
  const SLOT_NAMES = { breakfast: "Breakfast", lunch: "Lunch", snack: "Snack", dinner: "Dinner" };
  const VARIETY = [
    ["simple", "Keep it simple", "2 dinners. Cook once, eat twice."],
    ["some", "Some variety", "3 dinners, 2 lunches"],
    ["lots", "Lots", "A different dinner most nights"],
  ];
  const AVOID = ["Fish", "Pork", "Red meat", "Dairy", "Gluten", "Nuts", "Vegetarian"];
  // High-protein snacks: a fixed list, so it's free and the numbers stay put.
  // [emoji, name, serve, kcal, protein, what goes on the list, aisle]
  const SNACKS = [
    ["🥛", "Greek yoghurt", "1 small tub (170 g)", 120, 16, "Greek yoghurt tubs", "Dairy and eggs"],
    ["🥚", "Boiled eggs", "2 eggs", 140, 12, "Eggs", "Dairy and eggs"],
    ["🐟", "Tuna snack pack", "1 tin (95 g)", 110, 20, "Tuna snack packs", "Pantry"],
    ["🥩", "Beef jerky", "1 small bag (25 g)", 80, 12, "Beef jerky", "Pantry"],
    ["🧀", "Cottage cheese and berries", "½ cup + a handful", 150, 14, "Cottage cheese", "Dairy and eggs"],
    ["🫛", "Edamame", "1 cup, shelled", 190, 17, "Frozen edamame", "Frozen"],
    ["🍎", "Apple and a cheese stick", "1 each", 160, 7, "Cheese sticks", "Dairy and eggs"],
    ["🍘", "Rice cakes and peanut butter", "2 cakes, 1 tablespoon", 170, 6, "Rice cakes", "Pantry"],
  ];

  let sheet = null;
  let ctx = {};
  let plan = null;
  let list = null;
  let view = "today";
  const logged = new Set(); // "date slot" logged this visit

  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const today = () => MacroCore.sydneyDate();
  const kcalText = (n) => (ctx.hideKcal ? "" : `<b>${MacroCore.thousands(n)}</b> calories · `);

  // ---------------------------------------------------------------------------
  // Sheet
  // ---------------------------------------------------------------------------

  function show(title, body) {
    if (!sheet) {
      sheet = document.createElement("div");
      sheet.className = "week-sheet mp";
      sheet.setAttribute("role", "dialog");
      sheet.setAttribute("aria-modal", "true");
      document.body.appendChild(sheet);
    }
    sheet.innerHTML =
      `<div class="week-sheet__bar"><h2 class="week-sheet__title">${esc(title)}</h2><button class="week-sheet__close" type="button" data-mp-close aria-label="Close">✕</button></div>` +
      `<div class="week-sheet__body">${body}</div>`;
    sheet.hidden = false;
    sheet.scrollTop = 0;
    document.body.classList.add("week-sheet-open");
    sheet.querySelector("[data-mp-close]").addEventListener("click", close);
    return sheet.querySelector(".week-sheet__body");
  }

  function close() {
    if (!sheet) return;
    sheet.hidden = true;
    document.body.classList.remove("week-sheet-open");
  }

  function loading(title, text) {
    show(title, `<div class="mp-loading"><div class="mp-loading__emoji" aria-hidden="true">🍳</div>${esc(text)}</div>`);
  }

  /** Server errors: "diamond"/"gold" open the plans, anything else is shown in place. */
  function handleError(err, retry) {
    if ((err.code === "diamond" || err.code === "gold") && ctx.upsell) {
      close();
      ctx.upsell(err.code === "diamond" ? "plan" : "list", err.message);
      return;
    }
    const body = show("Meal plan", `<div class="week-card"><p class="week-text">${esc(err.message || "Something went wrong. Try again.")}</p></div><button class="week-btn" type="button" data-retry>Try again</button>`);
    body.querySelector("[data-retry]").addEventListener("click", retry);
  }

  function setList(next) {
    list = next;
    if (ctx.onChange) ctx.onChange(list.filter((i) => !i.done).length);
  }

  // ---------------------------------------------------------------------------
  // Plan my week
  // ---------------------------------------------------------------------------

  /** opts: { hideKcal, logMeal, upsell, onChange }. Shows this week's plan, or Plan my week. */
  async function open(opts) {
    ctx = opts || {};
    loading("Meal plan", "Opening your plan…");
    try {
      const data = await MacroApi.call("mealPlan", {});
      plan = data.plan;
      const live = plan && MacroCore.daysBetween(plan.start, today()) <= 6 && today() >= plan.start;
      if (live) showPlan();
      else showSetup(plan ? plan.prefs : null, data.aiToday);
    } catch (err) {
      handleError(err, () => open(ctx));
    }
  }

  function showSetup(prev, aiToday) {
    const p = Object.assign({ variety: "some", avoid: [], avoidText: "", people: 1, sharedDinners: true, band: 1 }, prev || {});
    const pick = { variety: p.variety, avoid: new Set(p.avoid), avoidText: p.avoidText, people: p.people, shared: p.sharedDinners !== false, band: 1 };
    if (prev && prev.budgetLabel) {
      const i = MacroCore.budgetBands(pick.people).findIndex((b) => b.label === prev.budgetLabel);
      if (i >= 0) pick.band = i;
    }

    function render() {
      const bands = MacroCore.budgetBands(pick.people);
      const left = aiToday && aiToday.limit ? `Uses 3 of your ${aiToday.left} AI uses left today.` : "Uses 3 of today's AI uses.";
      const body = show(
        "Plan my week",
        '<p class="week-help">A simple week of meals that hits your numbers, using foods you already log. Then one tap puts it all on your shopping list.</p>' +
          '<div class="week-card"><p class="mp-q">How much variety?</p><div class="mp-stack">' +
          VARIETY.map(([k, name, sub]) => `<button class="week-opt${pick.variety === k ? " is-on" : ""}" type="button" data-variety="${k}"><span class="week-opt__text"><span class="week-opt__main">${name}</span><span class="week-opt__sub">${sub}</span></span>${k === "some" ? '<span class="week-opt__tag">Recommended</span>' : ""}</button>`).join("") +
          "</div></div>" +
          `<div class="week-card"><p class="mp-q">Anything you don't eat?</p><div class="mp-chips">${AVOID.map((a) => `<button class="mp-chip${pick.avoid.has(a) ? " is-on" : ""}" type="button" data-avoid="${a}" aria-pressed="${pick.avoid.has(a)}">${a}</button>`).join("")}</div>` +
          `<input class="week-input mp-gap" type="text" maxlength="120" placeholder="Anything else? (e.g. no mushrooms)" value="${esc(pick.avoidText)}" data-avoidtext /></div>` +
          '<div class="week-card"><p class="mp-q">How many people do you shop for?</p><p class="week-note mp-tight">Including you.</p>' +
          `<div class="mp-stepper"><button class="mp-step" type="button" data-people="-1" aria-label="One fewer">−</button><span class="mp-step__num" aria-live="polite">${pick.people}</span><button class="mp-step" type="button" data-people="1" aria-label="One more">+</button></div>` +
          (pick.people > 1
            ? `<p class="mp-q mp-gap">Do they eat your dinners too?</p><div class="mp-chips"><button class="mp-chip${pick.shared ? " is-on" : ""}" type="button" data-shared="1">Yes, I cook for everyone</button><button class="mp-chip${pick.shared ? "" : " is-on"}" type="button" data-shared="0">No, just me</button></div>`
            : "") +
          "</div>" +
          `<div class="week-card"><p class="mp-q">Your weekly food budget${pick.people > 1 ? ` for all ${pick.people}` : ""}?</p><div class="mp-chips">` +
          bands.map((b, i) => `<button class="mp-chip${pick.band === i ? " is-on" : ""}" type="button" data-band="${i}">${b.label}</button>`).join("") +
          `</div><p class="week-note">${pick.people > 1 ? "Your whole shop. Your plan takes its share, and the rest is there for everyone else's food." : "Fuel picks foods that fit, and your list shows roughly what it'll cost."}</p></div>` +
          `<button class="week-btn" type="button" data-make>Make my plan</button><p class="mp-cost">${esc(left)}</p>`
      );
      body.querySelector("[data-avoidtext]").addEventListener("input", (e) => (pick.avoidText = e.target.value));
      body.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        const keep = sheet.scrollTop;
        if (b.dataset.variety) pick.variety = b.dataset.variety;
        else if (b.dataset.avoid) pick.avoid.has(b.dataset.avoid) ? pick.avoid.delete(b.dataset.avoid) : pick.avoid.add(b.dataset.avoid);
        else if (b.dataset.people) pick.people = Math.max(1, Math.min(8, pick.people + Number(b.dataset.people)));
        else if (b.dataset.shared) pick.shared = b.dataset.shared === "1";
        else if (b.dataset.band) pick.band = Number(b.dataset.band);
        else if (b.dataset.make !== undefined) return make();
        else return;
        render();
        sheet.scrollTop = keep;
      });
    }

    async function make() {
      const band = MacroCore.budgetBands(pick.people)[pick.band];
      const prefs = {
        variety: pick.variety,
        avoid: [...pick.avoid],
        avoidText: pick.avoidText,
        people: pick.people,
        sharedDinners: pick.people > 1 && pick.shared,
        budgetMax: band.max,
        budgetLabel: band.label,
      };
      loading("Plan my week", "Writing your plan… this takes about half a minute.");
      try {
        const data = await MacroApi.call("makeMealPlan", { prefs }, { timeoutMs: 180000 });
        plan = data.plan;
        if (ctx.onAi && data.aiToday) ctx.onAi(data.aiToday);
        view = "today";
        showPlan();
      } catch (err) {
        handleError(err, render);
      }
    }

    render();
  }

  // ---------------------------------------------------------------------------
  // The plan
  // ---------------------------------------------------------------------------

  function dayIndex() {
    return Math.max(0, Math.min(6, MacroCore.daysBetween(plan.start, today())));
  }

  function mealCard(slot, index, date) {
    const meal = plan.meals[slot][index];
    const t = MacroCore.mealTotals(meal);
    const key = `${date} ${slot}`;
    const done = logged.has(key);
    return (
      `<div class="week-card"><div class="mp-meal__top"><span class="mp-meal__emoji" aria-hidden="true">${esc(meal.emoji || "🍽️")}</span><div>` +
      `<div class="mp-meal__slot">${SLOT_NAMES[slot]}</div><div class="mp-meal__name">${esc(meal.name)}</div><div class="mp-meal__days">${esc(MacroCore.mealDays(plan, slot, index))}</div></div></div>` +
      `<ul class="mp-items">${meal.items.map((it) => `<li><span>${esc(it.name)}</span><span>${esc(it.amount_text || `${it.grams} g`)}</span></li>`).join("")}</ul>` +
      (meal.how_to ? `<p class="week-note">${esc(meal.how_to)}</p>` : "") +
      `<div class="mp-macros">${kcalText(t.kcal)}<b>${Math.round(t.protein_g)} g</b> protein</div>` +
      `<div class="mp-actions"><button class="mp-btn ${done ? "mp-btn--done" : "mp-btn--red"}" type="button" data-log="${slot}" data-index="${index}" ${done ? "disabled" : ""}>${done ? "✓ Logged" : "Log it"}</button>` +
      ((plan.swaps[slot] || []).length ? `<button class="mp-btn" type="button" data-swap="${slot}" data-index="${index}">Swap</button>` : "") +
      "</div></div>"
    );
  }

  function snacksCard() {
    const adding = new Set(((list || []).filter((i) => !i.done)).map((i) => i.name.toLowerCase()));
    return (
      '<div class="week-card"><h3 class="week-h">💪 High-protein snack ideas</h3><p class="week-note mp-tight">Good any time you\'re peckish. Tap to add one to your shopping list.</p>' +
      SNACKS.map(([emoji, name, serve, kcal, protein, item], i) => {
        const on = adding.has(item.toLowerCase());
        return `<div class="mp-snack"><span class="mp-snack__emoji" aria-hidden="true">${emoji}</span><span class="mp-snack__text"><span class="mp-snack__name">${esc(name)}</span><span class="mp-snack__sub">${esc(serve)} · ${ctx.hideKcal ? "" : `${kcal} cal · `}<b>${protein} g protein</b></span></span>` +
          `<button class="mp-btn mp-snack__add${on ? " mp-btn--done" : ""}" type="button" data-snack="${i}" ${on ? "disabled" : ""}>${on ? "✓ On list" : "+ List"}</button></div>`;
      }).join("") +
      "</div>"
    );
  }

  function showPlan() {
    const totals = MacroCore.planDayTotals(plan);
    const avgKcal = Math.round(totals.reduce((t, d) => t + d.kcal, 0) / 7);
    const avgProtein = Math.round(totals.reduce((t, d) => t + d.protein_g, 0) / 7);
    const cost = MacroCore.planCost(plan);
    const prefs = plan.prefs || {};
    let money = "";
    if (cost > 0) {
      money = prefs.people > 1 && prefs.budgetMax > 0
        ? `Your plan's shopping comes to about <b>$${cost}</b>${prefs.sharedDinners ? `, with dinners for all ${prefs.people}` : ""}. That leaves about $${Math.max(0, prefs.budgetMax - cost)} of your budget for everyone else's food.`
        : `Shopping comes to about <b>$${cost}</b> for the week${prefs.budgetLabel && prefs.budgetMax > 0 ? `, for your ${esc(prefs.budgetLabel)} budget` : ""}.`;
    }
    const end = MacroCore.addDays(plan.start, 6);
    let html =
      `<p class="week-dates">${esc(MacroCore.longDate(plan.start))} to ${esc(MacroCore.longDate(end))}</p>` +
      `<div class="week-card"><p class="week-text">Each day comes to about ${ctx.hideKcal ? "" : `<b>${MacroCore.thousands(avgKcal)} calories</b> and `}<b>${avgProtein} g protein</b>.</p>` +
      (money ? `<p class="week-note">${money}</p>` : "") +
      "</div>" +
      `<div class="mp-seg" role="tablist"><button type="button" role="tab" aria-selected="${view === "today"}" class="${view === "today" ? "is-on" : ""}" data-view="today">Today</button><button type="button" role="tab" aria-selected="${view === "week"}" class="${view === "week" ? "is-on" : ""}" data-view="week">Whole week</button></div>`;
    const days = MacroCore.planDays(plan);
    if (view === "today") {
      const d = days[dayIndex()];
      html += MacroCore.MEAL_SLOTS.filter((s) => d.meals[s] >= 0).map((s) => mealCard(s, d.meals[s], d.date)).join("");
      html += snacksCard();
    } else {
      html +=
        '<div class="week-card">' +
        days
          .map((d) => {
            const p = d.date.split("-").map(Number);
            return `<div class="mp-day"><div class="mp-day__name">${d.day} ${p[2]}</div>` +
              MacroCore.MEAL_SLOTS.filter((s) => d.meals[s] >= 0).map((s) => `<div class="mp-day__row">${SLOT_NAMES[s]}: <b>${esc(plan.meals[s][d.meals[s]].name)}</b></div>`).join("") +
              "</div>";
          })
          .join("") +
        "</div>";
    }
    html += '<button class="week-btn" type="button" data-tolist>🛒 Put it all on my shopping list</button><button class="week-link" type="button" data-newplan>Make a new plan</button>';
    const body = show("Your meal plan", html);
    body.addEventListener("click", onPlanClick);
  }

  async function onPlanClick(e) {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.view) {
      view = b.dataset.view;
      showPlan();
    } else if (b.dataset.log) {
      const slot = b.dataset.log;
      const meal = plan.meals[slot][Number(b.dataset.index)];
      b.disabled = true;
      b.textContent = "Logging…";
      try {
        await ctx.logMeal(
          meal.items.map((it) => ({ name: it.name, grams: it.grams, per100: MacroCore.per100From(it, it.grams), source: "plan" })),
          slot
        );
        logged.add(`${today()} ${slot}`);
        b.textContent = "✓ Logged";
        b.classList.remove("mp-btn--red");
        b.classList.add("mp-btn--done");
      } catch (err) {
        b.disabled = false;
        b.textContent = "Log it";
        window.alert(err.message || "Couldn't log that. Try again.");
      }
    } else if (b.dataset.swap) {
      showSwap(b.dataset.swap, Number(b.dataset.index));
    } else if (b.dataset.snack !== undefined) {
      const s = SNACKS[Number(b.dataset.snack)];
      b.disabled = true;
      try {
        const data = await MacroApi.call("shoppingAdd", { name: s[5], aisle: s[6], source: "snack" });
        setList(data.list);
        b.textContent = "✓ On list";
        b.classList.add("mp-btn--done");
      } catch (err) {
        b.disabled = false;
        if (err.code === "gold" && ctx.upsell) {
          close();
          ctx.upsell("list", err.message);
        } else window.alert(err.message || "Couldn't add that. Try again.");
      }
    } else if (b.dataset.tolist !== undefined) {
      b.disabled = true;
      b.textContent = "Adding it up…";
      try {
        const data = await MacroApi.call("shoppingFromPlan", {});
        setList(data.list);
        showList();
      } catch (err) {
        handleError(err, showPlan);
      }
    } else if (b.dataset.newplan !== undefined) {
      showSetup(plan.prefs, null);
    }
  }

  function showSwap(slot, index) {
    const body = show(
      `Swap ${SLOT_NAMES[slot].toLowerCase()}`,
      '<p class="week-help">About the same calories and protein. Swaps are free.</p>' +
        plan.swaps[slot]
          .map((m, i) => {
            const t = MacroCore.mealTotals(m);
            return `<button class="week-opt" type="button" data-alt="${i}"><span class="week-opt__emoji" aria-hidden="true">${esc(m.emoji || "🍽️")}</span><span class="week-opt__text"><span class="week-opt__main">${esc(m.name)}</span><span class="week-opt__sub">${ctx.hideKcal ? "" : `${MacroCore.thousands(t.kcal)} calories · `}${Math.round(t.protein_g)} g protein</span></span></button>`;
          })
          .join("") +
        '<button class="week-link" type="button" data-back>Keep what I have</button>'
    );
    body.addEventListener("click", async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.back !== undefined) return showPlan();
      if (b.dataset.alt === undefined) return;
      loading(`Swap ${SLOT_NAMES[slot].toLowerCase()}`, "Swapping…");
      try {
        const data = await MacroApi.call("swapMeal", { planId: plan.id, slot, index, alt: Number(b.dataset.alt) });
        plan = data.plan;
        if (data.list) setList(data.list);
        showPlan();
      } catch (err) {
        handleError(err, showPlan);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Shopping list
  // ---------------------------------------------------------------------------

  /** opts as for open(). */
  async function openList(opts) {
    if (opts) ctx = opts;
    loading("Shopping list", "Opening your list…");
    try {
      const data = await MacroApi.call("shoppingList", {});
      setList(data.list);
      showList();
    } catch (err) {
      handleError(err, () => openList());
    }
  }

  function listText() {
    return MacroCore.AISLES.map((a) => {
      const items = list.filter((i) => !i.done && i.aisle === a);
      return items.length ? `${a}:\n${items.map((i) => `- ${i.name}${i.amount ? ` (${i.amount})` : ""}`).join("\n")}` : "";
    })
      .filter(Boolean)
      .join("\n\n");
  }

  function showList() {
    const toBuy = list.filter((i) => !i.done).length;
    const ticked = list.length - toBuy;
    const fromPlan = plan && list.some((i) => i.source === "plan");
    const pantry = fromPlan ? MacroCore.planShopping(plan).filter((i) => i.pantry) : [];
    let html = `<p class="week-dates">${toBuy ? `${toBuy} to buy` : list.length ? "All done!" : "Nothing on it yet"}</p>`;
    if (fromPlan && MacroCore.planCost(plan) > 0) {
      html += `<div class="week-card"><p class="week-text">Your plan's shopping: about <b>$${MacroCore.planCost(plan)}</b> at Coles or Woolworths.</p><p class="week-note">A rough estimate. Specials and brands change it.</p></div>`;
    }
    MacroCore.AISLES.forEach((aisle) => {
      const items = list.filter((i) => i.aisle === aisle);
      if (!items.length) return;
      html +=
        `<div class="week-card"><p class="mp-group">${esc(aisle)}</p>` +
        items
          .map((i) => `<button class="mp-item${i.done ? " is-done" : ""}" type="button" data-item="${esc(i.id)}" aria-pressed="${i.done}"><span class="mp-box" aria-hidden="true">${i.done ? "✓" : ""}</span><span class="mp-item__name">${esc(i.name)}</span><span class="mp-item__amt">${esc(i.amount)}</span></button>`)
          .join("") +
        "</div>";
    });
    if (pantry.length) {
      html += `<details class="week-card"><summary class="mp-group mp-summary">Probably in your pantry (${pantry.length})</summary><p class="week-note">Check you have these. Add any you're out of below.</p>${pantry.map((p) => `<div class="mp-pantry">${esc(p.name)}</div>`).join("")}</details>`;
    }
    html +=
      '<div class="week-card"><p class="mp-group">Add something</p><form class="mp-add" data-add><input class="week-input" type="text" maxlength="60" placeholder="e.g. milk" aria-label="Add something" /><button class="mp-btn" type="submit">Add</button></form></div>' +
      (ticked ? `<button class="week-btn week-btn--ghost" type="button" data-clear>Clear ${ticked} ticked</button>` : "") +
      (toBuy ? '<button class="week-btn week-btn--ghost" type="button" data-share>Send this list to someone</button>' : "");
    const body = show("Shopping list", html);
    body.querySelector("[data-add]").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = e.target.querySelector("input");
      const name = input.value.trim();
      if (!name) return;
      input.disabled = true;
      try {
        const data = await MacroApi.call("shoppingAdd", { name });
        setList(data.list);
        showList();
      } catch (err) {
        input.disabled = false;
        window.alert(err.message || "Couldn't add that. Try again.");
      }
    });
    body.addEventListener("click", async (e) => {
      const b = e.target.closest("button");
      if (!b || b.disabled) return;
      if (b.dataset.item) {
        const item = list.find((i) => i.id === b.dataset.item);
        if (!item) return;
        item.done = !item.done; // show it straight away, then save
        const keep = sheet.scrollTop;
        showList();
        sheet.scrollTop = keep;
        try {
          const data = await MacroApi.call("shoppingToggle", { itemId: item.id, done: item.done });
          setList(data.list);
        } catch (err) {
          item.done = !item.done;
          showList();
        }
      } else if (b.dataset.clear !== undefined) {
        b.disabled = true;
        try {
          const data = await MacroApi.call("shoppingClear", {});
          setList(data.list);
          showList();
        } catch (err) {
          b.disabled = false;
        }
      } else if (b.dataset.share !== undefined) {
        const text = `Shopping list\n\n${listText()}`;
        if (navigator.share) navigator.share({ text }).catch(() => {});
        else window.location.href = `sms:?&body=${encodeURIComponent(text)}`;
      }
    });
  }

  return { open, openList, close };
})();
