/*
 * MaxFit website demo — runs the real backends in the visitor's browser.
 *
 * Loads demo/gas-fake.js (pretend Google), then the site's own copies of
 * apps-script/Code.gs (check-in, workouts, booking) and
 * apps-script/macros/Macros.gs (Fuel), each wrapped in its own function so
 * their top-level names don't collide. The card's requests arrive here from
 * demo/demo-mode.js and are answered by those files' own doPost/doGet, so
 * the demo behaves like the real thing. Claude, Open Food Facts and Stripe
 * are never called: __demoUrlFetch gives fixed sample answers.
 *
 * Message in:  { type: "init", snapshot, version }
 *              { type: "call", id, backend: "crm" | "fuel", method: "post" | "get", body, params }
 *              { type: "csv", id, gid, name }
 * Message out: { id, ok, text, snapshot } (snapshot after anything that may have written)
 */
/* global GasFake, DemoSeed */
let ready = null;
const backends = {};

function loadBackend_(name, text, exportsList) {
  const src =
    "self.__demoBackend_" + name + " = (function () {\n" + text +
    "\n;return { " + exportsList.map((n) => n + ": typeof " + n + " === 'function' ? " + n + " : null").join(", ") +
    ", run: function (code) { return eval(code); } };\n})();\n//# sourceURL=demo-backend-" + name + ".js";
  const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
  importScripts(url);
  URL.revokeObjectURL(url);
  backends[name] = self["__demoBackend_" + name];
}

