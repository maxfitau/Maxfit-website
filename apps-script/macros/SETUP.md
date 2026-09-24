# MaxFit Macros: one-time setup

The macro tracker (the FUEL tab on the card) has its own small backend: a **new, private Google Sheet** and a **new Apps Script project**. It's kept separate from the check-in script, so nothing here can break check-ins.

Allow about 15 minutes.

## 1. Make the private sheet

1. Go to **sheets.new**. Name the sheet **MaxFit Macros**.
2. **Don't share it** with anyone. Only the script reads it.
3. Copy its ID from the address bar. The ID is the long part between `/d/` and `/edit`.

## 2. Make the Apps Script project

1. Go to **script.google.com** and click **New project**. Name it **MaxFit Macros**.
2. Rename the file `Code.gs` to **Macros**. Delete what's in it, then paste in everything from `apps-script/macros/Macros.gs`.
3. Click **+** next to Files, choose **Script**, and name it **MacrosCore**. Paste in everything from `card/macros-core.js`.
   - Whenever `card/macros-core.js` changes, paste it in here again, so the phone and the server always do the same maths.
4. Press **Save** (the disk icon).

## 3. Add the secret settings

Click **Project Settings** (the gear icon on the left), then **Script Properties**, then **Add script property**. Add these:

| Property | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Claude API key, from console.anthropic.com → API Keys. |
| `STAFF_PIN` | The same PIN you use for check-in. |
| `MACRO_SHEET_ID` | The ID you copied in step 1. |
| `MAIN_SHEET_ID` | `1dGQyIoJ2_XrkbvvPvM2JAY0xdeYQfsCnYHal8WZojUg` |
| `DAILY_AI_LIMIT` | Optional. Photo/label scans per client per day (default 25; 15 is plenty for paying clients). |
| `CHAT_DAILY_LIMIT` | Optional. Ask Fuel messages per client per day (default 40). |

The three Stripe properties are covered in step 7.

You can leave out `ANTHROPIC_API_KEY` until you buy API credits. Until then Fuel AI (photo/label scans and Ask Fuel) is hidden, and clients use barcodes and the free "what to eat next" ideas.

Also set a monthly spend limit in console.anthropic.com → Settings → Limits. A photo scan costs roughly 1 US cent, and the **AI Usage** tab shows this month's total in cell N1.

## 4. Create the tabs

1. Go back to the editor.
2. Pick **setupMacroSheets** in the function dropdown at the top, then press **Run**.
3. Google will ask for permission. Click **Review permissions**, choose your account, then **Advanced** → **Go to MaxFit Macros**, then **Allow**.
4. Open the MaxFit Macros sheet. It should now have 6 tabs: Members, Macro Targets, Food Logs, Favourites, Barcode Cache and AI Usage. A **Foods** tab (about 80 Australian staples behind "what to eat next") appears by itself the first time a client opens FUEL. You can edit or add foods there any time.

## 5. Deploy it (first time only)

1. Click **Deploy** → **New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Set **Execute as** to **Me**, and **Who has access** to **Anyone**.
4. Click **Deploy** and copy the **Web app URL**.
5. Send that URL to Claude, or paste it into `card/macros-api.js` in place of `PASTE_MACROS_WEB_APP_URL_HERE`. Then push the site.

To check it's live, open the URL in a browser. You should see `{"ok":true,"app":"maxfit-macros","version":"…"}`.

### Later updates

Paste the new code in and save. Then go to **Deploy** → **Manage deployments**, click the **pencil**, set **Version** to **New version**, and click **Deploy**.

**Never** choose "New deployment" again. It makes a new URL, and the card would stop reaching the backend.

## 6. Give clients their FUEL link

1. Open **maxfit.now/card/coach.html** and enter your staff PIN.
2. For each client, tap **Create Fuel link**, pick their sex (this sets the 1,500 / 1,200 kcal floor), then tap **Copy link** and text it to them.
3. Optionally, tap **Set targets** to set their protein, carbs and fat yourself. If you don't, they can use the calculator in the app.

**What clients need to do:** open the link once in Safari (iPhone) or Chrome (Android), then **Add to Home Screen again**. On iPhone, the old home-screen icon keeps its own storage and won't know the new link.

