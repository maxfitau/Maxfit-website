/*
 * MaxFit website demo — turns a card page into a sandbox.
 *
 * Loaded only by the one-line check at the top of each client page, and only
 * when the page was opened with ?demo=1 or is already inside the demo (the
 * marker lives in window.name, which follows the demo frame from page to
 * page and is never shared with another tab). From here on:
 *  - localStorage / sessionStorage are kept in memory, so a real client's
 *    saved card on this phone is never read or changed;
 *  - every request to Google (the CRM sheet, both Apps Script backends) is
 *    answered by demo/backend-worker.js, which runs the real backend code
 *    against a pretend spreadsheet with a made-up member, Sam Taylor;
 *  - anything else that would leave the site (Stripe, texts, emails, Max's
 *    coach pages) is stopped with a short note instead.
 * The demo's state rides along in window.name until the frame is closed.
 */
(function () {
  "use strict";

  const MARK = "maxfitdemo:";
  const VERSION = "20261101b";
  const BASE = "/demo/";
  const FUEL_DEPLOYMENT = "AKfycbw5B8tpkFA1wEC8b3F9IKeiuWDjtVoW5IdXRE71D4FHvtc96RVYzLYlQPoQzfrjplNe";
  // Pages a visitor can move between. Everything else is Max's side, or leaves the demo.
  const PAGES = [
    "/card/", "/card/index.html", "/card/book.html", "/card/refer.html",
    "/workout/", "/workout/index.html", "/workout/library.html", "/workout/progress.html", "/workout/calendar.html",
  ];

  let state = null;
  try {
    if (window.name.indexOf(MARK) === 0) state = JSON.parse(window.name.slice(MARK.length));
  } catch (err) {
    state = null;
  }
  if (!state) {
    state = {
      ls: {
        maxfitMemberId: "samtaylor",
        maxfitMacroKey: JSON.stringify({ id: "samtaylor", k: "demo0000samtaylr" }),
        maxfitBookCode: JSON.stringify({ id: "samtaylor", code: "TRYME7" }),
      },
      ss: {},
      db: null,
    };
  }
  function save() {
    try {
      window.name = MARK + JSON.stringify(state);
    } catch (err) {
      // Too big to keep: this page still works, the next one starts fresh.
    }
  }
  save();
  document.documentElement.setAttribute("data-demo", "1");

  // ---- Storage: in memory only --------------------------------------------

  let realSession = null;
  try {
    realSession = window.sessionStorage;
  } catch (err) {
    realSession = null;
  }
  const has = Object.prototype.hasOwnProperty;
  const bagFor = (store) => (store === realSession ? state.ss : state.ls);
  const SP = Storage.prototype;
  SP.getItem = function (k) {
    const bag = bagFor(this);
    k = String(k);
    return has.call(bag, k) ? bag[k] : null;
  };
  SP.setItem = function (k, v) {
    bagFor(this)[String(k)] = String(v);
    save();
  };
  SP.removeItem = function (k) {
    delete bagFor(this)[String(k)];
    save();
  };
  SP.clear = function () {
    const bag = bagFor(this);
    Object.keys(bag).forEach((k) => delete bag[k]);
    save();
  };
  SP.key = function (i) {
    const keys = Object.keys(bagFor(this));
    return i >= 0 && i < keys.length ? keys[i] : null;
  };
  try {
    Object.defineProperty(SP, "length", { configurable: true, get() { return Object.keys(bagFor(this)).length; } });
  } catch (err) {
    // Older browsers: length stays the real one, which nothing here reads.
  }

  // ---- The pretend backend --------------------------------------------------

  const worker = new Worker(BASE + "backend-worker.js?v=" + VERSION);
  const pending = {};
  let seq = 0;
  worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.snapshot) {
      state.db = msg.snapshot;
      save();
    }
    if (!msg.ok) console.error("MaxFit demo:", msg.text);
    const done = pending[msg.id];
    if (done) {
      delete pending[msg.id];
      done(msg);
    }
  };
  const booted = new Promise((resolve) => { pending.init = resolve; });
  worker.postMessage({ type: "init", snapshot: state.db, version: VERSION });

  function ask(msg) {
    return booted.then(() => new Promise((resolve) => {
      const id = "m" + ++seq;
      pending[id] = resolve;
      worker.postMessage(Object.assign({ id: id }, msg));
    }));
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const json = (text, status) => new Response(text, { status: status || 200, headers: { "Content-Type": "application/json" } });
  const SNAG = JSON.stringify({ ok: false, status: "error", error: "demo", message: "The demo hit a snag. Close it and open it again." });

  const realFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const href = typeof input === "string" ? input : input && input.url ? input.url : String(input);
    let url;
    try {
      url = new URL(href, location.href);
    } catch (err) {
      return realFetch(input, init);
    }
    if (url.origin === location.origin) return realFetch(input, init);

    // A short pause, like the real network: the card's tiles expect answers to take a moment.
    await wait(250);

    if (url.hostname === "docs.google.com" && /\/spreadsheets\//.test(url.pathname)) {
      const gid = url.searchParams.get("gid");
      const name = url.searchParams.get("sheet");
      const res = await ask({ type: "csv", gid: gid && !name ? gid : null, name: name });
      return res.ok && res.text != null ? new Response(res.text, { status: 200, headers: { "Content-Type": "text/csv" } }) : new Response("", { status: 404 });
    }
    if (url.hostname === "docs.google.com") return new Response("", { status: 404 });

    if (url.hostname === "script.google.com") {
      const backend = url.pathname.indexOf(FUEL_DEPLOYMENT) >= 0 ? "fuel" : "crm";
      const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
      let body = init && init.body;
      if (body == null && input && typeof input.text === "function") body = await input.text();
      const params = {};
      url.searchParams.forEach((v, k) => { params[k] = v; });
      const res = await ask({ type: "call", backend: backend, method: method === "GET" ? "get" : "post", body: String(body || ""), params: params });
      return json(res.ok ? res.text : SNAG);
    }
    throw new TypeError("Not available in the demo.");
  };

  if (navigator.sendBeacon) navigator.sendBeacon = () => true;

  // ---- Staying inside the demo ----------------------------------------------

  let toastEl = null;
  let toastTimer = null;
  function toast(text) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.setAttribute("role", "status");
      toastEl.style.cssText =
        "position:fixed;left:16px;right:16px;bottom:160px;z-index:2147483647;margin:0 auto;max-width:360px;" +
        "background:#111;color:#fff;border:1px solid #333;border-radius:14px;padding:14px 16px;" +
        "font:500 16px/1.4 system-ui,-apple-system,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.45);" +
        "transition:opacity .2s;opacity:0;pointer-events:none;text-align:center";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.opacity = "0"; }, Math.max(2600, text.length * 60));
  }
  window.__maxfitDemoToast = toast;

  document.addEventListener(
    "click",
    (e) => {
      const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a || a.hasAttribute("data-demo-exit")) return;
      const raw = a.getAttribute("href") || "";
      if (!raw || raw[0] === "#" || /^javascript:/i.test(raw)) return;
      let url;
      try {
        url = new URL(a.href, location.href);
      } catch (err) {
        return;
      }
      if (url.origin === location.origin && PAGES.indexOf(url.pathname) >= 0) {
        if (a.target && a.target !== "_self") {
          e.preventDefault();
          location.href = url.href;
        }
        return;
      }
      e.preventDefault();
      if (/^(sms|tel|mailto):/i.test(url.protocol)) toast("In the real app this opens your messages. The demo keeps it here.");
      else if (/stripe\.com$/.test(url.hostname)) toast("On your real card this opens Stripe's secure checkout, and the session is added to your card once it's paid. The demo doesn't charge anything.");
      else if (url.origin === location.origin && /^\/(card\/(coach|clients|book-staff)|workout\/builder)/.test(url.pathname)) toast("That's Max's side of the app.");
      else toast("That opens outside the card, so it's switched off in the demo.");
    },
    true
  );
  window.open = function () {
    toast("That opens outside the card, so it's switched off in the demo.");
    return null;
  };
  if (navigator.share) {
    navigator.share = function () {
      toast("Sharing is switched off in the demo.");
      return Promise.reject(new DOMException("Demo", "AbortError"));
    };
  }

  // Opened on its own (not inside the website's demo frame): a way back out.
  if (window.top === window) {
    document.addEventListener("DOMContentLoaded", () => {
      const bar = document.createElement("a");
      bar.href = "/#card-showcase";
      bar.textContent = "Demo · Exit";
      bar.setAttribute("data-demo-exit", "");
      bar.style.cssText =
        "position:fixed;bottom:calc(env(safe-area-inset-bottom, 0px) + 92px);left:12px;z-index:2147483646;" +
        "background:#E00000;color:#fff;border-radius:999px;padding:12px 18px;min-height:48px;box-sizing:border-box;" +
        "font:700 16px/24px system-ui,-apple-system,sans-serif;text-decoration:none";
      bar.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.name = "";
        location.href = "/#card-showcase";
      }, true);
      document.body.appendChild(bar);
    });
  }
})();
