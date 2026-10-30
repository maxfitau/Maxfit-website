/*
 * Fuel's meal planner and shopping list. Rebuilt 2026-10-29 so Fuel stays
 * within a personal trainer's scope of practice: the client drives it.
 *
 *   - My week (Diamond only): the next 7 days, each with breakfast, lunch,
 *     snack and dinner. The client picks every meal (AI ideas, their own
 *     saved meals and favourites, or a search of Max's Foods list) and
 *     chooses the serves. Each day adds up against the client's OWN
 *     targets. AI ideas (Macros.gs mealIdeas, 3 AI uses a set) are general
 *     meals at standard recipe serves, never sized to anyone.
 *   - High-protein snack ideas (a fixed list, free) that go on the list.
 *   - The shopping list (Gold and Diamond): grouped by aisle, big tick boxes
 *     for the shop, the client's own items and snack ideas too.
 *
 * The maths is MacroCore (plannerDayTotals, plannerShopping, stepServes...).
 * The backend is Macros.gs (mealPlan, mealIdeas, savePlanner, shopping*).
 * Opened from Fuel's tiles (macros.js) and the card's shopping tile
 * (week.js), each passing a ctx (see macros.js mealPlanCtx()).
 * Big text throughout: many clients are older.
 */
const MealPlan = (function () {
  const SLOT_NAMES = { breakfast: "Breakfast", lunch: "Lunch", snack: "Snack", dinner: "Dinner" };
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
  let list = null;
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
    show(title, `<div class="mp-loading"><div class="mp-loading__emoji" aria-hidden="true">${MaxIcon("utensils")}</div>${esc(text)}</div>`);
  }

  /** Server errors: "diamond"/"gold" open the plans, anything else is shown in place. */
  function handleError(err, retry) {
    if ((err.code === "diamond" || err.code === "gold") && ctx.upsell) {
      close();
      ctx.upsell(err.code === "diamond" ? "plan" : "list", err.message);
      return;
    }
    const body = show("Meal planner", `<div class="week-card"><p class="week-text">${esc(err.message || "Something went wrong. Try again.")}</p></div><button class="week-btn" type="button" data-retry>Try again</button>`);
    body.querySelector("[data-retry]").addEventListener("click", retry);
  }

  function setList(next) {
    list = next;
    if (ctx.onChange) ctx.onChange(list.filter((i) => !i.done).length);
  }

  // ---------------------------------------------------------------------------
  // The meal planner (Diamond, rebuilt 2026-10-29 for scope of practice):
  // the client picks a meal for each slot of the next 7 days and chooses the
  // serves; the day adds up against THEIR targets and builds the shopping.
  // ---------------------------------------------------------------------------

  const GUIDE = "General guidance only. See a dietitian for a personalised plan.";
  let planner = null;
  let pickDay = null; // the day on screen
  let aiLeft = null;
  let chooseTab = "ideas";
  let saveTimer = null;

  const dayName = (ymd, style) => {
    const p = ymd.split("-").map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2])).toLocaleDateString("en-AU", { weekday: style || "long", timeZone: "UTC" });
  };
  const weekDays = () => Array.from({ length: 7 }, (_, i) => MacroCore.addDays(today(), i));
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  function normalise(p) {
    const out = p && p.version === 2 ? p : { version: 2, days: {}, ideas: {}, likes: "" };
    out.days = out.days || {};
    out.ideas = out.ideas || {};
    MacroCore.MEAL_SLOTS.forEach((s) => (out.ideas[s] = out.ideas[s] || []));
    return out;
  }

  /** opts: the ctx from macros.js mealPlanCtx(). Opens the planner on today. */
  async function open(opts) {
    ctx = opts || {};
    loading("Meal planner", "Opening your planner…");
    try {
      const data = await MacroApi.call("mealPlan", {});
      planner = normalise(data.planner);
      aiLeft = data.aiToday || null;
      if (!pickDay || pickDay < today() || pickDay > MacroCore.addDays(today(), 6)) pickDay = today();
      showWeek();
    } catch (err) {
      handleError(err, () => open(ctx));
    }
  }

  /** Saves the client's picks a moment after the last change. */
  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const data = await MacroApi.call("savePlanner", { days: planner.days });
        if (data.list) setList(data.list);
      } catch (err) {
        window.alert(err.message || "Couldn't save your planner. Check your connection.");
      }
    }, 700);
  }

  function totalsCard(t) {
    const g = ctx.targets;
    if (!g || !(g.kcal > 0)) {
      return `<div class="week-card"><p class="week-text">${ctx.hideKcal ? "" : `<b>${MacroCore.thousands(t.kcal)}</b> calories · `}<b>${Math.round(t.protein_g)} g</b> protein picked so far.</p><p class="week-note">Set your targets in Fuel to see each day next to them.</p></div>`;
    }
    const row = (have, want, unit, label) => {
      const pct = want > 0 ? Math.round((have / want) * 100) : 0;
      return `<div class="pl-total__row"><span><b>${MacroCore.thousands(Math.round(have))}${unit}</b> of your ${MacroCore.thousands(Math.round(want))}${unit} ${label}</span><span>${pct}%</span></div>` +
        `<div class="pl-bar"><span style="width:${Math.min(100, pct)}%"></span></div>`;
    };
    return `<div class="week-card pl-total">${ctx.hideKcal ? "" : row(t.kcal, g.kcal, "", "kcal")}${row(t.protein_g, g.protein_g, "g", "protein")}</div>`;
  }

  function slotRow(slot, pick) {
    if (!pick) {
      return `<div class="pl-slot"><span class="pl-slot__label">${SLOT_NAMES[slot]}</span><button class="pl-slot__add" type="button" data-choose="${slot}">+ Choose ${slot === "snack" ? "a snack" : "a meal"}</button></div>`;
    }
    const t = MacroCore.pickTotals(pick);
    const canLog = pickDay === today() && ctx.logMeal;
    const done = logged.has(`${pickDay} ${slot}`);
    return `<div class="pl-slot">
      <span class="pl-slot__label">${SLOT_NAMES[slot]}</span>
      <span class="pl-slot__meal">${esc(pick.meal.name)}<small>${MacroCore.servesText(pick.serves)} serve${pick.serves > 1 ? "s" : ""} · ${ctx.hideKcal ? "" : `${MacroCore.thousands(t.kcal)} kcal · `}${Math.round(t.protein_g)} g protein</small></span>
      <span class="pl-serves" role="group" aria-label="Serves of ${esc(pick.meal.name)}">
        <button type="button" data-serves="${slot}" data-dir="-1" aria-label="Fewer serves">−</button><b>${MacroCore.servesText(pick.serves)}</b><button type="button" data-serves="${slot}" data-dir="1" aria-label="More serves">+</button>
      </span>
      <span class="pl-slot__acts">
        ${canLog ? `<button class="mp-btn ${done ? "mp-btn--done" : "mp-btn--red"}" type="button" data-log="${slot}" ${done ? "disabled" : ""}>${done ? "✓ Logged" : "Log it"}</button>` : ""}
        <button class="mp-btn" type="button" data-choose="${slot}">Change</button>
        <button class="mp-btn" type="button" data-remove="${slot}">Remove</button>
      </span>
    </div>`;
  }

  function showWeek() {
    const day = planner.days[pickDay] || {};
    const chips = weekDays()
      .map((d) => {
        const n = MacroCore.MEAL_SLOTS.filter((s) => (planner.days[d] || {})[s]).length;
        return `<button class="pl-day${d === pickDay ? " is-on" : ""}" type="button" data-day="${d}" aria-pressed="${d === pickDay}">${d === today() ? "Today" : dayName(d, "short")}<small>${n ? plural(n, "meal") : "–"}</small></button>`;
      })
      .join("");
    const html =
      `<div class="pl-days">${chips}</div>` +
      `<p class="week-dates">${esc(dayName(pickDay))} ${esc(MacroCore.shortDate(pickDay))}</p>` +
      totalsCard(MacroCore.plannerDayTotals(day)) +
      `<div class="week-card pl-slots">${MacroCore.MEAL_SLOTS.map((s) => slotRow(s, day[s])).join("")}</div>` +
      `<button class="week-btn" type="button" data-tolist>${MaxIcon("cart")} Build my shopping list</button>` +
      snacksCard() +
      `<p class="pl-foot">${esc(GUIDE)}</p>`;
    const body = show("My week", html);
    body.addEventListener("click", onWeekClick);
  }

  async function onWeekClick(e) {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    const day = (planner.days[pickDay] = planner.days[pickDay] || {});
    if (b.dataset.day) {
      pickDay = b.dataset.day;
      showWeek();
    } else if (b.dataset.choose) {
      chooseTab = planner.ideas[b.dataset.choose].length ? "ideas" : ctx.meals && ctx.meals.length ? "mine" : "ideas";
      showChoose(b.dataset.choose);
    } else if (b.dataset.serves) {
      const pick = day[b.dataset.serves];
      if (!pick) return;
      pick.serves = MacroCore.stepServes(pick.serves, Number(b.dataset.dir));
      queueSave();
      showWeek();
    } else if (b.dataset.remove) {
      delete day[b.dataset.remove];
      if (!Object.keys(day).length) delete planner.days[pickDay];
      queueSave();
      showWeek();
    } else if (b.dataset.log) {
      const slot = b.dataset.log;
      const pick = day[slot];
      b.disabled = true;
      b.textContent = "Logging…";
      try {
        await ctx.logMeal(
          pick.meal.items.map((it) => ({ name: it.name, grams: Math.round(it.grams * pick.serves), per100: MacroCore.per100From(it, it.grams), source: "plan" })),
          slot
        );
        logged.add(`${pickDay} ${slot}`);
        showWeek();
      } catch (err) {
        b.disabled = false;
        b.textContent = "Log it";
        window.alert(err.message || "Couldn't log that. Try again.");
      }
    } else if (b.dataset.snack !== undefined) {
      addSnackToList(b);
    } else if (b.dataset.tolist !== undefined) {
      b.disabled = true;
      b.textContent = "Adding it up…";
      clearTimeout(saveTimer);
      try {
        await MacroApi.call("savePlanner", { days: planner.days });
        const data = await MacroApi.call("shoppingFromPlan", {});
        setList(data.list);
        showList();
      } catch (err) {
        handleError(err, showWeek);
      }
    }
  }

  async function addSnackToList(b) {
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
  }

  /** One standard serve of a single food, as a planner meal. */
  function foodAsMeal(name, grams, per100, amountText) {
    const m = MacroCore.scale(per100, grams);
    return {
      name: name,
      emoji: "",
      how_to: "",
      items: [{ name: name, amount_text: amountText || `${Math.round(grams)} g`, grams: Math.round(grams), count: 0, unit: "", kcal: m.kcal, protein_g: m.protein_g, carbs_g: m.carbs_g, fat_g: m.fat_g, aisle: "Other", pantry: false }],
    };
  }

  /** A saved meal (Fuel's Saved Meals) as a planner meal, at the amounts it was saved with. */
  function savedAsMeal(saved) {
    return {
      name: saved.name,
      emoji: "",
      how_to: "",
      items: (saved.items || []).map((it) => {
        const m = MacroCore.scale(it.per100, it.grams);
        return { name: it.name, amount_text: `${Math.round(it.grams)} g`, grams: Math.round(it.grams), count: 0, unit: "", kcal: m.kcal, protein_g: m.protein_g, carbs_g: m.carbs_g, fat_g: m.fat_g, aisle: "Other", pantry: false };
      }),
    };
  }

  function mealOption(meal, i, open) {
    const t = MacroCore.mealTotals(meal);
    const items = (meal.items || []).map((it) => `<li><span>${esc(it.name)}</span><span>${esc(it.amount_text || `${Math.round(it.grams)} g`)}</span></li>`).join("");
    return `<div class="week-card">
      <div class="mp-meal__top">${meal.emoji ? `<span class="mp-meal__emoji" aria-hidden="true">${esc(meal.emoji)}</span>` : ""}<div><div class="mp-meal__name">${esc(meal.name)}</div><div class="fr-meta">One standard serve${meal.how_to ? ` · ${esc(meal.how_to)}` : ""}</div></div></div>
      <div class="mp-macros">${ctx.hideKcal ? "" : `<b>${MacroCore.thousands(t.kcal)}</b> kcal · `}<b>${Math.round(t.protein_g)} g</b> protein per serve</div>
      ${open ? `<ul class="mp-items">${items}</ul>` : ""}
      <div class="mp-actions"><button class="mp-btn mp-btn--red" type="button" data-pick="${i}">Add to ${esc(pickDay === today() ? "today" : dayName(pickDay))}</button><button class="mp-btn" type="button" data-items="${i}">${open ? "Hide ingredients" : "Ingredients"}</button></div>
    </div>`;
  }

  function showChoose(slot, openIndex, query) {
    const tab = (id, label) => `<button type="button" class="${chooseTab === id ? "is-on" : ""}" data-tab="${id}" aria-pressed="${chooseTab === id}">${label}</button>`;
    let options = [];
    let html = `<div class="pl-tabs">${tab("ideas", "Ideas")}${tab("mine", "My meals")}${tab("search", "Search")}</div>`;
    if (chooseTab === "ideas") {
      options = planner.ideas[slot] || [];
      html += options.length
        ? options.map((m, i) => mealOption(m, i, i === openIndex)).join("")
        : `<div class="week-card"><p class="week-text">No ideas yet. Tell Fuel what you like below, then tap Get new ideas.</p></div>`;
      const left = aiLeft && aiLeft.limit ? ` · ${aiLeft.left} left today` : "";
      html +=
        `<div><p class="mp-q mp-tight">Foods you like or don't like</p><input class="fr-text" type="text" data-likes maxlength="200" value="${esc(planner.likes || "")}" placeholder="e.g. love eggs, not a fan of fish" aria-label="Foods you like or don't like" /></div>` +
        `<button class="week-btn week-btn--ghost" type="button" data-ideas>Get new ideas</button>` +
        `<p class="mp-cost">A set of ideas uses 3 AI scans${left}</p>`;
    } else if (chooseTab === "mine") {
      options = (ctx.meals || []).map(savedAsMeal).concat((ctx.favourites || []).map((f) => foodAsMeal(f.name, f.grams, f.per100)));
      html += options.length
        ? options.map((m, i) => mealOption(m, i, i === openIndex)).join("")
        : `<div class="week-card"><p class="week-text">Your saved meals and favourites show here. Save a meal when you log it, or star a food.</p></div>`;
    } else {
      const q = String(query || "").trim().toLowerCase();
      const pool = (ctx.foods || []).map((f) => foodAsMeal(f.name, f.serve_g, f.per100, f.serve_label || ""))
        .concat((ctx.recent || []).map((r) => foodAsMeal(r.name, r.grams, r.per100)));
      const seen = new Set();
      options = pool.filter((m) => {
        const k = m.name.toLowerCase();
        if (seen.has(k) || (q && !k.includes(q))) return false;
        seen.add(k);
        return true;
      }).slice(0, 12);
      html += `<input class="fr-text" type="search" data-search value="${esc(query || "")}" placeholder="Search foods" aria-label="Search foods" />` +
        (options.length ? options.map((m, i) => mealOption(m, i, i === openIndex)).join("") : `<div class="week-card"><p class="week-text">Nothing found. Try another word.</p></div>`);
    }
    html += `<button class="week-link" type="button" data-back>Back to my week</button><p class="pl-foot">${esc(GUIDE)}</p>`;
    const body = show(`${pickDay === today() ? "Today" : dayName(pickDay)}: ${SLOT_NAMES[slot].toLowerCase()}`, html);
    const search = body.querySelector("[data-search]");
    if (search) {
      search.addEventListener("input", () => {
        const v = search.value;
        const at = search.selectionStart;
        showChoose(slot, -1, v);
        const again = sheet.querySelector("[data-search]");
        again.focus();
        again.setSelectionRange(at, at);
      });
    }
    body.addEventListener("click", async (e) => {
      const b = e.target.closest("button");
      if (!b || b.disabled) return;
      if (b.dataset.tab) {
        chooseTab = b.dataset.tab;
        showChoose(slot);
      } else if (b.dataset.back !== undefined) {
        showWeek();
      } else if (b.dataset.items !== undefined) {
        const i = Number(b.dataset.items);
        showChoose(slot, i === openIndex ? -1 : i, query);
      } else if (b.dataset.pick !== undefined) {
        const meal = options[Number(b.dataset.pick)];
        if (!meal) return;
        const day = (planner.days[pickDay] = planner.days[pickDay] || {});
        day[slot] = { meal: JSON.parse(JSON.stringify(meal)), serves: 1 };
        queueSave();
        showWeek();
      } else if (b.dataset.ideas !== undefined) {
        const likes = body.querySelector("[data-likes]").value.trim();
        loading("Meal ideas", "Thinking up some ideas…");
        try {
          clearTimeout(saveTimer);
          await MacroApi.call("savePlanner", { days: planner.days });
          const data = await MacroApi.call("mealIdeas", { likes }, { timeoutMs: 90000 });
          planner = normalise(data.planner);
          aiLeft = data.aiToday || aiLeft;
          if (ctx.onAi && data.aiToday) ctx.onAi(data.aiToday);
          chooseTab = "ideas";
          showChoose(slot);
        } catch (err) {
          if (err.code === "limit" && ctx.upsell) {
            close();
            ctx.upsell("limit", err.message);
          } else handleError(err, () => showChoose(slot));
        }
      }
    });
  }

  function snacksCard() {
    const adding = new Set(((list || []).filter((i) => !i.done)).map((i) => i.name.toLowerCase()));
    return (
      '<div class="week-card"><h3 class="week-h">'+MaxIcon("dumbbell")+'High-protein snack ideas</h3><p class="week-note mp-tight">Good any time you\'re peckish. Tap to add one to your shopping list.</p>' +
      SNACKS.map(([emoji, name, serve, kcal, protein, item], i) => {
        const on = adding.has(item.toLowerCase());
        return `<div class="mp-snack"><span class="mp-snack__emoji" aria-hidden="true">${MaxIcon("utensils")}</span><span class="mp-snack__text"><span class="mp-snack__name">${esc(name)}</span><span class="mp-snack__sub">${esc(serve)} · ${ctx.hideKcal ? "" : `${kcal} cal · `}<b>${protein} g protein</b></span></span>` +
          `<button class="mp-btn mp-snack__add${on ? " mp-btn--done" : ""}" type="button" data-snack="${i}" ${on ? "disabled" : ""}>${on ? "✓ On list" : "+ List"}</button></div>`;
      }).join("") +
      "</div>"
    );
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
    const fromPlan = planner && list.some((i) => i.source === "plan");
    const pantry = fromPlan ? MacroCore.plannerShopping(planner, today()).filter((i) => i.pantry) : [];
    let html = `<p class="week-dates">${toBuy ? `${toBuy} to buy` : list.length ? "All done!" : "Nothing on it yet"}</p>`;

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
