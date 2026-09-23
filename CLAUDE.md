# MaxFit — notes for Claude sessions

Max French runs MaxFit, a personal-training business in Inner West Sydney with **no more than about 30 clients**. Keep solutions small, explicit and predictable. Don't build for scale. Always give Max plain, click-by-click deploy steps.

## Scope rules (from Max)

- The **membership card** (`card/`) and the **macro tracker** (inside the card) are fair game.
- **Ask Max first** before touching the marketing site: `index.html`, `styles.css`, `script.js` (and the other root-level pages: `join.*`, `referrer.*`, `checkin.*`).
- Don't touch `workout/` or `grocery/` unless Max asks.

## Stack

- **Front end:** static HTML, CSS and vanilla JS with no build step, no bundler and no npm. Each page loads its own `<script>` files. `card/sheet.js` holds the shared Sheet fetch and CSV parse helpers.
- **Hosting:** GitHub Pages from this repo, custom domain `maxfit.now` (see `CNAME`), HTTPS enforced. **The repo is public**, so secrets never go in any file here.
- **Backend:** one Google Apps Script web app (`apps-script/Code.gs`), deployed with "Anyone" access. Pages POST JSON to it as `text/plain` so the browser doesn't send a CORS preflight. Secrets live in Script Properties (`STAFF_PIN`, `GROCERY_CODE`).
- **Database:** a Google Sheet (`1dGQyIoJ2_XrkbvvPvM2JAY0xdeYQfsCnYHal8WZojUg`) shared as "Anyone with the link: Viewer". Pages **read it directly** as CSV (via `export?gid=` or `gviz?sheet=<name>`) and **write** through Apps Script. Because anyone can read that sheet, it must never hold private data such as food logs.
- **Member identity:** there is no login. Each member has a link like `maxfit.now/card/?id=<nameslug>`, where the slug is the lowercased name with non-alphanumerics stripped (`slugify()`). The id is saved in `localStorage` (`maxfitMemberId`) so the home-screen icon keeps working, and `app.js` rewrites the manifest's `start_url` for the same reason. Each member also has a random **Check-in Token**, which is encoded in the card's QR code. Both values can be read from the public sheet, so **neither one is a secret**.
- **Coach access:** gated by `STAFF_PIN` (see `checkPin_` in Code.gs), and used by `workout/builder.html` and check-in.
- **Timezone:** `Australia/Sydney` everywhere.

## Deploying

- **Front end:** Max pushes to GitHub himself because sessions have no push credentials. Bump the `?v=YYYYMMDDx` cache-busting tag on every CSS or JS file you change, in every page that loads that file, otherwise phones keep serving the old copy.
- **Apps Script:** pushing does **not** deploy it. Max pastes the code into the editor, saves, then goes to Deploy → **Manage deployments** → pencil → Version: *New version* → Deploy. **Never** choose "New deployment": that creates a new URL and orphans the URL hard-coded in the pages. Bump `BACKEND_VERSION` whenever the code changes. A GET on the web-app URL returns that version.
- **Live checks:** `curl -sL https://maxfit.now/card/index.html | grep -o 'app.js?v=[0-9a-z]*'`. Before assuming a schema, check the live sheet's headers with curl, because the live tabs have differed from what the code assumes.

## Local dev and testing

- `node` isn't installed, so there's no npm and no test runner. Run JS tests in the browser: plain HTML test pages that load the pure-logic files and assert.
- The built-in preview can't read `~/Desktop`. Rsync the repo into the session scratchpad and serve that copy (see `.claude/launch.json`, which sits one level up from this repo).
- Never press buttons that POST to the live Apps Script while testing (Log Workout, Save, check-in). Stub `fetch` instead.

## Brand rules (non-negotiable)

