/*
 * MaxFit macro tracker — pure maths and data clean-up. No DOM, no network.
 *
 * One file, two homes: the card loads it with a <script> tag, and the
 * "MaxFit Macros" Apps Script project has an exact copy pasted in as a
 * second file (MacrosCore.gs). Both sides therefore compute targets and
 * scale portions identically — the server re-checks anything the phone
 * sends instead of trusting it. Keep it plain JS (no window/document/
 * module) so it runs unchanged in both places.
 *
 * Unit tests: card/tests/macros-core.test.html (open it in a browser).
 */
const MacroCore = (function () {
  const ACTIVITY_FACTORS = {
    sedentary: 1.2, // desk job, little exercise
    light: 1.375, // 1–3 sessions a week
    moderate: 1.55, // 3–5 sessions a week
    very: 1.725, // 6–7 sessions a week
    athlete: 1.9, // training twice a day or a physical job plus training
  };

  // Safety floors — targets never go below these without Max approving it.
  const KCAL_FLOOR = { M: 1500, F: 1200 };

  // Roughly 7,700 kcal per kg of body fat; losing faster than ~1% of
  // bodyweight a week is the cap from Max's brief.
  const KCAL_PER_KG = 7700;
  const MAX_WEEKLY_LOSS_FRACTION = 0.01;

  const MEALS = ["breakfast", "lunch", "dinner", "snack"];

  function num_(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function round1(n) {
    return Math.round(num_(n) * 10) / 10;
  }

  /** Calories from macros — 4 per gram of protein or carbs, 9 per gram of fat. */
  function kcalFrom(protein, carbs, fat) {
    return 4 * num_(protein) + 4 * num_(carbs) + 9 * num_(fat);
  }

  /** Macros for `grams` of a food, given its per-100g values. kcal is whole, macros 1dp. */
  function scale(per100, grams) {
    const f = Math.max(0, num_(grams)) / 100;
    return {
      kcal: Math.round(num_(per100.kcal) * f),
      protein_g: round1(num_(per100.protein_g) * f),
      carbs_g: round1(num_(per100.carbs_g) * f),
      fat_g: round1(num_(per100.fat_g) * f),
    };
  }

  /** Per-100g values from an item's totals at a known weight (how the AI reports a meal). */
  function per100From(item, grams) {
    const g = num_(grams);
    if (g <= 0) return { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
    const f = 100 / g;
    return {
      kcal: Math.round(num_(item.kcal) * f * 10) / 10,
      protein_g: Math.round(num_(item.protein_g) * f * 100) / 100,
      carbs_g: Math.round(num_(item.carbs_g) * f * 100) / 100,
      fat_g: Math.round(num_(item.fat_g) * f * 100) / 100,
    };
  }

  /**
   * AI estimates sometimes report calories that don't add up from their own
   * macros. If they're more than 15% apart, trust the macros (4/4/9) —
   * they're what the client is tracking. Returns the corrected kcal.
   */
  function reconcileKcal(item) {
    const fromMacros = kcalFrom(item.protein_g, item.carbs_g, item.fat_g);
    const stated = num_(item.kcal);
    if (fromMacros <= 0) return Math.round(stated);
    const gap = Math.abs(stated - fromMacros) / fromMacros;
    return gap > 0.15 ? Math.round(fromMacros) : Math.round(stated);
  }

  function sumTotals(entries) {
    const t = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
    (entries || []).forEach((e) => {
      t.kcal += num_(e.kcal);
      t.protein_g += num_(e.protein_g);
      t.carbs_g += num_(e.carbs_g);
      t.fat_g += num_(e.fat_g);
    });
    return { kcal: Math.round(t.kcal), protein_g: round1(t.protein_g), carbs_g: round1(t.carbs_g), fat_g: round1(t.fat_g) };
  }

  /** "YYYY-MM-DD" for the given moment in Sydney — log dates are always Sydney days. */
  function sydneyDate(date) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Australia/Sydney",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date || new Date());
    const get = (type) => parts.find((p) => p.type === type).value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  }

  /** Which meal a log most likely belongs to, from the hour of day (Sydney). */
  function mealForHour(hour) {
    if (hour >= 4 && hour < 11) return "breakfast";
    if (hour >= 11 && hour < 15) return "lunch";
    if (hour >= 17 && hour < 22) return "dinner";
    return "snack";
  }

  /** Mifflin-St Jeor resting energy, kcal/day. */
  function bmr(sex, weightKg, heightCm, age) {
    const base = 10 * num_(weightKg) + 6.25 * num_(heightCm) - 5 * num_(age);
    return sex === "F" ? base - 161 : base + 5;
  }

  function validateInputs_(i) {
    const errors = [];
    if (i.sex !== "M" && i.sex !== "F") errors.push("Pick male or female (used for the energy formula).");
    if (!(i.age >= 16 && i.age <= 90)) errors.push("Age should be between 16 and 90.");
    if (!(i.heightCm >= 120 && i.heightCm <= 230)) errors.push("Height should be in cm, between 120 and 230.");
    if (!(i.weightKg >= 35 && i.weightKg <= 250)) errors.push("Weight should be in kg, between 35 and 250.");
    if (!ACTIVITY_FACTORS[i.activity]) errors.push("Pick an activity level.");
    if (["cut", "maintain", "gain"].indexOf(i.goal) < 0) errors.push("Pick a goal.");
    return errors;
  }

  /**
   * Daily targets from the client's details.
   *
   * inputs: { sex: "M"|"F", age, heightCm, weightKg,
   *           activity: key of ACTIVITY_FACTORS,
   *           goal: "cut"|"maintain"|"gain",
   *           adjustPct?: cut 15–20 (default 15), gain 5–10 (default 5),
   *           proteinPerKg?: 1.6–2.2 (default 2.0 on a cut, else 1.8) }
   *
   * Returns { ok, errors?, kcal, protein_g, carbs_g, fat_g, bmr, tdee,
   *           weeklyChangeKg, flags: { floorApplied, rateCapped } }.
   * kcal always equals 4P + 4C + 9F.
   */
  function calcTargets(raw) {
    const i = {
      sex: raw && raw.sex,
      age: num_(raw && raw.age),
      heightCm: num_(raw && raw.heightCm),
      weightKg: num_(raw && raw.weightKg),
      activity: raw && raw.activity,
      goal: raw && raw.goal,
      adjustPct: raw && raw.adjustPct != null && raw.adjustPct !== "" ? num_(raw.adjustPct) : null,
      proteinPerKg: raw && raw.proteinPerKg != null && raw.proteinPerKg !== "" ? num_(raw.proteinPerKg) : null,
    };
    const errors = validateInputs_(i);
    if (errors.length) return { ok: false, errors: errors };

    const restKcal = bmr(i.sex, i.weightKg, i.heightCm, i.age);
    const tdee = restKcal * ACTIVITY_FACTORS[i.activity];

    let adjust = 0;
    if (i.goal === "cut") adjust = -Math.min(20, Math.max(15, i.adjustPct == null ? 15 : i.adjustPct)) / 100;
    if (i.goal === "gain") adjust = Math.min(10, Math.max(5, i.adjustPct == null ? 5 : i.adjustPct)) / 100;

    let kcal = tdee * (1 + adjust);
    const flags = { floorApplied: false, rateCapped: false };

    // Cap the deficit so predicted loss is at most ~1% of bodyweight a week.
    const maxDailyDeficit = (i.weightKg * MAX_WEEKLY_LOSS_FRACTION * KCAL_PER_KG) / 7;
    if (tdee - kcal > maxDailyDeficit) {
      kcal = tdee - maxDailyDeficit;
      flags.rateCapped = true;
    }

    const floor = KCAL_FLOOR[i.sex];
    if (kcal < floor) {
      kcal = floor;
      flags.floorApplied = true;
    }
    kcal = Math.round(kcal / 10) * 10;

    const ppk = Math.min(2.2, Math.max(1.6, i.proteinPerKg == null ? (i.goal === "cut" ? 2.0 : 1.8) : i.proteinPerKg));
    let protein = Math.round(i.weightKg * ppk);
    let fat = Math.round(Math.max(0.6 * i.weightKg, (0.25 * kcal) / 9));
    let carbs = Math.round((kcal - 4 * protein - 9 * fat) / 4);

    // Not enough calories left for carbs: trim fat toward its 0.6 g/kg
    // minimum, then protein toward 1.6 g/kg, before letting carbs sit at 0.
    if (carbs < 0) {
      fat = Math.max(Math.round(0.6 * i.weightKg), Math.round((kcal - 4 * protein) / 9));
      carbs = Math.round((kcal - 4 * protein - 9 * fat) / 4);
    }
    if (carbs < 0) {
      protein = Math.max(Math.round(1.6 * i.weightKg), Math.round((kcal - 9 * fat) / 4));
      carbs = Math.max(0, Math.round((kcal - 4 * protein - 9 * fat) / 4));
    }

    let total = kcalFrom(protein, carbs, fat);
    // Rounding can land a couple of kcal under the floor; top up with carbs.
    while (total < floor) {
      carbs += 1;
      total = kcalFrom(protein, carbs, fat);
    }

    return {
      ok: true,
      kcal: total,
      protein_g: protein,
      carbs_g: carbs,
      fat_g: fat,
      bmr: Math.round(restKcal),
      tdee: Math.round(tdee),
      weeklyChangeKg: Math.round((((total - tdee) * 7) / KCAL_PER_KG) * 100) / 100,
      flags: flags,
    };
  }

  /**
   * Checks targets Max types in by hand (grams of P/C/F). kcal is derived
   * from them, never typed. belowFloor means it needs Max's explicit approval.
   */
  function checkCoachTargets(protein, carbs, fat, sex) {
    const p = Math.round(num_(protein));
    const c = Math.round(num_(carbs));
    const f = Math.round(num_(fat));
    const kcal = kcalFrom(p, c, f);
    const floor = KCAL_FLOOR[sex === "F" ? "F" : "M"];
    return { kcal: kcal, protein_g: p, carbs_g: c, fat_g: f, floor: floor, belowFloor: kcal < floor };
  }

  /** Grams (or ml) from a label serving string like "1 bar (68 g)", "33 g (2 biscuits)" or "375ml". */
  function parseServingGrams(text) {
    const m = /(\d+(?:[.,]\d+)?)\s*(g|gr|grams?|ml|mL)\b/i.exec(String(text || ""));
    if (!m) return null;
    const n = Number(m[1].replace(",", "."));
    return n > 0 ? n : null;
  }

  /**
   * Open Food Facts v2 product JSON → the fields the tracker stores.
   * Falls back to kJ ÷ 4.184 when a product only lists energy in kJ, and
   * treats a product with no usable macros as not found (so the client is
   * offered the label photo instead of logging zeros).
   */
  function normaliseOffProduct(json, barcode) {
    const product = json && json.product;
    if (!json || json.status !== 1 || !product) return { found: false, barcode: String(barcode) };

    const n = product.nutriments || {};
    const pick = (keys) => {
      for (let k = 0; k < keys.length; k++) {
        const v = n[keys[k]];
        if (v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v))) return Number(v);
      }
      return null;
    };
    let kcal = pick(["energy-kcal_100g"]);
    if (kcal === null) {
      const kj = pick(["energy-kj_100g", "energy_100g"]);
      if (kj !== null) kcal = kj / 4.184;
    }
    const protein = pick(["proteins_100g"]);
    const carbs = pick(["carbohydrates_100g"]);
    const fat = pick(["fat_100g"]);

    const name =
      product.product_name_en || product.product_name || product.generic_name_en || product.generic_name || "";
    const brand = String(product.brands || "").split(",")[0].trim();

    if (kcal === null || (protein === null && carbs === null && fat === null)) {
      return { found: false, barcode: String(barcode), reason: "no_nutrition", name: name, brand: brand };
    }

    const servingText = product.serving_size || "";
    let servingG = Number(product.serving_quantity);
    if (!(servingG > 0)) servingG = parseServingGrams(servingText);
    const isLiquid = /(\d\s*|\b)(ml|l)\b/i.test(String(servingText) + " " + String(product.quantity || ""));

    const per100 = {
      kcal: Math.round(kcal * 10) / 10,
      protein_g: round1(protein || 0),
      carbs_g: round1(carbs || 0),
      fat_g: round1(fat || 0),
    };
    // Crowd-sourced entries are sometimes wrong. If the label's kcal is far
    // from its own macros, say so rather than silently trusting it.
    const fromMacros = kcalFrom(per100.protein_g, per100.carbs_g, per100.fat_g);
    const suspicious = fromMacros > 20 && Math.abs(per100.kcal - fromMacros) / fromMacros > 0.35;

    return {
      found: true,
      barcode: String(barcode),
      name: name || "Unnamed product",
      brand: brand,
      per100: per100,
      serving_size: servingText,
      serving_g: servingG || null,
      unit: isLiquid ? "ml" : "g",
      quality: suspicious ? "check" : "ok",
    };
  }

  // ---------------------------------------------------------------------------
  // Fuel AI plan: 7-day trial, Stripe subscription, or a free month from Max
  // ---------------------------------------------------------------------------

  const TRIAL_DAYS = 7;
  // The free week gives the top plan, so new clients try everything.
  const TRIAL_TIER = "diamond";
  // Lowest to highest. Silver is free (no AI). Platinum was retired on
  // 10 Oct 2026 (Diamond took its $9.99 price), so an old "platinum" on
  // file or in a Stripe lookup key counts as Diamond.
  const TIERS = ["silver", "gold", "diamond"];

  /** 0 (Silver) to 2 (Diamond). A paid plan with no tier on file counts as Gold. */
  function tierRank(tier) {
    const i = TIERS.indexOf(tier === "platinum" ? "diamond" : tier);
    return i >= 0 ? i : 1;
  }
  // Stripe subscription statuses that still get Fuel AI. past_due is a card
  // that failed but is still being retried, so it isn't cut off straight away.
  const PAID_STATUSES = ["active", "trialing", "past_due"];

  function isYmd_(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  }

  function utcOf_(ymd) {
    const p = String(ymd).split("-").map(Number);
    return Date.UTC(p[0], p[1] - 1, p[2]);
  }

  /** "YYYY-MM-DD" plus n days. */
  function addDays(ymd, n) {
    return new Date(utcOf_(ymd) + n * 86400000).toISOString().slice(0, 10);
  }

  /** Whole days from a to b (b later = positive). */
  function daysBetween(a, b) {
    return Math.round((utcOf_(b) - utcOf_(a)) / 86400000);
  }

  /**
   * Whether a member has Fuel AI today, at which tier, and why. `m` has
   * the Members-tab fields trial_started, plan_status, plan_until,
   * comp_until (dates as "YYYY-MM-DD"), plan_tier and comp_tier; `today`
   * is a Sydney date.
   *
   * tier: "silver" (free, no AI) | "gold" | "diamond". The
   *       free week is Diamond.
   * kind: "paid" | "comp" (a free month from Max) | "trial" |
   *       "trial_over" | "lapsed" (subscription ended) | "not_started"
   * interval (paid only): "month" | "year", from plan_interval.
   */
  function planState(m, today) {
    m = m || {};
    const status = String(m.plan_status || "");
    const tierOf = (t) => (t === "platinum" || t === "diamond" ? "diamond" : "gold");
    const comp = String(m.comp_until || "");
    const compState =
      isYmd_(comp) && comp >= today
        ? { access: true, tier: tierOf(m.comp_tier), kind: "comp", until: comp, daysLeft: daysBetween(today, comp) + 1 }
        : null;
    if (PAID_STATUSES.indexOf(status) >= 0) {
      const paid = {
        access: true,
        tier: tierOf(m.plan_tier),
        kind: "paid",
        status: status,
        until: String(m.plan_until || ""),
        interval: m.plan_interval === "year" ? "year" : "month",
      };
      // A free month from Max on a higher plan tops up a paying client.
      return compState && tierRank(compState.tier) > tierRank(paid.tier) ? compState : paid;
    }
    if (compState) return compState;
    const start = String(m.trial_started || "");
    if (isYmd_(start)) {
      const end = addDays(start, TRIAL_DAYS);
      if (today < end) return { access: true, tier: TRIAL_TIER, kind: "trial", until: end, daysLeft: daysBetween(today, end) };
      return { access: false, tier: "silver", kind: status ? "lapsed" : "trial_over", status: status };
    }
    return { access: false, tier: "silver", kind: "not_started" };
  }

  // ---------------------------------------------------------------------------
  // "What to eat next": deterministic suggestions from the Foods list
  // ---------------------------------------------------------------------------
  //
  // A food: { name, category, serve_g, serve_label, per100: { kcal,
  // protein_g, carbs_g, fat_g } }. Categories: protein, carb, veg, fruit,
  // cereal (breakfast), dairy, shake, snack, meal (takeaway), fat, drink.

  // Two-item combos that make sense on a plate.
  const PAIRS = [
    ["protein", "carb"],
    ["protein", "veg"],
    ["dairy", "fruit"],
    ["dairy", "cereal"],
    ["dairy", "shake"],
    ["shake", "fruit"],
  ];
  // Never suggested on their own: cooking oil, spreads, drinks.
  const SKIP_CATEGORIES = { fat: true, drink: true };
  // Over-limit mode may shrink these to fit under 150 kcal; others must fit as served.
  const SHRINKABLE = { protein: true, dairy: true, veg: true, shake: true };
  const OVER_MAX_KCAL = 150;

  function portion_(food, grams) {
    return {
      name: food.name,
      category: food.category,
      grams: grams,
      serve_label: grams === Number(food.serve_g) ? food.serve_label || "" : "",
      per100: food.per100,
    };
  }

  /** "200g chicken breast" or "Whey protein shake (1 scoop)". */
  function portionLabel(p) {
    return p.serve_label ? p.name + " (" + p.serve_label + ")" : Math.round(p.grams) + "g " + p.name;
  }

  function usable_(foods) {
    return (foods || []).filter(
      (f) => f && f.name && f.per100 && num_(f.per100.kcal) > 0 && Number(f.serve_g) > 0 && !SKIP_CATEGORIES[f.category]
    );
  }

  /** Protein portions also come in a bigger size (150 g → 200 g). */
  function sizesFor_(food) {
    const g = Number(food.serve_g);
    return food.category === "protein" ? [g, Math.round((g * 4) / 3 / 10) * 10] : [g];
  }

  /**
   * How well a combo's totals `t` close the gap `r`: protein counts most,
   * then carbs, then fat and using the calories left; overshooting a macro
   * (especially fat) costs points. Higher is better.
   */
  function fillScore_(t, r) {
    const share = (have, need) => (need > 0 ? Math.min(have, need) / need : 0);
    const over = (have, need, floor) => Math.max(0, have - need) / Math.max(need, floor);
    const proteinWeight = r.protein_g > 5 ? 3 : 0.5;
    return (
      proteinWeight * share(t.protein_g, r.protein_g) +
      0.75 * share(t.carbs_g, r.carbs_g) +
      0.5 * share(t.fat_g, r.fat_g) +
      0.5 * (t.kcal / r.kcal) -
      0.2 * over(t.protein_g, r.protein_g, 20) -
      0.5 * over(t.carbs_g, r.carbs_g, 20) -
      0.8 * over(t.fat_g, r.fat_g, 10)
    );
  }

  /**
   * Top foods and 2-food combos that best fill what's left today without
   * going over the calories left. `remaining` = target minus eaten.
   * Returns [{ items: [portion], totals, label }] — each food is used in at
   * most one suggestion, so the list stays varied. Empty when no calories
   * are left (use suggestOver then).
   */
  function suggestFill(remaining, foods, limit) {
    const r = {
      kcal: num_(remaining && remaining.kcal),
      protein_g: Math.max(0, num_(remaining && remaining.protein_g)),
      carbs_g: Math.max(0, num_(remaining && remaining.carbs_g)),
      fat_g: Math.max(0, num_(remaining && remaining.fat_g)),
    };
    if (r.kcal <= 0) return [];
    const pool = usable_(foods);
    const candidates = [];
    const consider = (parts) => {
      const t = sumTotals(parts.map((p) => scale(p.per100, p.grams)));
      if (t.kcal <= 0 || t.kcal > r.kcal) return;
      candidates.push({ items: parts, totals: t, score: fillScore_(t, r) });
    };
    pool.forEach((f) => sizesFor_(f).forEach((g) => consider([portion_(f, g)])));
    PAIRS.forEach((pair) => {
      const firsts = pool.filter((f) => f.category === pair[0]);
      const seconds = pool.filter((f) => f.category === pair[1]);
      firsts.forEach((a) => seconds.forEach((b) => consider([portion_(a, Number(a.serve_g)), portion_(b, Number(b.serve_g))])));
    });
    candidates.sort((x, y) => y.score - x.score);
    const picked = [];
    const used = {};
    for (let i = 0; i < candidates.length && picked.length < (limit || 5); i++) {
      const c = candidates[i];
      if (c.items.some((p) => used[p.name])) continue;
      c.items.forEach((p) => (used[p.name] = true));
      picked.push({ items: c.items, totals: c.totals, label: c.items.map(portionLabel).join(" + ") });
    }
    return picked;
  }

  /**
   * Over the calorie target: high-protein, low-calorie options, each under
   * 150 kcal a serve, ranked by grams of protein per 100 kcal.
   */
  function suggestOver(foods, limit) {
    const out = [];
    usable_(foods).forEach((f) => {
      if (f.category === "meal") return;
      const k100 = num_(f.per100.kcal);
      let grams = Number(f.serve_g);
      if ((k100 * grams) / 100 >= OVER_MAX_KCAL) {
        if (!SHRINKABLE[f.category]) return;
        grams = Math.floor(((OVER_MAX_KCAL - 1) / k100) * 10) * 10;
      }
      if (grams < 30) return;
      const t = scale(f.per100, grams);
      if (t.kcal >= OVER_MAX_KCAL) return;
      out.push({ items: [portion_(f, grams)], totals: t, ratio: (num_(f.per100.protein_g) / k100) * 100 });
    });
    out.sort((a, b) => b.ratio - a.ratio);
    return out.slice(0, limit || 5).map((c) => ({
      items: c.items,
      totals: c.totals,
      label: portionLabel(c.items[0]),
      proteinPer100kcal: round1(c.ratio),
    }));
  }

  // ---------------------------------------------------------------------------
  // Progress: green days, weekly punches, weight trend, goal pace
  // ---------------------------------------------------------------------------

  // A "green day": protein at least 90% of target AND calories within ±10%.
  const GREEN_PROTEIN_SHARE = 0.9;
  const GREEN_KCAL_BAND = 0.1;
  // 5 green days in a Monday–Sunday week earns 1 punch on the loyalty card.
  const GREEN_DAYS_FOR_PUNCH = 5;

  /** The Monday (YYYY-MM-DD) of the week containing ymd. */
  function mondayOf(ymd) {
    const dow = new Date(utcOf_(ymd)).getUTCDay(); // 0 = Sunday
    return addDays(ymd, -((dow + 6) % 7));
  }

  /**
   * The target that applied on `date`: the latest history row effective on
   * or before it. history: [{ effective_date, kcal, protein_g, … }].
   * null before the first target (or when the latest row is a "cleared" one).
   */
  function targetOn(history, date) {
    let best = null;
    (history || []).forEach((h) => {
      if (isYmd_(h.effective_date) && h.effective_date <= date && (!best || h.effective_date >= best.effective_date)) best = h;
    });
    return best && num_(best.kcal) > 0 ? best : null;
  }

  function isGreenDay(totals, target) {
    if (!target || !totals) return false;
    const tk = num_(target.kcal);
    const tp = num_(target.protein_g);
    const k = num_(totals.kcal);
    if (tk <= 0 || k <= 0) return false;
    const eps = 1e-9;
    return num_(totals.protein_g) + eps >= GREEN_PROTEIN_SHARE * tp && Math.abs(k - tk) <= GREEN_KCAL_BAND * tk + eps;
  }

  /**
   * One Monday–Sunday week. dayTotals: { "YYYY-MM-DD": totals }.
   * Returns { weekStart, days: [{ date, logged, green, target }], greenDays, earnsPunch }.
   */
  function weekSummary(dayTotals, history, weekStart) {
    const days = [];
    let green = 0;
    for (let i = 0; i < 7; i++) {
      const date = addDays(weekStart, i);
      const totals = (dayTotals || {})[date] || null;
      const target = targetOn(history, date);
      const isGreen = isGreenDay(totals, target);
      if (isGreen) green++;
      days.push({ date: date, logged: !!(totals && num_(totals.kcal) > 0), green: isGreen, target: target });
    }
    return { weekStart: weekStart, days: days, greenDays: green, earnsPunch: green >= GREEN_DAYS_FOR_PUNCH };
  }

  /**
   * Smoothed weight: for each weigh-in, the average of weigh-ins in the
   * `windowDays` calendar days up to and including it (so gaps in logging
   * don't distort it). points: [{ date, kg }] in any order.
   */
  function movingAverage(points, windowDays) {
    const sorted = (points || []).filter((p) => isYmd_(p.date) && num_(p.kg) > 0).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const w = windowDays || 7;
    return sorted.map((p) => {
      const from = addDays(p.date, -(w - 1));
      const inWindow = sorted.filter((q) => q.date >= from && q.date <= p.date);
      const avg = inWindow.reduce((sum, q) => sum + num_(q.kg), 0) / inWindow.length;
      return { date: p.date, kg: Math.round(avg * 100) / 100 };
    });
  }

  /**
   * The goal pace line: from (startDate, startKg) at weeklyRateKg per week
   * (negative = losing), stopping at goalKg if it's in that direction.
   * Returns [start, end] points, where end is the goal date or `toDate`,
   * whichever comes first — or [] when there's no rate.
   */
  function goalPace(startDate, startKg, weeklyRateKg, goalKg, toDate) {
    const rate = num_(weeklyRateKg);
    const kg0 = num_(startKg);
    if (!isYmd_(startDate) || kg0 <= 0 || rate === 0) return [];
    let endDate = isYmd_(toDate) ? toDate : addDays(startDate, 84);
    let reached = false;
    const goal = num_(goalKg);
    if (goal > 0 && (goal - kg0) * rate > 0) {
      const daysToGoal = Math.ceil(((goal - kg0) / rate) * 7);
      const goalDate = addDays(startDate, daysToGoal);
      if (goalDate <= endDate) {
        endDate = goalDate;
        reached = true;
      }
    }
    const days = daysBetween(startDate, endDate);
    const endKg = reached ? goal : kg0 + (rate * days) / 7;
    return [
      { date: startDate, kg: round1(kg0) },
      { date: endDate, kg: round1(endKg), goalReached: reached },
    ];
  }

  // ---------------------------------------------------------------------------
  // Monthly goals and the weekly recap (2026-10-13, Max). A client sets one
  // SMART goal on their card; it runs a month from the day they set it and
  // is tracked from their own data. Pure maths, shared by the card, the
  // coach page and the unit tests (nothing here costs any AI).
  // ---------------------------------------------------------------------------

  const GOAL_TYPES = ["weight", "strength", "sessions", "green"];
  // These read Fuel's private data, so only clients with their Fuel link get them.
  const FUEL_GOAL_TYPES = ["weight", "green"];
  const GOAL_TAGS = ["Easy", "Recommended", "A push"];
  const DAY_NAMES_ = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTH_NAMES_ = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const clamp_ = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const roundStep_ = (x, step) => Math.round(x / step) * step;
  /** 2 -> "2", 2.5 -> "2.5", 62.49999 -> "62.5". */
  const fmtNum_ = (n) => String(Math.round(Number(n) * 10) / 10);
  /** 31642 -> "31,642". */
  function thousands(n) {
    return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  /** "Friday 13 November" for a "YYYY-MM-DD". */
  function longDate(ymd) {
    const p = String(ymd).split("-").map(Number);
    const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return `${DAY_NAMES_[d.getUTCDay()]} ${p[2]} ${MONTH_NAMES_[p[1] - 1]}`;
  }

  /** "13 Nov" for a "YYYY-MM-DD". */
  function shortDate(ymd) {
    const p = String(ymd).split("-").map(Number);
    return `${p[2]} ${MONTH_NAMES_[p[1] - 1].slice(0, 3)}`;
  }

  /** Same day next month, or that month's last day ("2026-01-31" -> "2026-02-28"). */
  function goalEndDate(start) {
    const p = String(start).split("-").map(Number);
    const y = p[1] === 12 ? p[0] + 1 : p[0];
    const m = p[1] === 12 ? 1 : p[1] + 1;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(p[2], last)).padStart(2, "0")}`;
  }

  /** Estimated one-rep max (Epley), the same measure as the workout pages' strength chart. */
  function estOneRepMax(kg, reps) {
    return Number(kg) * (1 + Number(reps) / 30);
  }

  /** "Calf Raises" and "calf raise" are the same lift. */
  function liftKey(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(" ")
      .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
      .join(" ");
  }

  /** The weight step for a lift: 1 kg for light dumbbell work, 2.5 kg otherwise. */
  function liftStep(kg) {
    return Number(kg) < 20 ? 1 : 2.5;
  }

  /**
   * The three choices on the "how much?" step, worked out from the client's
   * own numbers: [{ target, reps?, label, tag }] (Easy, Recommended, A push),
   * or [] when there's nothing to base them on. `stats`: weightKg (latest
   * weigh-in), lift ({ exercise, kg, reps }, their best recent set),
   * sessionsPerWeek, greenPerWeek.
   */
  function goalOptions(type, stats) {
    stats = stats || {};
    const tagged = (list) => list.map((o, i) => Object.assign(o, { tag: GOAL_TAGS[i] }));
    if (type === "weight") {
      const w = Number(stats.weightKg);
      if (!(w > 0)) return [];
      // About half a percent of body weight a week is a safe, steady pace.
      const rec = Math.max(0.5, roundStep_(w * 0.005 * 4.3, 0.5));
      const easy = Math.max(0.5, Math.min(rec - 0.5, roundStep_(rec / 2, 0.5)));
      const push = Math.max(rec + 0.5, roundStep_(rec * 1.5, 0.5));
      const kgs = rec === 0.5 ? [0.5, 1, 1.5] : [easy, rec, push];
      return tagged(kgs.map((kg) => ({ target: kg, label: `${fmtNum_(kg)} kg` })));
    }
    if (type === "strength") {
      const lift = stats.lift;
      if (!lift || !(Number(lift.kg) > 0) || !(Number(lift.reps) > 0)) return [];
      const reps = clamp_(Math.round(Number(lift.reps)), 5, 12);
      const now = estOneRepMax(lift.kg, lift.reps);
      const step = liftStep(lift.kg);
      let prev = 0;
      return tagged(
        [0.025, 0.05, 0.08].map((pct) => {
          let kg = roundStep_((now * (1 + pct)) / (1 + reps / 30), step);
          while (estOneRepMax(kg, reps) <= now || kg <= prev) kg = Math.round((kg + step) * 10) / 10;
          prev = kg;
          return { target: kg, reps: reps, label: `${fmtNum_(kg)} kg × ${reps}` };
        })
      );
    }
    if (type === "sessions" || type === "green") {
      const avg = Number(type === "sessions" ? stats.sessionsPerWeek : stats.greenPerWeek) || 0;
      const base = clamp_(Math.round(avg), 1, 5);
      const unit = type === "sessions" ? "a week" : "green days a week";
      return tagged([base, base + 1, base + 2].map((n) => ({ target: n, label: `${n} ${unit}` })));
    }
    return [];
  }

  /** "lose 2 kg", "train 4 times a week"... */
  function goalVerb(goal) {
    const t = fmtNum_(goal.target);
    if (goal.type === "weight") return `lose ${t} kg`;
    if (goal.type === "strength") return `lift ${t} kg for ${goal.target_reps} reps on ${goal.exercise}`;
    if (goal.type === "sessions") return `train ${t} times a week`;
    if (goal.type === "green") return `have ${t} green days a week`;
    return "";
  }

  /** Short name for tiles: "Lose 2 kg", "Barbell Bench Press 85 kg × 8"... */
  function goalTitle(goal) {
    const t = fmtNum_(goal.target);
    if (goal.type === "weight") return `Lose ${t} kg`;
    if (goal.type === "strength") return `${goal.exercise} ${t} kg × ${goal.target_reps}`;
    if (goal.type === "sessions") return `Train ${t} times a week`;
    if (goal.type === "green") return `${t} green days a week`;
    return "";
  }

  /**
   * The whole goal as the client wrote it: "By Friday 13 November I will
   * lose 2 kg. To get there I'll hit my protein most days and walk after
   * dinner, so I can keep up with my grandkids."
   */
  function goalSentence(goal) {
    const how = (goal.how || []).filter(Boolean).map((h) => h.charAt(0).toLowerCase() + h.slice(1));
    const why = String(goal.why || "").trim().replace(/[.!]+$/, "");
    let s = `By ${longDate(goal.end_date)} I will ${goalVerb(goal)}.`;
    if (how.length) s += ` To get there I'll ${how.join(" and ")}${why ? `, so I can ${why}` : ""}.`;
    else if (why) s += ` That way I can ${why}.`;
    return s;
  }

  /**
   * How a goal is going, from the client's own data. `data`: sets ([{ date,
   * exercise, kg, reps }], this client's logged sets), weights ([{ date, kg }]),
   * kcal ({ avg, target, proteinShortDays, loggedDays } over the last 14
   * days) and greenWeeks ([{ weekStart, greenDays }]). Returns pct (0-100),
   * status ("done" | "on track" | "behind" | "finished"), statusText,
   * start/now label and value, up to two "get there quicker" lines, a next
   * goal idea, ended and daysLeft. Never shaming: behind reads "Keep going".
   */
  function goalProgress(goal, data, today) {
    data = data || {};
    const start = String(goal.start_date);
    const end = String(goal.end_date);
    const total = Math.max(1, daysBetween(start, end));
    const elapsed = clamp_(daysBetween(start, today) / total, 0, 1);
    const ended = today > end;
    const target = Number(goal.target) || 0;
    const quicker = [];
    let pct = 0;
    let done = false;
    let detail = "";
    let startLabel = "Started";
    let startValue = "";
    let nowLabel = "Now";
    let nowValue = "";
    let next = "";

    if (goal.type === "weight") {
      const startKg = Number(goal.start_value);
      const since = (data.weights || []).filter((w) => w.date >= start);
      const latest = since.length ? Number(since[since.length - 1].kg) : startKg;
      const lost = round1(startKg - latest);
      pct = target > 0 ? clamp_(lost / target, 0, 1) : 0;
      done = target > 0 && lost >= target;
      startValue = `${fmtNum_(startKg)} kg`;
      nowValue = `${fmtNum_(latest)} kg`;
      detail = lost > 0 ? `${fmtNum_(lost)} kg down so far` : "no change on the scales yet";
      const k = data.kcal;
      if (k && k.target > 0 && k.avg > k.target * 1.03) {
        quicker.push(`You've averaged ${thousands(k.avg)} calories a day against your ${thousands(k.target)} target. Closing that gap gets you there sooner.`);
      }
      if (k && k.proteinShortDays >= 2) quicker.push(`Your protein was short on ${k.proteinShortDays} of the last 14 days. Protein keeps you full and protects your muscle.`);
      if (k && k.loggedDays < 8) quicker.push("Log your meals most days, so you can see where the calories come from.");
      if (!since.length || since[since.length - 1].date < addDays(today, -7)) quicker.push("Weigh in once a week, at the same time of day, so you can see it moving.");
      next = `Another ${fmtNum_(target)} kg, or a strength goal so you keep your muscle.`;
    } else if (goal.type === "strength") {
      const key = liftKey(goal.exercise);
      const reps = Number(goal.target_reps) || 1;
      const startE = estOneRepMax(goal.start_value, goal.start_reps);
      const targetE = estOneRepMax(target, reps);
      const mine = (data.sets || []).filter((s) => liftKey(s.exercise) === key && Number(s.kg) > 0);
      const since = mine.filter((s) => s.date >= start);
      let best = null;
      since.forEach((s) => {
        if (!best || estOneRepMax(s.kg, s.reps) > estOneRepMax(best.kg, best.reps)) best = s;
      });
      const bestE = best ? estOneRepMax(best.kg, best.reps) : startE;
      done = since.some((s) => Number(s.kg) >= target && Number(s.reps) >= reps);
      pct = done ? 1 : targetE > startE ? clamp_((bestE - startE) / (targetE - startE), 0, 1) : 0;
      startValue = `${fmtNum_(goal.start_value)} kg × ${goal.start_reps}`;
      nowLabel = "Best since";
      nowValue = best ? `${fmtNum_(best.kg)} kg × ${best.reps}` : "Not done yet";
      detail = best ? `best so far ${fmtNum_(best.kg)} kg × ${best.reps}` : `no ${goal.exercise} logged yet`;
      const recentDays = new Set(mine.filter((s) => s.date >= addDays(today, -13)).map((s) => s.date)).size;
      if (recentDays < 4) {
        quicker.push(`You did ${goal.exercise} on ${recentDays} day${recentDays === 1 ? "" : "s"} in the last 2 weeks. Twice a week gets you there faster.`);
      }
      const lastDate = mine.reduce((d, s) => (s.date > d ? s.date : d), "");
      const top = mine.filter((s) => s.date === lastDate).sort((a, b) => b.kg - a.kg || b.reps - a.reps)[0];
      const step = liftStep(target);
      if (top && Number(top.reps) >= reps) {
        quicker.push(`You got ${top.reps} reps at ${fmtNum_(top.kg)} kg last time. Try ${fmtNum_(Number(top.kg) + step)} kg next time.`);
      } else {
        quicker.push(`Add a rep each session. When you reach ${reps} reps, add ${fmtNum_(step)} kg.`);
      }
      next = `${goal.exercise} at ${fmtNum_(target + step)} kg × ${reps}, or a goal for another lift.`;
    } else if (goal.type === "sessions" || goal.type === "green") {
      const thisMonday = mondayOf(today);
      const weeks = [];
      for (let m = mondayOf(start); m <= thisMonday && m <= end; m = addDays(m, 7)) weeks.push(m);
      const counts = weeks.map((m) => {
        if (goal.type === "green") {
          const w = (data.greenWeeks || []).find((g) => g.weekStart === m);
          return w ? Number(w.greenDays) || 0 : 0;
        }
        return new Set((data.sets || []).filter((s) => s.date >= start && s.date <= today && mondayOf(s.date) === m).map((s) => s.date)).size;
      });
      const thisWeek = weeks.length && weeks[weeks.length - 1] === thisMonday ? counts[counts.length - 1] : 0;
      const fullWeeks = weeks.filter((m) => m < thisMonday).length;
      const hit = counts.slice(0, fullWeeks).filter((c) => c >= target).length;
      const totalWeeks = Math.max(1, Math.round(total / 7));
      pct = target > 0 ? clamp_(counts.reduce((t, c) => t + Math.min(c, target), 0) / (target * totalWeeks), 0, 1) : 0;
      done = ended && pct >= 0.75;
      startLabel = "Target";
      startValue = `${fmtNum_(target)} a week`;
      nowLabel = "This week";
      nowValue = `${thisWeek} so far`;
      detail = fullWeeks ? `${hit} of ${fullWeeks} week${fullWeeks === 1 ? "" : "s"} hit` : `${thisWeek} of ${fmtNum_(target)} this week`;
      if (goal.type === "sessions") {
        if (!ended && thisWeek < target) quicker.push(`${target - thisWeek} more this week keeps you on track.`);
        quicker.push("Book next week's sessions on Sunday, so they're in the diary.");
        next = target < 6 ? `${target + 1} a week, or keep ${target} and add a strength goal.` : `Keep ${target} a week and add a strength goal.`;
      } else {
        const k = data.kcal;
        if (k && k.proteinShortDays >= 2) quicker.push("Most misses are low protein. A protein shake or some Greek yoghurt fixes most of them.");
        if (k && k.target > 0 && k.avg > k.target * 1.1) quicker.push("Some days run over on calories. Plan dinner first, then fit lunch and snacks around it.");
        if (k && k.loggedDays < 10) quicker.push("Log every meal: a day can only turn green when it's logged.");
        next = `${Math.min(7, target + 1)} green days a week, or a weight goal.`;
      }
    }

    if (!quicker.length) quicker.push("You're doing everything right. Keep going.");
    const status = done ? "done" : ended ? "finished" : pct >= elapsed * 0.8 - 0.001 ? "on track" : "behind";
    const fresh = daysBetween(start, today) < 2 && status === "on track";
    const lead = fresh ? "Just started" : { done: "Goal reached", finished: "Month finished", "on track": "On track", behind: "Keep going" }[status];
    return {
      pct: Math.round(pct * 100),
      status: status,
      statusText: `${lead}: ${detail}`,
      startLabel: startLabel,
      startValue: startValue,
      nowLabel: nowLabel,
      nowValue: nowValue,
      quicker: quicker.slice(0, 2),
      next: next,
      ended: ended,
      daysLeft: Math.max(0, daysBetween(today, end)),
    };
  }

  // Things to compare a week's kilos with, lightest first.
  const COMPARISONS = [
    { one: "kangaroo", many: "kangaroos", kg: 85, emoji: "🦘" },
    { one: "piano", many: "pianos", kg: 250, emoji: "🎹" },
    { one: "cow", many: "cows", kg: 600, emoji: "🐄" },
    { one: "crocodile", many: "crocodiles", kg: 1000, emoji: "🐊" },
    { one: "small car", many: "small cars", kg: 1200, emoji: "🚗" },
    { one: "hippo", many: "hippos", kg: 1500, emoji: "🦛" },
    { one: "rhino", many: "rhinos", kg: 2300, emoji: "🦏" },
    { one: "elephant", many: "elephants", kg: 6000, emoji: "🐘" },
  ];

  /**
   * "about 5 elephants": the heaviest thing there are at least 2 of, so
   * the number stays easy to picture. `skip` leaves one out (so the legs
   * line doesn't repeat the total's animal). Null under 2 kangaroos.
   */
  function weightComparison(kg, skip) {
    const fits = COMPARISONS.filter((c) => c.one !== skip && Math.round(kg / c.kg) >= 2);
    const c = fits[fits.length - 1];
    if (!c) return null;
    const n = Math.round(kg / c.kg);
    return { emoji: c.emoji, one: c.one, text: `about ${n} ${c.many}` };
  }

  /**
   * One client's week (Monday weekStart to Sunday) from their logged sets
   * ([{ date, exercise, kg, reps }]): total kilos moved (kg × reps), sets,
   * workouts (days with sets), the week before's total, and new personal
   * bests: lifts whose best set (by estimated one-rep max) beat every
   * earlier week, biggest jump first.
   */
  function weekRecap(sets, weekStart) {
    const weekEnd = addDays(weekStart, 6);
    const prevStart = addDays(weekStart, -7);
    const inWeek = sets.filter((s) => s.date >= weekStart && s.date <= weekEnd);
    const volume = (list) => list.reduce((t, s) => t + (Number(s.kg) || 0) * (Number(s.reps) || 0), 0);
    const before = {};
    sets.forEach((s) => {
      if (s.date >= weekStart || !(Number(s.kg) > 0)) return;
      const k = liftKey(s.exercise);
      before[k] = Math.max(before[k] || 0, estOneRepMax(s.kg, s.reps));
    });
    const bestThisWeek = {};
    inWeek.forEach((s) => {
      if (!(Number(s.kg) > 0)) return;
      const k = liftKey(s.exercise);
      const e = estOneRepMax(s.kg, s.reps);
      if (!bestThisWeek[k] || e > bestThisWeek[k].e) bestThisWeek[k] = { e: e, set: s };
    });
    const bests = Object.keys(bestThisWeek)
      .filter((k) => before[k] && bestThisWeek[k].e > before[k] + 0.01)
      .map((k) => ({ exercise: bestThisWeek[k].set.exercise, kg: Number(bestThisWeek[k].set.kg), reps: Number(bestThisWeek[k].set.reps), gain: bestThisWeek[k].e / before[k] - 1 }))
      .sort((a, b) => b.gain - a.gain);
    return {
      weekStart: weekStart,
      weekEnd: weekEnd,
      totalKg: Math.round(volume(inWeek)),
      prevKg: Math.round(volume(sets.filter((s) => s.date >= prevStart && s.date < weekStart))),
      sets: inWeek.length,
      workouts: new Set(inWeek.map((s) => s.date)).size,
      bests: bests,
    };
  }

  return {
    ACTIVITY_FACTORS: ACTIVITY_FACTORS,
    KCAL_FLOOR: KCAL_FLOOR,
    MEALS: MEALS,
    round1: round1,
    kcalFrom: kcalFrom,
    scale: scale,
    per100From: per100From,
    reconcileKcal: reconcileKcal,
    sumTotals: sumTotals,
    sydneyDate: sydneyDate,
    mealForHour: mealForHour,
    bmr: bmr,
    calcTargets: calcTargets,
    checkCoachTargets: checkCoachTargets,
    parseServingGrams: parseServingGrams,
    normaliseOffProduct: normaliseOffProduct,
    TRIAL_DAYS: TRIAL_DAYS,
    TRIAL_TIER: TRIAL_TIER,
    TIERS: TIERS,
    tierRank: tierRank,
    addDays: addDays,
    daysBetween: daysBetween,
    planState: planState,
    portionLabel: portionLabel,
    suggestFill: suggestFill,
    suggestOver: suggestOver,
    GREEN_DAYS_FOR_PUNCH: GREEN_DAYS_FOR_PUNCH,
    mondayOf: mondayOf,
    targetOn: targetOn,
    isGreenDay: isGreenDay,
    weekSummary: weekSummary,
    movingAverage: movingAverage,
    goalPace: goalPace,
    GOAL_TYPES: GOAL_TYPES,
    FUEL_GOAL_TYPES: FUEL_GOAL_TYPES,
    thousands: thousands,
    longDate: longDate,
    shortDate: shortDate,
    goalEndDate: goalEndDate,
    estOneRepMax: estOneRepMax,
    liftKey: liftKey,
    goalOptions: goalOptions,
    goalTitle: goalTitle,
    goalSentence: goalSentence,
    goalProgress: goalProgress,
    weightComparison: weightComparison,
    weekRecap: weekRecap,
  };
})();
