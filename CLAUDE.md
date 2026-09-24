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

**Phase 2 is built (2026-09-24), not yet deployed.** It adds the Fuel AI plan on Stripe, the "what to eat next" suggestions and the Ask Fuel chat, with backend version `2026-09-24a`. To deploy, Max re-pastes `Macros.gs` and `MacrosCore.gs`, picks **New version**, pushes the site, then does the Stripe setup (SETUP.md step 7), in test mode first.

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
  - Foods (curated list behind the suggestions). It seeds itself from `FOOD_SEED` in Macros.gs the first time `foodsList_()` runs, and Max edits it in the sheet. Categories: protein, carb, cereal, veg, fruit, dairy, shake, snack, meal, fat, drink.
  - Members also carries plan columns: `trial_started`, `stripe_customer`, `stripe_subscription`, `plan_status`, `plan_until`, `comp_until`.
  - `tab_()` creates any missing tab and appends any missing header column, so updates never need `setupMacroSheets()` again. New columns must go at the end of a `TABS` header list.
  - The old `Scan Credits` tab (from this morning's per-scan credits, now removed) is unused.

  The text columns are formatted `@` (plain text) before values are written, so dates don't become Date objects and barcodes keep their leading 0.
- **Actions** (POST `{action,…}`):
  - Member: `me` (`sync:true` asks Stripe first, at most once a minute), `getDay`, `analyseImage` (meal|label), `barcode`, `addEntries`, `updateEntry`, `deleteEntry`, `saveTargets`, `addFavourite`, `removeFavourite`, `setPrefs`, `chat`.
  - Coach: `coachList`, `coachSetTargets`, `issueKey`, `coachGiveMonth`, `coachSyncStripe`.
  - Public (no key): `stripeReturn {session_id}`.
- **AI:** `claude-sonnet-5` through `UrlFetchApp`, with `output_config.format` json_schema (guaranteed JSON), `effort: "low"`, and the system prompt cached (`cache_control`; the prompt is kept over 1,024 tokens so it can cache). Rules:
  - A 25-scan/day limit is reserved under a lock *before* each call.
  - kcal is replaced by 4/4/9 when the model's figure is more than 15% off.
  - Ask Fuel chat: `claude-haiku-4-5`, JSON schema `{reply, foods[]}`, so any foods it mentions come with one-tap log chips. The server builds the context itself (targets, today's log, what's left, top suggestions). Chat history lives only on the phone (last 10 turns). `CHAT_DAILY_LIMIT` defaults to 40. Haiku 4.5 rejects `effort`, so it isn't sent.
  - With no `ANTHROPIC_API_KEY`, `me` returns `aiEnabled:false` and the card hides all of Fuel AI (barcodes and suggestions only).
- **Fuel AI plan** (Max's decisions, 2026-09-24):
  - **A$9.99/month for members** (a $19.99 non-member price is planned for when non-clients can sign up) through a Stripe Payment Link, with a **7-day free trial**. The trial starts the first time the client opens FUEL, but only while the API key is set.
  - **Free:** barcodes, targets, totals, favourites and suggestions. **Paid:** photo/label scans and Ask Fuel.
  - `MacroCore.planState` decides access: Stripe status active/trialing/past_due, or `comp_until` ≥ today (a free month from Max), or within the trial.
  - `requireFuelAi_` enforces it on the server. `DAILY_AI_LIMIT` still caps photo scans.
- **Stripe, no webhooks** (Apps Script can't read webhook signature headers, and it answers POSTs with a 302):
  - The Upgrade button opens `STRIPE_FUEL_LINK?client_reference_id=fuel-<slug>`.
  - `syncStripe_()` lists completed checkout sessions (matching `fuel-<slug>`) and then all subscriptions, using a **read-only restricted key**.
  - It runs every 15 minutes (the `installStripeSync` trigger), when a client returns (the link redirects to `/card/?paid={CHECKOUT_SESSION_ID}`, so the card calls `stripeReturn`, which fetches that session from Stripe), and from the coach page's "Check Stripe now".
  - The renewal date comes from `items.data[0].current_period_end`, where newer API versions put it, with a fallback to `current_period_end`.
- **Suggestions (free, no AI):** `MacroCore.suggestFill` scores single foods and sensible pairs (protein+carb/veg, dairy+fruit/cereal, shake+fruit). Weights: protein 3, carbs 0.75, fat 0.5, calories used 0.5, with overshoot penalties. It never exceeds the calories left, and each food appears at most once. `suggestOver` gives serves under 150 kcal, ranked by protein per 100 kcal, shrinking lean proteins to fit. Both are unit-tested.
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

**Progress (built 2026-09-24, backend version `2026-09-25a`, not yet deployed):**
- A free Progress sheet in FUEL (chart button next to the gear), drawn as hand-made SVG with no chart library:
  1. weight: dots, a 7-day average line, and a goal-pace line that projects up to 14 days ahead; the goal line only shows within 3 kg;
  2. calorie target steps from Target History (protein instead when calories are hidden);
  3. the last 14 days as bars against a ±10% band, red for green days, with this week's dots and the loyalty pegs.
- The home screen shows a "Weight trend" line. Settings has "Hide weight".
- **Tabs:** Weights (one per client per day; client or coach), Target History (a row appended on every target change; seeded from `updated_at` if missing), and Punch Awards (makes each week idempotent). Macro Targets gains `goal_weight_kg` and `weekly_rate_kg` (the calculator stores its `weeklyChangeKg`; the coach's "Set goal" infers the direction from the goal vs the latest weight). Members gains `hide_weight`.
- **Maths** (MacroCore, unit-tested): `mondayOf`, `targetOn`, `isGreenDay` (protein at least 90% AND calories within ±10%, inclusive), `weekSummary` (5+ green days = punch), `movingAverage` (7 calendar days), `goalPace`.
- **Punches:** `awardPunches_()` (daily trigger `installPunchTrigger`, around 3am) checks the last two finished weeks. For each unawarded week with 5+ green days, it adds +1 to **CRM "Nutrition Punches"**. If `(Total Classes Attended + Nutrition Punches) % 10 === 0`, it sets **"Free Session Owed" = Y**. The Macros backend creates both CRM columns at the end of Sessions Remaining.
  - `card/app.js` shows attended + punches, and "Free session ready" when owed.
  - `checkin.js` uses the combined count for the milestone and pre-ticks when owed.
  - `Code.gs` `handleCheckIn_` clears owed on a free check-in (check-in backend `2026-09-25a`).
- **Test harness:** it now fakes the CRM too (shared between pages) and has `_test_checkin.html`, which runs the real Code.gs.

### Next up (needs Max)

- **Training payments on Stripe:** Max wants them all on Stripe. That needs his price list (packs, memberships, group vs 1-on-1) and what each payment adds in Sessions Remaining. It touches `apps-script/Code.gs` and the live CRM. Referral payouts fire from a hand-edit `onEdit` trigger, and script writes don't fire `onEdit`, so a Stripe sync must call the payout logic directly.
- **Idea:** time-of-day-aware suggestions, so it doesn't suggest fish and rice at 7am.
- **Still to come:** Phase 3 fridge scan, and the rest of Phase 4 (milestone toasts, web push, coach dashboard).

### Open questions for Max

- **Phase 4:** should nutrition punches add to "Total Classes Attended" (which would inflate attendance) or go in a new column?
- Panel radius: the brief says 14px, but the existing card uses 18px/10px. FUEL uses 14px.
