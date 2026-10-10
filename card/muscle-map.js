/*
 * Shared muscle-group data and the "which muscles does this exercise work"
 * display — used by the coach's workout builder, a client's own workout
 * page, and the Exercise Library / Anatomy Lab (workout/library.html).
 * Keys match the muscle keys in the Exercises sheet's Primary/Secondary
 * Muscles columns (comma-separated), added with Max's fuller exercise
 * library (2026-10-02).
 *
 * Colour language (Max's spec, 2026-10-02): every primary muscle is the
 * SAME red, every secondary muscle the SAME salmon — the muscle's NAME is
 * what tells one from another, not a rainbow of per-muscle hues. That's
 * deliberate (his spec: "Colour is never the only signal: always list
 * muscle names in text too") and matches how gym-machine diagrams actually
 * work. Applies to both the chip row (renderMuscleHighlight) and the real
 * figure (muscleFigureSvg/paintMuscleFigure) below, so the two always
 * agree with each other.
 */
const MUSCLE_KEYS = {
  chest: "Chest",
  delts: "Shoulders",
  triceps: "Triceps",
  biceps: "Biceps",
  forearms: "Forearms",
  abs: "Abs",
  obliques: "Obliques",
  lats: "Lats",
  lowerback: "Lower Back",
  glutes: "Glutes",
  quads: "Quads",
  hamstrings: "Hamstrings",
  calves: "Calves",
  traps: "Traps",
  // v2 figure groups (2026-10-04) with no equivalent in the original 14 —
  // real anatomy the old system couldn't express at all (e.g. the rotator
  // cuff). A group only shows up anywhere real (the weekly breakdown list,
  // say) once some exercise actually names it as a primary/secondary muscle.
  neck: "Neck",
  serratus: "Serratus",
  hipflexors: "Hip Flexors",
  adductors: "Adductors",
  shins: "Shins",
  rhomboids: "Rhomboids",
  rotatorcuff: "Rotator Cuff",
  teres: "Teres Major",
};

const MUSCLE_PRIMARY_COLOR = "#ff2a1f";
const MUSCLE_SECONDARY_COLOR = "#ff9a7a";
const MUSCLE_UNUSED_COLOR = "#3c3c3c"; // a muscle key that exists, but isn't part of this exercise
const MUSCLE_BASE_COLOR = "#2a2a2a"; // head, neck, hands, feet — never individually highlighted
const MUSCLE_TENDON_COLOR = "#333333"; // tendons/bony landmarks (v2 figure only) — between base and unused
const MUSCLE_GAP_STROKE_COLOR = "#141414"; // outline between adjoining muscles, dark-card version

// Display names for the v2 fine keys (maxfit-muscle-keys.json) — used for
// the accessible text summary (paintMuscleFigure's <title>) and for the
// muscle breakdown lists (muscleLabel_ below checks this first, falling
// back to MUSCLE_KEYS for a key that's already broad). Painting itself
// never needs these, just the keys. Not every fine key has an entry here
// on purpose — "lats" is both a fine key and its own group, and already
// has a label via MUSCLE_KEYS.
const MUSCLE_FINE_LABELS_ = {
  sternocleidomastoid: "Sternocleidomastoid",
  "traps-upper": "Upper Traps",
  "delts-front": "Front Delt",
  "delts-side": "Side Delt",
  "chest-upper": "Upper Chest",
  "chest-mid": "Mid Chest",
  "chest-lower": "Lower Chest",
  serratus: "Serratus Anterior",
  "obliques-external": "External Obliques",
  "abs-upper": "Upper Abs",
  "abs-mid": "Mid Abs",
  "abs-lower": "Lower Abs",
  "abs-infra": "Deep Lower Abs",
  "triceps-lateral": "Triceps (Lateral Head)",
  brachialis: "Brachialis",
  "biceps-long": "Biceps (Long Head)",
  "biceps-short": "Biceps (Short Head)",
  "triceps-long": "Triceps (Long Head)",
  brachioradialis: "Brachioradialis",
  "pronator-teres": "Pronator Teres",
  "forearm-flexors": "Forearm Flexors",
  "flexor-carpi-ulnaris": "Flexor Carpi Ulnaris",
  "glutes-med": "Glute Medius",
  "hip-flexors": "Hip Flexors",
  tfl: "Tensor Fasciae Latae",
  sartorius: "Sartorius",
  "rectus-femoris": "Rectus Femoris",
  "vastus-medialis": "Vastus Medialis",
  "vastus-lateralis": "Vastus Lateralis",
  "adductor-longus": "Adductor Longus",
  gracilis: "Gracilis",
  "tibialis-anterior": "Tibialis Anterior",
  peroneus: "Peroneus Longus",
  "calves-soleus": "Soleus",
  "calves-gastroc-medial": "Gastrocnemius (Medial)",
  "traps-mid": "Mid Traps",
  "traps-lower": "Lower Traps",
  rhomboids: "Rhomboids",
  "delts-rear": "Rear Delt",
  infraspinatus: "Infraspinatus",
  "teres-minor": "Teres Minor",
  "teres-major": "Teres Major",
  "triceps-medial": "Triceps (Medial Head)",
  "forearm-extensors": "Forearm Extensors",
  "extensor-carpi-ulnaris": "Extensor Carpi Ulnaris",
  "erector-spinae": "Erector Spinae",
  "glutes-max": "Glute Max",
  "hamstrings-biceps-femoris": "Biceps Femoris",
  "hamstrings-semitendinosus": "Semitendinosus",
  "hamstrings-semimembranosus": "Semimembranosus",
  "adductor-magnus": "Adductor Magnus",
  "calves-gastroc-lateral": "Gastrocnemius (Lateral)",
  // Synthetic, display-only (2026-10-09) — the Muscles tab's grouped list
  // merges abs-upper/abs-mid/abs-lower/abs-infra into this one row, per
  // Max's own request. The engine itself never produces this key; only
  // workout/library.js's grouping step does, by summing the 4 real ones.
  "abs-rectus": "Rectus Abdominis",
};

function muscleLabel_(key) {
  return MUSCLE_FINE_LABELS_[key] || MUSCLE_KEYS[key] || key;
}

// ---------------------------------------------------------------------------
// UI grouping for the Muscles tab's collapsible list (2026-10-09) — maps
// every real key (fine or the older bare coarse ones a Conditioning-category
// exercise can still carry straight from the sheet, e.g. "quads") onto one
// of Max's 6 top-level sections. Display-only: doesn't change anything the
// effective-sets engine computes, just how workout/library.js buckets the
// result. A key with no entry here falls into "Other" rather than being
// silently dropped — same "never silently skip" rule as everywhere else.
const MUSCLE_UI_GROUPS_ = ["Chest", "Shoulders", "Arms", "Back", "Core", "Legs & Hips", "Other"];
const MUSCLE_UI_GROUP_OF_ = {
  // Chest — including serratus anterior (the "boxer's muscle" along the
  // ribs, a chest-wall/scapular stabiliser most often grouped with chest).
  "chest-upper": "Chest", "chest-mid": "Chest", "chest-lower": "Chest", chest: "Chest", serratus: "Chest",

  // Shoulders — deltoid heads + rotator cuff/scapular stabilisers. Front,
  // side and rear delt stay 3 separate rows (Max's own earlier request),
  // not re-merged here.
  "delts-front": "Shoulders", "delts-side": "Shoulders", "delts-rear": "Shoulders", delts: "Shoulders",
  infraspinatus: "Shoulders", "teres-minor": "Shoulders", "teres-major": "Shoulders", rotatorcuff: "Shoulders", teres: "Shoulders",

  // Arms — Biceps/Triceps/Forearms, exactly as Max listed.
  "biceps-long": "Arms", "biceps-short": "Arms", biceps: "Arms", brachialis: "Arms", brachioradialis: "Arms",
  "triceps-lateral": "Arms", "triceps-medial": "Arms", "triceps-long": "Arms", triceps: "Arms",
  "forearm-flexors": "Arms", "forearm-extensors": "Arms", forearms: "Arms", "pronator-teres": "Arms",
  "flexor-carpi-ulnaris": "Arms", "extensor-carpi-ulnaris": "Arms",

  // Back — lats, all 3 trap regions, rhomboids, spinal erectors. Neck has
  // no group of its own in Max's 6-section list, so it's folded in here
  // (flagged for him, not a definite final call).
  lats: "Back", "traps-upper": "Back", "traps-mid": "Back", "traps-lower": "Back", traps: "Back",
  rhomboids: "Back", "erector-spinae": "Back", lowerback: "Back",
  sternocleidomastoid: "Back", neck: "Back",

  // Core — Abs (merged to Rectus Abdominis, see abs-rectus above) + obliques.
  // No real TVA key exists anywhere in the data yet, so it's left out
  // rather than fabricated (flagged separately for Max). hip-flexors is
  // deliberately NOT here — Max asked for it under Legs/Hips instead.
  "abs-upper": "Core", "abs-mid": "Core", "abs-lower": "Core", "abs-infra": "Core", abs: "Core",
  "abs-rectus": "Core", // the merged display row itself (workout/library.js) — see abs-rectus's label above
  "obliques-external": "Core", obliques: "Core",

  // Legs & Hips — quads, hamstrings, glutes, calves, hip flexors/adductors/
  // shin muscles, and hip-flexors (moved here per Max's own instruction).
  "hip-flexors": "Legs & Hips", hipflexors: "Legs & Hips",
  "rectus-femoris": "Legs & Hips", "vastus-medialis": "Legs & Hips", "vastus-lateralis": "Legs & Hips", quads: "Legs & Hips",
  tfl: "Legs & Hips", sartorius: "Legs & Hips",
  "adductor-longus": "Legs & Hips", "adductor-magnus": "Legs & Hips", gracilis: "Legs & Hips", adductors: "Legs & Hips",
  "hamstrings-biceps-femoris": "Legs & Hips", "hamstrings-semitendinosus": "Legs & Hips", "hamstrings-semimembranosus": "Legs & Hips", hamstrings: "Legs & Hips",
  "glutes-max": "Legs & Hips", "glutes-med": "Legs & Hips", glutes: "Legs & Hips",
  "calves-soleus": "Legs & Hips", "calves-gastroc-medial": "Legs & Hips", "calves-gastroc-lateral": "Legs & Hips", calves: "Legs & Hips",
  "tibialis-anterior": "Legs & Hips", peroneus: "Legs & Hips", shins: "Legs & Hips",
};

function muscleUiGroupOf_(key) {
  return MUSCLE_UI_GROUP_OF_[key] || "Other";
}

