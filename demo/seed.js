/*
 * MaxFit website demo — the made-up member, Sam Taylor.
 *
 * Each function below is run INSIDE one backend's scope by
 * demo/backend-worker.js (crm inside Code.gs, fuel inside Macros.gs), so it
 * can use that file's own helpers and tab names. Everything is dated
 * relative to today, so the demo always has a recent week to show.
 * Never a real client's name or numbers.
 */
const DemoSeed = {
  SLUG: "samtaylor",
  NAME: "Sam Taylor",
  FUEL_KEY: "demo0000samtaylr",
  BOOKING_CODE: "TRYME7",

  // Runs inside apps-script/Code.gs.
  crm: function (data) {
    const TZ = "Australia/Sydney";
    const day = (offset, fmt) => GasFake.formatDate(new Date(Date.now() + offset * 86400000), TZ, fmt || "yyyy-MM-dd");
    const slug = "samtaylor";

    const ss = GasFake.newSpreadsheet("MaxFit CRM (demo)", true);
    const cards = GasFake.insertSheetWithId(ss, "Client cards", SESSIONS_SHEET_GID);
    const header = [
      "Name", "Sign-up Date", "Package Type", "Payment Status", "Group Sessions Remaining", "1 on 1 Remaining",
      "Paid sessions", "Next session ", "Last Attended", "Program type", "Class", "Program doc",
      "Total Classes Attended", "Check-in Token", "Phone", "Email", "Referred By", "Paid In Classes", "Tokens Owed", "",
      "Nutrition Punches", "Free Session Owed", "Referral Sessions Counted", "Referred Clients", "Clients Referred",
      "Referral Code", "Referral Punches", "Manual Session Punches", "Duo Remaining",
    ];
    const row = header.map(() => "");
    const set = (h, v) => { row[header.indexOf(h)] = v; };
    set("Name", "Sam Taylor");
    set("Sign-up Date", day(-63, "d/M/yy"));
    set("Package Type", "1-on-1");
    set("Payment Status", "Paid");
    set("Group Sessions Remaining", 0);
    set("1 on 1 Remaining", 4);
    set("Paid sessions", 12);
    set("Last Attended", day(-2, "d/M/yy"));
    set("Program type", "1-on-1");
    set("Total Classes Attended", 14);
    set("Check-in Token", "demo-sam-taylor");
    set("Nutrition Punches", 3);
    set("Referral Punches", 1);
    set("Manual Session Punches", 0);
    set("Duo Remaining", 0);
    cards.getRange(1, 1, 2, header.length).setValues([header, row]);
    ["Leads", "Attendance Log", "Client Details"].forEach((n) => ss.insertSheet(n));

    // The exercise library is a copy of the real one (no client data in it).
    const ex = ss.insertSheet(EXERCISES_SHEET_NAME);
    const lib = data.exercises;
    ex.getRange(1, 1, lib.length, lib[0].length).setValues(lib.map((r) => lib[0].map((_, i) => r[i] || "")));

    // Three workouts, so every day of the week has one on.
    const plan = [
      ["Upper body", "Mon,Thu,Sun", "Chest, back and shoulders. Slow on the way down.", [
        ["Barbell Bench Press", 3, "8", "Feet flat, shoulder blades pinned back."],
        ["Lat Pulldown", 3, "10", ""],
        ["Dumbbell Shoulder Press", 3, "10", ""],
        ["Seated Cable Row", 3, "10", "Squeeze for a second at the end."],
        ["Tricep Pushdown", 2, "12", ""],
        ["Face Pull", 2, "15", ""],
      ]],
      ["Lower body", "Tue,Fri", "Legs day. Warm up with two light squat sets first.", [
        ["Back Squat", 4, "6", "Sit between your heels, chest proud."],
        ["Romanian Deadlift", 3, "8", ""],
        ["Leg Press", 3, "10", ""],
        ["Walking Lunge", 2, "10 each leg", ""],
        ["Leg Curl", 3, "12", ""],
        ["Plank", 3, "30 sec", ""],
      ]],
      ["Full body", "Wed,Sat", "A bit of everything. Keep the rests short.", [
        ["Goblet Squat", 3, "10", ""],
        ["Incline Dumbbell Press", 3, "10", ""],
        ["Hip Thrust", 3, "10", "Pause at the top."],
        ["Seated Cable Row", 3, "12", ""],
        ["Plank", 3, "30 sec", ""],
      ]],
    ];
    const we = ss.insertSheet(WORKOUT_EXERCISES_SHEET_NAME);
    const weRows = [["Client", "Workout Name", "Order", "Exercise", "Target Sets", "Target Reps", "Days", "Workout Order", "Exercise Notes", "Workout Notes", "Superset"]];
    plan.forEach(([name, days, note, list], w) => {
      list.forEach(([exName, sets, reps, tip], i) => {
        weRows.push([slug, name, i + 1, exName, sets, reps, days, w + 1, tip, note, ""]);
      });
    });
    we.getRange(1, 1, weRows.length, weRows[0].length).setValues(weRows);

    // Three weeks of sessions, a little heavier each week.
    const start = {
      "Barbell Bench Press": [52.5, 8], "Lat Pulldown": [47.5, 10], "Dumbbell Shoulder Press": [12.5, 10],
      "Seated Cable Row": [45, 10], "Tricep Pushdown": [20, 12], "Face Pull": [15, 15],
      "Back Squat": [70, 6], "Romanian Deadlift": [60, 8], "Leg Press": [110, 10], "Walking Lunge": [10, 10],
      "Leg Curl": [32.5, 12], "Plank": [0, 30], "Goblet Squat": [20, 10], "Incline Dumbbell Press": [14, 10], "Hip Thrust": [80, 10],
    };
    const logged = [["Client", "Exercise", "Set Number", "Weight (kg)", "Reps", "Date", "Timestamp", "Workout Name", "Notes"]];
    const dayAbbr = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (let offset = -21; offset <= -1; offset++) {
      const date = day(offset);
      const wd = dayAbbr[new Date(date + "T12:00:00Z").getUTCDay()];
      // Sam trains Mon, Wed and Fri.
      const which = wd === "Mon" ? 0 : wd === "Wed" ? 2 : wd === "Fri" ? 1 : -1;
      if (which < 0) continue;
      const week = Math.floor((offset + 21) / 7);
      const [name, , , list] = plan[which];
      list.forEach(([exName, sets]) => {
        const [kg, reps] = start[exName];
        const step = kg >= 40 ? 2.5 : kg > 0 ? 1 : 0;
        for (let s = 1; s <= sets; s++) {
          logged.push([slug, exName, s, kg + step * week, reps, date, day(offset, "dd/MM/yyyy") + " 07:" + String(10 + s * 3 + list.length).padStart(2, "0") + ":00", name, ""]);
        }
      });
    }
    const ls = ss.insertSheet(LOGGED_SETS_SHEET_NAME);
    ls.getRange(1, 1, logged.length, logged[0].length).setValues(logged);
    ss.insertSheet(GROCERY_SHEET_NAME).getRange(1, 1, 1, 5).setValues([["ID", "Surname", "Item", "Added By", "Added At"]]);

    // Bookings: the real setup, then Sam's code, open hours and no emails or payments.
    setupBooking();
    const book = bookingBook_();
    const settings = book.getSheetByName(BOOKING_TABS.settings);
    const sv = settings.getDataRange().getValues();
    const put = (name, value) => {
      for (let r = 1; r < sv.length; r++) if (String(sv[r][0]).trim() === name) settings.getRange(r + 1, 2).setValue(value);
    };
    put("Notify email", "");
    put("Email clients", "No");
    // Buy buttons show as on a real card; demo-mode.js stops the click before it reaches Stripe.
    put("Online payments", "Yes");
    PropertiesService.getScriptProperties().setProperty(BOOKING_STRIPE_KEY_PROPERTY, "demo-placeholder");
    const prices = book.getSheetByName(BOOKING_TABS.prices);
    const ph = prices.getRange(1, 1, 1, prices.getLastColumn()).getValues()[0].map(String);
    const pv = prices.getDataRange().getValues();
    for (let r = 1; r < pv.length; r++) {
      const onlyFor = String(pv[r][ph.indexOf("Only for")] || "").trim();
      const on = String(pv[r][ph.indexOf("On")]).trim() === "Yes";
      if (on && !onlyFor) prices.getRange(r + 1, ph.indexOf("Pay link") + 1).setValue("https://buy.stripe.com/demo");
    }
    put("Contact link", "");
    put("Meeting place", "the park (the demo doesn't really book)");
    const avail = book.getSheetByName(BOOKING_TABS.availability);
    avail.getRange(2, 1, 60, BOOKING_AVAILABILITY_HEADER.length).setValue("");
    const hours = [["Mon", "06:00", "10:00"], ["Tue", "15:00", "19:00"], ["Wed", "06:00", "10:00"], ["Thu", "15:00", "19:00"], ["Fri", "06:00", "10:00"], ["Sat", "08:00", "12:00"]];
    avail.getRange(2, 1, hours.length, 6).setValues(hours.map((h) => ["Yes", h[0], h[1], h[2], 45, 0]));
    const clients = book.getSheetByName(BOOKING_TABS.clients);
    const ch = clients.getRange(1, 1, 1, clients.getLastColumn()).getValues()[0].map(String);
    // setupBooking has already issued Sam a random code; swap it for the fixed demo one.
    const cv = clients.getDataRange().getValues();
    let at = cv.findIndex((r, i) => i > 0 && String(r[ch.indexOf("Slug")]) === slug) + 1;
    if (!at) at = clients.getLastRow() + 1;
    const crow = ch.map((h) => ({ Name: "Sam Taylor", Slug: slug, "Booking Code": "TRYME7" })[h] || "");
    clients.getRange(at, 1, 1, ch.length).setValues([crow]);
  },

  // Runs inside apps-script/macros/Macros.gs.
  fuel: function () {
    const slug = "samtaylor";
    const ss = GasFake.newSpreadsheet("MaxFit Macros (demo)", false);
    PropertiesService.getScriptProperties().setProperties({ MACRO_SHEET_ID: ss.getId(), ANTHROPIC_API_KEY: "demo" });
    setupMacroSheets();
    const today = todaySydney_();
    const day = (n) => MacroCore.addDays(today, n);
    const stamp = (d, t) => d + " " + t;

    appendRow_("members", {
      slug: slug, name: "Sam Taylor", key: "demo0000samtaylr", hide_kcal: "", created_at: stamp(day(-63), "09:00:00"),
      trial_started: day(-63), plan_status: "active", plan_until: day(300), plan_tier: "diamond", plan_interval: "month",
    });
    appendRow_("targets", {
      slug: slug, kcal: 1900, protein_g: 130, carbs_g: 190, fat_g: 65, set_by: "client", updated_at: stamp(day(-40), "10:00:00"),
    });
    appendRow_("targetHistory", {
      slug: slug, effective_date: day(-40), kcal: 1900, protein_g: 130, carbs_g: 190, fat_g: 65, set_by: "client", created_at: stamp(day(-40), "10:00:00"),
    });

    const foods = [
      // name, category, serve g, serve label, kcal, p, c, f per 100 g
      ["Rolled oats", "Grains", 40, "1/2 cup", 375, 12, 60, 8],
      ["Banana", "Fruit", 120, "1 medium", 89, 1.1, 23, 0.3],
      ["Greek yoghurt, plain", "Dairy", 170, "1 tub", 73, 9.5, 4, 2],
      ["Eggs", "Eggs", 50, "1 egg", 143, 12.6, 0.7, 9.5],
      ["Wholemeal bread", "Bakery", 40, "1 slice", 240, 10, 41, 3.5],
      ["Chicken breast, cooked", "Meat", 150, "1 fillet", 165, 31, 0, 3.6],
      ["White rice, cooked", "Grains", 180, "1 cup", 130, 2.4, 28, 0.3],
      ["Broccoli", "Vegetables", 90, "1 cup", 34, 2.8, 7, 0.4],
      ["Salmon fillet, cooked", "Fish", 120, "1 fillet", 206, 22, 0, 12],
      ["Sweet potato, baked", "Vegetables", 150, "1 medium", 90, 2, 21, 0.2],
      ["Apple", "Fruit", 150, "1 medium", 52, 0.3, 14, 0.2],
      ["Almonds", "Nuts", 30, "small handful", 579, 21, 22, 50],
      ["Milk, full cream", "Dairy", 250, "1 glass", 64, 3.4, 4.8, 3.4],
      ["Tuna in springwater", "Fish", 95, "1 tin", 116, 26, 0, 1],
      ["Avocado", "Fruit", 50, "1/4 avocado", 160, 2, 9, 15],
      ["Beef mince, lean, cooked", "Meat", 120, "1 serve", 217, 26, 0, 12],
      ["Pasta, cooked", "Grains", 180, "1 cup", 158, 5.8, 31, 0.9],
      ["Cheddar cheese", "Dairy", 20, "1 slice", 403, 25, 1.3, 33],
      ["Peanut butter", "Spreads", 20, "1 tbsp", 588, 25, 20, 50],
      ["Protein bar", "Snacks", 60, "1 bar", 360, 33, 37, 13],
    ];
    foods.forEach((f) => appendRow_("foods", {
      name: f[0], category: f[1], serve_g: f[2], serve_label: f[3], kcal_100g: f[4], protein_100g: f[5], carbs_100g: f[6], fat_100g: f[7],
    }));

    const per = (name) => foods.find((f) => f[0] === name);
    const log = (date, meal, name, grams, time) => {
      const f = per(name);
      const k = grams / 100;
      appendRow_("logs", {
        id: Utilities.getUuid(), slug: slug, log_date: date, meal: meal, name: name, grams: grams,
        kcal: Math.round(f[4] * k), protein_g: Math.round(f[5] * k * 10) / 10, carbs_g: Math.round(f[6] * k * 10) / 10, fat_g: Math.round(f[7] * k * 10) / 10,
        kcal_100g: f[4], protein_100g: f[5], carbs_100g: f[6], fat_100g: f[7], source: "search", confidence: "high", created_at: stamp(date, time),
      });
    };
    // The last six days in full, and breakfast and lunch today.
    for (let n = -6; n <= 0; n++) {
      const d = day(n);
      log(d, "breakfast", "Rolled oats", 50, "07:30:00");
      log(d, "breakfast", "Greek yoghurt, plain", 170, "07:31:00");
      log(d, "breakfast", "Banana", 120, "07:32:00");
      log(d, "lunch", n % 2 ? "Tuna in springwater" : "Chicken breast, cooked", n % 2 ? 95 : 150, "12:30:00");
      log(d, "lunch", "Wholemeal bread", 80, "12:31:00");
      log(d, "lunch", "Avocado", 50, "12:32:00");
      if (n === 0) continue;
      log(d, "snack", n % 3 ? "Apple" : "Protein bar", n % 3 ? 150 : 60, "15:30:00");
      log(d, "dinner", n % 2 ? "Salmon fillet, cooked" : "Beef mince, lean, cooked", 140, "19:00:00");
      log(d, "dinner", n % 2 ? "Sweet potato, baked" : "Pasta, cooked", 180, "19:01:00");
      log(d, "dinner", "Broccoli", 90, "19:02:00");
    }

    [82.6, 82.3, 82.4, 81.9, 81.7, 81.5, 81.2, 81.0].forEach((kg, i) => {
      const d = day(-49 + i * 7);
      appendRow_("weights", { id: Utilities.getUuid(), slug: slug, date: d, kg: kg, by: "client", created_at: stamp(d, "07:00:00") });
    });

    // Two EVOLT scans a month apart, so Progress has a body-scan line to show.
    [[-49, 82.6, 24.1, 19.9, 34.8], [-21, 81.9, 23.2, 19.0, 35.2]].forEach(([n, kg, pct, fat, muscle]) => {
      appendRow_("bodyScans", {
        id: Utilities.getUuid(), slug: slug, scan_date: day(n), weight_kg: kg, body_fat_pct: pct, fat_mass_kg: fat,
        muscle_mass_kg: muscle, by: "coach", confidence: "high", created_at: stamp(day(n), "10:00:00"),
      });
    });

    appendRow_("goals", {
      id: Utilities.getUuid(), slug: slug, type: "strength", exercise: "Back Squat", target: 80, target_reps: 6,
      start_value: 70, start_reps: 6, start_date: day(-12), end_date: day(16),
      how: "Squat twice a week and add 2.5 kg when all sets feel solid.", why: "To keep up with my kids at the park.",
      created_at: stamp(day(-12), "18:00:00"), updated_at: stamp(day(-12), "18:00:00"),
    });

    [["Greek yoghurt", "2 tubs", "Dairy and eggs"], ["Bananas", "6", "Fruit and veg"], ["Chicken breast", "500 g", "Meat and fish"], ["Rolled oats", "1 bag", "Pantry"]].forEach((s, i) => {
      appendRow_("shopping", { id: Utilities.getUuid(), slug: slug, name: s[0], amount: s[1], aisle: s[2], done: i === 3 ? "Y" : "", source: "own", created_at: stamp(day(-1), "20:00:00") });
    });
  },
};
