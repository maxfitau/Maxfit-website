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
| `DAILY_AI_LIMIT` | `25` (optional; 25 photo scans per client per day is the default). |
| `CENTS_PER_SCAN` | Optional. What a client pays per photo scan, in cents. Defaults to `5`, so $10 = 200 scans. |
| `FREE_SCANS` | Optional. Free photo scans for each new client. Defaults to `10`. |

You can leave out `ANTHROPIC_API_KEY` until you buy API credits. Until then photo and label scanning are hidden and clients use barcodes only.

Also set a monthly spend limit in console.anthropic.com → Settings → Limits. A photo scan costs roughly 1 US cent, and the **AI Usage** tab shows this month's total in cell N1.

## 4. Create the tabs

1. Go back to the editor.
2. Pick **setupMacroSheets** in the function dropdown at the top, then press **Run**.
3. Google will ask for permission. Click **Review permissions**, choose your account, then **Advanced** → **Go to MaxFit Macros**, then **Allow**.
4. Open the MaxFit Macros sheet. It should now have 6 tabs: Members, Macro Targets, Food Logs, Favourites, Barcode Cache and AI Usage.

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

**When a client pays you for photo scans:** on the coach page, tap **Add top-up** on their card, type the amount they paid (e.g. `10`) and tap **Add scans**. At 5c a scan, $10 gives them 200. Each successful photo or label scan uses 1; failed scans are free. Every top-up is recorded in the **Scan Credits** tab. If you type a wrong amount, enter a negative amount (e.g. `-10`), or just delete that row in the tab.

Lost phone, or a link shared by mistake? Tap **New link** on the coach page. The old link stops working for FUEL straight away.
