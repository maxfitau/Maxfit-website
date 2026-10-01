# MaxFit — notes for Claude sessions

Max French runs MaxFit, a personal-training business in Inner West Sydney with **no more than about 30 clients**. Keep solutions small, explicit and predictable. Don't build for scale. Always give Max plain, click-by-click deploy steps.

## Scope rules (from Max)

- The **membership card** (`card/`) and the **macro tracker** (inside the card) are fair game.
- **Ask Max first** before touching the marketing site: `index.html`, `styles.css`, `script.js` (and the other root-level pages: `join.*`, `checkin.*`).
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

## Card home screen (redesigned 2026-09-29)

The Card tab is a 2×2 grid of square tiles — Check In, Today's Workout/Upcoming Session, 1-on-1 Sessions, Refer a Friend — instead of the old stacked rows. Check In opens the QR in a modal (`#qrModal`) instead of showing it on the card at all times. All existing element ids were kept, so `app.js`'s render logic barely changed. No reinstall needed for UI changes like this: the card has no service worker, so the home-screen icon just re-fetches the page fresh every time it's opened (only the icon image and app name are fixed at install time).

**Loading screen (2026-10-01):** `#cardLoading` is a full-screen overlay with an animated dumbbell, shown by default in the HTML and hidden by `app.js` once the first real data is on screen (`hideCardLoading()`, called from `render()`, `showPicker()`, and `loadCard()`'s catch block). FUEL's existing spinner (`.fuel-spinner`, used for every loading moment in macros.js — initial load, AI scans, barcodes, suggestions, progress) was restyled into a flame (`FUEL_FLAME_SVG` in macros.js) — one change, every loading moment in FUEL gets it. Both icons **build themselves** rather than just spin: the dumbbell's bar stays put while the collars then the outer plates slide on and stack up (`dumbbell__collar`/`dumbbell__plate`, `card/styles.css`); the flame is three layers that stack bottom to top (`flame__layer--1/2/3`, `card/macros.css`). Each holds fully built for a beat, then clears and builds again. A `prefers-reduced-motion` version swaps the build for a plain synchronized pulse (`card-loading-pulse` / `fuel-loading-pulse`).

**Readability pass (2026-10-01):** text sizes bumped across the Card tab for legibility — tile labels and values, the member/tier row, section labels, the loyalty count, the QR modal title, the name picker, and the status line. All in `card/styles.css`; nothing moved, nothing new, just bigger.

**Faster loading (2026-10-01):** all `<script>` tags across `card/*.html` are now `defer`red so they download in parallel instead of one at a time; the Google Fonts request only pulls the Barlow Condensed weights actually used (700/800, down from six) since Barlow (body) genuinely uses 400/500/600/700; `<link rel="preconnect">` was added for `docs.google.com` and `script.google.com` (whichever a page actually calls) so the browser isn't doing DNS/TLS on top of the real fetch; and on the Card tab, the member-data fetch and the "Today's Workout" lookup now fire at the same time instead of one after the other (both only need the id's slug, known before either starts).

## Booking (1-on-1 sessions, built 2026-09-26)

Clients book from the card: **Book a session** (Card tab) opens `card/book.html` (`book.js`, `book.css`), a day grid then a time list, then confirm. Max chose: 1-on-1 only, hours set in a sheet, cancelling up to 24 hours before.

- **Backend (`Code.gs`):** actions `bookingInfo` (read-only), `bookSession` and `cancelBooking`. All rules run server-side, and booking re-checks everything under `withLock_` and flushes before releasing it.
- **Who is asking:** a client's slug and Check-in Token are both readable in the public CRM, so they prove nothing. Each client instead has a personal **booking code** (6 characters, no I/L/O/0/1) in the private *Clients* tab. Max texts it to them (the tab has a ready-made text), and they type it once per phone; `book.js` keeps it in `localStorage` under `maxfitBookCode`. Five wrong codes for one slug lock that slug for 15 minutes (`CacheService`), unknown slugs count too, and a right code clears the count. Settings > "Require booking code" = No falls back to slug + Check-in Token. `issueBookingCodes()` fills in codes for new CRM clients (`setupBooking()` runs it too).
- **Private data:** bookings live in a separate **private** sheet, "MaxFit Bookings", which `setupBooking()` creates (its id is the `BOOKING_SHEET_ID` Script Property). The public CRM must not hold them, and the card never reads that sheet.
- **Tabs there:** *Availability* (On, Day, Start, End, Session Minutes, Buffer Minutes; the examples ship switched off), *Time Off* (From, To), *Settings* (Notify email, Min notice hours 12, Book ahead days 28, Cancel notice hours 24, Require session left Yes, Max active bookings 6, Require booking code Yes, Contact link, Email clients Yes, Meeting place, Online payments No), *Clients* (Name, Slug, Booking Code, Text to send, Email), *Bookings* (Status "Booked" holds a slot and anything else frees it), *Upcoming* (a formula), *Prices* (On, Name, Sessions, Price, Stripe lookup key, Pay link) and *Payments* (the Stripe ledger, written by the script). Columns are found by header name. Cells are read with `getDisplayValues()`, because Sheets turns typed times and dates into Date values.
- **Message Max:** Settings > "Contact link" is a `https:`, `sms:`, `tel:` or `mailto:` link with `{message}` where a ready-typed message goes. It is only returned to someone who has entered a valid code, never in an error reply, so Max's number isn't handed to whoever asks. Blank hides the buttons.
- **Confirmation emails (built 2026-09-27, backend `2026-09-27a`):** a client with an address in the Clients tab's *Email* column gets a plain-text confirmation with a calendar file (`.ics` built from real instants, so daylight saving is right) when they book, and a note when they cancel. Max is still emailed too, and his notice says whether the client was. The address is copied from the CRM's *Email* column by `issueBookingCodes()` when it has one (never overwriting one already here), or typed by the client in the Book page's optional email box (a blank box means "not this time"). It lives only in the private Clients tab. Settings: *Email clients* (Yes/No) and *Meeting place*. They're sent with `MailApp` from Max's own Gmail (sender name "MaxFit"), so a client's reply reaches him. A failed email is logged and never fails a booking. The self-test sends Max two `[Self-test sample]` emails so he can see what clients get. Stripe doesn't send booking emails, only payment receipts.
- **Paying through Stripe (built 2026-09-27, backend `2026-09-27b`, off until Max switches it on):** a client with no 1-on-1 sessions left (reason `no-sessions` only, never "all booked") sees Buy buttons instead of "message Max": one per *Prices* row that is On, adds at least one session and has a `https://buy.stripe.com/` Pay link. `bookingInfo` returns them as `buy` (only after a valid code), each link carrying `client_reference_id=pt-<slug>` (FUEL's are `fuel-<slug>`) and the client's email if on file. The Payment Link's "after payment" address is `https://maxfit.now/card/book.html?paid={CHECKOUT_SESSION_ID}`; the page sends that id to the `paymentReturn` action, and a 10-minute trigger (`installBookingPaymentSync` -> `syncBookingPayments`) catches anyone who paid and left. Both ask Stripe with a READ-ONLY restricted key in the `STRIPE_SECRET_KEY` Script Property (Checkout Sessions: Read; the same key FUEL uses works), never a webhook, because Apps Script can't read webhook headers. A paid session adds what it bought (matched on the price's **lookup key**, via *Prices*) to "1 on 1 Remaining" on the public CRM, the number check-in already uses. "Paid sessions", "Has Paid 1-on-1" and the referral payout are deliberately NOT touched: they happen at check-in. Each Stripe session is credited exactly once: the *Payments* ledger row (Status Crediting, with the balance before) is written before the balance moves, and a half-finished run is completed on retry without paying twice. A payment that can't be matched (no such client, unknown lookup key, unreadable balance) is logged as Unmatched and Max is emailed; nothing is credited. Refunds and disputes aren't detected: Max removes the sessions by hand. A test-mode key only sees test payments, so test payments credit the real CRM row of whoever paid (use a throwaway row, then delete it); Max's emails say `[TEST]`. Never log or return the key: `bookingScrub_` blanks it out of every message. Editor functions: `checkBookingPayments()` (a checklist emailed to Max: setting, key, each price's link, key/link mode agreeing, trigger, ledger), `syncBookingPayments()`, `installBookingPaymentSync()`. Only Max signs in to Stripe, makes the key and pastes it; the pay links, products and prices can be made with him watching, in test mode first.
- **No card-fee line on checkout (Australian law, from 1 Oct 2026):** never add a "card fee", "processing fee" or similar extra line to a Stripe checkout so Max nets the full price. From 1 October 2026 surcharges for paying by Visa, Mastercard, eftpos, Amex (and PayPal, UnionPay), including overseas-issued cards and wallets like Apple Pay, are banned in Australia (RBA reforms, enforced through the card networks' merchant rules). The ACCC says renaming a card surcharge doesn't escape it, and a mandatory extra fee also breaks the single-price rule. The allowed way to not eat Stripe's fee is to build it into the price (Stripe AU is about 1.7% + 30c on Australian cards, GST included, and more on overseas cards). Max asked about this on 2026-09-27 and chose to keep the prices and absorb Stripe's fee, so nothing changes.
- **Rules:** booking never touches "1 on 1 Remaining" (check-in still does that), but a client can't hold more bookings than sessions left (unless Require session left is No or the plan is unlimited). Cancelling is measured in real elapsed time, so daylight saving can't shift it.
- **Self-test:** `bookingSelfTest()` (run from the editor) tries the whole flow on real Google in a reused scratch spreadsheet, then emails PASSED or FAILED. It points at the scratch sheet only through the per-run global `bookingSheetOverride_`, so a real client's request can never be redirected, and it only reads the CRM.
- **Testing:** the real `Code.gs` runs in the browser against fake Sheets/Utilities/MailApp/CacheService with a Sydney clock (454 checks, including a pretend Stripe and the real check-in code, and a runner that breaks the code 29 different ways to prove the checks notice), and the page runs against a stubbed backend (62 checks on the email box and the Buy buttons, plus a runner that breaks the page 7 ways). Don't commit those harness files.
- **Not built yet:** the next booking on the card itself, today's bookings on the check-in page, a reminder email the day before, buying more while you still have sessions, and paying for memberships and group classes through Stripe (the wider "Training payments on Stripe" plan in *Next up* below).

## Referrals (simplified 2026-09-28)

Max found the first version (a personal code per client, 20 tokens at the 3rd paid session then 5 per 1-on-1, free classes for "Paid In Classes") too complex, and asked for: no codes, a QR on the card that opens the sign-up form, one "who referred them" column, and a simple reward. He doesn't give clients cash. He then had the red referral-partner cards (`referrer.html`, the Refferals tab's codes and 5-token payouts) removed altogether: **only clients refer, and the only reward is a punch.**

- **The card:** **Refer a Friend** (Card tab) opens `card/refer.html`: a QR and a Share button for `join.html?ref=<card id>` (the member's slug), plus "Punches From Referrals". No codes, nothing to issue.
- **Sign-up:** `handleSignup_` resolves `?ref=` as a client's card id (`findClientNameBySlug_`) and writes their name into the Lead's **Referred By**; anything else (such as an old partner code) is ignored. `join.js` shows "Referred by <Name>" before submitting.
- **Max's one manual step:** when a lead becomes a client he types the referrer's name into their **Referred By** cell on Sessions Remaining. Matching ignores capitals, spaces and punctuation (`findClientRowBySlug_`).
- **The reward, one per paid session (group or 1-on-1, never a free one):** `maybeApplyReferralBonus_(sheet, row)` gives the client named in Referred By +1 **Referral Punches**. If class visits + Nutrition Punches + Referral Punches hits a multiple of 10, **Free Session Owed** = Y, exactly like a Fuel punch. A name that isn't a client pays nothing, and nobody earns from their own sessions.
- **Both paths still run:** a check-in scan, and a hand edit of "Paid sessions" (the simple `onEdit` trigger). "Referral Sessions Counted" stops any session being paid twice, and a jump of more than 10 in one edit is treated as a typo (no pay, a note on the cell).
- **A hand-raised Paid Sessions also punches the CLIENT'S OWN card (2026-10-01):** Max's call — check-in scans probably won't be his most common way of recording a session, so that can't be the only way a client's own loyalty card fills up. Every new paid session counted in a hand edit now does two things, not one: pays the referrer (as above, unchanged) AND adds +1 to the edited client's own **Manual Session Punches** (`addManualSessionPunch_`, same "every paid session, group or 1-on-1" rule, same typo guard). The loyalty total is now **class visits + Fuel + referral + manual punches** everywhere it's computed: `card/app.js`, `checkin.js`, and the Fuel backend (`crmIndex_`/`awardPunches_`/`actionProgress_` in Macros.gs). A column that doesn't exist yet (a sheet from before this) just counts as 0, so nothing breaks before the first hand edit creates it.
- **Loyalty card count everywhere:** Total Classes Attended + Nutrition Punches + Referral Punches, in `card/app.js`, `checkin.js` and the Fuel backend (`crmIndex_`/`awardPunches_` in Macros.gs, `2026-09-28b`, so a Fuel punch and a referral punch fill the same card).
- **Removed:** personal Referral Codes (`issueReferralCodes`, `findClientNameByReferralCode_`), the "Referred Clients" reverse lookup, "Paid In Classes", "Has Paid 1-on-1", the 20-token milestone, all tokens, and the red partner cards (`referrer.html/js/css`, `referrer-manifest.json`, `referrer-icons/`, `fetchReferrals()` in sheet.js, and every Refferals-tab read or write in Code.gs). Nothing reads the Refferals tab any more, so Max can delete it, along with these unused Sessions Remaining columns: Referral Code, Referred Clients, Clients Referred, Tokens Owed, Paid In Classes, Has Paid 1-on-1 and the older Referral Bonus Applied.
- **Testing:** a scratchpad page runs the real `Code.gs` against fake sheets (48 checks: client punch, the card-filling punch, free sessions, old partner codes and non-clients paying nobody, working with the Refferals tab deleted, self/blank/unknown referrers, name matching, hand edits including the typo guard and a blank counter, sign-up by card id, `setupReferralTracking`). Don't commit it.
- **Deploy:** paste `Code.gs` (`BACKEND_VERSION 2026-10-01b`), Save, run `setupReferralTracking` (adds Referral Punches, safe to re-run), Deploy -> New version. Paste `Macros.gs` (`2026-10-01a`) into the Fuel project, New version. Then push the site.

## Exercise picker (built 2026-10-01)

Adding an exercise — in the coach's workout builder (`workout/builder.html`) — is now pick-from-a-list, not free text: tap the exercise field to open `workout/exercise-picker.js` (shared, self-mounting, no markup of its own needed), choose a **Movement** (Push / Pull / Legs / Core), then a **Body Part** (e.g. Push → Chest, Shoulders, Triceps), then search or tap an exercise from that body part's list. Typing a name that isn't there shows **+ Add "..." as a new exercise**, which saves it to the Exercises tab under the movement/body part just picked and selects it — no separate category step, since those were already chosen on the way in. This is what stops "Bench Press" vs "bench press" from silently splitting an exercise's logged history.

- **Data:** the Exercises tab gained **Movement** and **Body Part** columns (`addCategoryColumnsToExercises()`, safe to re-run). `seedExercises()` fills in a ~45-exercise starting library across all 11 body parts, skipping anything already there — run once after redeploying, so the picker isn't empty on day one.
- **Backend:** new action `addExercise` (`handleAddExercise_`, no PIN — the client-side "+ Add Exercise" ad-hoc flow in `workout/app.js` can use it too, not just the builder) — case-insensitive duplicate check, so two people adding "bench press" around the same time can't fork it into two rows.
- **Colour coding:** one accent colour per body part (`ExercisePicker.colorFor(bodyPart)`), shown as a small dot on the tile, the exercise's row in the picker, and the chosen exercise back in the builder row. Deliberately a separate, functional use of colour — red stays the only accent everywhere else.
- **Not yet done:** `workout/app.js`'s own "+ Add Exercise" (the client's ad-hoc, mid-session one) still free-types — same picker, same component, just not wired in there yet.
- **Deploy:** paste `Code.gs` (`BACKEND_VERSION 2026-10-01a`), Save, run `addCategoryColumnsToExercises()` then `seedExercises()`, Deploy -> New version. Then push the site.

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
  - With no `ANTHROPIC_API_KEY`, `me` returns `aiEnabled:false` and the card hides all of Fuel AI (barcodes, search and suggestions only).
- **Plans** (Max's decisions; ladder and yearly from 2026-09-27, backend `2026-09-28a`): **Silver** (free, no AI), **Gold** (A$5.99/month or $53.99/year, 5 AI uses a day), **Platinum** ($9.99 / $89.99, 10 a day plus Ask Fuel) and **Diamond** ($14.99 / $134.99, "unlimited" plus Ask Fuel). Yearly is 3 months free. Diamond's real ceiling is a fair-use 20 a day (`DIAMOND_DAILY_AI`), and the plans sheet says so in small print (Australian Consumer Law and "unlimited"). **Ask Fuel is Platinum and Diamond only**, to give Gold clients a reason to move up: the card shows a Platinum chip on the button and opens the plans sheet, and `requireAskFuel_` refuses it with code `platinum` before any use is counted. Each plan has its own look in `card/macros.css` (matte silver, metallic gold, shimmering pearl platinum, icy prism diamond with a turning rainbow edge); red stays the accent everywhere else. **The whole Fuel screen carries it (2026-10-01), not just badges and buttons:** `#panelFuel[data-fuel-tier]`, set once in `applyMe()` (`els.panelFuel.dataset.fuelTier = tier()`) so it survives every view's re-render, not just the home screen. Gold and Platinum get a coloured glow (reusing the same metal gradients, just toned down so the existing white/grey text everywhere in Fuel stays readable — a direct copy of the bright badge gradient as a full background would have wrecked that contrast); Diamond gets the identical spinning rainbow border the Diamond plan card already had (`fuel-spin`, `--diamond-spectrum`), just sized to the whole panel. Silver stays plain, same as its badge. A non-member price is still an idea for when non-clients can sign up.
  - **One daily pool of AI uses:** a photo scan, a label scan, a Describe it, or (Platinum/Diamond) an Ask Fuel message is 1 use each. It resets at midnight Sydney time, and failed calls that Claude didn't bill don't count. Override with the `GOLD_DAILY_AI` / `PLATINUM_DAILY_AI` / `DIAMOND_DAILY_AI` Script Properties.
  - **Free (Silver):** barcodes, search, saved meals, "Enter the numbers", targets, totals, favourites, suggestions and progress.
  - New clients get **7 days of Diamond** (`MacroCore.TRIAL_TIER`), starting the first time they open FUEL while the API key is set.
  - `MacroCore.planState` returns `{access, tier, kind, interval, …}`: paid (active/trialing/past_due, tier from `plan_tier`, interval from `plan_interval`), comp (`comp_until` ≥ today, tier from `comp_tier`; a free month on a higher plan, by `MacroCore.tierRank`, tops up a paying client), trial (Diamond), otherwise Silver.
  - `requireFuelAi_` checks access, and `reserveAi_(member, …)` checks the pool under a lock. Every AI response returns `aiToday {tier, used, limit, left, unlimited}` for the card's meter.
  - Upgrades: Silver/trial/comp clients use a Payment Link per plan and period (`planPayload_().links[tier][month|year]`, from `STRIPE_FUEL_LINK`, `STRIPE_GOLD_YEAR_LINK`, `STRIPE_PLATINUM_LINK`, `STRIPE_PLATINUM_YEAR_LINK`, `STRIPE_DIAMOND_LINK`, `STRIPE_DIAMOND_YEAR_LINK`). A paying client switches plan or period in the Stripe customer portal, never through a second link. The sync reads the tier from the price's lookup key (`diamond` / `platinum` / otherwise gold) and the period from `price.recurring.interval` (Members `plan_interval`).
- **Saved meals:** the "Saved Meals" tab stores `items` as JSON (up to 20 foods, 30 meals per client). Tapping one opens the confirm sheet so the amounts can differ. They also show in Search and "Tap to log again".
- **Describe it:** text → Claude Haiku with the same food system prompt and `MEAL_SCHEMA`, source `describe`, 1 AI use.
- **Stripe, no webhooks** (Apps Script can't read webhook signature headers, and it answers POSTs with a 302):
  - The Upgrade button opens `STRIPE_FUEL_LINK?client_reference_id=fuel-<slug>`.
  - `syncStripe_()` lists completed checkout sessions (matching `fuel-<slug>`) and then all subscriptions, using a **read-only restricted key**.
  - It runs every 15 minutes (the `installStripeSync` trigger), when a client returns (the link redirects to `/card/?paid={CHECKOUT_SESSION_ID}`, so the card calls `stripeReturn`, which fetches that session from Stripe), and from the coach page's "Check Stripe now".
  - The renewal date comes from `items.data[0].current_period_end`, where newer API versions put it, with a fallback to `current_period_end`.
  - The tier comes from `items.data[0].price.lookup_key`: anything containing "diamond" is Diamond, "platinum" is Platinum, and everything else is Gold. The period comes from `price.recurring.interval`.
- **Suggestions (free, no AI):** `MacroCore.suggestFill` scores single foods and sensible pairs (protein+carb/veg, dairy+fruit/cereal, shake+fruit). Weights: protein 3, carbs 0.75, fat 0.5, calories used 0.5, with overshoot penalties. It never exceeds the calories left, and each food appears at most once. `suggestOver` gives serves under 150 kcal, ranked by protein per 100 kcal, shrinking lean proteins to fit. Both are unit-tested.
- **Manual logging (free, no AI):** Add food → **Search** looks through favourites, recent foods and Max's Foods tab (add rows there to grow it). **Enter the numbers** logs a food by its per-serve numbers, with source `quick`: `grams` 100 means 1 serve and `per100` holds the per-serve values, so the server skips its ≤105 g-per-100 g check for `quick`. The card shows these as serves (`amountText`). The confirm sheet's **+ Add another food** adds search results to any meal, photo ones included.
- **Photo note:** after a meal photo, an optional "What's in it?" note (≤300 chars) goes to Claude with the image (`mealPrompt_`). It's trusted for what the foods are and any amounts it gives, and it costs no extra scan.
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
- **Punches:** `awardPunches_()` (daily trigger `installPunchTrigger`, around 3am) checks the last two finished weeks. For each unawarded week with 5+ green days, it adds +1 to **CRM "Nutrition Punches"**. If `(Total Classes Attended + Nutrition Punches + Referral Punches) % 10 === 0`, it sets **"Free Session Owed" = Y**. The Macros backend creates both CRM columns at the end of Sessions Remaining.
  - `card/app.js` shows attended + punches, and "Free session ready" when owed.
  - `checkin.js` uses the combined count for the milestone and pre-ticks when owed.
  - `Code.gs` `handleCheckIn_` clears owed on a free check-in (check-in backend `2026-09-25a`).
- **Test harness:** it now fakes the CRM too (shared between pages) and has `_test_checkin.html`, which runs the real Code.gs.

### Next up (needs Max)

- **Training payments on Stripe:** Max wants them all on Stripe. 1-on-1 singles and 6-packs bought from the Book page are built (see "Paying through Stripe" in the Booking section): they add to "1 on 1 Remaining" only, so referral payouts still happen at check-in and nothing had to call the payout logic. Memberships (Monthly Unlimited) and group classes are still to do; they'd need his price list and what each payment adds in Sessions Remaining. Referral payouts also fire from a hand-edit `onEdit` trigger, and script writes don't fire `onEdit`, so anything that bumps "Paid sessions" from a script must call the payout logic directly.
- **Idea:** time-of-day-aware suggestions, so it doesn't suggest fish and rice at 7am.
- **Still to come:** Phase 3 fridge scan, and the rest of Phase 4 (milestone toasts, web push, coach dashboard).

### Open questions for Max

- **Check-in at exactly 0 sessions: leave as is (Max's decision, 2026-09-27).** `handleCheckIn_` reads the balance with `String(row[col.sessions] || "")`, and a numeric 0 is falsy, so a client on exactly 0 is treated like a blank balance. The scan succeeds, the visit is logged, "Paid sessions" goes up by one (which feeds referral payouts) and nothing is deducted. The "No Sessions Left, sort payment before their session" screen only appears for a negative number. It has been this way since the first check-in commit (95df571); booking and payments didn't change it. On 2026-09-27, 7 of 9 clients showed 0 group sessions and 4 showed 0 1-on-1. Max was asked whether scans at 0 should stop and chose to keep it as it is, so don't change `handleCheckIn_` for this. The test harness has a "KNOWN BUG" check that pins the current behaviour.
- **Phase 4:** should nutrition punches add to "Total Classes Attended" (which would inflate attendance) or go in a new column?
- Panel radius: the brief says 14px, but the existing card uses 18px/10px. FUEL uses 14px.
- **Public CRM holds contact details (found 2026-09-26, not yet decided):** the shared CRM sheet has *Phone* and *Email* columns in Sessions Remaining (5 of 9 clients had a phone and 4 of 9 an email) and a *Leads* tab with a phone and email on every row, all readable by anyone with the link. That contradicts the "never hold private data" rule in Stack above. No page reads those columns, so they could move to a private sheet; the sign-up handler (`handleSignup_`, and `isEmailAlreadyPresent_`'s duplicate check) would need to follow. Ask Max before changing his CRM.
