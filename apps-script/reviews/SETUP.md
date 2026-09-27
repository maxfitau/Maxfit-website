# MaxFit Reviews: one-time setup

The website's "Leave a review" section has its own small backend: a **new, private Google Sheet** with a **new Apps Script project** attached to it. It's kept separate from the check-in script and the FUEL macro tracker, so nothing here can break them.

Allow about 10 minutes.

## How it works (read this first)

1. A visitor fills in the review form on the site (stars, name, review).
2. It lands in your private sheet as **pending**, and you get an email.
3. **Nothing shows on the website until you change it to "approved".**
4. After sending, the visitor is offered a **"Post it on Google too"** button. It copies their review and opens Google's own review page, so they just paste and press Post.

**Why the Google step is a button and not automatic:** Google only lets the reviewer post their own review. No website or app is allowed to post one for somebody else, and trying to would risk your Google Business Profile being suspended. The button is the fastest legitimate way, and it is offered to **everyone, whatever star rating they gave**. Google's rules ban only asking happy customers to post on Google, so please don't change that.

## 1. Make the private sheet

1. Go to **sheets.new**. Name the sheet **MaxFit Reviews**.
2. **Don't share it** with anyone.

## 2. Add the script to the sheet

1. In the sheet, click **Extensions** then **Apps Script**.
2. Rename the project (top left) to **MaxFit Reviews**.
3. In the file `Code.gs`, delete everything and paste in everything from `apps-script/reviews/Reviews.gs`.
4. Press **Save** (the disk icon).

## 3. Add your email

1. Click **Project Settings** (the gear icon on the left), then scroll to **Script Properties** and click **Add script property**.
2. Add:

| Property | Value |
|---|---|
| `NOTIFY_EMAIL` | The email you want new reviews sent to. |
| `DAILY_REVIEW_LIMIT` | Optional. The most reviews accepted per day. Defaults to `30`. |

## 4. Create the Reviews tab

1. Go back to the editor (the `<>` icon on the left).
2. Pick **setupReviewSheet** in the function dropdown at the top, then press **Run**.
3. Google will ask for permission. Click **Review permissions**, choose your account, then **Advanced**, then **Go to MaxFit Reviews**, then **Allow**. (It needs permission to edit this sheet and to email you.)
4. Look at the sheet. It should now have a **Reviews** tab with these headings: Received, Name, Rating, Review, Status, Consent, ID.
5. Refresh the sheet page once. A **Reviews** menu appears at the top, next to Help.

## 5. Deploy it (first time only)

1. In the Apps Script editor, click **Deploy** then **New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Set **Execute as** to **Me**, and **Who has access** to **Anyone**.
4. Click **Deploy** and copy the **Web app URL**.

To check it's live, open that URL in a browser. You should see `{"ok":true,"app":"maxfit-reviews","version":"…"}`. Add `?action=reviews` to the end of the URL and you should see `{"ok":true,"reviews":[]}`.

## 6. Turn it on in the website

Send the **Web app URL** to Claude, or paste it into `js/reviews-config.js` where it says `apiUrl`. Then push the site.

Until that URL is set, the reviews section stays completely hidden, so it's safe to publish the site before you finish this.

## 7. Get your Google review link

1. Search for your business on **google.com** while signed in to the Google account that owns the Business Profile.
2. On your profile, click **Ask for reviews** (or go to business.google.com, open your profile and click **Get more reviews**).
3. Copy the link. It looks like `https://g.page/r/xxxxxxxx/review`.
4. Send it to Claude, or paste it into `js/reviews-config.js` where it says `googleUrl`. Then push the site.

If `googleUrl` is left empty, the "Post it on Google too" button simply doesn't appear.

## Approving reviews

New reviews arrive with **Status = pending**, and you get an email.

- **To publish:** click the Status cell and choose **approved**. Or select the row (click its number on the left) and use the **Reviews** menu, then **Approve selected rows**. It shows on the site within about a minute.
- **To remove:** set Status to **hidden**.

Only hide reviews that are spam or abusive. Hiding a review just because it's critical would mislead people and can breach consumer law.

## Later updates

Paste the new code in and save. Then go to **Deploy** then **Manage deployments**, click the **pencil**, set **Version** to **New version**, and click **Deploy**.

**Never** choose "New deployment" again. It makes a new URL, and the website would stop reaching the reviews backend.