/** "chest,delts" (as stored in the sheet) -> ["chest", "delts"], blanks dropped. */
function parseMuscleKeys(raw) {
  return String(raw || "")
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Exercise-name -> muscle-data resolver (2026-10-09). Every page that needs
// to know an exercise's muscles from its logged/assigned NAME (the Muscle
// Heatmap, the builder's Muscles Worked panel, the client's live Train-
// session panel) used to do its own plain `name.toLowerCase()` lookup
// straight against the Exercises sheet — so "Bicep Curls" never matched
// "Barbell Curl", "Pull-ups" never matched "Pull-Up", and so on. Found via a
// full audit of real data (2026-10-08): 65% of all logged sets were
// resolving to nothing. This is the one shared fix, used everywhere that
// used to do its own lookup.
//
// Matching order, every time: exact name -> normalized name -> an explicit
// alias from the sheet's own Aliases column. Never a fourth, fuzzier step —
// an exercise that still doesn't match after these three is reported as
// UNMATCHED, never silently guessed at (e.g. "Tricep Kickbacks" must never
// quietly become "Cable Kickback" just because they share a word — that
// would wrongly credit triceps work to glutes).
// ---------------------------------------------------------------------------

/**
 * Deterministic, explicit transforms only — every rule here is fixed and
 * predictable, never a similarity/fuzzy guess. Lowercases, trims, turns
 * punctuation/hyphens into spaces (so "Pull-Up" and "Pull-ups" both become
 * two words before the plural check below, not one hyphenated token),
 * expands a few common equipment abbreviations (word-boundary only, so
 * "bb" inside another word is never touched), and strips a single trailing
 * "s" off the LAST word only — e.g. "Barbell Curls" -> "barbell curl",
 * "Pull-ups" -> "pull up". A word already ending "ss" ("Press") is never
 * touched; a word 2 letters or shorter never is either (nothing this short
 * shows up pluralised in real exercise names). A short, already-singular
 * word like "Dips" (4 letters, ends "s") does lose its "s" here too — that
 * never matters in practice, since its own exact name still matches first.
 */
function normalizeExerciseName_(name) {
  let s = String(name || "").toLowerCase().trim();
  s = s.replace(/[.,/#!$%^&*;:{}=`~()]/g, " ").replace(/-/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "";
  const words = s.split(" ").map((w) => {
    if (w === "banded") return "band";
    if (w === "db") return "dumbbell";
    if (w === "bb") return "barbell";
    return w;
  });
  const last = words[words.length - 1];
  if (last.length > 2 && last.endsWith("s") && !last.endsWith("ss")) {
    words[words.length - 1] = last.slice(0, -1);
  }
  return words.join(" ");
}

/**
 * Builds the lookup `resolveExerciseMuscles_` needs, once per page, from
 * `fetchExercises()`'s own `{rows, col}` — exact names, normalized names,
 * and every alias in the sheet's Aliases column (comma-separated), all
 * pointing at the same catalog row. A name or alias that would collide with
 * a DIFFERENT row's exact/normalized form is dropped from that index with a
 * console warning rather than silently picked one way — an ambiguous match
 * is exactly what this resolver is meant to never do.
 */
function buildExerciseIndex_(rows, col) {
  const byExact = {};
  const byNormalized = {};
  const collidedNormalized = new Set();

  function add(map, key, entry, label) {
    if (!key) return;
    if (map === byNormalized && collidedNormalized.has(key)) return;
    if (Object.prototype.hasOwnProperty.call(map, key) && map[key] !== entry) {
      if (map === byExact) {
        console.warn(`muscle-map: "${key}" names two different Exercises rows — ${label} kept pointing at neither.`);
        delete map[key];
      } else {
        console.warn(`muscle-map: "${key}" normalizes the same as another exercise — ${label} dropped from fuzzy matching, exact name still works.`);
        collidedNormalized.add(key);
        delete map[key];
      }
      return;
    }
    map[key] = entry;
  }

  rows.forEach((r) => {
    const name = col.name >= 0 ? String(r[col.name] || "").trim() : "";
    if (!name) return;
    const entry = {
      catalogName: name,
      primary: col.primaryMuscles >= 0 ? parseMuscleKeys(r[col.primaryMuscles]) : [],
      secondary: col.secondaryMuscles >= 0 ? parseMuscleKeys(r[col.secondaryMuscles]) : [],
      // Not every caller needs these (the heatmap only ever reads
      // primary/secondary) — carried anyway so this stays the ONE shared
      // index/resolver rather than a second parallel lookup just for the
      // builder's colour dot and category.
      movement: col.movement >= 0 ? String(r[col.movement] || "").trim() : "",
      bodyPart: col.bodyPart >= 0 ? String(r[col.bodyPart] || "").trim() : "",
      bestView: col.bestView >= 0 ? String(r[col.bestView] || "").trim() : "",
      // Raw "group:weight[head%/head%], ..." string, blank until Max pastes
      // reviewed values in (see effectiveSetsFor_ below). Carried as-is,
      // unparsed, so a sheet typo only breaks ONE exercise's effective-sets
      // line (caught + warned by effectiveSetsFor_) rather than the index.
      muscleWeights: col.muscleWeights >= 0 ? String(r[col.muscleWeights] || "").trim() : "",
    };
    add(byExact, name.toLowerCase(), entry, name);
    add(byNormalized, normalizeExerciseName_(name), entry, name);
    const aliasRaw = col.aliases >= 0 ? String(r[col.aliases] || "") : "";
    aliasRaw.split(",").map((a) => a.trim()).filter(Boolean).forEach((alias) => {
      add(byExact, alias.toLowerCase(), entry, `${name}'s alias "${alias}"`);
      add(byNormalized, normalizeExerciseName_(alias), entry, `${name}'s alias "${alias}"`);
    });
  });

  return { byExact, byNormalized };
}

/**
 * The one lookup every page uses: a logged/assigned exercise NAME -> its
 * muscles, via `index` (from buildExerciseIndex_). Never throws, never
 * invents a match — `matched: false` means exactly that, and callers must
 * show it, not silently skip it (the builder's per-card warning, the
 * heatmap's "N sets not counted" line).
 */
function resolveExerciseMuscles_(name, index) {
  const empty = { matched: false, matchedVia: null, primary: [], secondary: [], catalogName: "", movement: "", bodyPart: "", bestView: "", muscleWeights: "" };
  const trimmed = String(name || "").trim();
  if (!trimmed) return empty;
  const exact = index.byExact[trimmed.toLowerCase()];
  if (exact) return Object.assign({}, exact, { matched: true, matchedVia: "exact" });
  const normalized = index.byNormalized[normalizeExerciseName_(trimmed)];
  if (normalized) return Object.assign({}, normalized, { matched: true, matchedVia: "normalized" });
  return empty;
}

// ---------------------------------------------------------------------------
// Weighted effective-sets model (2026-10-09). Built because one set could
// count more than once toward the same muscle group under the old flat
// primary=1/secondary=0.5 tally — e.g. Hanging Leg Raise lists BOTH
// abs-lower and abs-infra as primary, so 3 real sets scored as 6 "ab sets".
// The fix: for ONE set of ONE exercise, no single muscle GROUP may ever
// contribute more than 1.0 effective set, no matter how many of its
// fine-grained heads that exercise happens to list.
//
// "Group", here, is whichever level Max's own muscleWeights reference
// examples capped together: front/side/rear delt are each independently
// capped (his examples use delts-front/delts-rear bare, at full weight, with
// no shared "delts" budget between them — matching the earlier, deliberate
// choice to track them separately) and so is every other already-standalone
// fine key (lats, hip-flexors, the rotator-cuff muscles, forearm
// stabilisers...). Chest/triceps/biceps/quads/hamstrings/abs/glutes/
// traps/calves genuinely share a budget across their fine heads, which is
// what MUSCLE_GROUP_CHILDREN_ below encodes — hand-authored, not inferred
// from key names, since several fine keys (tfl, sartorius, rhomboids,
// infraspinatus...) don't share a naming prefix with any coarse group and
// genuinely don't belong to one for this purpose.
const MUSCLE_GROUP_CHILDREN_ = {
  chest: ["chest-upper", "chest-mid", "chest-lower"],
  triceps: ["triceps-lateral", "triceps-medial", "triceps-long"],
  biceps: ["biceps-long", "biceps-short"],
  forearms: ["forearm-flexors", "forearm-extensors"],
  abs: ["abs-upper", "abs-mid", "abs-lower", "abs-infra"],
  obliques: ["obliques-external"],
  lowerback: ["erector-spinae"],
  glutes: ["glutes-max", "glutes-med"],
  quads: ["rectus-femoris", "vastus-medialis", "vastus-lateralis"],
  hamstrings: ["hamstrings-biceps-femoris", "hamstrings-semitendinosus", "hamstrings-semimembranosus"],
  calves: ["calves-soleus", "calves-gastroc-medial", "calves-gastroc-lateral"],
  traps: ["traps-upper", "traps-mid", "traps-lower"],
};

// Reverse lookup, built once: real fine key -> its coarse parent, for
// whichever fine keys actually have one. A fine key with no entry here
// (lats, delts-front, hip-flexors, rhomboids...) is its own group — already
// atomic, same as it's always been.
const MUSCLE_FINE_KEY_TO_GROUP_ = {};
Object.keys(MUSCLE_GROUP_CHILDREN_).forEach((group) => {
  MUSCLE_GROUP_CHILDREN_[group].forEach((key) => {
    MUSCLE_FINE_KEY_TO_GROUP_[key] = group;
  });
});

/**
 * True if `key` is already a real, terminal muscle key with no further
 * split available — a fine key (delts-front, hip-flexors, erector-spinae),
 * or a coarse MUSCLE_KEYS name that has no entry in MUSCLE_GROUP_CHILDREN_
 * (lats, lowerback). A coarse name that DOES have real children (chest,
 * quads...) is NOT terminal — it must go through the group-split path below
 * even though it's also technically "a key in MUSCLE_KEYS".
 */
function isRealFineKey_(key) {
  if (Object.prototype.hasOwnProperty.call(MUSCLE_FINE_LABELS_, key)) return true;
  return Object.prototype.hasOwnProperty.call(MUSCLE_KEYS, key) && !MUSCLE_GROUP_CHILDREN_[key];
}

const MUSCLE_WEIGHTS_LINE_RE_ = /^([a-z][a-z0-9-]*):([0-9.]+)(?:\[([^\]]*)\])?$/;
const MUSCLE_WEIGHTS_HEAD_RE_ = /^([a-z-]+)(\d+)$/;

/**
 * Parses one exercise's `muscleWeights` string ("group:weight[head%/...], ..."
 * — see apps-script/Code.gs's ensureExerciseColumns_ for the sheet column,
 * blank on every row until Max pastes reviewed values in) into a flat
 * { fineKey: weight } map for ONE set. Never throws on bad input — an
 * unreadable segment is warned about and skipped, same "don't guess, don't
 * silently drop the whole exercise" rule as the name resolver above.
 *
 * A bare "group:weight" with no [heads] splits that weight evenly across
 * ALL of the group's real children (Max's own reference examples do this
 * for small/secondary contributions, e.g. Back Squat's "hamstrings:0.1" —
 * not worth the author specifying exactly which hamstring head). A group
 * that's already a real terminal key (delts-front, lats, hip-flexors...) is
 * used directly; a [heads] bracket is only meaningful on a group that still
 * has real children to split across.
 */
function effectiveSetsFromWeights_(raw, exerciseLabel) {
  const result = {};
  String(raw || "").split(",").forEach((segRaw) => {
    const seg = segRaw.trim();
    if (!seg) return;
    const m = MUSCLE_WEIGHTS_LINE_RE_.exec(seg);
    if (!m) {
      console.warn(`muscle-map: "${exerciseLabel}" has an unreadable muscleWeights segment "${seg}" — skipped.`);
      return;
    }
    const group = m[1];
    const weight = parseFloat(m[2]);
    const headsRaw = m[3];

    if (isRealFineKey_(group)) {
      if (headsRaw) {
        console.warn(`muscle-map: "${exerciseLabel}"'s "${group}" is already one muscle — the [${headsRaw}] head split is ignored.`);
      }
      result[group] = (result[group] || 0) + weight;
      return;
    }

    const children = MUSCLE_GROUP_CHILDREN_[group];
    if (!children) {
      console.warn(`muscle-map: "${exerciseLabel}" uses unknown muscleWeights group "${group}" — skipped.`);
      return;
    }

    if (!headsRaw) {
      const share = weight / children.length;
      children.forEach((k) => {
        result[k] = (result[k] || 0) + share;
      });
      return;
    }

    const heads = headsRaw.split("/").map((h) => h.trim()).filter(Boolean);
    let pctTotal = 0;
    const resolvedHeads = [];
    heads.forEach((h) => {
      const hm = MUSCLE_WEIGHTS_HEAD_RE_.exec(h);
      if (!hm) {
        console.warn(`muscle-map: "${exerciseLabel}"'s "${group}" has an unreadable head "${h}" — skipped.`);
        return;
      }
      const headName = hm[1];
      const pct = parseInt(hm[2], 10);
      const matches = children.filter((c) => c === headName || c.endsWith("-" + headName));
      if (matches.length !== 1) {
        console.warn(`muscle-map: "${exerciseLabel}"'s "${group}" head "${headName}" ${matches.length ? "matches more than one muscle" : "doesn't match any muscle"} in that group — skipped.`);
        return;
      }
      pctTotal += pct;
      resolvedHeads.push({ key: matches[0], pct });
    });
    if (pctTotal !== 100) {
      console.warn(`muscle-map: "${exerciseLabel}"'s "${group}" head percentages add up to ${pctTotal}, not 100 — used as given rather than guessing a fix.`);
    }
    resolvedHeads.forEach(({ key, pct }) => {
      result[key] = (result[key] || 0) + weight * (pct / 100);
    });
  });
  return result;
}

/**
 * The fallback used for every exercise that has no muscleWeights yet (every
 * exercise right now — see effectiveSetsPerSet_ below): each coarse group's
 * weight is 1.0 if any of its fine children is PRIMARY for this exercise,
 * else 0.5 if any is SECONDARY, split evenly across however many of that
 * group's children THIS exercise actually lists (never all of them — an
 * exercise that only lists chest-mid shouldn't invent a chest-upper
 * contribution it never claimed). This is the direct fix for the
 * Hanging-Leg-Raise-style bug: abs-lower + abs-infra both primary used to
 * score 1.0 each (2.0 total); now the "abs" group scores 1.0 total, split
 * 0.5/0.5 between the two heads this exercise actually names.
 */
function effectiveSetsFromRoles_(primaryKeys, secondaryKeys) {
  const byGroup = {};
  function note(key, isPrimary) {
    const group = MUSCLE_FINE_KEY_TO_GROUP_[key] || key;
    if (!byGroup[group]) byGroup[group] = { keys: new Set(), primary: false };
    byGroup[group].keys.add(key);
    if (isPrimary) byGroup[group].primary = true;
  }
  (primaryKeys || []).forEach((k) => note(k, true));
  (secondaryKeys || []).forEach((k) => note(k, false));

  const result = {};
  Object.keys(byGroup).forEach((group) => {
    const { keys, primary } = byGroup[group];
    const weight = primary ? 1 : 0.5;
    const share = weight / keys.size;
    keys.forEach((k) => {
      result[k] = (result[k] || 0) + share;
    });
  });
  return result;
}

/**
 * Safety net applied no matter which path produced `perSetWeights` — sums
 * contributions back up by coarse group and clamps (with a console warning)
 * if a bad sheet edit ever pushes one over 1.0 for a single set. Both
 * generator functions above already keep every real exercise under the cap
 * by construction; this exists for when muscleWeights gets hand-edited
 * later and something slips through.
 */
function enforceMuscleGroupCap_(perSetWeights, exerciseLabel) {
  const byGroup = {};
  Object.keys(perSetWeights).forEach((key) => {
    const group = MUSCLE_FINE_KEY_TO_GROUP_[key] || key;
    byGroup[group] = (byGroup[group] || 0) + perSetWeights[key];
  });
  const overLimit = Object.keys(byGroup).filter((g) => byGroup[g] > 1 + 1e-9);
  if (!overLimit.length) return perSetWeights;
  overLimit.forEach((g) => {
    console.warn(`muscle-map: "${exerciseLabel}" scores ${byGroup[g].toFixed(2)} effective sets for "${g}" from a single set — clamped to 1.0. Check its muscleWeights line.`);
  });
  const scaled = {};
  Object.keys(perSetWeights).forEach((key) => {
    const group = MUSCLE_FINE_KEY_TO_GROUP_[key] || key;
    const factor = overLimit.includes(group) ? 1 / byGroup[group] : 1;
    scaled[key] = perSetWeights[key] * factor;
  });
  return scaled;
}

/**
 * The one entry point every caller uses (the heatmap, the builder's side
 * panel, the live Train-session panel) — the effective-sets contribution of
 * ONE set of this exercise, keyed by fine muscle key, hard-cap already
 * applied. Callers multiply by however many sets and accumulate across
 * exercises themselves, same shape the old flat tally had; this just
 * replaces what goes into each key's number.
 *
 * Builder's planned sets and the heatmap/Train's logged sets intentionally
 * run through this exact same function — no separate "planned" vs "logged"
 * weighting logic, per Max's own spec.
 */
function effectiveSetsPerSet_(resolved) {
  const label = resolved.catalogName || "(unnamed exercise)";
  const raw = resolved.muscleWeights
    ? effectiveSetsFromWeights_(resolved.muscleWeights, label)
    : effectiveSetsFromRoles_(resolved.primary, resolved.secondary);
  return enforceMuscleGroupCap_(raw, label);
}

/**
 * Hook for scaling a logged set's effective-sets contribution by how hard
 * it actually was (RIR/RPE) — e.g. excluding warm-ups or down-weighting a
 * set logged at RIR 5+. Checked both fetchLoggedSets' own column list and
 * the live Logged Sets sheet directly (2026-10-09): neither has an RIR/RPE
 * column today, so this always returns 1. Wire a real scale factor in here
 * if that data ever gets added, rather than threading it through every
 * caller individually.
 */
function effortScaleForSet_(setRow, setCol) {
  return 1;
}

/**
 * Turns a muscle's { exerciseName: totalContribution } map (built by
 * workout/heatmap.js and workout/builder.js alongside their own weighted
 * totals) into the top N, highest first — the figure tooltip's "top 3
 * contributing exercises" (Goal 4, 2026-10-09). Shared so both pages format
 * this identically rather than two slightly different sort/slice calls.
 */
function muscleTopContributions_(byExercise, limit) {
  return Object.keys(byExercise || {})
    .map((name) => ({ name, contribution: byExercise[name] }))
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, limit || 3);
}

/**
 * Fills `container` with a small coloured chip per muscle — red for
 * primary, salmon for secondary — and hides it when there's nothing to
 * show, so a caller can always call this unconditionally rather than
 * checking first. `primary`/`secondary` can be either arrays of keys or raw
 * "a,b" strings straight from the sheet.
 */
function renderMuscleHighlight(container, primary, secondary) {
  if (!container) return;
  const p = Array.isArray(primary) ? primary : parseMuscleKeys(primary);
  const s = Array.isArray(secondary) ? secondary : parseMuscleKeys(secondary);
  if (!p.length && !s.length) {
    container.innerHTML = "";
    container.hidden = true;
    return;
  }
  const chip = (key, kind, color) =>
    `<span class="muscle-chip muscle-chip--${kind}">` +
    `<span class="muscle-chip__dot" style="background:${color}"></span>` +
    `<span class="muscle-chip__label">${muscleLabel_(key)}</span>` +
    "</span>";
  container.innerHTML =
    p.map((k) => chip(k, "primary", MUSCLE_PRIMARY_COLOR)).join("") +
    s.map((k) => chip(k, "secondary", MUSCLE_SECONDARY_COLOR)).join("");
  container.hidden = false;
}

// ---------------------------------------------------------------------------
// The real figure — Max's own artwork (maxfit-muscle-figure.svg), not
// hand-authored here. The two constants below are a byte-for-byte copy of
// that file's `#front`/`#back` group contents (shapes and coordinates
// untouched — don't hand-edit them).
//
// v2 (2026-10-04, "much more detailed" per Max): every shape now carries BOTH
// `data-muscle` (a fine-grained key, e.g. "chest-upper", "triceps-lateral" —
// ~50 of them, see maxfit-muscle-keys.json) and `data-group` (the same 14
// broad keys this app has always used — "chest", "triceps", etc.). Every
// painter below (paintMuscleFigure/paintMuscleCrop/paintMuscleHeat) still
// matches against `data-group`, so EXERCISE_MUSCLE_DATA_ and the live
// sheet's Primary/Secondary Muscles columns needed NO changes — only the
// artwork got more detailed, not the data model. `data-muscle`'s finer keys
// aren't used anywhere yet; they're there for a future round if Max wants
// exercises mapped to specific heads/regions rather than whole muscles. A
// handful of v2 regions (serratus, hip flexors, rotator cuff, rhomboids,
// teres, adductors, shins, neck) have no equivalent in the old 14-key
// system at all — they render as part of the figure but never highlight,
// since no exercise data targets them specifically.
//
// The source file is drawn for a light card (silhouette #e7e5e0, unused
// muscle #d9d6d0, tendons #e0ddd7, white gap stroke between muscles). Every
// screen that uses this today has a dark card, so muscleRecolourForDarkCard_
// below swaps those four colours for the dark-card ones at load time. If a
// light card ever needs this figure (the light-themed Muscle Heatmap screen
// might), add a light variant instead of reusing these recoloured constants.
// ---------------------------------------------------------------------------

const MUSCLE_FRONT_SVG_RAW_ = `
<!-- ===== Silhouette (non-interactive) ===== -->
  <g class="silhouette" fill="#e7e5e0" pointer-events="none">
    <path d="M100 6 C111.6 6 119.6 15 119.6 28 C119.6 32 119.2 35 118.8 37.6 C121 37.4 122 40 121 43.6 C120.2 46.6 118.6 48.4 116.8 48.4 C114.8 54.6 110 61.6 100 62.4 C90 61.6 85.2 54.6 83.2 48.4 C81.4 48.4 79.8 46.6 79 43.6 C78 40 79 37.4 81.2 37.6 C80.8 35 80.4 32 80.4 28 C80.4 15 88.4 6 100 6 Z"/>
    <path d="M100 50 L87.4 50 C87.2 54 86.8 58 86.6 61 C85 68 76 73.4 61.6 77.6 C55 79 48.6 84.4 46.2 94 C45.2 99 46 104 48.6 108 C54 113 60 115 64.8 114.6 C65.2 126 64.8 138 66.6 152 C67.8 162 70.2 172 70.4 184 C70.4 192 68.8 199 66.8 205.4 C64.6 212 63 221 63.2 232 C63.2 250 63.6 268 65.8 288 C67.6 302 70.4 312 71.2 320 C71.4 328 69.6 338 69.2 350 C68.8 362 69 374 69.8 386 C71 398 73.8 410 76.8 420 C75.8 426 73.8 432 72.8 440 C72.2 446 73.8 451.6 79 452.2 C84 452.6 91.8 452.4 95 450.4 C97 446.6 95.6 436 93.2 428 C92 424.6 90.8 422.4 90.6 420.4 C91.2 412 92.8 401 93.8 390 C95.2 378 97.8 362 97.8 348 C97.8 338 96.8 330 96.4 322 C97.4 308 98 292 98.6 276 C99 262 99.2 248 99.2 240 Q99.4 236.6 100 236.2 Q100.6 236.6 100.8 240 C100.8 248 101 262 101.4 276 C102 292 102.6 308 103.6 322 C103.2 330 102.2 338 102.2 348 C102.2 362 104.8 378 106.2 390 C107.2 401 108.8 412 109.4 420.4 C109.2 422.4 108 424.6 106.8 428 C104.4 436 103 446.6 105 450.4 C108.2 452.4 116 452.6 121 452.2 C126.2 451.6 127.8 446 127.2 440 C126.2 432 124.2 426 123.2 420 C126.2 410 129 398 130.2 386 C131 374 131.2 362 130.8 350 C130.4 338 128.6 328 128.8 320 C129.6 312 132.4 302 134.2 288 C136.4 268 136.8 250 136.8 232 C137 221 135.4 212 133.2 205.4 C131.2 199 129.6 192 129.6 184 C129.8 172 132.2 162 133.4 152 C135.2 138 134.8 126 135.2 114.6 C140 115 146 113 151.4 108 C154 104 154.8 99 153.8 94 C151.4 84.4 145 79 138.4 77.6 C124 73.4 115 68 113.4 61 C113.2 58 112.8 54 112.6 50 L100 50 Z"/>
    <path d="M60 80 C52.8 80.4 46.8 87.4 46 96 C45.4 104 44.2 116 43.6 128 C43.2 138 43.2 146 42.2 152 C41 158 39 162 37.8 166 C36.2 172 35.2 180 34.8 188 C34.4 200 33.4 214 33 226.6 C31.4 231 29 235 27.8 240 C26.8 245 27 250.4 28.6 251.6 C30.4 252.8 31.8 249 32.8 245 C32.4 252 31.8 259 33.2 265 C34.6 270.4 39.4 270.8 41.8 267.8 C44 264 45 255 45.2 247 C45.4 240 45.4 233 45.6 227.6 C47.4 224 49.6 220 51.2 216.4 C53.2 212 54.8 208 56.4 204 C58 200 59.4 196 60 192 C60.8 188 61.4 184 61.4 180 C61.4 176 61 172 60.4 168 C61.8 160 63.8 154 64.4 148 C65.8 140 66.4 130 66.4 122 C66.4 118 66.2 115 66 113 C62 106 58 92 60 80 Z"/>
    <path d="M140 80 C147.2 80.4 153.2 87.4 154 96 C154.6 104 155.8 116 156.4 128 C156.8 138 156.8 146 157.8 152 C159 158 161 162 162.2 166 C163.8 172 164.8 180 165.2 188 C165.6 200 166.6 214 167 226.6 C168.6 231 171 235 172.2 240 C173.2 245 173 250.4 171.4 251.6 C169.6 252.8 168.2 249 167.2 245 C167.6 252 168.2 259 166.8 265 C165.4 270.4 160.6 270.8 158.2 267.8 C156 264 155 255 154.8 247 C154.6 240 154.6 233 154.4 227.6 C152.6 224 150.4 220 148.8 216.4 C146.8 212 145.2 208 143.6 204 C142 200 140.6 196 140 192 C139.2 188 138.6 184 138.6 180 C138.6 176 139 172 139.6 168 C138.2 160 136.2 154 135.6 148 C134.2 140 133.6 130 133.6 122 C133.6 118 133.8 115 134 113 C138 106 142 92 140 80 Z"/>
  </g>
  <!-- ===== Muscles. data-side = the figure's anatomical side (in the front view the figure's right side is on the viewer's left). Deep muscles are drawn first in each region. ===== -->
  <g class="muscles" fill="#d9d6d0" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round">
    <g data-region="shoulders">
      <!-- Sternocleidomastoid (mastoid -> sternum/clavicle) -->
      <path id="f-sternocleidomastoid-r" class="muscle" data-muscle="sternocleidomastoid" data-group="neck" data-side="right" d="M85 51 C88 60 93 69 98.2 77.8 L93.6 79 C90.6 72 87 65 84.6 57.5 Z"><title>Sternocleidomastoid (Right)</title></path>
      <path id="f-sternocleidomastoid-l" class="muscle" data-muscle="sternocleidomastoid" data-group="neck" data-side="left" d="M115 51 C112 60 107 69 101.8 77.8 L106.4 79 C109.4 72 113 65 115.4 57.5 Z"><title>Sternocleidomastoid (Left)</title></path>
      <!-- Trapezius, upper (descending) fibres -->
      <path id="f-traps-upper-r" class="muscle" data-muscle="traps-upper" data-group="traps" data-side="right" d="M84.4 58.5 C84.2 67 75 73.5 62 77.2 Q59.5 78.6 62.2 79.4 L92.6 79.4 C89.8 72.6 86.6 65.8 84.4 58.5 Z"><title>Upper Traps (Right)</title></path>
      <path id="f-traps-upper-l" class="muscle" data-muscle="traps-upper" data-group="traps" data-side="left" d="M115.6 58.5 C115.8 67 125 73.5 138 77.2 Q140.5 78.6 137.8 79.4 L107.4 79.4 C110.2 72.6 113.4 65.8 115.6 58.5 Z"><title>Upper Traps (Left)</title></path>
      <!-- Anterior deltoid (lateral 1/3 clavicle -> deltoid tuberosity) -->
      <path id="f-delts-front-r" class="muscle" data-muscle="delts-front" data-group="delts" data-side="right" d="M60 82.2 C66 81.2 72 81.8 77.2 83.8 Q71 95 65 106 Q60 115 55 124 C54 108 55 92 60 82.2 Z"><title>Front Delt (Right)</title></path>
      <path id="f-delts-front-l" class="muscle" data-muscle="delts-front" data-group="delts" data-side="left" d="M140 82.2 C134 81.2 128 81.8 122.8 83.8 Q129 95 135 106 Q140 115 145 124 C146 108 145 92 140 82.2 Z"><title>Front Delt (Left)</title></path>
      <!-- Lateral deltoid (acromion -> deltoid tuberosity) -->
      <path id="f-delts-side-r" class="muscle" data-muscle="delts-side" data-group="delts" data-side="right" d="M60 82.2 C53 82.8 47.6 90 47 100 C46.6 110 50 118 55 124 C54 108 55 92 60 82.2 Z"><title>Side Delt (Right)</title></path>
      <path id="f-delts-side-l" class="muscle" data-muscle="delts-side" data-group="delts" data-side="left" d="M140 82.2 C147 82.8 152.4 90 153 100 C153.4 110 150 118 145 124 C146 108 145 92 140 82.2 Z"><title>Side Delt (Left)</title></path>
    </g>
    <g data-region="chest">
      <!-- Pectoralis major, clavicular head -->
      <path id="f-chest-upper-r" class="muscle" data-muscle="chest-upper" data-group="chest" data-side="right" d="M98.2 82.6 C92 82.2 84 82.8 77.2 83.8 Q71 95 65 106 C75 99.5 87 95.5 98.2 95.2 Z"><title>Upper Chest (Right)</title></path>
      <path id="f-chest-upper-l" class="muscle" data-muscle="chest-upper" data-group="chest" data-side="left" d="M101.8 82.6 C108 82.2 116 82.8 122.8 83.8 Q129 95 135 106 C125 99.5 113 95.5 101.8 95.2 Z"><title>Upper Chest (Left)</title></path>
      <!-- Pectoralis major, sternal head -->
      <path id="f-chest-mid-r" class="muscle" data-muscle="chest-mid" data-group="chest" data-side="right" d="M98.2 95.2 C87 95.5 75 99.5 65 106 L63.4 110.4 C74 106.2 86 107.8 98.2 112 Z"><title>Mid Chest (Right)</title></path>
      <path id="f-chest-mid-l" class="muscle" data-muscle="chest-mid" data-group="chest" data-side="left" d="M101.8 95.2 C113 95.5 125 99.5 135 106 L136.6 110.4 C126 106.2 114 107.8 101.8 112 Z"><title>Mid Chest (Left)</title></path>
      <!-- Pectoralis major, abdominal/costal head (lower pec fold) -->
      <path id="f-chest-lower-r" class="muscle" data-muscle="chest-lower" data-group="chest" data-side="right" d="M98.2 112 C86 107.8 74 106.2 63.4 110.4 C66 116 72 121 79 124 C86 127 93 125.4 98.2 122 Z"><title>Lower Chest (Right)</title></path>
      <path id="f-chest-lower-l" class="muscle" data-muscle="chest-lower" data-group="chest" data-side="left" d="M101.8 112 C114 107.8 126 106.2 136.6 110.4 C134 116 128 121 121 124 C114 127 107 125.4 101.8 122 Z"><title>Lower Chest (Left)</title></path>
    </g>
    <g data-region="arms">
      <!-- Triceps brachii, lateral head - sliver on the outer arm behind brachialis [deep] -->
      <path id="f-triceps-lateral-r" class="muscle" data-muscle="triceps-lateral" data-group="triceps" data-side="right" d="M46.6 106.6 C46 116 44.6 128 44 138 C43.8 144 43.4 148 42.8 151.4 C43.8 146 44.6 140 45.2 134 C45.8 126 47 117 48.4 111.4 Q47.4 109 46.6 106.6 Z"><title>Triceps (Lateral Head) (Right)</title></path>
      <path id="f-triceps-lateral-l" class="muscle" data-muscle="triceps-lateral" data-group="triceps" data-side="left" d="M153.4 106.6 C154 116 155.4 128 156 138 C156.2 144 156.6 148 157.2 151.4 C156.2 146 155.4 140 154.8 134 C154.2 126 153 117 151.6 111.4 Q152.6 109 153.4 106.6 Z"><title>Triceps (Lateral Head) (Left)</title></path>
      <!-- Brachialis (lower humerus -> ulnar tuberosity), seen lateral to biceps [deep] -->
      <path id="f-brachialis-r" class="muscle" data-muscle="brachialis" data-group="biceps" data-side="right" d="M48.6 115.6 C50.4 119.8 52.4 122.8 54.6 125 C50.6 130 48.4 138 48.4 146 C48.6 153 50.4 159 52.6 164.6 Q51 165.8 49.4 166 C47.6 160 46.4 154 45.8 148 C45.6 140 46.4 126 48.6 115.6 Z"><title>Brachialis (Right)</title></path>
      <path id="f-brachialis-l" class="muscle" data-muscle="brachialis" data-group="biceps" data-side="left" d="M151.4 115.6 C149.6 119.8 147.6 122.8 145.4 125 C149.4 130 151.6 138 151.6 146 C151.4 153 149.6 159 147.4 164.6 Q149 165.8 150.6 166 C152.4 160 153.6 154 154.2 148 C154.4 140 153.6 126 151.4 115.6 Z"><title>Brachialis (Left)</title></path>
      <!-- Triceps brachii, long head - sliver on the inner arm [deep] -->
      <path id="f-triceps-long-r" class="muscle" data-muscle="triceps-long" data-group="triceps" data-side="right" d="M64.6 114.2 Q65.6 116 65.8 120 C65.8 130 65.2 140 63.6 148 C62.6 154 61 160 58.6 165.6 C59.4 159.6 60.8 154 61.6 148.6 C63.4 139 64.2 127 64.6 114.2 Z"><title>Triceps (Long Head) (Right)</title></path>
      <path id="f-triceps-long-l" class="muscle" data-muscle="triceps-long" data-group="triceps" data-side="left" d="M135.4 114.2 Q134.4 116 134.2 120 C134.2 130 134.8 140 136.4 148 C137.4 154 139 160 141.4 165.6 C140.6 159.6 139.2 154 138.4 148.6 C136.6 139 135.8 127 135.4 114.2 Z"><title>Triceps (Long Head) (Left)</title></path>
      <!-- Biceps brachii, long (lateral) head -->
      <path id="f-biceps-long-r" class="muscle" data-muscle="biceps-long" data-group="biceps" data-side="right" d="M54.8 124.6 L59.6 115.8 C57.4 130 55.8 147 53.4 163.6 C51.4 160 49.4 154 49 146 C49 138 51 130.6 55 124.8 Z"><title>Biceps (Long Head) (Right)</title></path>
      <path id="f-biceps-long-l" class="muscle" data-muscle="biceps-long" data-group="biceps" data-side="left" d="M145.2 124.6 L140.4 115.8 C142.6 130 144.2 147 146.6 163.6 C148.6 160 150.6 154 151 146 C151 138 149 130.6 145 124.8 Z"><title>Biceps (Long Head) (Left)</title></path>
      <!-- Biceps brachii, short (medial) head -->
      <path id="f-biceps-short-r" class="muscle" data-muscle="biceps-short" data-group="biceps" data-side="right" d="M59.6 115.8 L62.2 111.2 Q63.4 112.6 63.8 114.6 C63 126 62 138 59.8 148 C58.4 155 56.4 160.6 54 164.4 C55.8 147 57.4 130 59.6 115.8 Z"><title>Biceps (Short Head) (Right)</title></path>
      <path id="f-biceps-short-l" class="muscle" data-muscle="biceps-short" data-group="biceps" data-side="left" d="M140.4 115.8 L137.8 111.2 Q136.6 112.6 136.2 114.6 C137 126 138 138 140.2 148 C141.6 155 143.6 160.6 146 164.4 C144.2 147 142.6 130 140.4 115.8 Z"><title>Biceps (Short Head) (Left)</title></path>
      <!-- Brachioradialis (lateral supracondylar ridge -> radial styloid) -->
      <path id="f-brachioradialis-r" class="muscle" data-muscle="brachioradialis" data-group="forearms" data-side="right" d="M45.2 146.4 C45.8 154 47.2 160.6 49.4 166.6 C49.2 171 47.6 176 45.8 182 C43 192 40 208 37.6 226 L34 226 C34.6 212 35 198 35.6 186 C36.4 176 38.6 166 41.6 157 C42.6 153 43.8 149 45.2 146.4 Z"><title>Brachioradialis (Right)</title></path>
      <path id="f-brachioradialis-l" class="muscle" data-muscle="brachioradialis" data-group="forearms" data-side="left" d="M154.8 146.4 C154.2 154 152.8 160.6 150.6 166.6 C150.8 171 152.4 176 154.2 182 C157 192 160 208 162.4 226 L166 226 C165.4 212 165 198 164.4 186 C163.6 176 161.4 166 158.4 157 C157.4 153 156.2 149 154.8 146.4 Z"><title>Brachioradialis (Left)</title></path>
      <!-- Pronator teres (medial epicondyle -> mid radius) -->
      <path id="f-pronator-teres-r" class="muscle" data-muscle="pronator-teres" data-group="forearms" data-side="right" d="M53 166.8 C56 166.4 58.4 167 59.8 168.4 C58 176 54 184 48 192.6 Q45.6 193 44.8 190.6 C46.4 185 48.4 179 49.2 172 Q50.6 168.4 53 166.8 Z"><title>Pronator Teres (Right)</title></path>
      <path id="f-pronator-teres-l" class="muscle" data-muscle="pronator-teres" data-group="forearms" data-side="left" d="M147 166.8 C144 166.4 141.6 167 140.2 168.4 C142 176 146 184 152 192.6 Q154.4 193 155.2 190.6 C153.6 185 151.6 179 150.8 172 Q149.4 168.4 147 166.8 Z"><title>Pronator Teres (Left)</title></path>
      <!-- Flexor carpi radialis, palmaris longus & flexor digitorum superficialis -->
      <path id="f-forearm-flexors-r" class="muscle" data-muscle="forearm-flexors" data-group="forearms" data-side="right" d="M59.6 169.4 Q58.6 173 57.2 179 C55.8 185 53.8 192 51.4 199 C48.8 207 45.6 216 42.2 226.8 L38.4 226.2 C40.6 214 43 204 45.4 194.4 Q46.6 193.6 48 192.6 C54 184 58 176 59.6 169.4 Z"><title>Forearm Flexors (Right)</title></path>
      <path id="f-forearm-flexors-l" class="muscle" data-muscle="forearm-flexors" data-group="forearms" data-side="left" d="M140.4 169.4 Q141.4 173 142.8 179 C144.2 185 146.2 192 148.6 199 C151.2 207 154.4 216 157.8 226.8 L161.6 226.2 C159.4 214 157 204 154.6 194.4 Q153.4 193.6 152 192.6 C146 184 142 176 140.4 169.4 Z"><title>Forearm Flexors (Left)</title></path>
      <!-- Flexor carpi ulnaris (ulnar border of the forearm) -->
      <path id="f-flexor-carpi-ulnaris-r" class="muscle" data-muscle="flexor-carpi-ulnaris" data-group="forearms" data-side="right" d="M60 168.8 C60.8 172 60.8 178 60.6 182 C60.4 186 60 189 59.2 192 C58.2 196 57 200 55.6 204 C54 208.6 52.4 212.4 50.4 216 C48.6 219.6 46.8 223.6 45 227 L42.6 226.8 C46 216 49.2 207 51.8 199 C54 192 56.2 185 57.6 179 Q58.6 173 60 168.8 Z"><title>Flexor Carpi Ulnaris (Right)</title></path>
      <path id="f-flexor-carpi-ulnaris-l" class="muscle" data-muscle="flexor-carpi-ulnaris" data-group="forearms" data-side="left" d="M140 168.8 C139.2 172 139.2 178 139.4 182 C139.6 186 140 189 140.8 192 C141.8 196 143 200 144.4 204 C146 208.6 147.6 212.4 149.6 216 C151.4 219.6 153.2 223.6 155 227 L157.4 226.8 C154 216 150.8 207 148.2 199 C146 192 143.8 185 142.4 179 Q141.4 173 140 168.8 Z"><title>Flexor Carpi Ulnaris (Left)</title></path>
    </g>
    <g data-region="core">
      <!-- Latissimus dorsi - sliver visible behind serratus from the front [deep] -->
      <path id="f-lats-r" class="muscle" data-muscle="lats" data-group="lats" data-side="right" d="M66.6 116.6 C68.6 118 69.4 121 69.4 124 C69.2 134 69.4 144 70 153.4 L67.6 153.4 C65.6 142 65.2 128 66.6 116.6 Z"><title>Lats (Right)</title></path>
      <path id="f-lats-l" class="muscle" data-muscle="lats" data-group="lats" data-side="left" d="M133.4 116.6 C131.4 118 130.6 121 130.6 124 C130.8 134 130.6 144 130 153.4 L132.4 153.4 C134.4 142 134.8 128 133.4 116.6 Z"><title>Lats (Left)</title></path>
      <!-- Serratus anterior - digitations on ribs 5-8, interlocking with external oblique [deep] -->
      <path id="f-serratus-r" class="muscle" data-muscle="serratus" data-group="serratus" data-side="right" d="M70.4 122.4 C74.4 123.8 78.4 126 80.6 128.4 Q81.4 129.8 79.8 130.6 Q77.4 131.4 75.6 131.8 Q79 133.2 80.8 135.4 Q81.6 137 80 137.8 Q77.6 138.8 75.4 139.4 Q78.6 141 80.4 143 Q81.2 144.6 79.6 145.6 Q77.2 146.6 74.8 147 Q77 148.6 78.6 150.4 Q79.4 152 77.8 152.8 Q74.4 154.2 70.6 154.6 C70 144 70.2 133 70.4 122.4 Z"><title>Serratus Anterior (Right)</title></path>
      <path id="f-serratus-l" class="muscle" data-muscle="serratus" data-group="serratus" data-side="left" d="M129.6 122.4 C125.6 123.8 121.6 126 119.4 128.4 Q118.6 129.8 120.2 130.6 Q122.6 131.4 124.4 131.8 Q121 133.2 119.2 135.4 Q118.4 137 120 137.8 Q122.4 138.8 124.6 139.4 Q121.4 141 119.6 143 Q118.8 144.6 120.4 145.6 Q122.8 146.6 125.2 147 Q123 148.6 121.4 150.4 Q120.6 152 122.2 152.8 Q125.6 154.2 129.4 154.6 C130 144 129.8 133 129.6 122.4 Z"><title>Serratus Anterior (Left)</title></path>
      <!-- External oblique (lower ribs -> iliac crest / linea alba) -->
      <path id="f-obliques-external-r" class="muscle" data-muscle="obliques-external" data-group="obliques" data-side="right" d="M84.6 127.6 C84.6 150 86 170 87 180 C87.6 195 89 207 90.4 215.4 C86 211.6 80.6 207.6 75.6 203.2 C73 196 71.4 190 71.4 184 C71.4 174 70.4 164 70 156.4 Q74.6 155.8 78.8 154 Q81.4 152.6 80.8 150.4 Q79.4 148.4 76.4 147.6 Q79.6 146.8 81.4 145.4 Q82.6 143.6 81.4 141.8 Q79.4 140.2 77 139.8 Q80 139 81.6 137.8 Q82.8 136 81.6 134.2 Q79.6 132.6 77.2 132.2 Q80.2 131.4 81.8 130.4 Q82.8 129 82 127.8 Q83.2 127.4 84.6 127.6 Z"><title>External Obliques (Right)</title></path>
      <path id="f-obliques-external-l" class="muscle" data-muscle="obliques-external" data-group="obliques" data-side="left" d="M115.4 127.6 C115.4 150 114 170 113 180 C112.4 195 111 207 109.6 215.4 C114 211.6 119.4 207.6 124.4 203.2 C127 196 128.6 190 128.6 184 C128.6 174 129.6 164 130 156.4 Q125.4 155.8 121.2 154 Q118.6 152.6 119.2 150.4 Q120.6 148.4 123.6 147.6 Q120.4 146.8 118.6 145.4 Q117.4 143.6 118.6 141.8 Q120.6 140.2 123 139.8 Q120 139 118.4 137.8 Q117.2 136 118.4 134.2 Q120.4 132.6 122.8 132.2 Q119.8 131.4 118.2 130.4 Q117.2 129 118 127.8 Q116.8 127.4 115.4 127.6 Z"><title>External Obliques (Left)</title></path>
      <!-- Rectus abdominis, 1st segment (xiphoid / 5th-7th costal cartilages) -->
      <path id="f-abs-upper-r" class="muscle" data-muscle="abs-upper" data-group="abs" data-side="right" d="M98.4 125.8 C94 125.2 89 126.2 85.4 128.8 C85 134 85 140 85.6 145.2 C89 143.4 94 142.8 98.4 143.4 Z"><title>Upper Abs (Right)</title></path>
      <path id="f-abs-upper-l" class="muscle" data-muscle="abs-upper" data-group="abs" data-side="left" d="M101.6 125.8 C106 125.2 111 126.2 114.6 128.8 C115 134 115 140 114.4 145.2 C111 143.4 106 142.8 101.6 143.4 Z"><title>Upper Abs (Left)</title></path>
      <!-- Rectus abdominis, 2nd segment -->
      <path id="f-abs-mid-r" class="muscle" data-muscle="abs-mid" data-group="abs" data-side="right" d="M98.4 145.6 C94 145 89.4 145.6 85.8 147.4 C85.6 152 85.8 157 86.2 161.6 C89.6 160.4 94 160 98.4 160.6 Z"><title>Mid Abs (Right)</title></path>
      <path id="f-abs-mid-l" class="muscle" data-muscle="abs-mid" data-group="abs" data-side="left" d="M101.6 145.6 C106 145 110.6 145.6 114.2 147.4 C114.4 152 114.2 157 113.8 161.6 C110.4 160.4 106 160 101.6 160.6 Z"><title>Mid Abs (Left)</title></path>
      <!-- Rectus abdominis, 3rd segment (ends at the navel intersection) -->
      <path id="f-abs-lower-r" class="muscle" data-muscle="abs-lower" data-group="abs" data-side="right" d="M98.4 162.8 C94 162.2 89.8 162.6 86.4 163.8 C86.6 168.4 87 173 87.6 177.4 C90.8 176.8 94.6 176.8 98.4 177.4 Z"><title>Lower Abs (3rd pair) (Right)</title></path>
      <path id="f-abs-lower-l" class="muscle" data-muscle="abs-lower" data-group="abs" data-side="left" d="M101.6 162.8 C106 162.2 110.2 162.6 113.6 163.8 C113.4 168.4 113 173 112.4 177.4 C109.2 176.8 105.4 176.8 101.6 177.4 Z"><title>Lower Abs (3rd pair) (Left)</title></path>
      <!-- Rectus abdominis, infra-umbilical part tapering to the pubis -->
      <path id="f-abs-infra-r" class="muscle" data-muscle="abs-infra" data-group="abs" data-side="right" d="M98.4 180.6 C94.6 180 90.8 180 87.8 180.6 C88.2 192 89.4 205 91.4 216.6 C93.2 222.6 95.8 226.6 98.4 229 Z"><title>Lower Abs (below navel) (Right)</title></path>
      <path id="f-abs-infra-l" class="muscle" data-muscle="abs-infra" data-group="abs" data-side="left" d="M101.6 180.6 C105.4 180 109.2 180 112.2 180.6 C111.8 192 110.6 205 108.6 216.6 C106.8 222.6 104.2 226.6 101.6 229 Z"><title>Lower Abs (below navel) (Left)</title></path>
    </g>
    <g data-region="hips">
      <!-- Iliopsoas & pectineus in the femoral triangle [deep] -->
      <path id="f-hip-flexors-r" class="muscle" data-muscle="hip-flexors" data-group="hipflexors" data-side="right" d="M79.4 208.2 C82.8 210.6 86.6 213.8 90 217.4 C89.6 227 89.2 237 88.6 246 C86 236 82.4 222 79.4 208.2 Z"><title>Hip Flexors (Right)</title></path>
      <path id="f-hip-flexors-l" class="muscle" data-muscle="hip-flexors" data-group="hipflexors" data-side="left" d="M120.6 208.2 C117.2 210.6 113.4 213.8 110 217.4 C110.4 227 110.8 237 111.4 246 C114 236 117.6 222 120.6 208.2 Z"><title>Hip Flexors (Left)</title></path>
      <!-- Gluteus medius - anterior fibres visible at the side of the hip, above TFL -->
      <path id="f-glutes-med-r" class="muscle" data-muscle="glutes-med" data-group="glutes" data-side="right" d="M70.6 188.4 C71.4 194 73 199 75.2 204.4 C72 205.4 68.8 207.6 66.6 210.8 C67.6 206 68.8 200.6 69.6 195.4 Q70.2 191.6 70.6 188.4 Z"><title>Glute Medius (Right)</title></path>
      <path id="f-glutes-med-l" class="muscle" data-muscle="glutes-med" data-group="glutes" data-side="left" d="M129.4 188.4 C128.6 194 127 199 124.8 204.4 C128 205.4 131.2 207.6 133.4 210.8 C132.4 206 131.2 200.6 130.4 195.4 Q129.8 191.6 129.4 188.4 Z"><title>Glute Medius (Left)</title></path>
      <!-- Tensor fasciae latae (iliac crest -> ITB) -->
      <path id="f-tfl-r" class="muscle" data-muscle="tfl" data-group="hipflexors" data-side="right" d="M74.6 206.2 C71 207.2 67.6 209.8 65.6 214.4 C64.2 222 64.4 232 65.8 241.6 C69 235.6 72 226.4 74.8 214.6 Q75.4 210 74.6 206.2 Z"><title>Tensor Fasciae Latae (Right)</title></path>
      <path id="f-tfl-l" class="muscle" data-muscle="tfl" data-group="hipflexors" data-side="left" d="M125.4 206.2 C129 207.2 132.4 209.8 134.4 214.4 C135.8 222 135.6 232 134.2 241.6 C131 235.6 128 226.4 125.2 214.6 Q124.6 210 125.4 206.2 Z"><title>Tensor Fasciae Latae (Left)</title></path>
    </g>
    <g data-region="legs">
      <!-- Soleus - outer edge peeking out beside the peroneals [deep] -->
      <path id="f-calves-soleus-lateral-r" class="muscle" data-muscle="calves-soleus" data-group="calves" data-side="right" d="M70.2 356 C70.6 362 71 366 71.4 370 C72.4 378 73.6 386 74.8 392 C76.2 400 77.8 410 79.6 418.8 L77.6 419.6 C76 412.6 74 405 72.4 398 C71 392 70 384 69.6 376 C69.4 368 69.6 361 70.2 356 Z"><title>Soleus (Right)</title></path>
      <path id="f-calves-soleus-lateral-l" class="muscle" data-muscle="calves-soleus" data-group="calves" data-side="left" d="M129.8 356 C129.4 362 129 366 128.6 370 C127.6 378 126.4 386 125.2 392 C123.8 400 122.2 410 120.4 418.8 L122.4 419.6 C124 412.6 126 405 127.6 398 C129 392 130 384 130.4 376 C130.6 368 130.4 361 129.8 356 Z"><title>Soleus (Left)</title></path>
      <!-- Soleus - inner edge below the medial gastrocnemius [deep] -->
      <path id="f-calves-soleus-medial-r" class="muscle" data-muscle="calves-soleus" data-group="calves" data-side="right" d="M88.4 377.6 Q90 381.8 91.6 385.6 Q93.4 381.6 94.8 377.6 C94.2 384 93.8 392 93.2 398 C92.6 404 91.8 410 90.6 416.6 Q89.6 417.4 89.4 416 C88.4 406 88 396 88 390 C88 385 88.1 381 88.4 377.6 Z"><title>Soleus (Right)</title></path>
      <path id="f-calves-soleus-medial-l" class="muscle" data-muscle="calves-soleus" data-group="calves" data-side="left" d="M111.6 377.6 Q110 381.8 108.4 385.6 Q106.6 381.6 105.2 377.6 C105.8 384 106.2 392 106.8 398 C107.4 404 108.2 410 109.4 416.6 Q110.4 417.4 110.6 416 C111.6 406 112 396 112 390 C112 385 111.9 381 111.6 377.6 Z"><title>Soleus (Left)</title></path>
      <!-- Sartorius (ASIS -> medial tibia, pes anserinus) -->
      <path id="f-sartorius-r" class="muscle" data-muscle="sartorius" data-group="quads" data-side="right" d="M77.2 205.2 C83 228 91 252 95.2 276 C97.2 290 97.4 306 95.4 322 Q93.8 325 92.4 321 C93.8 306 93.6 292 92 279 C88 256 80.6 231 75.6 209.4 Q76 206.4 77.2 205.2 Z"><title>Sartorius (Right)</title></path>
      <path id="f-sartorius-l" class="muscle" data-muscle="sartorius" data-group="quads" data-side="left" d="M122.8 205.2 C117 228 109 252 104.8 276 C102.8 290 102.6 306 104.6 322 Q106.2 325 107.6 321 C106.2 306 106.4 292 108 279 C112 256 119.4 231 124.4 209.4 Q124 206.4 122.8 205.2 Z"><title>Sartorius (Left)</title></path>
      <!-- Rectus femoris (AIIS -> patella), bipennate -->
      <path id="f-rectus-femoris-r" class="muscle" data-muscle="rectus-femoris" data-group="quads" data-side="right" d="M76 213.4 C75 234 76 262 76.4 284 C77.6 297 79 304 80.8 309.6 Q81.4 310.2 82 309.6 C84.4 300 86.4 287 86.4 272 C86 254 81 232 76 213.4 Z"><title>Rectus Femoris (Right)</title></path>
      <path id="f-rectus-femoris-l" class="muscle" data-muscle="rectus-femoris" data-group="quads" data-side="left" d="M124 213.4 C125 234 124 262 123.6 284 C122.4 297 121 304 119.2 309.6 Q118.6 310.2 118 309.6 C115.6 300 113.6 287 113.6 272 C114 254 119 232 124 213.4 Z"><title>Rectus Femoris (Left)</title></path>
      <!-- Vastus medialis - the 'teardrop', sits lower than vastus lateralis -->
      <path id="f-vastus-medialis-r" class="muscle" data-muscle="vastus-medialis" data-group="quads" data-side="right" d="M86.2 262 C88.6 268 90.6 273.6 91.4 279.6 C92.8 292 93 306 91.8 319.8 C90 317.6 86.8 313.6 83.4 311 C85.6 301 86.6 288 86.4 272 Q86.4 267 86.2 262 Z"><title>Vastus Medialis (Right)</title></path>
      <path id="f-vastus-medialis-l" class="muscle" data-muscle="vastus-medialis" data-group="quads" data-side="left" d="M113.8 262 C111.4 268 109.4 273.6 108.6 279.6 C107.2 292 107 306 108.2 319.8 C110 317.6 113.2 313.6 116.6 311 C114.4 301 113.4 288 113.6 272 Q113.6 267 113.8 262 Z"><title>Vastus Medialis (Left)</title></path>
      <!-- Vastus lateralis (greater trochanter / linea aspera -> patella) -->
      <path id="f-vastus-lateralis-r" class="muscle" data-muscle="vastus-lateralis" data-group="quads" data-side="right" d="M65.8 244.4 C68.8 239.4 71.4 233.6 74.6 226.4 C74 244 74.6 264 75.6 284 C76.6 297 78.6 304 80.4 310 C78.8 312 77.4 314.6 76.2 317.4 C71.6 311 67.8 302 66 292 C64.4 280 64 262 65.8 244.4 Z"><title>Vastus Lateralis (Right)</title></path>
      <path id="f-vastus-lateralis-l" class="muscle" data-muscle="vastus-lateralis" data-group="quads" data-side="left" d="M134.2 244.4 C131.2 239.4 128.6 233.6 125.4 226.4 C126 244 125.4 264 124.4 284 C123.4 297 121.4 304 119.6 310 C121.2 312 122.6 314.6 123.8 317.4 C128.4 311 132.2 302 134 292 C135.6 280 136 262 134.2 244.4 Z"><title>Vastus Lateralis (Left)</title></path>
      <!-- Adductor longus (pubis -> linea aspera) -->
      <path id="f-adductor-longus-r" class="muscle" data-muscle="adductor-longus" data-group="adductors" data-side="right" d="M90.8 218.6 C93.2 222 94.8 226.4 95.4 232.4 C94.8 244 94 254 92.6 263 C91.6 257 90.4 252 88.8 247.6 C89.6 238 90.4 228 90.8 218.6 Z"><title>Adductor Longus (Right)</title></path>
      <path id="f-adductor-longus-l" class="muscle" data-muscle="adductor-longus" data-group="adductors" data-side="left" d="M109.2 218.6 C106.8 222 105.2 226.4 104.6 232.4 C105.2 244 106 254 107.4 263 C108.4 257 109.6 252 111.2 247.6 C110.4 238 109.6 228 109.2 218.6 Z"><title>Adductor Longus (Left)</title></path>
      <!-- Gracilis (pubis -> medial tibia), the innermost thigh strap -->
      <path id="f-gracilis-r" class="muscle" data-muscle="gracilis" data-group="adductors" data-side="right" d="M97 232.6 C98.4 242 98.6 256 98.2 268 C97.9 275 97.6 280 97.2 285.6 C96.6 282 96 278.6 95.6 275.6 C95.6 262 95.8 248 96.2 233 Z"><title>Gracilis (Right)</title></path>
      <path id="f-gracilis-l" class="muscle" data-muscle="gracilis" data-group="adductors" data-side="left" d="M103 232.6 C101.6 242 101.4 256 101.8 268 C102.1 275 102.4 280 102.8 285.6 C103.4 282 104 278.6 104.4 275.6 C104.4 262 104.2 248 103.8 233 Z"><title>Gracilis (Left)</title></path>
      <!-- Tibialis anterior (lateral tibia -> medial cuneiform) -->
      <path id="f-tibialis-anterior-r" class="muscle" data-muscle="tibialis-anterior" data-group="shins" data-side="right" d="M75.6 331.2 Q79.4 329.6 83 332.6 C84.8 342 85.4 352 85 362 C84.6 374 82.8 386 82.4 396 C81.8 404 83 412 85 418.6 L83 419.4 C80.8 412 78.6 404 77.4 396 C76 386 75 374 74.8 362 C74.6 352 74.8 340 75.6 331.2 Z"><title>Tibialis Anterior (Right)</title></path>
      <path id="f-tibialis-anterior-l" class="muscle" data-muscle="tibialis-anterior" data-group="shins" data-side="left" d="M124.4 331.2 Q120.6 329.6 117 332.6 C115.2 342 114.6 352 115 362 C115.4 374 117.2 386 117.6 396 C118.2 404 117 412 115 418.6 L117 419.4 C119.2 412 121.4 404 122.6 396 C124 386 125 374 125.2 362 C125.4 352 125.2 340 124.4 331.2 Z"><title>Tibialis Anterior (Left)</title></path>
      <!-- Fibularis (peroneus) longus - outer lower leg -->
      <path id="f-peroneus-r" class="muscle" data-muscle="peroneus" data-group="shins" data-side="right" d="M74.2 331.6 C73.6 340 73.4 352 73.6 362 C73.8 374 74.8 386 76.2 396 C77.4 404 79.2 412 81.2 418.2 L79.6 418.8 C77.8 410 76.2 400 74.8 392 C73.6 386 72.4 378 71.4 370 C70.2 360 70 346 71.2 334 Q72.6 332.4 74.2 331.6 Z"><title>Peroneus Longus (Right)</title></path>
      <path id="f-peroneus-l" class="muscle" data-muscle="peroneus" data-group="shins" data-side="left" d="M125.8 331.6 C126.4 340 126.6 352 126.4 362 C126.2 374 125.2 386 123.8 396 C122.6 404 120.8 412 118.8 418.2 L120.4 418.8 C122.2 410 123.8 400 125.2 392 C126.4 386 127.6 378 128.6 370 C129.8 360 130 346 128.8 334 Q127.4 332.4 125.8 331.6 Z"><title>Peroneus Longus (Left)</title></path>
      <!-- Gastrocnemius, medial head - inner calf -->
      <path id="f-calves-gastroc-medial-r" class="muscle" data-muscle="calves-gastroc-medial" data-group="calves" data-side="right" d="M92.4 326.8 C95 329 96.8 334 97.2 341 C97.6 349 97.2 357 96.2 366 C95.2 373 93.6 379 91.6 383.4 C89.8 378 88.6 370 88.4 360 C88.2 350 88.8 340 90 332.4 Q91.2 328.8 92.4 326.8 Z"><title>Medial Gastrocnemius (Right)</title></path>
      <path id="f-calves-gastroc-medial-l" class="muscle" data-muscle="calves-gastroc-medial" data-group="calves" data-side="left" d="M107.6 326.8 C105 329 103.2 334 102.8 341 C102.4 349 102.8 357 103.8 366 C104.8 373 106.4 379 108.4 383.4 C110.2 378 111.4 370 111.6 360 C111.8 350 111.2 340 110 332.4 Q108.8 328.8 107.6 326.8 Z"><title>Medial Gastrocnemius (Left)</title></path>
    </g>
  </g>
  <!-- ===== Tendons, fascia & bony landmarks (non-interactive) ===== -->
  <g class="tendons" fill="#e0ddd7" stroke="#ffffff" stroke-width="0.8" stroke-linejoin="round" pointer-events="none">
    <!-- Linea alba -->
    <path class="tendon" d="M98.6 125.4 Q100 124.6 101.4 125.4 L101.4 177.4 Q100 177 98.6 177.4 Z M98.6 180.6 Q100 181 101.4 180.6 L101.2 228.8 Q100 230 98.8 228.8 Z"/>
    <!-- Navel -->
    <path class="tendon" d="M100 177.8 C101.4 177.8 102 178.8 102 179.6 C102 180.4 101 181 100 181 C99 181 98 180.4 98 179.6 C98 178.8 98.6 177.8 100 177.8 Z"/>
    <!-- Distal biceps tendon -->
    <path class="tendon" d="M52.8 163.6 Q54 164 54.2 165 C53.6 167.6 52.8 170.4 51.6 172.6 L50.8 171.6 C51.6 169 52 166.4 52.8 163.6 Z"/>
    <path class="tendon" d="M147.2 163.6 Q146 164 145.8 165 C146.4 167.6 147.2 170.4 148.4 172.6 L149.2 171.6 C148.4 169 148 166.4 147.2 163.6 Z"/>
    <!-- Kneecap (patella) -->
    <path class="tendon" d="M81.6 310.6 C85.6 310.6 88 314 87.8 318 C87.6 322 85 324.6 81.6 324.6 C78.2 324.6 75.8 322 75.6 318 C75.4 314 77.8 310.6 81.6 310.6 Z"/>
    <path class="tendon" d="M118.4 310.6 C114.4 310.6 112 314 112.2 318 C112.4 322 115 324.6 118.4 324.6 C121.8 324.6 124.2 322 124.4 318 C124.6 314 122.2 310.6 118.4 310.6 Z"/>
    <!-- Patellar tendon -->
    <path class="tendon" d="M79 324 Q81.6 325.4 84.2 324 C84 329 83.6 334 83.4 338 Q81.8 339 80.2 338 C80 334 79.4 329 79 324 Z"/>
    <path class="tendon" d="M121 324 Q118.4 325.4 115.8 324 C116 329 116.4 334 116.6 338 Q118.2 339 119.8 338 C120 334 120.6 329 121 324 Z"/>
    <!-- Quadriceps tendon -->
    <path class="tendon" d="M80.2 309.4 Q81.4 308.4 82.4 309.4 L83.2 311.2 Q81.4 310.4 79.8 311.2 Z"/>
    <path class="tendon" d="M119.8 309.4 Q118.6 308.4 117.6 309.4 L116.8 311.2 Q118.6 310.4 120.2 311.2 Z"/>
  </g>
  <!-- ===== Fibre direction (hide with: .fibres { display: none }) ===== -->
  <defs>
    <clipPath id="clip-f-sternocleidomastoid-r"><use href="#f-sternocleidomastoid-r"/></clipPath>
    <clipPath id="clip-f-sternocleidomastoid-l"><use href="#f-sternocleidomastoid-l"/></clipPath>
    <clipPath id="clip-f-traps-upper-r"><use href="#f-traps-upper-r"/></clipPath>
    <clipPath id="clip-f-traps-upper-l"><use href="#f-traps-upper-l"/></clipPath>
    <clipPath id="clip-f-delts-front-r"><use href="#f-delts-front-r"/></clipPath>
    <clipPath id="clip-f-delts-front-l"><use href="#f-delts-front-l"/></clipPath>
    <clipPath id="clip-f-delts-side-r"><use href="#f-delts-side-r"/></clipPath>
    <clipPath id="clip-f-delts-side-l"><use href="#f-delts-side-l"/></clipPath>
    <clipPath id="clip-f-chest-upper-r"><use href="#f-chest-upper-r"/></clipPath>
    <clipPath id="clip-f-chest-upper-l"><use href="#f-chest-upper-l"/></clipPath>
    <clipPath id="clip-f-chest-mid-r"><use href="#f-chest-mid-r"/></clipPath>
    <clipPath id="clip-f-chest-mid-l"><use href="#f-chest-mid-l"/></clipPath>
    <clipPath id="clip-f-chest-lower-r"><use href="#f-chest-lower-r"/></clipPath>
    <clipPath id="clip-f-chest-lower-l"><use href="#f-chest-lower-l"/></clipPath>
    <clipPath id="clip-f-triceps-lateral-r"><use href="#f-triceps-lateral-r"/></clipPath>
    <clipPath id="clip-f-triceps-lateral-l"><use href="#f-triceps-lateral-l"/></clipPath>
    <clipPath id="clip-f-brachialis-r"><use href="#f-brachialis-r"/></clipPath>
    <clipPath id="clip-f-brachialis-l"><use href="#f-brachialis-l"/></clipPath>
    <clipPath id="clip-f-biceps-long-r"><use href="#f-biceps-long-r"/></clipPath>
    <clipPath id="clip-f-biceps-long-l"><use href="#f-biceps-long-l"/></clipPath>
    <clipPath id="clip-f-biceps-short-r"><use href="#f-biceps-short-r"/></clipPath>
    <clipPath id="clip-f-biceps-short-l"><use href="#f-biceps-short-l"/></clipPath>
    <clipPath id="clip-f-brachioradialis-r"><use href="#f-brachioradialis-r"/></clipPath>
    <clipPath id="clip-f-brachioradialis-l"><use href="#f-brachioradialis-l"/></clipPath>
    <clipPath id="clip-f-pronator-teres-r"><use href="#f-pronator-teres-r"/></clipPath>
    <clipPath id="clip-f-pronator-teres-l"><use href="#f-pronator-teres-l"/></clipPath>
    <clipPath id="clip-f-forearm-flexors-r"><use href="#f-forearm-flexors-r"/></clipPath>
    <clipPath id="clip-f-forearm-flexors-l"><use href="#f-forearm-flexors-l"/></clipPath>
    <clipPath id="clip-f-flexor-carpi-ulnaris-r"><use href="#f-flexor-carpi-ulnaris-r"/></clipPath>
    <clipPath id="clip-f-flexor-carpi-ulnaris-l"><use href="#f-flexor-carpi-ulnaris-l"/></clipPath>
    <clipPath id="clip-f-lats-r"><use href="#f-lats-r"/></clipPath>
    <clipPath id="clip-f-lats-l"><use href="#f-lats-l"/></clipPath>
    <clipPath id="clip-f-serratus-r"><use href="#f-serratus-r"/></clipPath>
    <clipPath id="clip-f-serratus-l"><use href="#f-serratus-l"/></clipPath>
    <clipPath id="clip-f-obliques-external-r"><use href="#f-obliques-external-r"/></clipPath>
    <clipPath id="clip-f-obliques-external-l"><use href="#f-obliques-external-l"/></clipPath>
    <clipPath id="clip-f-abs-upper-r"><use href="#f-abs-upper-r"/></clipPath>
    <clipPath id="clip-f-abs-upper-l"><use href="#f-abs-upper-l"/></clipPath>
    <clipPath id="clip-f-abs-mid-r"><use href="#f-abs-mid-r"/></clipPath>
    <clipPath id="clip-f-abs-mid-l"><use href="#f-abs-mid-l"/></clipPath>
    <clipPath id="clip-f-abs-lower-r"><use href="#f-abs-lower-r"/></clipPath>
    <clipPath id="clip-f-abs-lower-l"><use href="#f-abs-lower-l"/></clipPath>
    <clipPath id="clip-f-abs-infra-r"><use href="#f-abs-infra-r"/></clipPath>
    <clipPath id="clip-f-abs-infra-l"><use href="#f-abs-infra-l"/></clipPath>
    <clipPath id="clip-f-hip-flexors-r"><use href="#f-hip-flexors-r"/></clipPath>
    <clipPath id="clip-f-hip-flexors-l"><use href="#f-hip-flexors-l"/></clipPath>
    <clipPath id="clip-f-glutes-med-r"><use href="#f-glutes-med-r"/></clipPath>
    <clipPath id="clip-f-glutes-med-l"><use href="#f-glutes-med-l"/></clipPath>
    <clipPath id="clip-f-tfl-r"><use href="#f-tfl-r"/></clipPath>
    <clipPath id="clip-f-tfl-l"><use href="#f-tfl-l"/></clipPath>
    <clipPath id="clip-f-calves-soleus-lateral-r"><use href="#f-calves-soleus-lateral-r"/></clipPath>
    <clipPath id="clip-f-calves-soleus-lateral-l"><use href="#f-calves-soleus-lateral-l"/></clipPath>
    <clipPath id="clip-f-calves-soleus-medial-r"><use href="#f-calves-soleus-medial-r"/></clipPath>
    <clipPath id="clip-f-calves-soleus-medial-l"><use href="#f-calves-soleus-medial-l"/></clipPath>
    <clipPath id="clip-f-sartorius-r"><use href="#f-sartorius-r"/></clipPath>
    <clipPath id="clip-f-sartorius-l"><use href="#f-sartorius-l"/></clipPath>
    <clipPath id="clip-f-rectus-femoris-r"><use href="#f-rectus-femoris-r"/></clipPath>
    <clipPath id="clip-f-rectus-femoris-l"><use href="#f-rectus-femoris-l"/></clipPath>
    <clipPath id="clip-f-vastus-medialis-r"><use href="#f-vastus-medialis-r"/></clipPath>
    <clipPath id="clip-f-vastus-medialis-l"><use href="#f-vastus-medialis-l"/></clipPath>
    <clipPath id="clip-f-vastus-lateralis-r"><use href="#f-vastus-lateralis-r"/></clipPath>
    <clipPath id="clip-f-vastus-lateralis-l"><use href="#f-vastus-lateralis-l"/></clipPath>
    <clipPath id="clip-f-adductor-longus-r"><use href="#f-adductor-longus-r"/></clipPath>
    <clipPath id="clip-f-adductor-longus-l"><use href="#f-adductor-longus-l"/></clipPath>
    <clipPath id="clip-f-gracilis-r"><use href="#f-gracilis-r"/></clipPath>
    <clipPath id="clip-f-gracilis-l"><use href="#f-gracilis-l"/></clipPath>
    <clipPath id="clip-f-tibialis-anterior-r"><use href="#f-tibialis-anterior-r"/></clipPath>
    <clipPath id="clip-f-tibialis-anterior-l"><use href="#f-tibialis-anterior-l"/></clipPath>
    <clipPath id="clip-f-peroneus-r"><use href="#f-peroneus-r"/></clipPath>
    <clipPath id="clip-f-peroneus-l"><use href="#f-peroneus-l"/></clipPath>
    <clipPath id="clip-f-calves-gastroc-medial-r"><use href="#f-calves-gastroc-medial-r"/></clipPath>
    <clipPath id="clip-f-calves-gastroc-medial-l"><use href="#f-calves-gastroc-medial-l"/></clipPath>
  </defs>
  <g class="fibres" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="0.6" stroke-linecap="round" pointer-events="none">
    <g clip-path="url(#clip-f-sternocleidomastoid-r)"><path class="fibre" d="M84.93 54.67 Q89.75 66.96 96.47 78.33"/><path class="fibre" d="M84.87 56.33 Q89.11 67.91 95.13 78.67"/></g>
    <g clip-path="url(#clip-f-sternocleidomastoid-l)"><path class="fibre" d="M115.07 54.67 Q110.25 66.96 103.53 78.33"/><path class="fibre" d="M115.13 56.33 Q110.89 67.91 104.87 78.67"/></g>
    <g clip-path="url(#clip-f-traps-upper-r)"><path class="fibre" d="M86.2 64.67 Q73.55 70.62 62 78.5"/><path class="fibre" d="M86.4 67.33 Q73.75 71.94 62 78.5"/><path class="fibre" d="M85 65 Q79.92 71.94 76 79.6"/></g>
    <g clip-path="url(#clip-f-traps-upper-l)"><path class="fibre" d="M113.8 64.67 Q126.45 70.62 138 78.5"/><path class="fibre" d="M113.6 67.33 Q126.25 71.94 138 78.5"/><path class="fibre" d="M115 65 Q120.08 71.94 124 79.6"/></g>
    <g clip-path="url(#clip-f-delts-front-r)"><path class="fibre" d="M66 82.35 Q58.95 102.54 55.2 123.6"/><path class="fibre" d="M69 82.7 Q60.46 102.6 55.2 123.6"/><path class="fibre" d="M72 83.05 Q61.98 102.65 55.2 123.6"/></g>
    <g clip-path="url(#clip-f-delts-front-l)"><path class="fibre" d="M134 82.35 Q141.05 102.54 144.8 123.6"/><path class="fibre" d="M131 82.7 Q139.54 102.6 144.8 123.6"/><path class="fibre" d="M128 83.05 Q138.02 102.65 144.8 123.6"/></g>
    <g clip-path="url(#clip-f-delts-side-r)"><path class="fibre" d="M52 86.65 Q52.12 105.25 55.2 123.6"/><path class="fibre" d="M54 85.3 Q53.07 104.5 55.2 123.6"/><path class="fibre" d="M56 83.95 Q54.01 103.74 55.2 123.6"/></g>
    <g clip-path="url(#clip-f-delts-side-l)"><path class="fibre" d="M148 86.65 Q147.88 105.25 144.8 123.6"/><path class="fibre" d="M146 85.3 Q146.93 104.5 144.8 123.6"/><path class="fibre" d="M144 83.95 Q145.99 103.74 144.8 123.6"/></g>
    <g clip-path="url(#clip-f-chest-upper-r)"><path class="fibre" d="M84 83.25 Q73.57 94.11 65 106.5"/><path class="fibre" d="M88 83.1 Q75.56 93.88 65 106.5"/><path class="fibre" d="M92 82.95 Q77.56 93.64 65 106.5"/></g>
    <g clip-path="url(#clip-f-chest-upper-l)"><path class="fibre" d="M116 83.25 Q126.43 94.11 135 106.5"/><path class="fibre" d="M112 83.1 Q124.44 93.88 135 106.5"/><path class="fibre" d="M108 82.95 Q122.44 93.64 135 106.5"/></g>
    <g clip-path="url(#clip-f-chest-mid-r)"><path class="fibre" d="M98 101 Q80.72 103.14 64 108"/><path class="fibre" d="M98 104 Q80.84 104.64 64 108"/><path class="fibre" d="M98 107 Q80.96 106.14 64 108"/></g>
    <g clip-path="url(#clip-f-chest-mid-l)"><path class="fibre" d="M102 101 Q119.28 103.14 136 108"/><path class="fibre" d="M102 104 Q119.16 104.64 136 108"/><path class="fibre" d="M102 107 Q119.04 106.14 136 108"/></g>
    <g clip-path="url(#clip-f-chest-lower-r)"><path class="fibre" d="M95 116.5 Q79.53 112.39 63.6 110.8"/><path class="fibre" d="M92 119 Q78.13 113.76 63.6 110.8"/><path class="fibre" d="M89 121.5 Q76.73 115.13 63.6 110.8"/></g>
    <g clip-path="url(#clip-f-chest-lower-l)"><path class="fibre" d="M105 116.5 Q120.47 112.39 136.4 110.8"/><path class="fibre" d="M108 119 Q121.87 113.76 136.4 110.8"/><path class="fibre" d="M111 121.5 Q123.27 115.13 136.4 110.8"/></g>
    <g clip-path="url(#clip-f-triceps-lateral-r)"><path class="fibre" d="M46.2 110 Q43.28 128.89 43.4 148"/></g>
    <g clip-path="url(#clip-f-triceps-lateral-l)"><path class="fibre" d="M153.8 110 Q156.72 128.89 156.6 148"/></g>
    <g clip-path="url(#clip-f-brachialis-r)"><path class="fibre" d="M49.8 122 Q48.06 142.49 49.6 163"/></g>
    <g clip-path="url(#clip-f-brachialis-l)"><path class="fibre" d="M150.2 122 Q151.94 142.49 150.4 163"/></g>
    <g clip-path="url(#clip-f-biceps-long-r)"><path class="fibre" d="M56.6 121 Q52.9 140.83 52.4 161"/><path class="fibre" d="M53 128 Q50.68 141.9 50.6 156"/></g>
    <g clip-path="url(#clip-f-biceps-long-l)"><path class="fibre" d="M143.4 121 Q147.1 140.83 147.6 161"/><path class="fibre" d="M147 128 Q149.32 141.9 149.4 156"/></g>
    <g clip-path="url(#clip-f-biceps-short-r)"><path class="fibre" d="M61 115 Q55.82 138.24 54.4 162"/><path class="fibre" d="M62.6 122 Q58.16 139.76 56.6 158"/></g>
    <g clip-path="url(#clip-f-biceps-short-l)"><path class="fibre" d="M139 115 Q144.18 138.24 145.6 162"/><path class="fibre" d="M137.4 122 Q141.84 139.76 143.4 158"/></g>
    <g clip-path="url(#clip-f-brachioradialis-r)"><path class="fibre" d="M43.4 154 Q36.7 188.69 35.6 224"/><path class="fibre" d="M46.6 163 Q39.16 193.1 36.6 224"/></g>
    <g clip-path="url(#clip-f-brachioradialis-l)"><path class="fibre" d="M156.6 154 Q163.3 188.69 164.4 224"/><path class="fibre" d="M153.4 163 Q160.84 193.1 163.4 224"/></g>
    <g clip-path="url(#clip-f-pronator-teres-r)"><path class="fibre" d="M56.6 168.4 Q52.78 178.46 50.6 189"/></g>
    <g clip-path="url(#clip-f-pronator-teres-l)"><path class="fibre" d="M143.4 168.4 Q147.22 178.46 149.4 189"/></g>
    <g clip-path="url(#clip-f-forearm-flexors-r)"><path class="fibre" d="M58.4 172 Q47.04 198.26 40 226"/><path class="fibre" d="M57.6 175 Q47.56 199.86 41.6 226"/></g>
    <g clip-path="url(#clip-f-forearm-flexors-l)"><path class="fibre" d="M141.6 172 Q152.96 198.26 160 226"/><path class="fibre" d="M142.4 175 Q152.44 199.86 158.4 226"/></g>
    <g clip-path="url(#clip-f-flexor-carpi-ulnaris-r)"><path class="fibre" d="M59.6 172 Q49.52 198.67 43.8 226.6"/></g>
    <g clip-path="url(#clip-f-flexor-carpi-ulnaris-l)"><path class="fibre" d="M140.4 172 Q150.48 198.67 156.2 226.6"/></g>
    <g clip-path="url(#clip-f-lats-r)"><path class="fibre" d="M67.6 120 Q66.52 136.02 68 152"/></g>
    <g clip-path="url(#clip-f-lats-l)"><path class="fibre" d="M132.4 120 Q133.48 136.02 132 152"/></g>
    <g clip-path="url(#clip-f-serratus-r)"><path class="fibre" d="M70.6 126 Q74.66 128.14 79 129.6"/><path class="fibre" d="M70.6 134 Q74.89 135.75 79.4 136.8"/><path class="fibre" d="M70.6 142 Q74.8 143.64 79.2 144.6"/><path class="fibre" d="M70.6 149.6 Q74.02 150.88 77.6 151.6"/></g>
    <g clip-path="url(#clip-f-serratus-l)"><path class="fibre" d="M129.4 126 Q125.34 128.14 121 129.6"/><path class="fibre" d="M129.4 134 Q125.11 135.75 120.6 136.8"/><path class="fibre" d="M129.4 142 Q125.2 143.64 120.8 144.6"/><path class="fibre" d="M129.4 149.6 Q125.98 150.88 122.4 151.6"/></g>
    <g clip-path="url(#clip-f-obliques-external-r)"><path class="fibre" d="M72 164.4 Q78.42 175.98 86.6 186.4"/><path class="fibre" d="M72 170.8 Q78.72 182.41 87.2 192.8"/><path class="fibre" d="M72 177.2 Q79.02 188.83 87.8 199.2"/><path class="fibre" d="M72 183.6 Q79.32 195.26 88.4 205.6"/></g>
    <g clip-path="url(#clip-f-obliques-external-l)"><path class="fibre" d="M128 164.4 Q121.58 175.98 113.4 186.4"/><path class="fibre" d="M128 170.8 Q121.28 182.41 112.8 192.8"/><path class="fibre" d="M128 177.2 Q120.98 188.83 112.2 199.2"/><path class="fibre" d="M128 183.6 Q120.68 195.26 111.6 205.6"/></g>
    <g clip-path="url(#clip-f-abs-upper-r)"><path class="fibre" d="M90.67 126.67 Q89.99 135.17 90.67 143.67"/><path class="fibre" d="M93.33 126.33 Q92.65 134.83 93.33 143.33"/></g>
    <g clip-path="url(#clip-f-abs-upper-l)"><path class="fibre" d="M109.33 126.67 Q110.01 135.17 109.33 143.67"/><path class="fibre" d="M106.67 126.33 Q107.35 134.83 106.67 143.33"/></g>
    <g clip-path="url(#clip-f-abs-mid-r)"><path class="fibre" d="M90.67 145.87 Q90.07 153.33 90.67 160.8"/><path class="fibre" d="M93.33 145.73 Q92.74 153.17 93.33 160.6"/></g>
    <g clip-path="url(#clip-f-abs-mid-l)"><path class="fibre" d="M109.33 145.87 Q109.93 153.33 109.33 160.8"/><path class="fibre" d="M106.67 145.73 Q107.26 153.17 106.67 160.6"/></g>
    <g clip-path="url(#clip-f-abs-lower-r)"><path class="fibre" d="M91.33 162.87 Q90.9 169.94 91.6 177"/><path class="fibre" d="M93.67 162.73 Q93.16 169.87 93.8 177"/></g>
    <g clip-path="url(#clip-f-abs-lower-l)"><path class="fibre" d="M108.67 162.87 Q109.1 169.94 108.4 177"/><path class="fibre" d="M106.33 162.73 Q106.84 169.87 106.2 177"/></g>
    <g clip-path="url(#clip-f-abs-infra-r)"><path class="fibre" d="M92.2 180.87 Q91.59 200.17 94.07 219.33"/><path class="fibre" d="M94.4 180.73 Q93.39 201.75 95.73 222.67"/></g>
    <g clip-path="url(#clip-f-abs-infra-l)"><path class="fibre" d="M107.8 180.87 Q108.41 200.17 105.93 219.33"/><path class="fibre" d="M105.6 180.73 Q106.61 201.75 104.27 222.67"/></g>
    <g clip-path="url(#clip-f-hip-flexors-r)"><path class="fibre" d="M82 212 Q83.24 229.21 87.2 246"/><path class="fibre" d="M86 215 Q86.3 227.6 88.6 240"/></g>
    <g clip-path="url(#clip-f-hip-flexors-l)"><path class="fibre" d="M118 212 Q116.76 229.21 112.8 246"/><path class="fibre" d="M114 215 Q113.7 227.6 111.4 240"/></g>
    <g clip-path="url(#clip-f-glutes-med-r)"><path class="fibre" d="M69.93 193.67 Q71.75 199.01 74.4 204"/><path class="fibre" d="M69.47 197.33 Q71.67 200.86 74.4 204"/></g>
    <g clip-path="url(#clip-f-glutes-med-l)"><path class="fibre" d="M130.07 193.67 Q128.25 199.01 125.6 204"/><path class="fibre" d="M130.53 197.33 Q128.33 200.86 125.6 204"/></g>
    <g clip-path="url(#clip-f-tfl-r)"><path class="fibre" d="M69.2 209.67 Q67.74 222.47 68.33 235.33"/><path class="fibre" d="M71.4 208.33 Q70.04 219.46 70.47 230.67"/></g>
    <g clip-path="url(#clip-f-tfl-l)"><path class="fibre" d="M130.8 209.67 Q132.26 222.47 131.67 235.33"/><path class="fibre" d="M128.6 208.33 Q129.96 219.46 129.53 230.67"/></g>
    <g clip-path="url(#clip-f-calves-soleus-lateral-r)"><path class="fibre" d="M71 372 Q72.96 395.3 78.6 418"/><path class="fibre" d="M89 376 Q88.18 395.06 90.4 414"/></g>
    <g clip-path="url(#clip-f-calves-soleus-lateral-l)"><path class="fibre" d="M129 372 Q127.04 395.3 121.4 418"/><path class="fibre" d="M111 376 Q111.82 395.06 109.6 414"/></g>
    <g clip-path="url(#clip-f-calves-soleus-medial-r)"><path class="fibre" d="M71 372 Q72.96 395.3 78.6 418"/><path class="fibre" d="M89 376 Q88.18 395.06 90.4 414"/></g>
    <g clip-path="url(#clip-f-calves-soleus-medial-l)"><path class="fibre" d="M129 372 Q127.04 395.3 121.4 418"/><path class="fibre" d="M111 376 Q111.82 395.06 109.6 414"/></g>
    <g clip-path="url(#clip-f-sartorius-r)"><path class="fibre" d="M76.4 207 Q82.2 245.2 94 282"/><path class="fibre" d="M94 282 Q92.48 301 94 320"/></g>
    <g clip-path="url(#clip-f-sartorius-l)"><path class="fibre" d="M123.6 207 Q117.8 245.2 106 282"/><path class="fibre" d="M106 282 Q107.52 301 106 320"/></g>
    <g clip-path="url(#clip-f-rectus-femoris-r)"><path class="fibre" d="M74.04 233.44 Q75.72 239.45 78.34 245.12"/><path class="fibre" d="M81.64 233.44 Q79.52 239.15 78.34 245.12"/><path class="fibre" d="M74.88 251.64 Q76.56 257.65 79.18 263.32"/><path class="fibre" d="M82.48 251.64 Q80.36 257.35 79.18 263.32"/><path class="fibre" d="M75.72 269.84 Q77.4 275.85 80.02 281.52"/><path class="fibre" d="M83.32 269.84 Q81.2 275.55 80.02 281.52"/><path class="fibre" d="M76.56 288.04 Q78.24 294.05 80.86 299.72"/><path class="fibre" d="M84.16 288.04 Q82.04 293.75 80.86 299.72"/></g>
    <g clip-path="url(#clip-f-rectus-femoris-l)"><path class="fibre" d="M125.96 233.44 Q124.28 239.45 121.66 245.12"/><path class="fibre" d="M118.36 233.44 Q120.48 239.15 121.66 245.12"/><path class="fibre" d="M125.12 251.64 Q123.44 257.65 120.82 263.32"/><path class="fibre" d="M117.52 251.64 Q119.64 257.35 120.82 263.32"/><path class="fibre" d="M124.28 269.84 Q122.6 275.85 119.98 281.52"/><path class="fibre" d="M116.68 269.84 Q118.8 275.55 119.98 281.52"/><path class="fibre" d="M123.44 288.04 Q121.76 294.05 119.14 299.72"/><path class="fibre" d="M115.84 288.04 Q117.96 293.75 119.14 299.72"/></g>
    <g clip-path="url(#clip-f-vastus-medialis-r)"><path class="fibre" d="M88.8 277.5 Q84.94 295.56 84 314"/><path class="fibre" d="M90.2 289 Q86.1 301.25 84 314"/><path class="fibre" d="M91.6 300.5 Q87.26 306.95 84 314"/></g>
    <g clip-path="url(#clip-f-vastus-medialis-l)"><path class="fibre" d="M111.2 277.5 Q115.06 295.56 116 314"/><path class="fibre" d="M109.8 289 Q113.9 301.25 116 314"/><path class="fibre" d="M108.4 300.5 Q112.74 306.95 116 314"/></g>
    <g clip-path="url(#clip-f-vastus-lateralis-r)"><path class="fibre" d="M67.95 247 Q69.77 280.23 76.85 312.75"/><path class="fibre" d="M69.5 242 Q70.82 277.08 77.7 311.5"/><path class="fibre" d="M71.05 237 Q71.87 273.93 78.55 310.25"/></g>
    <g clip-path="url(#clip-f-vastus-lateralis-l)"><path class="fibre" d="M132.05 247 Q130.23 280.23 123.15 312.75"/><path class="fibre" d="M130.5 242 Q129.18 277.08 122.3 311.5"/><path class="fibre" d="M128.95 237 Q128.13 273.93 121.45 310.25"/></g>
    <g clip-path="url(#clip-f-adductor-longus-r)"><path class="fibre" d="M92.47 225 Q90.21 239.41 90.27 254"/><path class="fibre" d="M93.53 228 Q91.23 242.91 91.33 258"/></g>
    <g clip-path="url(#clip-f-adductor-longus-l)"><path class="fibre" d="M107.53 225 Q109.79 239.41 109.73 254"/><path class="fibre" d="M106.47 228 Q108.77 242.91 108.67 258"/></g>
    <g clip-path="url(#clip-f-gracilis-r)"><path class="fibre" d="M97.4 236 Q94.82 261.96 96.4 288"/></g>
    <g clip-path="url(#clip-f-gracilis-l)"><path class="fibre" d="M102.6 236 Q105.18 261.96 103.6 288"/></g>
    <g clip-path="url(#clip-f-tibialis-anterior-r)"><path class="fibre" d="M77.6 334 Q77.44 376.26 84 418"/><path class="fibre" d="M80.4 334 Q78.3 364.02 81 394"/></g>
    <g clip-path="url(#clip-f-tibialis-anterior-l)"><path class="fibre" d="M122.4 334 Q122.56 376.26 116 418"/><path class="fibre" d="M119.6 334 Q121.7 364.02 119 394"/></g>
    <g clip-path="url(#clip-f-peroneus-r)"><path class="fibre" d="M72.6 336 Q73.22 377.31 80.4 418"/></g>
    <g clip-path="url(#clip-f-peroneus-l)"><path class="fibre" d="M127.4 336 Q126.78 377.31 119.6 418"/></g>
    <g clip-path="url(#clip-f-calves-gastroc-medial-r)"><path class="fibre" d="M89.55 341.44 Q90.69 344.71 92.33 347.76"/><path class="fibre" d="M95.15 341.44 Q93.49 344.49 92.33 347.76"/><path class="fibre" d="M89.5 353.44 Q90.64 356.71 92.28 359.76"/><path class="fibre" d="M95.1 353.44 Q93.44 356.49 92.28 359.76"/><path class="fibre" d="M89.45 365.44 Q90.59 368.71 92.23 371.76"/><path class="fibre" d="M95.05 365.44 Q93.39 368.49 92.23 371.76"/></g>
    <g clip-path="url(#clip-f-calves-gastroc-medial-l)"><path class="fibre" d="M110.45 341.44 Q109.31 344.71 107.67 347.76"/><path class="fibre" d="M104.85 341.44 Q106.51 344.49 107.67 347.76"/><path class="fibre" d="M110.5 353.44 Q109.36 356.71 107.72 359.76"/><path class="fibre" d="M104.9 353.44 Q106.56 356.49 107.72 359.76"/><path class="fibre" d="M110.55 365.44 Q109.41 368.71 107.77 371.76"/><path class="fibre" d="M104.95 365.44 Q106.61 368.49 107.77 371.76"/></g>
  </g>
`;

const MUSCLE_BACK_SVG_RAW_ = `
<!-- ===== Silhouette (non-interactive) ===== -->
  <g class="silhouette" fill="#e7e5e0" pointer-events="none">
    <path d="M100 6 C111.6 6 119.6 15 119.6 28 C119.6 32 119.2 35 118.8 37.6 C121 37.4 122 40 121 43.6 C120.2 46.6 118.6 48.4 116.8 48.4 C114.8 54.6 110 61.6 100 62.4 C90 61.6 85.2 54.6 83.2 48.4 C81.4 48.4 79.8 46.6 79 43.6 C78 40 79 37.4 81.2 37.6 C80.8 35 80.4 32 80.4 28 C80.4 15 88.4 6 100 6 Z"/>
    <path d="M100 50 L87.4 50 C87.2 54 86.8 58 86.6 61 C85 68 76 73.4 61.6 77.6 C55 79 48.6 84.4 46.2 94 C45.2 99 46 104 48.6 108 C54 113 60 115 64.8 114.6 C65.2 126 64.8 138 66.6 152 C67.8 162 70.2 172 70.4 184 C70.4 192 68.8 199 66.8 205.4 C64.6 212 63 221 63.2 232 C63.2 250 63.6 268 65.8 288 C67.6 302 70.4 312 71.2 320 C71.4 328 69.6 338 69.2 350 C68.8 362 69 374 69.8 386 C71 398 73.8 410 76.8 420 C76.2 428 75.4 436 76.4 442 C77.8 447.6 81.8 448.8 84 448.8 C87.6 448.8 90.8 447 91.8 442 C92.6 436 91.6 428 90.6 420.4 C91.2 412 92.8 401 93.8 390 C95.2 378 97.8 362 97.8 348 C97.8 338 96.8 330 96.4 322 C97.4 308 98 292 98.6 276 C99 262 99.2 248 99.2 240 Q99.4 236.6 100 236.2 Q100.6 236.6 100.8 240 C100.8 248 101 262 101.4 276 C102 292 102.6 308 103.6 322 C103.2 330 102.2 338 102.2 348 C102.2 362 104.8 378 106.2 390 C107.2 401 108.8 412 109.4 420.4 C108.4 428 107.4 436 108.2 442 C109.2 447 112.4 448.8 116 448.8 C118.2 448.8 122.2 447.6 123.6 442 C124.6 436 123.8 428 123.2 420 C126.2 410 129 398 130.2 386 C131 374 131.2 362 130.8 350 C130.4 338 128.6 328 128.8 320 C129.6 312 132.4 302 134.2 288 C136.4 268 136.8 250 136.8 232 C137 221 135.4 212 133.2 205.4 C131.2 199 129.6 192 129.6 184 C129.8 172 132.2 162 133.4 152 C135.2 138 134.8 126 135.2 114.6 C140 115 146 113 151.4 108 C154 104 154.8 99 153.8 94 C151.4 84.4 145 79 138.4 77.6 C124 73.4 115 68 113.4 61 C113.2 58 112.8 54 112.6 50 L100 50 Z"/>
    <path d="M60 80 C52.8 80.4 46.8 87.4 46 96 C45.4 104 44.2 116 43.6 128 C43.2 138 43.2 146 42.2 152 C41 158 39 162 37.8 166 C36.2 172 35.2 180 34.8 188 C34.4 200 33.4 214 33 226.6 C31.4 231 29 235 27.8 240 C26.8 245 27 250.4 28.6 251.6 C30.4 252.8 31.8 249 32.8 245 C32.4 252 31.8 259 33.2 265 C34.6 270.4 39.4 270.8 41.8 267.8 C44 264 45 255 45.2 247 C45.4 240 45.4 233 45.6 227.6 C47.4 224 49.6 220 51.2 216.4 C53.2 212 54.8 208 56.4 204 C58 200 59.4 196 60 192 C60.8 188 61.4 184 61.4 180 C61.4 176 61 172 60.4 168 C61.8 160 63.8 154 64.4 148 C65.8 140 66.4 130 66.4 122 C66.4 118 66.2 115 66 113 C62 106 58 92 60 80 Z"/>
    <path d="M140 80 C147.2 80.4 153.2 87.4 154 96 C154.6 104 155.8 116 156.4 128 C156.8 138 156.8 146 157.8 152 C159 158 161 162 162.2 166 C163.8 172 164.8 180 165.2 188 C165.6 200 166.6 214 167 226.6 C168.6 231 171 235 172.2 240 C173.2 245 173 250.4 171.4 251.6 C169.6 252.8 168.2 249 167.2 245 C167.6 252 168.2 259 166.8 265 C165.4 270.4 160.6 270.8 158.2 267.8 C156 264 155 255 154.8 247 C154.6 240 154.6 233 154.4 227.6 C152.6 224 150.4 220 148.8 216.4 C146.8 212 145.2 208 143.6 204 C142 200 140.6 196 140 192 C139.2 188 138.6 184 138.6 180 C138.6 176 139 172 139.6 168 C138.2 160 136.2 154 135.6 148 C134.2 140 133.6 130 133.6 122 C133.6 118 133.8 115 134 113 C138 106 142 92 140 80 Z"/>
  </g>
  <!-- ===== Muscles. data-side = the figure's anatomical side (in the back view the figure's left side is on the viewer's left). Deep muscles are drawn first in each region. ===== -->
  <g class="muscles" fill="#d9d6d0" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round">
    <g data-region="shoulders">
      <!-- Lateral deltoid, seen from behind -->
      <path id="b-delts-side-l" class="muscle" data-muscle="delts-side" data-group="delts" data-side="left" d="M60 82.2 C53 82.8 47.6 90 47 100 C46.6 110 50 118 55 124 C55.2 110 57.2 95 61.4 84.6 Q61 83 60 82.2 Z"><title>Side Delt (Left)</title></path>
      <path id="b-delts-side-r" class="muscle" data-muscle="delts-side" data-group="delts" data-side="right" d="M140 82.2 C147 82.8 152.4 90 153 100 C153.4 110 150 118 145 124 C144.8 110 142.8 95 138.6 84.6 Q139 83 140 82.2 Z"><title>Side Delt (Right)</title></path>
      <!-- Posterior deltoid: spine of scapula -> deltoid tuberosity -->
      <path id="b-delts-rear-l" class="muscle" data-muscle="delts-rear" data-group="delts" data-side="left" d="M62.6 85.8 C67.4 87.4 72 89.4 76 91.8 C72.6 100.6 65.6 113 55.6 124 C55.6 110 57.8 96 62.6 85.8 Z"><title>Rear Delt (Left)</title></path>
      <path id="b-delts-rear-r" class="muscle" data-muscle="delts-rear" data-group="delts" data-side="right" d="M137.4 85.8 C132.6 87.4 128 89.4 124 91.8 C127.4 100.6 134.4 113 144.4 124 C144.4 110 142.2 96 137.4 85.8 Z"><title>Rear Delt (Right)</title></path>
    </g>
    <g data-region="back">
      <!-- Rhomboid major & minor: spine -> medial border of scapula (deep to mid/lower traps; drawn visible by convention) [deep] -->
      <path id="b-rhomboids-l" class="muscle" data-muscle="rhomboids" data-group="rhomboids" data-side="left" d="M84.4 101.6 Q84.8 102.2 85 102.8 C87.4 110.4 89.6 120 92 129.2 C88.4 131.2 84 130.8 80.8 128.8 C81.6 120 82.6 111 84.4 101.6 Z"><title>Rhomboids (Left)</title></path>
      <path id="b-rhomboids-r" class="muscle" data-muscle="rhomboids" data-group="rhomboids" data-side="right" d="M115.6 101.6 Q115.2 102.2 115 102.8 C112.6 110.4 110.4 120 108 129.2 C111.6 131.2 116 130.8 119.2 128.8 C118.4 120 117.4 111 115.6 101.6 Z"><title>Rhomboids (Right)</title></path>
      <!-- Trapezius, upper (descending) fibres: occiput & nuchal ligament -> lateral clavicle/acromion -->
      <path id="b-traps-upper-l" class="muscle" data-muscle="traps-upper" data-group="traps" data-side="left" d="M98.8 51.6 C95.2 52.4 90.8 53.6 87.8 55.4 C87.2 60 86.4 64 85 67.4 C82.4 71.4 74 74.6 62.4 78 Q59.8 79.4 61.2 81 C68.8 82 76.4 83 83 84.6 C88.6 83.4 94 82.8 98.8 82.6 Z"><title>Upper Traps (Left)</title></path>
      <path id="b-traps-upper-r" class="muscle" data-muscle="traps-upper" data-group="traps" data-side="right" d="M101.2 51.6 C104.8 52.4 109.2 53.6 112.2 55.4 C112.8 60 113.6 64 115 67.4 C117.6 71.4 126 74.6 137.6 78 Q140.2 79.4 138.8 81 C131.2 82 123.6 83 117 84.6 C111.4 83.4 106 82.8 101.2 82.6 Z"><title>Upper Traps (Right)</title></path>
      <!-- Trapezius, middle (transverse) fibres: C7-T3 -> acromion & spine of scapula -->
      <path id="b-traps-mid-l" class="muscle" data-muscle="traps-mid" data-group="traps" data-side="left" d="M98.8 84.8 C94 85 88.6 85.6 83.2 86.8 C76.4 85.2 69 83.8 62.4 83 Q61.6 84.4 63 85.4 C70 87.6 78 91 84.4 95.4 C89 99.2 94 102.8 98.8 106.2 Z"><title>Mid Traps (Left)</title></path>
      <path id="b-traps-mid-r" class="muscle" data-muscle="traps-mid" data-group="traps" data-side="right" d="M101.2 84.8 C106 85 111.4 85.6 116.8 86.8 C123.6 85.2 131 83.8 137.6 83 Q138.4 84.4 137 85.4 C130 87.6 122 91 115.6 95.4 C111 99.2 106 102.8 101.2 106.2 Z"><title>Mid Traps (Right)</title></path>
      <!-- Trapezius, lower (ascending) fibres: T4-T12 -> root of scapular spine -->
      <path id="b-traps-lower-l" class="muscle" data-muscle="traps-lower" data-group="traps" data-side="left" d="M98.8 108.6 C94 105 89.4 101.6 85.6 98.2 Q84.8 99.8 85.6 101.6 C88.6 112 92.6 128 98.8 160 Z"><title>Lower Traps (Left)</title></path>
      <path id="b-traps-lower-r" class="muscle" data-muscle="traps-lower" data-group="traps" data-side="right" d="M101.2 108.6 C106 105 110.6 101.6 114.4 98.2 Q115.2 99.8 114.4 101.6 C111.4 112 107.4 128 101.2 160 Z"><title>Lower Traps (Right)</title></path>
      <!-- Infraspinatus: infraspinous fossa -> greater tubercle -->
      <path id="b-infraspinatus-l" class="muscle" data-muscle="infraspinatus" data-group="rotatorcuff" data-side="left" d="M84 99 C83.8 104.6 82.6 114 80.4 125.4 C76.4 120 71.8 114.4 67.4 110.2 C70.6 104.6 74 98.6 77 93.6 C79.6 95.2 81.8 97 84 99 Z"><title>Infraspinatus (Left)</title></path>
      <path id="b-infraspinatus-r" class="muscle" data-muscle="infraspinatus" data-group="rotatorcuff" data-side="right" d="M116 99 C116.2 104.6 117.4 114 119.6 125.4 C123.6 120 128.2 114.4 132.6 110.2 C129.4 104.6 126 98.6 123 93.6 C120.4 95.2 118.2 97 116 99 Z"><title>Infraspinatus (Right)</title></path>
      <!-- Teres minor: lateral border of scapula -> greater tubercle -->
      <path id="b-teres-minor-l" class="muscle" data-muscle="teres-minor" data-group="rotatorcuff" data-side="left" d="M79.8 127.4 C75.6 122.4 71 117 66.8 112.6 Q65.2 113.6 64.4 115.2 C68.6 118 74.2 123.4 78.8 129.6 Q79.4 128.6 79.8 127.4 Z"><title>Teres Minor (Left)</title></path>
      <path id="b-teres-minor-r" class="muscle" data-muscle="teres-minor" data-group="rotatorcuff" data-side="right" d="M120.2 127.4 C124.4 122.4 129 117 133.2 112.6 Q134.8 113.6 135.6 115.2 C131.4 118 125.8 123.4 121.2 129.6 Q120.6 128.6 120.2 127.4 Z"><title>Teres Minor (Right)</title></path>
      <!-- Teres major: inferior angle of scapula -> medial lip of bicipital groove (back wall of armpit) -->
      <path id="b-teres-major-l" class="muscle" data-muscle="teres-major" data-group="teres" data-side="left" d="M79.2 131 C74.4 125.6 69.6 121.4 65 118.8 Q64.4 122.4 64.8 126.6 C69.4 129 73.6 132.6 76.6 136.8 Q78.6 134.2 79.2 131 Z"><title>Teres Major (Left)</title></path>
      <path id="b-teres-major-r" class="muscle" data-muscle="teres-major" data-group="teres" data-side="right" d="M120.8 131 C125.6 125.6 130.4 121.4 135 118.8 Q135.6 122.4 135.2 126.6 C130.6 129 126.4 132.6 123.4 136.8 Q121.4 134.2 120.8 131 Z"><title>Teres Major (Right)</title></path>
      <!-- Latissimus dorsi: T7-L5 via thoracolumbar fascia & iliac crest -> humerus (gives the V-taper) -->
      <path id="b-lats-l" class="muscle" data-muscle="lats" data-group="lats" data-side="left" d="M93.2 132.6 C89 133.8 84.4 133.8 80.6 132.8 Q79.4 135.2 77.8 138.8 C73 134.4 68.8 130.8 65 128.8 C65.2 138 65.4 147 66.6 156 C67.2 162 67.8 166 68.4 170 C70.6 180 73 189 75.8 196.4 C81.2 180 88 160 93.8 145.2 C93.8 140 93.6 136 93.2 132.6 Z"><title>Lats (Left)</title></path>
      <path id="b-lats-r" class="muscle" data-muscle="lats" data-group="lats" data-side="right" d="M106.8 132.6 C111 133.8 115.6 133.8 119.4 132.8 Q120.6 135.2 122.2 138.8 C127 134.4 131.2 130.8 135 128.8 C134.8 138 134.6 147 133.4 156 C132.8 162 132.2 166 131.6 170 C129.4 180 127 189 124.2 196.4 C118.8 180 112 160 106.2 145.2 C106.2 140 106.4 136 106.8 132.6 Z"><title>Lats (Right)</title></path>
      <!-- Erector spinae (iliocostalis/longissimus): sacrum -> ribs, widest at the lumbar -->
      <path id="b-erector-spinae-l" class="muscle" data-muscle="erector-spinae" data-group="lowerback" data-side="left" d="M95.8 146.4 C94 156 91.6 166 90 180 C89 192 88.8 203 89.6 213.4 Q93.8 216.4 98.8 216 L98.8 161.6 C97.8 156 96.8 151 95.8 146.4 Z"><title>Erector Spinae (Left)</title></path>
      <path id="b-erector-spinae-r" class="muscle" data-muscle="erector-spinae" data-group="lowerback" data-side="right" d="M104.2 146.4 C106 156 108.4 166 110 180 C111 192 111.2 203 110.4 213.4 Q106.2 216.4 101.2 216 L101.2 161.6 C102.2 156 103.2 151 104.2 146.4 Z"><title>Erector Spinae (Right)</title></path>
    </g>
    <g data-region="arms">
      <!-- Brachialis - sliver on the outer arm, between lateral triceps and brachioradialis [deep] -->
      <path id="b-brachialis-l" class="muscle" data-muscle="brachialis" data-group="biceps" data-side="left" d="M44.2 134 C44.4 140 45.2 146 46.4 151 C47.2 153.4 48.2 155.6 49.2 157.4 Q47.8 158.4 46.6 157.8 C45.6 155 44.6 152 44 149 C43.6 144 43.6 138 44.2 134 Z"><title>Brachialis (Left)</title></path>
      <path id="b-brachialis-r" class="muscle" data-muscle="brachialis" data-group="biceps" data-side="right" d="M155.8 134 C155.6 140 154.8 146 153.6 151 C152.8 153.4 151.8 155.6 150.8 157.4 Q152.2 158.4 153.4 157.8 C154.4 155 155.4 152 156 149 C156.4 144 156.4 138 155.8 134 Z"><title>Brachialis (Right)</title></path>
      <!-- Triceps brachii, long head: infraglenoid tubercle -> olecranon -->
      <path id="b-triceps-long-l" class="muscle" data-muscle="triceps-long" data-group="triceps" data-side="left" d="M56 124.2 L63 115.6 Q63.6 121 64 128.6 C64.4 136 64 144 62.8 150 C62 153.4 60.8 156.4 59.2 158.8 C58.4 154 58.2 148 58.2 142.8 Q56.8 139.8 54.6 139.4 C54.6 134 55 129 56 124.2 Z"><title>Triceps (Long Head) (Left)</title></path>
      <path id="b-triceps-long-r" class="muscle" data-muscle="triceps-long" data-group="triceps" data-side="right" d="M144 124.2 L137 115.6 Q136.4 121 136 128.6 C135.6 136 136 144 137.2 150 C138 153.4 139.2 156.4 140.8 158.8 C141.6 154 141.8 148 141.8 142.8 Q143.2 139.8 145.4 139.4 C145.4 134 145 129 144 124.2 Z"><title>Triceps (Long Head) (Right)</title></path>
      <!-- Triceps brachii, lateral head - the outer 'horseshoe' -->
      <path id="b-triceps-lateral-l" class="muscle" data-muscle="triceps-lateral" data-group="triceps" data-side="left" d="M46.4 106.8 C48.2 114 51.2 119.6 54.8 124.6 C54 129.6 53.4 135 53.2 140.2 C52.2 146.4 51.4 151.6 50.6 156.4 Q48.6 155.6 47.6 153 C46.6 150 45.8 146.6 45.2 143 C44.6 136 44.6 128 44.8 121 C45 115.6 45.6 111 46.4 106.8 Z"><title>Triceps (Lateral Head) (Left)</title></path>
      <path id="b-triceps-lateral-r" class="muscle" data-muscle="triceps-lateral" data-group="triceps" data-side="right" d="M153.6 106.8 C151.8 114 148.8 119.6 145.2 124.6 C146 129.6 146.6 135 146.8 140.2 C147.8 146.4 148.6 151.6 149.4 156.4 Q151.4 155.6 152.4 153 C153.4 150 154.2 146.6 154.8 143 C155.4 136 155.4 128 155.2 121 C155 115.6 154.4 111 153.6 106.8 Z"><title>Triceps (Lateral Head) (Right)</title></path>
      <!-- Triceps brachii, medial head - visible on the inner side of the tendon above the elbow -->
      <path id="b-triceps-medial-medial-l" class="muscle" data-muscle="triceps-medial" data-group="triceps" data-side="left" d="M63.6 151 C63.2 155.6 62.2 160.2 60.4 165.2 Q58.4 165.4 56.8 163.6 C57.8 162 58.8 160.6 59.8 158.8 C61.4 156.4 62.8 153.6 63.6 151 Z"><title>Triceps (Medial Head) (Left)</title></path>
      <path id="b-triceps-medial-medial-r" class="muscle" data-muscle="triceps-medial" data-group="triceps" data-side="right" d="M136.4 151 C136.8 155.6 137.8 160.2 139.6 165.2 Q141.6 165.4 143.2 163.6 C142.2 162 141.2 160.6 140.2 158.8 C138.6 156.4 137.2 153.6 136.4 151 Z"><title>Triceps (Medial Head) (Right)</title></path>
      <!-- Triceps brachii, medial head - visible on the outer side of the tendon above the elbow -->
      <path id="b-triceps-medial-lateral-l" class="muscle" data-muscle="triceps-medial" data-group="triceps" data-side="left" d="M50.4 157.6 Q50.8 159.6 50.6 161.4 C49.6 161.8 48.6 161.2 48.2 160 Q49.4 159.2 50.4 157.6 Z"><title>Triceps (Medial Head) (Left)</title></path>
      <path id="b-triceps-medial-lateral-r" class="muscle" data-muscle="triceps-medial" data-group="triceps" data-side="right" d="M149.6 157.6 Q149.2 159.6 149.4 161.4 C150.4 161.8 151.4 161.2 151.8 160 Q150.6 159.2 149.6 157.6 Z"><title>Triceps (Medial Head) (Right)</title></path>
      <!-- Brachioradialis - outer (thumb-side) edge of the forearm -->
      <path id="b-brachioradialis-l" class="muscle" data-muscle="brachioradialis" data-group="forearms" data-side="left" d="M43.6 151.4 C44.6 154 45.6 156.6 46.4 159.4 C46 164.6 44.8 170.4 43.4 176 C41.4 186 39.2 200 37.2 213 Q36.6 220 36.2 226.2 L33.6 226.4 C34 214 34.6 200 35 188 C35.4 180 36.4 172 37.8 166 C39.2 160.6 41.2 155.4 43.6 151.4 Z"><title>Brachioradialis (Left)</title></path>
      <path id="b-brachioradialis-r" class="muscle" data-muscle="brachioradialis" data-group="forearms" data-side="right" d="M156.4 151.4 C155.4 154 154.4 156.6 153.6 159.4 C154 164.6 155.2 170.4 156.6 176 C158.6 186 160.8 200 162.8 213 Q163.4 220 163.8 226.2 L166.4 226.4 C166 214 165.4 200 165 188 C164.6 180 163.6 172 162.2 166 C160.8 160.6 158.8 155.4 156.4 151.4 Z"><title>Brachioradialis (Right)</title></path>
      <!-- Extensor carpi radialis longus/brevis & extensor digitorum (from the lateral epicondyle) -->
      <path id="b-forearm-extensors-l" class="muscle" data-muscle="forearm-extensors" data-group="forearms" data-side="left" d="M46.8 160 Q48.2 161.4 49.2 163.2 C50.2 168.6 50 176 48.6 184 C46.6 196 44 210 42.4 226.4 L36.8 226.2 Q37.2 220 37.8 213 C39.8 200 42 186 43.8 176 C45.2 170.4 46.4 165 46.8 160 Z"><title>Forearm Extensors (Left)</title></path>
      <path id="b-forearm-extensors-r" class="muscle" data-muscle="forearm-extensors" data-group="forearms" data-side="right" d="M153.2 160 Q151.8 161.4 150.8 163.2 C149.8 168.6 150 176 151.4 184 C153.4 196 156 210 157.6 226.4 L163.2 226.2 Q162.8 220 162.2 213 C160.2 200 158 186 156.2 176 C154.8 170.4 153.6 165 153.2 160 Z"><title>Forearm Extensors (Right)</title></path>
      <!-- Extensor carpi ulnaris - ulnar side of the back of the forearm -->
      <path id="b-extensor-carpi-ulnaris-l" class="muscle" data-muscle="extensor-carpi-ulnaris" data-group="forearms" data-side="left" d="M49.8 163.4 Q51 165.2 51.8 167.8 C53 174.4 53 182 51.6 190 C49.8 202 47.6 214 45.8 226.6 L43 226.4 C44.6 210 47.2 196 49.2 184 C50.6 176 50.8 168.8 49.8 163.4 Z"><title>Extensor Carpi Ulnaris (Left)</title></path>
      <path id="b-extensor-carpi-ulnaris-r" class="muscle" data-muscle="extensor-carpi-ulnaris" data-group="forearms" data-side="right" d="M150.2 163.4 Q149 165.2 148.2 167.8 C147 174.4 147 182 148.4 190 C150.2 202 152.4 214 154.2 226.6 L157 226.4 C155.4 210 152.8 196 150.8 184 C149.4 176 149.2 168.8 150.2 163.4 Z"><title>Extensor Carpi Ulnaris (Right)</title></path>
      <!-- Flexor carpi ulnaris - inner edge of the forearm, beyond the ulnar border -->
      <path id="b-flexor-carpi-ulnaris-l" class="muscle" data-muscle="flexor-carpi-ulnaris" data-group="forearms" data-side="left" d="M57 168 C58.8 168.4 60.2 169.6 61 171.6 C61.4 178 61.2 184 60.4 189 C59.6 194 58.4 199 56.6 204 C54.4 210 51.2 218 48.4 226.4 L47.4 226.2 C50.8 216 53.8 206 55.4 198 C56.8 190 57.4 180 57 168 Z"><title>Flexor Carpi Ulnaris (Left)</title></path>
      <path id="b-flexor-carpi-ulnaris-r" class="muscle" data-muscle="flexor-carpi-ulnaris" data-group="forearms" data-side="right" d="M143 168 C141.2 168.4 139.8 169.6 139 171.6 C138.6 178 138.8 184 139.6 189 C140.4 194 141.6 199 143.4 204 C145.6 210 148.8 218 151.6 226.4 L152.6 226.2 C149.2 216 146.2 206 144.6 198 C143.2 190 142.6 180 143 168 Z"><title>Flexor Carpi Ulnaris (Right)</title></path>
    </g>
    <g data-region="core">
      <!-- External oblique - posterior edge visible at the flank between lat and iliac crest -->
      <path id="b-obliques-external-l" class="muscle" data-muscle="obliques-external" data-group="obliques" data-side="left" d="M68.4 173.6 Q69.6 178.6 70 183 C70.2 188 69.8 192 69.2 195.6 Q68.8 198 68.4 199.6 C70.8 199 73 198.6 74.6 198.4 C72.6 193 70.4 184.6 68.4 173.6 Z"><title>External Obliques (Left)</title></path>
      <path id="b-obliques-external-r" class="muscle" data-muscle="obliques-external" data-group="obliques" data-side="right" d="M131.6 173.6 Q130.4 178.6 130 183 C129.8 188 130.2 192 130.8 195.6 Q131.2 198 131.6 199.6 C129.2 199 127 198.6 125.4 198.4 C127.4 193 129.6 184.6 131.6 173.6 Z"><title>External Obliques (Right)</title></path>
    </g>
    <g data-region="hips">
      <!-- Gluteus medius: outer ilium -> greater trochanter (above & lateral to glute max) -->
      <path id="b-glutes-med-l" class="muscle" data-muscle="glutes-med" data-group="glutes" data-side="left" d="M67.4 203.6 C70.8 201 74.2 200.4 77.6 200.8 C81.6 201.8 85.2 205.4 88 210 C82.6 213.2 76 218.8 70.4 226.2 Q67.2 228.4 64.6 228.6 C64.2 221 65 211 67.4 203.6 Z"><title>Glute Medius (Left)</title></path>
      <path id="b-glutes-med-r" class="muscle" data-muscle="glutes-med" data-group="glutes" data-side="right" d="M132.6 203.6 C129.2 201 125.8 200.4 122.4 200.8 C118.4 201.8 114.8 205.4 112 210 C117.4 213.2 124 218.8 129.6 226.2 Q132.8 228.4 135.4 228.6 C135.8 221 135 211 132.6 203.6 Z"><title>Glute Medius (Right)</title></path>
      <!-- Gluteus maximus: ilium, sacrum & coccyx -> ITB & gluteal tuberosity (fibres run down and out) -->
      <path id="b-glutes-max-l" class="muscle" data-muscle="glutes-max" data-group="glutes" data-side="left" d="M98.6 218.4 C95 217.8 92 217 89.6 215.6 Q88.6 213.6 88.8 211.8 C83 214.8 76.4 220.2 70.8 227.6 Q67.6 230 64.8 230.6 C64.6 236.2 65.6 242 68.4 247.4 C72.2 253.4 79.2 256.4 86 256.6 C91.6 256.6 95.8 254.6 98.6 251.4 Z"><title>Glute Max (Left)</title></path>
      <path id="b-glutes-max-r" class="muscle" data-muscle="glutes-max" data-group="glutes" data-side="right" d="M101.4 218.4 C105 217.8 108 217 110.4 215.6 Q111.4 213.6 111.2 211.8 C117 214.8 123.6 220.2 129.2 227.6 Q132.4 230 135.2 230.6 C135.4 236.2 134.4 242 131.6 247.4 C127.8 253.4 120.8 256.4 114 256.6 C108.4 256.6 104.2 254.6 101.4 251.4 Z"><title>Glute Max (Right)</title></path>
    </g>
    <g data-region="legs">
      <!-- Soleus - outer part, below and beside the lateral gastrocnemius [deep] -->
      <path id="b-calves-soleus-lateral-l" class="muscle" data-muscle="calves-soleus" data-group="calves" data-side="left" d="M70.4 356 C72.2 363.6 75.4 370.4 79.6 376.4 Q80.6 377.6 80.4 380 C80.2 390 80.2 402 80.6 414 Q79.6 418.6 77.6 418.4 C75 410 72.2 400 70.4 390 C69.4 380 69.2 368 69.6 361 Q69.8 358 70.4 356 Z"><title>Soleus (Left)</title></path>
      <path id="b-calves-soleus-lateral-r" class="muscle" data-muscle="calves-soleus" data-group="calves" data-side="right" d="M129.6 356 C127.8 363.6 124.6 370.4 120.4 376.4 Q119.4 377.6 119.6 380 C119.8 390 119.8 402 119.4 414 Q120.4 418.6 122.4 418.4 C125 410 127.8 400 129.6 390 C130.6 380 130.8 368 130.4 361 Q130.2 358 129.6 356 Z"><title>Soleus (Right)</title></path>
      <!-- Soleus - inner part, below the medial gastrocnemius [deep] -->
      <path id="b-calves-soleus-medial-l" class="muscle" data-muscle="calves-soleus" data-group="calves" data-side="left" d="M95.4 375 Q95.2 380 94.6 384 C93.8 392 92.8 401 91.6 410 Q90.4 416.6 88.4 418.4 C86.6 418.2 85.4 417 85 415 C84.8 406 84.6 398 84.6 392.4 Q88 390.8 91 387.4 C92.8 384.8 94.4 380.4 95.4 375 Z"><title>Soleus (Left)</title></path>
      <path id="b-calves-soleus-medial-r" class="muscle" data-muscle="calves-soleus" data-group="calves" data-side="right" d="M104.6 375 Q104.8 380 105.4 384 C106.2 392 107.2 401 108.4 410 Q109.6 416.6 111.6 418.4 C113.4 418.2 114.6 417 115 415 C115.2 406 115.4 398 115.4 392.4 Q112 390.8 109 387.4 C107.2 384.8 105.6 380.4 104.6 375 Z"><title>Soleus (Right)</title></path>
      <!-- Biceps femoris (long head): ischial tuberosity -> fibular head -->
      <path id="b-hamstrings-biceps-femoris-l" class="muscle" data-muscle="hamstrings-biceps-femoris" data-group="hamstrings" data-side="left" d="M69.8 250.6 C74.2 255 79.6 257.6 85.6 258.2 C84.4 268 82.6 282 81 296 C79.8 304 78.4 312 76.6 321 Q75.2 323 74.4 321 C72.2 304 70.2 290 69.6 276 C69 266 69.2 258 69.8 250.6 Z"><title>Biceps Femoris (Left)</title></path>
      <path id="b-hamstrings-biceps-femoris-r" class="muscle" data-muscle="hamstrings-biceps-femoris" data-group="hamstrings" data-side="right" d="M130.2 250.6 C125.8 255 120.4 257.6 114.4 258.2 C115.6 268 117.4 282 119 296 C120.2 304 121.6 312 123.4 321 Q124.8 323 125.6 321 C127.8 304 129.8 290 130.4 276 C131 266 130.8 258 130.2 250.6 Z"><title>Biceps Femoris (Right)</title></path>
      <!-- Semitendinosus: ischial tuberosity -> medial tibia (sits on top of semimembranosus) -->
      <path id="b-hamstrings-semitendinosus-l" class="muscle" data-muscle="hamstrings-semitendinosus" data-group="hamstrings" data-side="left" d="M86.8 258.2 C88.8 258 90.6 257.6 92.4 257.2 C91.6 268 90.4 282 88.8 294 C87.6 302 87 310 87.2 318 Q85.8 319.6 84.8 318 C84 310 83 302 82.6 296 C83.6 282 85.4 268 86.8 258.2 Z"><title>Semitendinosus (Left)</title></path>
      <path id="b-hamstrings-semitendinosus-r" class="muscle" data-muscle="hamstrings-semitendinosus" data-group="hamstrings" data-side="right" d="M113.2 258.2 C111.2 258 109.4 257.6 107.6 257.2 C108.4 268 109.6 282 111.2 294 C112.4 302 113 310 112.8 318 Q114.2 319.6 115.2 318 C116 310 117 302 117.4 296 C116.4 282 114.6 268 113.2 258.2 Z"><title>Semitendinosus (Right)</title></path>
      <!-- Semimembranosus - inner strip beside the semitendinosus -->
      <path id="b-hamstrings-semimembranosus-medial-l" class="muscle" data-muscle="hamstrings-semimembranosus" data-group="hamstrings" data-side="left" d="M91.8 272.6 C93.4 275.6 94.2 279.4 94.4 283.6 C94.2 292 93.8 300 93.2 306 C92.6 314 91.6 319 90.4 324 Q89 324.8 88.2 322.6 C88.6 314 89.4 304 90.2 296 C90.8 288 91.2 280 91.8 272.6 Z"><title>Semimembranosus (Left)</title></path>
      <path id="b-hamstrings-semimembranosus-medial-r" class="muscle" data-muscle="hamstrings-semimembranosus" data-group="hamstrings" data-side="right" d="M108.2 272.6 C106.6 275.6 105.8 279.4 105.6 283.6 C105.8 292 106.2 300 106.8 306 C107.4 314 108.4 319 109.6 324 Q111 324.8 111.8 322.6 C111.4 314 110.6 304 109.8 296 C109.2 288 108.8 280 108.2 272.6 Z"><title>Semimembranosus (Right)</title></path>
      <!-- Semimembranosus - lateral edge peeking out beside the semitendinosus tendon -->
      <path id="b-hamstrings-semimembranosus-lateral-l" class="muscle" data-muscle="hamstrings-semimembranosus" data-group="hamstrings" data-side="left" d="M82.6 300 C83 306 83.6 312 84.2 317.6 Q83 318.6 82 317.4 C81.8 311.6 82 305.6 82.6 300 Z"><title>Semimembranosus (Left)</title></path>
      <path id="b-hamstrings-semimembranosus-lateral-r" class="muscle" data-muscle="hamstrings-semimembranosus" data-group="hamstrings" data-side="right" d="M117.4 300 C117 306 116.4 312 115.8 317.6 Q117 318.6 118 317.4 C118.2 311.6 118 305.6 117.4 300 Z"><title>Semimembranosus (Right)</title></path>
      <!-- Adductor magnus (posterior/hamstring part): ischial ramus -> adductor tubercle -->
      <path id="b-adductor-magnus-l" class="muscle" data-muscle="adductor-magnus" data-group="adductors" data-side="left" d="M92.8 256.4 C94.2 255.8 95.4 255.2 96.4 254.6 C96.2 263 95.8 272 95.2 280.6 C94.2 276.4 93.2 273.2 92.2 269.8 C92.4 265 92.6 260.6 92.8 256.4 Z"><title>Adductor Magnus (Left)</title></path>
      <path id="b-adductor-magnus-r" class="muscle" data-muscle="adductor-magnus" data-group="adductors" data-side="right" d="M107.2 256.4 C105.8 255.8 104.6 255.2 103.6 254.6 C103.8 263 104.2 272 104.8 280.6 C105.8 276.4 106.8 273.2 107.8 269.8 C107.6 265 107.4 260.6 107.2 256.4 Z"><title>Adductor Magnus (Right)</title></path>
      <!-- Gracilis - innermost strap of the thigh -->
      <path id="b-gracilis-l" class="muscle" data-muscle="gracilis" data-group="adductors" data-side="left" d="M98.2 252.6 C98.6 262 98.4 272 98 282 C97.6 294 96.8 308 96 324 Q94.6 325.4 93.6 323.4 C94.4 308 95 294 95.6 282 C96 272 96.4 262 96.8 254 Q97.6 253.4 98.2 252.6 Z"><title>Gracilis (Left)</title></path>
      <path id="b-gracilis-r" class="muscle" data-muscle="gracilis" data-group="adductors" data-side="right" d="M101.8 252.6 C101.4 262 101.6 272 102 282 C102.4 294 103.2 308 104 324 Q105.4 325.4 106.4 323.4 C105.6 308 105 294 104.4 282 C104 272 103.6 262 103.2 254 Q102.4 253.4 101.8 252.6 Z"><title>Gracilis (Right)</title></path>
      <!-- Gastrocnemius, lateral head - smaller and higher -->
      <path id="b-calves-gastroc-lateral-l" class="muscle" data-muscle="calves-gastroc-lateral" data-group="calves" data-side="left" d="M74.6 323.6 Q78.4 324 81.6 327.6 C82.6 336 82.8 350 82.6 362 C82.4 368 82 372 81.2 375.6 C77 371 73.6 364 71.6 356 C70.4 348 70.4 338 71.4 330 Q72.6 325.4 74.6 323.6 Z"><title>Lateral Gastrocnemius (Left)</title></path>
      <path id="b-calves-gastroc-lateral-r" class="muscle" data-muscle="calves-gastroc-lateral" data-group="calves" data-side="right" d="M125.4 323.6 Q121.6 324 118.4 327.6 C117.4 336 117.2 350 117.4 362 C117.6 368 118 372 118.8 375.6 C123 371 126.4 364 128.4 356 C129.6 348 129.6 338 128.6 330 Q127.4 325.4 125.4 323.6 Z"><title>Lateral Gastrocnemius (Right)</title></path>
      <!-- Gastrocnemius, medial head - larger and drops lower -->
      <path id="b-calves-gastroc-medial-l" class="muscle" data-muscle="calves-gastroc-medial" data-group="calves" data-side="left" d="M85.2 327.6 Q89.2 323.6 93.4 323.4 Q96 326 96.8 331 C97.4 339 97.4 349 96.8 358 C96 368 94.4 376 91.4 382 C89.4 386 87 388.6 84.8 389.4 C84.4 380 84.2 368 84.2 356 C84.2 346 84.4 336 85.2 327.6 Z"><title>Medial Gastrocnemius (Left)</title></path>
      <path id="b-calves-gastroc-medial-r" class="muscle" data-muscle="calves-gastroc-medial" data-group="calves" data-side="right" d="M114.8 327.6 Q110.8 323.6 106.6 323.4 Q104 326 103.2 331 C102.6 339 102.6 349 103.2 358 C104 368 105.6 376 108.6 382 C110.6 386 113 388.6 115.2 389.4 C115.6 380 115.8 368 115.8 356 C115.8 346 115.6 336 114.8 327.6 Z"><title>Medial Gastrocnemius (Right)</title></path>
    </g>
  </g>
  <!-- ===== Tendons, fascia & bony landmarks (non-interactive) ===== -->
  <g class="tendons" fill="#e0ddd7" stroke="#ffffff" stroke-width="0.8" stroke-linejoin="round" pointer-events="none">
    <!-- Spine line (spinous processes / nuchal ligament) -->
    <path class="tendon" d="M99.2 50 Q100 49.4 100.8 50 L100.8 216.6 Q100 217.4 99.2 216.6 Z"/>
    <!-- Trapezius tendinous diamond at C7 -->
    <path class="tendon" d="M98.8 82.8 Q100 81.6 101.2 82.8 L101.2 84.6 Q100 86 98.8 84.6 Z"/>
    <!-- Thoracolumbar fascia (where the lats attach) -->
    <path class="tendon" d="M94 145.8 C88.4 160 81.8 180 76.6 196.8 Q77.2 199.2 78.2 199.8 C82 201.2 85.4 204.6 87.8 208.8 Q87.6 205 87.8 202 C87.8 193 88.6 183 90.2 172 C91.4 163 92.6 154 94 145.8 Z"/>
    <path class="tendon" d="M106 145.8 C111.6 160 118.2 180 123.4 196.8 Q122.8 199.2 121.8 199.8 C118 201.2 114.6 204.6 112.2 208.8 Q112.4 205 112.2 202 C112.2 193 111.4 183 109.8 172 C108.6 163 107.4 154 106 145.8 Z"/>
    <!-- Sacral fascia -->
    <path class="tendon" d="M89.8 214 Q94 217 98.8 216.8 L98.8 218 Q94.4 218 90 216.4 Z"/>
    <path class="tendon" d="M110.2 214 Q106 217 101.2 216.8 L101.2 218 Q105.6 218 110 216.4 Z"/>
    <!-- Triceps tendon -->
    <path class="tendon" d="M54.4 140.2 C55.8 139.8 57 140.6 57.6 142.2 C57.8 149 56.8 156 54.6 162.4 Q52.6 163.8 51.2 162.8 C52.2 155 53 147.4 54.4 140.2 Z"/>
    <path class="tendon" d="M145.6 140.2 C144.2 139.8 143 140.6 142.4 142.2 C142.2 149 143.2 156 145.4 162.4 Q147.4 163.8 148.8 162.8 C147.8 155 147 147.4 145.6 140.2 Z"/>
    <!-- Iliotibial band (ITB) -->
    <path class="tendon" d="M64.2 236.8 C65.4 241.8 66.8 245.4 68.8 248.8 C68.6 256 68 264 68.6 272 C69.4 286 71.4 300 74 318.8 Q73 321.6 71.4 321 C70.8 312 68.4 302 66.6 290 C64.4 276 63.8 262 63.8 248 C63.8 243 63.9 239.6 64.2 236.8 Z"/>
    <path class="tendon" d="M135.8 236.8 C134.6 241.8 133.2 245.4 131.2 248.8 C131.4 256 132 264 131.4 272 C130.6 286 128.6 300 126 318.8 Q127 321.6 128.6 321 C129.2 312 131.6 302 133.4 290 C135.6 276 136.2 262 136.2 248 C136.2 243 136.1 239.6 135.8 236.8 Z"/>
    <!-- Achilles tendon -->
    <path class="tendon" d="M81.6 377.6 Q82.8 379.8 84 382.4 C83.8 392 83.8 404 84.4 418 Q83 420.8 81.4 419.6 C81.6 406 81.4 394 80.8 384 Q80.8 380.4 81.6 377.6 Z"/>
    <path class="tendon" d="M118.4 377.6 Q117.2 379.8 116 382.4 C116.2 392 116.2 404 115.6 418 Q117 420.8 118.6 419.6 C118.4 406 118.6 394 119.2 384 Q119.2 380.4 118.4 377.6 Z"/>
  </g>
  <!-- ===== Fibre direction (hide with: .fibres { display: none }) ===== -->
  <defs>
    <clipPath id="clip-b-delts-side-l"><use href="#b-delts-side-l"/></clipPath>
    <clipPath id="clip-b-delts-side-r"><use href="#b-delts-side-r"/></clipPath>
    <clipPath id="clip-b-delts-rear-l"><use href="#b-delts-rear-l"/></clipPath>
    <clipPath id="clip-b-delts-rear-r"><use href="#b-delts-rear-r"/></clipPath>
    <clipPath id="clip-b-rhomboids-l"><use href="#b-rhomboids-l"/></clipPath>
    <clipPath id="clip-b-rhomboids-r"><use href="#b-rhomboids-r"/></clipPath>
    <clipPath id="clip-b-traps-upper-l"><use href="#b-traps-upper-l"/></clipPath>
    <clipPath id="clip-b-traps-upper-r"><use href="#b-traps-upper-r"/></clipPath>
    <clipPath id="clip-b-traps-mid-l"><use href="#b-traps-mid-l"/></clipPath>
    <clipPath id="clip-b-traps-mid-r"><use href="#b-traps-mid-r"/></clipPath>
    <clipPath id="clip-b-traps-lower-l"><use href="#b-traps-lower-l"/></clipPath>
    <clipPath id="clip-b-traps-lower-r"><use href="#b-traps-lower-r"/></clipPath>
    <clipPath id="clip-b-infraspinatus-l"><use href="#b-infraspinatus-l"/></clipPath>
    <clipPath id="clip-b-infraspinatus-r"><use href="#b-infraspinatus-r"/></clipPath>
    <clipPath id="clip-b-teres-minor-l"><use href="#b-teres-minor-l"/></clipPath>
    <clipPath id="clip-b-teres-minor-r"><use href="#b-teres-minor-r"/></clipPath>
    <clipPath id="clip-b-teres-major-l"><use href="#b-teres-major-l"/></clipPath>
    <clipPath id="clip-b-teres-major-r"><use href="#b-teres-major-r"/></clipPath>
    <clipPath id="clip-b-lats-l"><use href="#b-lats-l"/></clipPath>
    <clipPath id="clip-b-lats-r"><use href="#b-lats-r"/></clipPath>
    <clipPath id="clip-b-erector-spinae-l"><use href="#b-erector-spinae-l"/></clipPath>
    <clipPath id="clip-b-erector-spinae-r"><use href="#b-erector-spinae-r"/></clipPath>
    <clipPath id="clip-b-triceps-long-l"><use href="#b-triceps-long-l"/></clipPath>
    <clipPath id="clip-b-triceps-long-r"><use href="#b-triceps-long-r"/></clipPath>
    <clipPath id="clip-b-triceps-lateral-l"><use href="#b-triceps-lateral-l"/></clipPath>
    <clipPath id="clip-b-triceps-lateral-r"><use href="#b-triceps-lateral-r"/></clipPath>
    <clipPath id="clip-b-brachioradialis-l"><use href="#b-brachioradialis-l"/></clipPath>
    <clipPath id="clip-b-brachioradialis-r"><use href="#b-brachioradialis-r"/></clipPath>
    <clipPath id="clip-b-forearm-extensors-l"><use href="#b-forearm-extensors-l"/></clipPath>
    <clipPath id="clip-b-forearm-extensors-r"><use href="#b-forearm-extensors-r"/></clipPath>
    <clipPath id="clip-b-extensor-carpi-ulnaris-l"><use href="#b-extensor-carpi-ulnaris-l"/></clipPath>
    <clipPath id="clip-b-extensor-carpi-ulnaris-r"><use href="#b-extensor-carpi-ulnaris-r"/></clipPath>
    <clipPath id="clip-b-flexor-carpi-ulnaris-l"><use href="#b-flexor-carpi-ulnaris-l"/></clipPath>
    <clipPath id="clip-b-flexor-carpi-ulnaris-r"><use href="#b-flexor-carpi-ulnaris-r"/></clipPath>
    <clipPath id="clip-b-obliques-external-l"><use href="#b-obliques-external-l"/></clipPath>
    <clipPath id="clip-b-obliques-external-r"><use href="#b-obliques-external-r"/></clipPath>
    <clipPath id="clip-b-glutes-med-l"><use href="#b-glutes-med-l"/></clipPath>
    <clipPath id="clip-b-glutes-med-r"><use href="#b-glutes-med-r"/></clipPath>
    <clipPath id="clip-b-glutes-max-l"><use href="#b-glutes-max-l"/></clipPath>
    <clipPath id="clip-b-glutes-max-r"><use href="#b-glutes-max-r"/></clipPath>
    <clipPath id="clip-b-calves-soleus-lateral-l"><use href="#b-calves-soleus-lateral-l"/></clipPath>
    <clipPath id="clip-b-calves-soleus-lateral-r"><use href="#b-calves-soleus-lateral-r"/></clipPath>
    <clipPath id="clip-b-calves-soleus-medial-l"><use href="#b-calves-soleus-medial-l"/></clipPath>
    <clipPath id="clip-b-calves-soleus-medial-r"><use href="#b-calves-soleus-medial-r"/></clipPath>
    <clipPath id="clip-b-hamstrings-biceps-femoris-l"><use href="#b-hamstrings-biceps-femoris-l"/></clipPath>
    <clipPath id="clip-b-hamstrings-biceps-femoris-r"><use href="#b-hamstrings-biceps-femoris-r"/></clipPath>
    <clipPath id="clip-b-hamstrings-semitendinosus-l"><use href="#b-hamstrings-semitendinosus-l"/></clipPath>
    <clipPath id="clip-b-hamstrings-semitendinosus-r"><use href="#b-hamstrings-semitendinosus-r"/></clipPath>
    <clipPath id="clip-b-hamstrings-semimembranosus-medial-l"><use href="#b-hamstrings-semimembranosus-medial-l"/></clipPath>
    <clipPath id="clip-b-hamstrings-semimembranosus-medial-r"><use href="#b-hamstrings-semimembranosus-medial-r"/></clipPath>
    <clipPath id="clip-b-hamstrings-semimembranosus-lateral-l"><use href="#b-hamstrings-semimembranosus-lateral-l"/></clipPath>
    <clipPath id="clip-b-hamstrings-semimembranosus-lateral-r"><use href="#b-hamstrings-semimembranosus-lateral-r"/></clipPath>
    <clipPath id="clip-b-adductor-magnus-l"><use href="#b-adductor-magnus-l"/></clipPath>
    <clipPath id="clip-b-adductor-magnus-r"><use href="#b-adductor-magnus-r"/></clipPath>
    <clipPath id="clip-b-gracilis-l"><use href="#b-gracilis-l"/></clipPath>
    <clipPath id="clip-b-gracilis-r"><use href="#b-gracilis-r"/></clipPath>
    <clipPath id="clip-b-calves-gastroc-lateral-l"><use href="#b-calves-gastroc-lateral-l"/></clipPath>
    <clipPath id="clip-b-calves-gastroc-lateral-r"><use href="#b-calves-gastroc-lateral-r"/></clipPath>
    <clipPath id="clip-b-calves-gastroc-medial-l"><use href="#b-calves-gastroc-medial-l"/></clipPath>
    <clipPath id="clip-b-calves-gastroc-medial-r"><use href="#b-calves-gastroc-medial-r"/></clipPath>
  </defs>
  <g class="fibres" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="0.6" stroke-linecap="round" pointer-events="none">
    <g clip-path="url(#clip-b-delts-side-l)"><path class="fibre" d="M52.25 86.85 Q52.26 105.34 55.2 123.6"/><path class="fibre" d="M54.5 85.7 Q53.33 104.68 55.2 123.6"/><path class="fibre" d="M56.75 84.55 Q54.41 104.01 55.2 123.6"/></g>
    <g clip-path="url(#clip-b-delts-side-r)"><path class="fibre" d="M147.75 86.85 Q147.74 105.34 144.8 123.6"/><path class="fibre" d="M145.5 85.7 Q146.67 104.68 144.8 123.6"/><path class="fibre" d="M143.25 84.55 Q145.59 104.01 144.8 123.6"/></g>
    <g clip-path="url(#clip-b-delts-rear-l)"><path class="fibre" d="M66.2 87.65 Q59.57 105.11 55.8 123.4"/><path class="fibre" d="M69 88.9 Q61.02 105.62 55.8 123.4"/><path class="fibre" d="M71.8 90.15 Q62.47 106.14 55.8 123.4"/></g>
    <g clip-path="url(#clip-b-delts-rear-r)"><path class="fibre" d="M133.8 87.65 Q140.43 105.11 144.2 123.4"/><path class="fibre" d="M131 88.9 Q138.98 105.62 144.2 123.4"/><path class="fibre" d="M128.2 90.15 Q137.53 106.14 144.2 123.4"/></g>
    <g clip-path="url(#clip-b-rhomboids-l)"><path class="fibre" d="M98 107.5 Q90.6 108.17 83.4 110"/><path class="fibre" d="M98 115 Q90.36 114.89 82.8 116"/><path class="fibre" d="M98 122.5 Q90.12 121.62 82.2 122"/></g>
    <g clip-path="url(#clip-b-rhomboids-r)"><path class="fibre" d="M102 107.5 Q109.4 108.17 116.6 110"/><path class="fibre" d="M102 115 Q109.64 114.89 117.2 116"/><path class="fibre" d="M102 122.5 Q109.88 121.62 117.8 122"/></g>
    <g clip-path="url(#clip-b-traps-upper-l)"><path class="fibre" d="M98.6 61.5 Q79.58 69.09 62 79.6"/><path class="fibre" d="M98.6 67 Q79.8 71.84 62 79.6"/><path class="fibre" d="M98.6 72.5 Q80.02 74.59 62 79.6"/></g>
    <g clip-path="url(#clip-b-traps-upper-r)"><path class="fibre" d="M101.4 61.5 Q120.42 69.09 138 79.6"/><path class="fibre" d="M101.4 67 Q120.2 71.84 138 79.6"/><path class="fibre" d="M101.4 72.5 Q119.98 74.59 138 79.6"/></g>
    <g clip-path="url(#clip-b-traps-mid-l)"><path class="fibre" d="M98.6 91.75 Q84.5 88.16 70 86.85"/><path class="fibre" d="M98.6 95.5 Q86.56 91.32 74 89.1"/><path class="fibre" d="M98.6 99.25 Q88.62 94.48 78 91.35"/></g>
    <g clip-path="url(#clip-b-traps-mid-r)"><path class="fibre" d="M101.4 91.75 Q115.5 88.16 130 86.85"/><path class="fibre" d="M101.4 95.5 Q113.44 91.32 126 89.1"/><path class="fibre" d="M101.4 99.25 Q111.38 94.48 122 91.35"/></g>
    <g clip-path="url(#clip-b-traps-lower-l)"><path class="fibre" d="M98.6 127.5 Q93.73 116.29 87.15 106"/><path class="fibre" d="M98.6 135 Q94.35 122.08 88.1 110"/><path class="fibre" d="M98.6 142.5 Q94.96 127.87 89.05 114"/></g>
    <g clip-path="url(#clip-b-traps-lower-r)"><path class="fibre" d="M101.4 127.5 Q106.27 116.29 112.85 106"/><path class="fibre" d="M101.4 135 Q105.65 122.08 111.9 110"/><path class="fibre" d="M101.4 142.5 Q105.04 127.87 110.95 114"/></g>
    <g clip-path="url(#clip-b-infraspinatus-l)"><path class="fibre" d="M82.75 106.5 Q74.33 106.38 66 107.6"/><path class="fibre" d="M82.1 112 Q74.23 109.16 66 107.6"/><path class="fibre" d="M81.45 117.5 Q74.12 111.93 66 107.6"/></g>
    <g clip-path="url(#clip-b-infraspinatus-r)"><path class="fibre" d="M117.25 106.5 Q125.67 106.38 134 107.6"/><path class="fibre" d="M117.9 112 Q125.77 109.16 134 107.6"/><path class="fibre" d="M118.55 117.5 Q125.88 111.93 134 107.6"/></g>
    <g clip-path="url(#clip-b-teres-minor-l)"><path class="fibre" d="M79.4 128.2 Q72.87 120.53 65.2 114"/></g>
    <g clip-path="url(#clip-b-teres-minor-r)"><path class="fibre" d="M120.6 128.2 Q127.13 120.53 134.8 114"/></g>
    <g clip-path="url(#clip-b-teres-major-l)"><path class="fibre" d="M78.6 132 Q72.2 126.46 65 122"/><path class="fibre" d="M77 134.6 Q71.38 129.32 65 125"/></g>
    <g clip-path="url(#clip-b-teres-major-r)"><path class="fibre" d="M121.4 132 Q127.8 126.46 135 122"/><path class="fibre" d="M123 134.6 Q128.62 129.32 135 125"/></g>
    <g clip-path="url(#clip-b-lats-l)"><path class="fibre" d="M90.73 147.5 Q78.55 135.4 64.6 125.4"/><path class="fibre" d="M87.87 157 Q77.5 140.27 64.6 125.4"/><path class="fibre" d="M85 166.5 Q76.44 145.13 64.6 125.4"/><path class="fibre" d="M82.13 176 Q75.39 150 64.6 125.4"/><path class="fibre" d="M79.27 185.5 Q74.34 154.86 64.6 125.4"/></g>
    <g clip-path="url(#clip-b-lats-r)"><path class="fibre" d="M109.27 147.5 Q121.45 135.4 135.4 125.4"/><path class="fibre" d="M112.13 157 Q122.5 140.27 135.4 125.4"/><path class="fibre" d="M115 166.5 Q123.56 145.13 135.4 125.4"/><path class="fibre" d="M117.87 176 Q124.61 150 135.4 125.4"/><path class="fibre" d="M120.73 185.5 Q125.66 154.86 135.4 125.4"/></g>
    <g clip-path="url(#clip-b-erector-spinae-l)"><path class="fibre" d="M97.4 156 Q94.88 184.98 97 214"/><path class="fibre" d="M95 154 Q91.48 182.9 92.6 212"/><path class="fibre" d="M92.6 168 Q90.04 189.94 91 212"/></g>
    <g clip-path="url(#clip-b-erector-spinae-r)"><path class="fibre" d="M102.6 156 Q105.12 184.98 103 214"/><path class="fibre" d="M105 154 Q108.52 182.9 107.4 212"/><path class="fibre" d="M107.4 168 Q109.96 189.94 109 212"/></g>
    <g clip-path="url(#clip-b-triceps-long-l)"><path class="fibre" d="M62.4 118 Q59.88 136.92 60.4 156"/><path class="fibre" d="M59.4 122 Q57.96 134.97 58.6 148"/></g>
    <g clip-path="url(#clip-b-triceps-long-r)"><path class="fibre" d="M137.6 118 Q140.12 136.92 139.6 156"/><path class="fibre" d="M140.6 122 Q142.04 134.97 141.4 148"/></g>
    <g clip-path="url(#clip-b-triceps-lateral-l)"><path class="fibre" d="M47 110 Q46.94 132.14 50.4 154"/><path class="fibre" d="M51 118 Q50.4 133.05 52.2 148"/></g>
    <g clip-path="url(#clip-b-triceps-lateral-r)"><path class="fibre" d="M153 110 Q153.06 132.14 149.6 154"/><path class="fibre" d="M149 118 Q149.6 133.05 147.8 148"/></g>
    <g clip-path="url(#clip-b-brachioradialis-l)"><path class="fibre" d="M43 154 Q36.3 188.69 35.2 224"/></g>
    <g clip-path="url(#clip-b-brachioradialis-r)"><path class="fibre" d="M157 154 Q163.7 188.69 164.8 224"/></g>
    <g clip-path="url(#clip-b-forearm-extensors-l)"><path class="fibre" d="M47.2 162 Q40.88 193.2 39.6 225"/><path class="fibre" d="M48.6 166 Q42.78 194.72 41.6 224"/></g>
    <g clip-path="url(#clip-b-forearm-extensors-r)"><path class="fibre" d="M152.8 162 Q159.12 193.2 160.4 225"/><path class="fibre" d="M151.4 166 Q157.22 194.72 158.4 224"/></g>
    <g clip-path="url(#clip-b-extensor-carpi-ulnaris-l)"><path class="fibre" d="M50.6 166 Q45.14 195.25 44.4 225"/></g>
    <g clip-path="url(#clip-b-extensor-carpi-ulnaris-r)"><path class="fibre" d="M149.4 166 Q154.86 195.25 155.6 225"/></g>
    <g clip-path="url(#clip-b-flexor-carpi-ulnaris-l)"><path class="fibre" d="M58.6 170 Q51.3 197.09 48.4 225"/></g>
    <g clip-path="url(#clip-b-flexor-carpi-ulnaris-r)"><path class="fibre" d="M141.4 170 Q148.7 197.09 151.6 225"/></g>
    <g clip-path="url(#clip-b-obliques-external-l)"><path class="fibre" d="M68.8 178 Q70.4 188.19 73.6 198"/></g>
    <g clip-path="url(#clip-b-obliques-external-r)"><path class="fibre" d="M131.2 178 Q129.6 188.19 126.4 198"/></g>
    <g clip-path="url(#clip-b-glutes-med-l)"><path class="fibre" d="M72.65 205 Q68.52 216.04 66.2 227.6"/><path class="fibre" d="M77.3 206 Q70.89 216.36 66.2 227.6"/><path class="fibre" d="M81.95 207 Q73.25 216.67 66.2 227.6"/></g>
    <g clip-path="url(#clip-b-glutes-med-r)"><path class="fibre" d="M127.35 205 Q131.48 216.04 133.8 227.6"/><path class="fibre" d="M122.7 206 Q129.11 216.36 133.8 227.6"/><path class="fibre" d="M118.05 207 Q126.75 216.67 133.8 227.6"/></g>
    <g clip-path="url(#clip-b-glutes-max-l)"><path class="fibre" d="M90.8 221.2 Q78.78 227.99 68 236.6"/><path class="fibre" d="M92.6 228.4 Q80.79 233.9 70 241.2"/><path class="fibre" d="M94.4 235.6 Q82.79 239.8 72 245.8"/><path class="fibre" d="M96.2 242.8 Q84.8 245.71 74 250.4"/></g>
    <g clip-path="url(#clip-b-glutes-max-r)"><path class="fibre" d="M109.2 221.2 Q121.22 227.99 132 236.6"/><path class="fibre" d="M107.4 228.4 Q119.21 233.9 130 241.2"/><path class="fibre" d="M105.6 235.6 Q117.21 239.8 128 245.8"/><path class="fibre" d="M103.8 242.8 Q115.2 245.71 126 250.4"/></g>
    <g clip-path="url(#clip-b-calves-soleus-lateral-l)"><path class="fibre" d="M71 360 Q72.56 388.3 78.6 416"/><path class="fibre" d="M93.2 382 Q88.84 398.76 87.2 416"/></g>
    <g clip-path="url(#clip-b-calves-soleus-lateral-r)"><path class="fibre" d="M129 360 Q127.44 388.3 121.4 416"/><path class="fibre" d="M106.8 382 Q111.16 398.76 112.8 416"/></g>
    <g clip-path="url(#clip-b-calves-soleus-medial-l)"><path class="fibre" d="M71 360 Q72.56 388.3 78.6 416"/><path class="fibre" d="M93.2 382 Q88.84 398.76 87.2 416"/></g>
    <g clip-path="url(#clip-b-calves-soleus-medial-r)"><path class="fibre" d="M129 360 Q127.44 388.3 121.4 416"/><path class="fibre" d="M106.8 382 Q111.16 398.76 112.8 416"/></g>
    <g clip-path="url(#clip-b-hamstrings-biceps-femoris-l)"><path class="fibre" d="M75.33 255.33 Q73.09 286.35 75.8 317.33"/><path class="fibre" d="M79.67 256.67 Q75.73 286.54 76.6 316.67"/></g>
    <g clip-path="url(#clip-b-hamstrings-biceps-femoris-r)"><path class="fibre" d="M124.67 255.33 Q126.91 286.35 124.2 317.33"/><path class="fibre" d="M120.33 256.67 Q124.27 286.54 123.4 316.67"/></g>
    <g clip-path="url(#clip-b-hamstrings-semitendinosus-l)"><path class="fibre" d="M88 259 Q84.62 287.41 85.8 316"/><path class="fibre" d="M90.4 259 Q86.62 282.35 86.6 306"/></g>
    <g clip-path="url(#clip-b-hamstrings-semitendinosus-r)"><path class="fibre" d="M112 259 Q115.38 287.41 114.2 316"/><path class="fibre" d="M109.6 259 Q113.38 282.35 113.4 306"/></g>
    <g clip-path="url(#clip-b-hamstrings-semimembranosus-medial-l)"><path class="fibre" d="M93 276 Q89.46 298.86 89.6 322"/></g>
    <g clip-path="url(#clip-b-hamstrings-semimembranosus-medial-r)"><path class="fibre" d="M107 276 Q110.54 298.86 110.4 322"/></g>
    <g clip-path="url(#clip-b-hamstrings-semimembranosus-lateral-l)"><path class="fibre" d="M93 276 Q89.46 298.86 89.6 322"/></g>
    <g clip-path="url(#clip-b-hamstrings-semimembranosus-lateral-r)"><path class="fibre" d="M107 276 Q110.54 298.86 110.4 322"/></g>
    <g clip-path="url(#clip-b-adductor-magnus-l)"><path class="fibre" d="M94 257 Q93.14 266.49 93.8 276"/></g>
    <g clip-path="url(#clip-b-adductor-magnus-r)"><path class="fibre" d="M106 257 Q106.86 266.49 106.2 276"/></g>
    <g clip-path="url(#clip-b-gracilis-l)"><path class="fibre" d="M97.4 256 Q93.46 288.9 94.8 322"/></g>
    <g clip-path="url(#clip-b-gracilis-r)"><path class="fibre" d="M102.6 256 Q106.54 288.9 105.2 322"/></g>
    <g clip-path="url(#clip-b-calves-gastroc-lateral-l)"><path class="fibre" d="M74.4 336.48 Q75.47 339.48 77 342.28"/><path class="fibre" d="M79.6 336.48 Q78.07 339.28 77 342.28"/><path class="fibre" d="M74.4 347.48 Q75.47 350.48 77 353.28"/><path class="fibre" d="M79.6 347.48 Q78.07 350.28 77 353.28"/><path class="fibre" d="M74.4 358.48 Q75.47 361.48 77 364.28"/><path class="fibre" d="M79.6 358.48 Q78.07 361.28 77 364.28"/></g>
    <g clip-path="url(#clip-b-calves-gastroc-lateral-r)"><path class="fibre" d="M125.6 336.48 Q124.53 339.48 123 342.28"/><path class="fibre" d="M120.4 336.48 Q121.93 339.28 123 342.28"/><path class="fibre" d="M125.6 347.48 Q124.53 350.48 123 353.28"/><path class="fibre" d="M120.4 347.48 Q121.93 350.28 123 353.28"/><path class="fibre" d="M125.6 358.48 Q124.53 361.48 123 364.28"/><path class="fibre" d="M120.4 358.48 Q121.93 361.28 123 364.28"/></g>
    <g clip-path="url(#clip-b-calves-gastroc-medial-l)"><path class="fibre" d="M87.2 339.4 Q88.36 343.18 90.1 346.72"/><path class="fibre" d="M93.2 339.4 Q91.36 342.94 90.1 346.72"/><path class="fibre" d="M87 353.4 Q88.16 357.18 89.9 360.72"/><path class="fibre" d="M93 353.4 Q91.16 356.94 89.9 360.72"/><path class="fibre" d="M86.8 367.4 Q87.96 371.18 89.7 374.72"/><path class="fibre" d="M92.8 367.4 Q90.96 370.94 89.7 374.72"/></g>
    <g clip-path="url(#clip-b-calves-gastroc-medial-r)"><path class="fibre" d="M112.8 339.4 Q111.64 343.18 109.9 346.72"/><path class="fibre" d="M106.8 339.4 Q108.64 342.94 109.9 346.72"/><path class="fibre" d="M113 353.4 Q111.84 357.18 110.1 360.72"/><path class="fibre" d="M107 353.4 Q108.84 356.94 110.1 360.72"/><path class="fibre" d="M113.2 367.4 Q112.04 371.18 110.3 374.72"/><path class="fibre" d="M107.2 367.4 Q109.04 370.94 110.3 374.72"/></g>
  </g>
`;

function muscleRecolourForDarkCard_(svgMarkup) {
  return svgMarkup
    .split("#e7e5e0").join(MUSCLE_BASE_COLOR)
    .split("#d9d6d0").join(MUSCLE_UNUSED_COLOR)
    .split("#e0ddd7").join(MUSCLE_TENDON_COLOR)
    .split("#ffffff").join(MUSCLE_GAP_STROKE_COLOR);
}

const MUSCLE_FRONT_SVG_ = muscleRecolourForDarkCard_(MUSCLE_FRONT_SVG_RAW_);
const MUSCLE_BACK_SVG_ = muscleRecolourForDarkCard_(MUSCLE_BACK_SVG_RAW_);

/**
 * The front or back figure as inline SVG markup (a string, not yet in the
 * DOM) — Max's artwork above, filled `MUSCLE_UNUSED_COLOR` until
 * paintMuscleFigure() recolours it. `summaryId` is used for the hidden text
 * summary paintMuscleFigure keeps up to date (the accessible description of
 * what's highlighted).
 */
function muscleFigureSvg(view, summaryId) {
  const inner = view === "back" ? MUSCLE_BACK_SVG_ : MUSCLE_FRONT_SVG_;
  return (
    `<svg class="muscle-figure" data-view="${view}" viewBox="0 0 200 460" role="img" aria-labelledby="${summaryId}">` +
    `<title id="${summaryId}">${view === "back" ? "Back" : "Front"} view</title>` +
    inner +
    "</svg>"
  );
}

/**
 * A small icon-sized crop of the same figure — same shapes, same colours,
 * just a tight viewBox over one region (e.g. shoulders-to-chest) instead of
 * the full 200x460 body, so a highlighted muscle actually reads at 20-30px
 * instead of being a fleck on a tiny full-body silhouette. `keys` are
 * painted MUSCLE_PRIMARY_COLOR; everything else fades to near-invisible
 * against the icon's own background rather than competing with it. Used by
 * the workout builder's movement tiles (exercise-picker.js).
 */
function muscleCropSvg(view, viewBox, keys) {
  const inner = view === "back" ? MUSCLE_BACK_SVG_ : MUSCLE_FRONT_SVG_;
  return `<svg viewBox="${viewBox}" aria-hidden="true" data-crop-keys="${keys.join(",")}">${inner}</svg>`;
}

/** Paints a muscleCropSvg() once it's in the DOM — keys lit up, everything else nearly gone. */
/** A shape matches `keys` if EITHER its fine key (data-muscle, e.g. "chest-upper") or its broad one (data-group, e.g. "chest") is listed — so exercise data can mix fine and broad keys freely (see EXERCISE_MUSCLE_DATA_'s header comment in Code.gs) and both still paint correctly. */
function muscleShapeMatches_(el, keys) {
  return keys.includes(el.getAttribute("data-muscle")) || keys.includes(el.getAttribute("data-group"));
}

function paintMuscleCrop(svgRoot) {
  if (!svgRoot) return;
  const keys = (svgRoot.dataset.cropKeys || "").split(",").filter(Boolean);
  svgRoot.querySelectorAll("[data-muscle]").forEach((el) => {
    el.setAttribute("fill", muscleShapeMatches_(el, keys) ? MUSCLE_PRIMARY_COLOR : "rgba(255,255,255,0.06)");
  });
}

/**
 * Recolours every `[data-muscle]` group inside `svgRoot` (a front or back
 * muscleFigureSvg already in the DOM) to match primary/secondary, and
 * updates its `<title>` to a plain-text summary for screen readers — e.g.
 * "Highlights: Chest (primary), Shoulders, Triceps (secondary)". A muscle
 * key this view doesn't have a shape for (e.g. "chest" on the back view)
 * is silently skipped — the other view still carries it.
 */
function paintMuscleFigure(svgRoot, primary, secondary) {
  if (!svgRoot) return;
  const p = Array.isArray(primary) ? primary : parseMuscleKeys(primary);
  const s = Array.isArray(secondary) ? secondary : parseMuscleKeys(secondary);
  svgRoot.querySelectorAll("[data-muscle]").forEach((g) => {
    g.setAttribute("fill", muscleShapeMatches_(g, p) ? MUSCLE_PRIMARY_COLOR : muscleShapeMatches_(g, s) ? MUSCLE_SECONDARY_COLOR : MUSCLE_UNUSED_COLOR);
  });
  const title = svgRoot.querySelector("title");
  if (title) {
    const parts = [];
    if (p.length) parts.push(`${p.map(muscleLabel_).join(", ")} (primary)`);
    if (s.length) parts.push(`${s.map(muscleLabel_).join(", ")} (secondary)`);
    title.textContent = parts.length ? `Highlights: ${parts.join(", ")}` : (svgRoot.dataset.view === "back" ? "Back view" : "Front view");
  }
}

/** Grey (0) toward red (1), for paintMuscleHeat below — MUSCLE_UNUSED_COLOR and MUSCLE_PRIMARY_COLOR are both #rrggbb. */
function muscleHeatColor_(t) {
  const from = [0x3c, 0x3c, 0x3c];
  const to = [0xff, 0x2a, 0x1f];
  const rgb = from.map((c, i) => Math.round(c + (to[i] - c) * Math.max(0, Math.min(1, t))));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/**
 * Colours every `[data-muscle]` shape by how much it's been trained,
 * grey-to-red, instead of paintMuscleFigure's binary primary/secondary —
 * for the Muscle Heatmap (workout/heatmap.js), not an exercise's own
 * figure. `weighted` is `{ key: weightedSetCount }`; `cap` is the count
 * that reads as fully red (so a heavy but not extreme day doesn't look
 * identical to a maximal one) — defaults to 10.
 */
function paintMuscleHeat(svgRoot, weighted, cap) {
  if (!svgRoot) return;
  const capVal = cap || 10;
  svgRoot.querySelectorAll("[data-muscle]").forEach((g) => {
    // A shape's heat is whatever was logged against its OWN fine key (e.g.
    // "chest-upper") plus whatever was logged against its broad group (e.g.
    // "chest", from an exercise whose data never got the v2 upgrade) — the
    // broad hit applies to every sub-region of that muscle, same as it
    // would've painted the whole muscle before v2 existed.
    const w = ((weighted && weighted[g.getAttribute("data-muscle")]) || 0) + ((weighted && weighted[g.getAttribute("data-group")]) || 0);
    g.setAttribute("fill", muscleHeatColor_(w / capVal));
  });
  const title = svgRoot.querySelector("title");
  if (title) title.textContent = svgRoot.dataset.view === "back" ? "Back view" : "Front view";
}

// ---------------------------------------------------------------------------
// Weekly targets (2026-10-09, Goal 3) — colour by status against a target
// range instead of relative to whatever's trained hardest this week, so a
// quiet week doesn't paint itself falsely "fully red" and a heavy week
// doesn't look identical to a moderate one. One shared default per tracked
// muscle; override individual keys here if a specific muscle ever needs a
// different range, so a tweak stays a one-line diff.
const MUSCLE_WEEKLY_TARGET_DEFAULT_ = { min: 10, max: 20 };
const MUSCLE_WEEKLY_TARGET_OVERRIDES_ = {};
function muscleWeeklyTarget_(key) {
  return MUSCLE_WEEKLY_TARGET_OVERRIDES_[key] || MUSCLE_WEEKLY_TARGET_DEFAULT_;
}

/** "under" (below target.min), "above" (over target.max), else "in-range". */
function muscleTargetStatus_(value, target) {
  if (value < target.min) return "under";
  if (value > target.max) return "above";
  return "in-range";
}

// Grey for "under" (same as an untrained muscle — not enough yet, not a
// failure colour), the brand red for "in-range" (used positively here:
// on target), and the app's existing amber for "above" — deliberately NOT
// a louder/alarm red, per Max's own "no shaming, no red failure screens"
// rule. Text uses --grey (not --dim) for "under" so it still reads at his
// brightness bar for anything a client reads.
const MUSCLE_STATUS_COLOR_ = { under: "#3c3c3c", "in-range": "#ff2a1f", above: "#e08a00" };

// The 4 abs sub-region shapes all display as the single merged "Rectus
// Abdominis" row (workout/library.js's own merge) — shared here so the
// status figure (below) and the tooltip (further below) redirect to it
// identically, rather than two copies of the same little lookup table.
const MUSCLE_ABS_SHAPE_REDIRECT_ = { "abs-upper": "abs-rectus", "abs-mid": "abs-rectus", "abs-lower": "abs-rectus", "abs-infra": "abs-rectus" };
function muscleAbsDisplayKey_(rawKey) {
  return MUSCLE_ABS_SHAPE_REDIRECT_[rawKey] || rawKey;
}

/**
 * Colours every `[data-muscle]` shape by its weekly TARGET STATUS instead
 * of paintMuscleHeat's continuous grey-to-red intensity — for the Muscles
 * tab's This Week view only (Today keeps the old relative scaling; a
 * single day isn't comparable to a weekly target). `weighted` must already
 * have the abs sub-regions merged into "abs-rectus" (workout/library.js's
 * own merge, done once and shared between the list and this figure) —
 * every real abs-* shape here is redirected to read that merged value, so
 * the 4 ab regions on the figure always agree with the single merged row
 * the list shows, rather than quietly reflecting a split the list no
 * longer displays.
 */
function paintMuscleHeatByStatus_(svgRoot, weighted) {
  if (!svgRoot) return;
  svgRoot.querySelectorAll("[data-muscle]").forEach((g) => {
    const key = muscleAbsDisplayKey_(g.getAttribute("data-muscle"));
    // Unlike paintMuscleHeat's continuous scale, status needs ONE real
    // number to judge against this muscle's own target — adding the fine
    // key's value to its bare coarse group's (the old fallback, meant for
    // legacy coarse-only data lighting up every sub-region) double-counts
    // whenever something ALSO logs the bare group name on its own, which
    // every Conditioning-category exercise does (e.g. a real "delts-side"
    // entry plus an unrelated bare "delts" one from a burpee) — inflating a
    // muscle's status past what it actually earned. Prefer the shape's own
    // fine-key value whenever anything has ever touched it; only fall back
    // to the bare group's value for a shape whose fine key has no data at
    // all (found 2026-10-09 verifying this against real data — several
    // under-target muscles were painting as in-range).
    const groupKey = g.getAttribute("data-group");
    const value = weighted && Object.prototype.hasOwnProperty.call(weighted, key) ? weighted[key] : (weighted && weighted[groupKey]) || 0;
    g.setAttribute("fill", MUSCLE_STATUS_COLOR_[muscleTargetStatus_(value, muscleWeeklyTarget_(key))]);
  });
  const title = svgRoot.querySelector("title");
  if (title) title.textContent = svgRoot.dataset.view === "back" ? "Back view" : "Front view";
}

// ---------------------------------------------------------------------------
// Figure tooltip (2026-10-09, Goal 4) — hover (desktop) or tap (mobile; tap
// the same muscle again, or anywhere else, to close) a shape on either
// page's body figure for its own breakdown: effective sets (vs target where
// one applies), direct/indirect split, and its top contributing exercises.
// One shared component so the Muscles tab and the builder's side panel look
// and behave identically instead of two near-duplicate implementations.

/** Plain-text escape for exercise names (coach-typed, not from a fixed dictionary) interpolated into the tooltip's innerHTML. */
function muscleTooltipEsc_(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

let muscleTooltipEl_ = null;
let muscleTooltipOpenShape_ = null; // the SVG shape element the open tooltip belongs to, or null

function muscleTooltipEnsure_() {
  if (!muscleTooltipEl_) {
    const el = document.createElement("div");
    el.className = "muscle-tooltip";
    el.hidden = true;
    document.body.appendChild(el);
    muscleTooltipEl_ = el;
  }
  return muscleTooltipEl_;
}

function muscleTooltipHide_() {
  if (muscleTooltipEl_) muscleTooltipEl_.hidden = true;
  muscleTooltipOpenShape_ = null;
}

/** Positions the (already-filled, still hidden) tooltip near `shapeEl`, clamped to the viewport. Fixed positioning off the shape's own bounding rect — no SVG-coordinate math, works the same regardless of which page/scroll container it's in. */
function muscleTooltipPosition_(el, shapeEl) {
  const rect = shapeEl.getBoundingClientRect();
  const margin = 10;
  el.style.left = "0px";
  el.style.top = "0px";
  el.hidden = false;
  const tw = el.offsetWidth;
  const th = el.offsetHeight;
  let left = rect.left + rect.width / 2 - tw / 2;
  let top = rect.top - th - margin;
  if (top < margin) top = rect.bottom + margin; // not enough room above — show below instead
  left = Math.max(margin, Math.min(window.innerWidth - tw - margin, left));
  top = Math.max(margin, Math.min(window.innerHeight - th - margin, top));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

/**
 * The tooltip's inner HTML for one muscle. `target` ({min,max}) is optional
 * — pass it for "x.x / min–max" (the Muscles tab's This Week view); omit it
 * for a plain "x.x effective sets" (Today, and the builder's single-workout
 * preview, neither of which compares against a weekly target).
 * `contributions` is muscleTopContributions_'s own output.
 */
function muscleTooltipContentHtml_(key, weightedValue, primaryN, secondaryN, contributions, target) {
  const value = weightedValue || 0;
  const valueText = target
    ? `${value.toFixed(1)} / ${target.min}–${target.max} effective sets`
    : `${value.toFixed(1)} effective sets`;
  const p = primaryN || 0;
  const s = secondaryN || 0;
  const splitText = p || s ? `${p} direct set${p === 1 ? "" : "s"}, ${s} indirect set${s === 1 ? "" : "s"}` : "No sets yet";
  const contribHtml = contributions && contributions.length
    ? `<ul class="muscle-tooltip__list">${contributions
        .map((c) => `<li><span class="muscle-tooltip__list-name">${muscleTooltipEsc_(c.name)}</span><span class="muscle-tooltip__list-num">${c.contribution.toFixed(1)}</span></li>`)
        .join("")}</ul>`
    : `<p class="muscle-tooltip__empty">No exercises yet</p>`;
  return (
    `<div class="muscle-tooltip__name">${muscleTooltipEsc_(muscleLabel_(key))}</div>` +
    `<div class="muscle-tooltip__value">${muscleTooltipEsc_(valueText)}</div>` +
    `<div class="muscle-tooltip__split">${muscleTooltipEsc_(splitText)}</div>` +
    `<div class="muscle-tooltip__label">Top exercises</div>` +
    contribHtml
  );
}

/**
 * Wires hover/tap onto every `[data-muscle]` shape in `svgRoot` — call this
 * fresh every time a figure is (re)rendered, since muscleFigureSvg builds
 * new DOM each time. `contentForKey(rawKey)` returns the tooltip's inner
 * HTML for that shape (already run through muscleAbsDisplayKey_ by the
 * caller if it needs the abs merge), or a falsy value to skip a shape with
 * nothing worth showing. `onSelect(displayKey)`, if given, fires when a
 * shape is tapped/clicked open — library.js uses it to expand/highlight
 * that muscle's group in the breakdown list; the builder has no such list
 * and omits it.
 */
function wireMuscleTooltips_(svgRoot, contentForKey, onSelect) {
  if (!svgRoot) return;
  const canHover = typeof window.matchMedia === "function" && window.matchMedia("(hover: hover)").matches;
  svgRoot.querySelectorAll("[data-muscle]").forEach((shape) => {
    const rawKey = shape.getAttribute("data-muscle");
    // Only wired shapes get the pointer cursor — the static Anatomy Lab
    // detail figure (showLibDetail, workout/library.js) uses the same
    // .muscle-figure class without calling this, and isn't tappable.
    shape.style.cursor = "pointer";
    function show() {
      const html = contentForKey(rawKey);
      if (!html) return;
      const el = muscleTooltipEnsure_();
      el.innerHTML = html;
      muscleTooltipPosition_(el, shape);
      muscleTooltipOpenShape_ = shape;
    }
    if (canHover) {
      shape.addEventListener("mouseenter", show);
      shape.addEventListener("mouseleave", muscleTooltipHide_);
    }
    shape.addEventListener("click", (e) => {
      e.stopPropagation(); // keep the document-level listener below from treating this as "tapped outside"
      if (muscleTooltipOpenShape_ === shape) {
        muscleTooltipHide_();
        return;
      }
      show();
      if (muscleTooltipOpenShape_ === shape && typeof onSelect === "function") onSelect(muscleAbsDisplayKey_(rawKey));
    });
  });
}

// Tap/click anywhere outside the tooltip itself closes whatever's open —
// wired once, globally (there can be up to 4 figures live on the Muscles
// tab across its two views, but only ever one tooltip).
document.addEventListener("click", (e) => {
  if (!muscleTooltipOpenShape_) return;
  if (muscleTooltipEl_ && muscleTooltipEl_.contains(e.target)) return;
  muscleTooltipHide_();
});