**Fuel AI** (photo and label scans, plus the Ask Fuel chat) costs **$14.99 a month**. Each client gets a **7-day free trial** from the first time they open FUEL; after that it's locked until they subscribe through the Upgrade button (Stripe, step 7). On the coach page, each client shows their status: trial, paying, free month, or ended. **Give a free month** unlocks it for 30 days without payment, which is handy for friends, testing, or making up for a problem.

Lost phone, or a link shared by mistake? Tap **New link** on the coach page. The old link stops working for FUEL straight away.

## 7. Fuel AI on Stripe (do it in test mode first)

Stripe moves its menus around. If you can't find something, type its name ("Payment Links", "Customer portal", "Restricted keys") into Stripe's search bar.

1. Sign in to **stripe.com**, or create an account for MaxFit. Your business and bank details are yours to enter.
2. Turn on **Test mode** (the switch at the top right), so nothing is really charged while we test.
3. **Product catalogue → Add product.** Name it **Fuel AI**, choose **Recurring**, set the price to **14.99 AUD** and the period to **Monthly**, then save.
4. **Payment Links → New.** Pick **Fuel AI**. On the **After payment** tab, choose **Don't show confirmation page → Redirect customers to your website**, and enter exactly:
   `https://maxfit.now/card/?paid={CHECKOUT_SESSION_ID}`
   Create the link and copy it. It starts with `https://buy.stripe.com/`.
5. **Settings → Billing → Customer portal.** Turn it on and copy its **login link** (`https://billing.stripe.com/p/login/…`). This is where clients cancel or change their card.
6. **Developers → API keys → Create restricted key.** Name it **MaxFit Macros**. Give it **Checkout Sessions: Read** and **Subscriptions: Read**, and leave everything else as None. Create it and copy the key (it starts with `rk_test_`). **Paste it only into Apps Script**: never into chat, email or anywhere else.
7. In Apps Script → **Project Settings → Script Properties**, add:

| Property | Value |
|---|---|
| `STRIPE_SECRET_KEY` | the restricted key from step 6 |
| `STRIPE_FUEL_LINK` | the payment link from step 4 |
| `STRIPE_PORTAL_LINK` | the portal login link from step 5 |

8. Back in the editor, choose **installStripeSync** in the function dropdown and press **Run** (allow permissions if asked). From now on the backend checks Stripe every 15 minutes, and straight away whenever a client comes back from paying.
9. **Test on yourself:** open your own FUEL tab, tap a locked feature → **Upgrade to Fuel AI**, and pay with Stripe's test card `4242 4242 4242 4242` (any future expiry date, any CVC). You should land back on the card with "Fuel AI is on", and the coach page should say "paying · renews …".
10. **Go live:** turn Test mode off and repeat steps 3–6 in live mode (test products, links and keys don't carry over). Then replace the three Stripe Script Properties with the live values.

## 8. Progress and nutrition punches

The Progress screen (weight trend, calorie target, last 14 days) is free for everyone and needs no setup: its tabs (**Weights**, **Target History**, **Punch Awards**) create themselves.

**Nutrition punches:** 5 green days in a Monday–Sunday week earns 1 punch on the client's loyalty card. A green day means protein at least 90% of target and calories within ±10%. Punches are added to a new **Nutrition Punches** column on your Sessions Remaining tab (it appears by itself, next to a **Free Session Owed** column). The card and the check-in page add them to Total Classes Attended. When a nutrition punch completes a card, the check-in page pre-ticks "Free Session (earned with Fuel!)".

1. In the **MaxFit Macros** editor, choose **installPunchTrigger** in the function dropdown and press **Run**, once. From then on it checks every morning around 3am. It's safe to run **awardPunches** by hand at any time; it never gives the same week twice.
2. The **check-in** script (the *other* Apps Script project, `apps-script/Code.gs`) also changed slightly, so it can clear "Free Session Owed" once that free session is used. Paste the new Code.gs in, save, then go to **Manage deployments → pencil → New version → Deploy**. Opening its URL should show version `2026-09-25a`.

**Weights:** clients log their own weight on the Progress screen, and you can log it from the coach page (**Log weight**) after a session. **Set goal** on the coach page sets a goal weight and a pace (kg per week). The pace line on the client's chart follows it, going up or down depending on the goal.