- **Logo:** use `assets/images/maxfit-logo.png` exactly as it is. The card already references it as `../assets/images/maxfit-logo.png`. Never recreate, redraw, restyle or re-type the logo.
- **Palette:** near-black surfaces (`--bg: #111`, card `#1c1c1c`) and MaxFit red `#E00000` (`--red`) as the **only** accent. Text is white, `#ccc` and `#999`. Borders are thin `rgba(255,255,255,.12)`.
- **Type:** Barlow Condensed uppercase for labels and big numbers, Barlow for body text (Google Fonts, already loaded in `card/index.html`).
- **Panels:** rounded with thin borders. Max's brief asks for 14px panels. The existing card uses `--radius: 18px` (outer card) and `--radius-sm: 10px` (inner blocks), so new macro panels use 14px.
- **Progress:** thin red bars in the same style as the loyalty punch card (`.card__loyalty-peg`).
- **Tone:** supportive everywhere. No shaming, no red "failure" screens, and clients can hide calorie numbers.

## Macro tracker: phase plan

Build one phase at a time. **Stop after each phase for Max to test.** At the end of each phase: works on iPhone Safari and Android Chrome installed to the home screen, camera permission flows tested, 5 food photos + 5 barcodes + 1 fridge photo tested with JSON and screenshots shown, macro maths unit-tested, no API keys in client code, a clean console, this file updated, and a commit with a clear message.

1. **MVP:** daily targets (set by the coach or the Mifflin-St Jeor calculator), photo scan, barcode scan (Open Food Facts), label-photo fallback, a confirm sheet with editable grams, daily totals (`128 / 180g`), edit and delete of entries, and recent + favourites.
2. **Smart suggestions:** a deterministic "what to eat next" ranking over a curated `foods` list (about 80 Australian staples, FSANZ values), plus an over-limit high-protein/low-calorie mode.
3. **Fridge scan:** photo → editable ingredient chips → 3 meals that fit the remaining macros → one-tap log.
4. **Motivation:** green days (protein at least 90% of target and kcal within ±10%), a 7-dot week, 5/7 counts as a win, "never miss twice", 5+ green days earns 1 punch on the loyalty card, milestones shown as red toasts, optional web push, and a coach dashboard.

### AI rules

- Claude API calls happen **server-side only**. The key is `ANTHROPIC_API_KEY`, kept in Script Properties or env and never in the repo.
- Use a Sonnet model with vision for photos, labels and fridge scans, and Haiku for text-only wording. Check current model IDs at docs.claude.com before changing them.
- Force structured output with tool use. Food schema: `{ items: [{ name, estimated_grams, kcal, protein_g, carbs_g, fat_g, confidence, notes }], meal_guess }`.
- Assume Australian portions, list oils and sauces as separate items, and prefer low confidence over invented detail.
- The browser resizes images to a 1024px long edge, JPEG at 0.8 quality. Photos aren't stored.
- Limit each member to 25 AI scans a day (a config value), use prompt caching on the system prompt, and log token usage and cost for every call.

### Maths

- Calories = 4P + 4C + 9F.
- Targets: Mifflin-St Jeor BMR × activity factor, then adjusted by goal (cut −15 to −20%, maintain, or lean gain +5 to 10%). Protein 1.6–2.2 g/kg, fat at least 0.6 g/kg, carbs fill the rest.
- Floors: at least 1,500 kcal for men and 1,200 kcal for women without coach approval. Weight loss no faster than about 1% of bodyweight a week.

### Guardrails

- Photo results show "Estimates only, typically within about 20% for photos". Barcode results show as exact.
- Settings carry a not-medical-advice line (GP / Accredited Practising Dietitian).
- A client sees only their own data. Only Max's coach access sees everyone.

## Macro tracker: implementation status

**Phase 1 is built, and the backend was deployed 2026-09-23** (setup steps in `apps-script/macros/SETUP.md`). The web-app URL is in `MACROS_API_URL` in `card/macros-api.js`.

### Architecture (decided with Max)