function parseCsv_(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function init_(msg) {
  const v = msg.version ? "?v=" + msg.version : "";
  importScripts("gas-fake.js" + v, "seed.js" + v, "../card/macros-core.js" + v);
  const get = (path) => fetch(path + v).then((r) => {
    if (!r.ok) throw new Error("Demo couldn't load " + path);
    return r.text();
  });
  const [code, macros, exercises] = await Promise.all([
    get("../apps-script/Code.gs"),
    get("../apps-script/macros/Macros.gs"),
    get("data/exercises.csv"),
  ]);
  loadBackend_("crm", code, ["doPost", "doGet"]);
  loadBackend_("fuel", macros, ["doPost", "doGet"]);
  // Test hooks Code.gs already has: no calendar look-ups.
  backends.crm.run("bookingSkipCalendarSync_ = true");

  if (msg.snapshot) {
    GasFake.restore(msg.snapshot);
  } else {
    backends.crm.run("(" + DemoSeed.crm.toString() + ")")({ exercises: parseCsv_(exercises) });
    backends.fuel.run("(" + DemoSeed.fuel.toString() + ")")();
  }
}

// ---- Fixed sample answers for outside services ------------------------------

const SAMPLE_FOODS = [
  { name: "Grilled chicken breast", g: 150, kcal: 248, p: 46, c: 0, f: 5.4 },
  { name: "Steamed white rice", g: 180, kcal: 234, p: 4.3, c: 51, f: 0.5 },
  { name: "Broccoli", g: 90, kcal: 31, p: 2.5, c: 6, f: 0.4 },
  { name: "Olive oil (for cooking)", g: 5, kcal: 44, p: 0, c: 0, f: 5 },
];
const SAMPLE_MEALS = {
  breakfast: ["Berry yoghurt bowl", "🥣"], lunch: ["Chicken and avocado wrap", "🌯"],
  dinner: ["Salmon, sweet potato and greens", "🐟"], snack: ["Apple and peanut butter", "🍎"],
};
const SAMPLE_REPLY =
  "This is the demo, so it only has a few sample answers. Try asking what protein is for, how to read a " +
  "nutrition label, or about fibre or water. On your own card, Ask Fuel answers general healthy-eating " +
  "questions in plain words, and for anything about your own health it points you to your GP or an " +
  "Accredited Practising Dietitian.";
// General information only (Australian Dietary Guidelines), same rules as the real Food Q&A: no numbers for you, no meal plans.
const SAMPLE_ANSWERS = [
  [/protein/i, "Protein helps your body build and repair muscle and other tissues. Good sources include lean meat, chicken, fish, eggs, dairy, tofu, beans and lentils. Many people find it easiest to include some at each meal. If you want amounts worked out for you, an Accredited Practising Dietitian can help."],
  [/label|panel|packet/i, "On an Australian nutrition label, the 'per 100 g' column lets you compare two products fairly. The 'per serve' column shows what's in one serve, as the maker defines it. Fuel can read a label for you: tap Log Food, then Label."],
  [/fib(re|er)/i, "Fibre is found in wholegrains, vegetables, fruit, beans and lentils. It helps keep your digestion regular and helps you feel full. Swapping white bread or rice for wholegrain versions is a simple way to get more."],
  [/water|drink|hydrat/i, "The Australian Dietary Guidelines suggest water as your main drink. You need more when it's hot or you've been training. A quick check is the colour of your urine: pale yellow usually means you're drinking enough."],
  [/carb/i, "Carbohydrates are your body's main source of energy, especially for training. Wholegrains, fruit, vegetables, legumes and dairy give you carbs along with fibre and vitamins, so they're a better pick than lollies and soft drinks."],
];
function sampleReply_(question) {
  const hit = SAMPLE_ANSWERS.find((a) => a[0].test(question || ""));
  return hit ? hit[1] : SAMPLE_REPLY;
}

/** Fills a Claude structured-output schema with believable sample values. */
function fill_(schema, key, ctx) {
  ctx = ctx || {};
  if (!schema) return null;
  if (schema.enum) return key === "confidence" ? "high" : schema.enum[0];
  const food = ctx.food || SAMPLE_FOODS[0];
  switch (schema.type) {
    case "object": {
      const out = {};
      const props = schema.properties || {};
      Object.keys(props).forEach((k) => {
        const sub = Object.assign({}, ctx, k in SAMPLE_MEALS ? { slot: k } : {});
        out[k] = fill_(props[k], k, sub);
      });
      return out;
    }
    case "array": {
      const item = schema.items || {};
      if (item.type === "string") {
        const lists = {
          spotted: ["Eggs", "Spinach", "Feta", "Wholemeal wraps", "Cherry tomatoes"],
          steps: ["Get everything out and ready.", "Cook the protein first, then the veg.", "Plate it up and enjoy."],
          uses: ["Eggs", "Spinach", "Feta"], need: ["Wholemeal wraps"],
        };
        return lists[key] || ["Sample"];
      }
      if (item.type === "object" && item.properties && ("kcal" in item.properties || "estimated_grams" in item.properties)) {
        return SAMPLE_FOODS.map((f) => fill_(item, key, Object.assign({}, ctx, { food: f })));
      }
      return [0, 1].map((i) => fill_(item, key, Object.assign({}, ctx, { index: i })));
    }
    case "string": {
      const meal = SAMPLE_MEALS[ctx.slot] || ["Chicken, rice and greens", "🍗"];
      const words = {
        name: ctx.food ? food.name : meal[0],
        meal_guess: "Chicken, rice and broccoli", emoji: meal[1], brand: "Sample brand",
        how_to: "A quick sample idea for the demo. On your own card these come from your saved foods and targets.",
        why: "Quick, and it uses what you've already got.", notes: "Sample answer: in the demo every meal comes back as this one.",
        amount_text: food.g + " g", unit: "g", reply: sampleReply_(ctx.question),
      };
      return key in words ? words[key] : "Sample";
    }
    case "number":
    case "integer": {
      const nums = {
        estimated_grams: food.g, grams: food.g, kcal: food.kcal, protein_g: food.p, carbs_g: food.c, fat_g: food.f,
        count: 1, minutes: 15, serving_g: 170,
      };
      return key in nums ? nums[key] : 1;
    }
    case "boolean":
      return false;
    default:
      return null;
  }
}

self.__demoUrlFetch = function (url, opts) {
  if (/api\.anthropic\.com/.test(url)) {
    let body = {};
    try { body = JSON.parse(opts.payload || "{}"); } catch (err) { body = {}; }
    const schema = body.output_config && body.output_config.format && body.output_config.format.schema;
    let out;
    if (schema && schema.properties && schema.properties.per100) {
      out = { name: "Greek yoghurt (sample label)", brand: "Sample brand", per100: { kcal: 73, protein_g: 9.5, carbs_g: 4, fat_g: 2 }, per100_unit: "g", serving_g: 170, confidence: "high", notes: "Sample answer: the demo doesn't read your photo." };
    } else {
      const msgs = body.messages || [];
      const last = msgs.length ? msgs[msgs.length - 1].content : "";
      const question = typeof last === "string" ? last : (last || []).map((b) => b.text || "").join(" ");
      out = schema ? fill_(schema, "", { question: question }) : { reply: sampleReply_(question) };
    }
    return {
      status: 200,
      body: JSON.stringify({
        content: [{ type: "text", text: JSON.stringify(out) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    };
  }
  if (/openfoodfacts\.org/.test(url)) {
    return {
      status: 200,
      body: JSON.stringify({
        status: 1,
        product: {
          product_name: "Greek yoghurt (sample scan)", brands: "Sample brand", serving_size: "170 g", serving_quantity: 170,
          nutriments: { "energy-kcal_100g": 73, proteins_100g: 9.5, carbohydrates_100g: 4, fat_100g: 2 },
        },
      }),
    };
  }
  return { status: 404, body: JSON.stringify({ error: { message: "Not in the demo." } }) };
};

// ---- Requests ---------------------------------------------------------------

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "init") {
    ready = init_(msg);
    try {
      await ready;
      self.postMessage({ id: "init", ok: true, snapshot: GasFake.snapshot() });
    } catch (err) {
      self.postMessage({ id: "init", ok: false, text: String(err && err.stack || err) });
    }
    return;
  }
  try {
    await ready;
    if (msg.type === "csv") {
      self.postMessage({ id: msg.id, ok: true, text: GasFake.csv({ gid: msg.gid, name: msg.name, quoteAll: !msg.gid }) });
      return;
    }
    const be = backends[msg.backend];
    const out = msg.method === "get"
      ? be.doGet({ parameter: msg.params || {}, parameters: {} })
      : be.doPost({ postData: { contents: msg.body || "{}", type: "text/plain" }, parameter: {} });
    self.postMessage({ id: msg.id, ok: true, text: out && out.getContent ? out.getContent() : "", snapshot: GasFake.snapshot() });
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, text: String(err && err.stack || err) });
  }
};
