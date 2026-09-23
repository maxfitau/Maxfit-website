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
  };
})();