- **Backend:** a separate Apps Script project called "MaxFit Macros" (`apps-script/macros/Macros.gs`) with its own URL and its own **private** Google Sheet. It never touches `Code.gs` or the public CRM sheet, except to read client names (`MAIN_SHEET_ID`).
- **Shared maths:** `card/macros-core.js` (`MacroCore`) is pure JS. It's loaded by the card **and** pasted into the Apps Script project as `MacrosCore.gs`. Change it in the repo, then re-paste it. The server recomputes every macro from per-100g values × grams, so it never trusts totals sent by the phone.
- **Member identity:** each member has a random key in the Members tab. Their link is `/card/?id=<slug>&k=<key>`, created on `card/coach.html`. `macros-api.js` saves `{id,k}` in `localStorage` under `maxfitMacroKey`. Every member action checks the id + key; coach actions check `STAFF_PIN`. A missing `STAFF_PIN` locks the coach view (unlike check-in, where a missing PIN opens it).
- **Tabs in the private sheet:**
  - Members (slug, name, sex, key, hide_kcal)
  - Macro Targets (set_by coach|calculator, calc_inputs JSON, coach_approved)
  - Food Logs (log_date as text YYYY-MM-DD, Sydney; per-100g columns so grams can be edited)
  - Favourites
  - Barcode Cache (30 days for hits, 3 for misses)
  - AI Usage (tokens and est. USD per call; N1 holds this month's total)
  - Scan Credits (a ledger: timestamp, slug, change, amount_aud, note, by). A client's balance is the sum of their `change` rows. It creates itself on first use (`tab_()` auto-creates any missing tab).

  The text columns are formatted `@` (plain text) before values are written, so dates don't become Date objects and barcodes keep their leading 0.
- **Actions** (POST `{action,…}`):
  - Member: `me`, `getDay`, `analyseImage` (meal|label), `barcode`, `addEntries`, `updateEntry`, `deleteEntry`, `saveTargets`, `addFavourite`, `removeFavourite`, `setPrefs`.
  - Coach: `coachList`, `coachSetTargets`, `issueKey`, `addCredit`.
- **AI:** `claude-sonnet-5` through `UrlFetchApp`, with `output_config.format` json_schema (guaranteed JSON), `effort: "low"`, and the system prompt cached (`cache_control`; the prompt is kept over 1,024 tokens so it can cache). Rules:
  - A 25-scan/day limit is reserved under a lock *before* each call.
  - kcal is replaced by 4/4/9 when the model's figure is more than 15% off.
  - `claude-haiku-4-5` is reserved for Phase 2 wording.
  - **Clients prepay for photo scans** (Max's decision, 2026-09-23). Max records a payment on the coach page (`addCredit`, in dollars), which becomes scans at `CENTS_PER_SCAN` (default 5c, so $10 = 200). New clients get `FREE_SCANS` (default 10) when their link is created. `reserveScan_` takes 1 credit, plus a daily-limit slot, under a lock before calling Claude. `refundScan_` zeroes that ledger row if the call fails.
  - With no `ANTHROPIC_API_KEY`, `me` returns `aiEnabled:false` and the card hides photo and label scanning (barcodes only). Max hasn't bought API credits yet.
- **Barcodes:** `BarcodeDetector` when available (Android Chrome). Otherwise ZXing, vendored at `card/vendor/zxing-browser.min.js` (@zxing/browser 0.2.1) and loaded lazily. There's also a typed-number fallback and a photo-of-barcode fallback. Open Food Facts is always called server-side and cached.

### UI files

- `card/index.html`: CARD | FUEL tabs. The existing card markup sits unchanged in `#panelCard`.
- `card/macros.js`: the FUEL UI and bottom sheets.
- `card/macros.css`: FUEL styles, using the tokens from `styles.css`.
- `card/coach.html` + `coach.js`: the coach view.

`macros.css` also changes page centring: the card now uses auto margins, so a card taller than the screen scrolls instead of being clipped.

### Testing

- **Unit tests:** open `card/tests/macros-core.test.html` (72 checks, including 4/4/9, scaling, the calculator, floors, the 1%/week cap, OFF parsing and Sydney dates).
- **End-to-end without deploying:** a scratchpad harness runs the real `Macros.gs` in the browser with fake SpreadsheetApp/Utilities/etc., a mocked Claude, and real Open Food Facts. Don't commit harness files (`_test*.html`, `_mock-gas.js`, `_harness.js`, `_Macros.gs.js`).

### Open questions for Max

- **Phase 4:** should nutrition punches add to "Total Classes Attended" (which would inflate attendance) or go in a new column?
- Panel radius: the brief says 14px, but the existing card uses 18px/10px. FUEL uses 14px.
