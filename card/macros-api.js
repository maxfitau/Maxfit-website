/*
 * MaxFit macro tracker — talks to the "MaxFit Macros" Apps Script web app.
 *
 * That's a separate Apps Script project from check-in (see
 * apps-script/macros/Macros.gs) with its own private Google Sheet. Paste its
 * deployment URL below after the first deploy. Until then the FUEL tab
 * says the tracker isn't switched on yet.
 *
 * Every member request carries the member's id plus their secret macro key
 * (the &k= in the link Max sends them). The key is remembered on the
 * phone, alongside the id it belongs to, so the home-screen icon keeps
 * working. No API keys live here — Claude is only ever called server-side.
 */
const MACROS_API_URL = "https://script.google.com/macros/s/AKfycbw5B8tpkFA1wEC8b3F9IKeiuWDjtVoW5IdXRE71D4FHvtc96RVYzLYlQPoQzfrjplNe/exec";

const MACRO_KEY_STORAGE = "maxfitMacroKey";

const MacroApi = (function () {
  function configured() {
    return /^https:\/\/script\.google\.com\//.test(MACROS_API_URL);
  }

  /** { id, k } for this phone, from the URL first (and saved), else from storage. */
  function identity() {
    const params = new URLSearchParams(window.location.search);
    const urlId = params.get("id");
    const urlKey = params.get("k");
    if (urlId && urlKey) {
      try {
        localStorage.setItem(MACRO_KEY_STORAGE, JSON.stringify({ id: urlId, k: urlKey }));
      } catch (err) {
        // Storage off (private mode) — still works for this visit.
      }
      return { id: urlId, k: urlKey };
    }
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(MACRO_KEY_STORAGE) || "null");
    } catch (err) {
      saved = null;
    }
    let memberId = urlId;
    if (!memberId) {
      try {
        memberId = localStorage.getItem("maxfitMemberId"); // the card's own saved id (app.js)
      } catch (err) {
        memberId = null;
      }
    }
    // A saved key only counts for the member it was issued to.
    if (saved && saved.k && (!memberId || saved.id === memberId)) return { id: saved.id, k: saved.k };
    return { id: memberId, k: null };
  }

  async function post(body, { timeoutMs = 30000 } = {}) {
    if (!configured()) {
      const err = new Error("The macro tracker isn't switched on yet.");
      err.code = "not_configured";
      throw err;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(MACROS_API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids a CORS preflight
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const e = new Error(
        err.name === "AbortError" ? "That took too long. Check your signal and try again." : "No connection. Try again."
      );
      e.code = "network";
      throw e;
    } finally {
      clearTimeout(timer);
    }
    let data;
    try {
      data = await res.json();
    } catch (err) {
      const e = new Error("Something went wrong on our side. Try again.");
      e.code = "bad_response";
      throw e;
    }
    if (!data.ok) {
      const e = new Error(data.message || "Something went wrong. Try again.");
      e.code = data.error || "error";
      throw e;
    }
    return data;
  }

  /**
   * Saves a pasted card link (or just its 16-character key) on this phone,
   * for a home-screen icon that opened without the personal link. Also sets
   * the card's own saved id, so the CARD tab follows the same person.
   * Returns false if the text doesn't look like a MaxFit link.
   */
  function saveLink(text) {
    const raw = String(text || "").trim();
    const idMatch = /[?&]id=([^&#\s]+)/.exec(raw);
    const keyMatch = /[?&]k=([^&#\s]+)/.exec(raw);
    let id = null;
    let k = null;
    try {
      if (idMatch && keyMatch) {
        id = decodeURIComponent(idMatch[1]);
        k = decodeURIComponent(keyMatch[1]);
      } else if (/^[a-f0-9]{16}$/i.test(raw)) {
        id = localStorage.getItem("maxfitMemberId");
        k = raw.toLowerCase();
      }
    } catch (err) {
      return false;
    }
    if (!id || !k || !/^[a-z0-9]+$/.test(id)) return false;
    try {
      localStorage.setItem(MACRO_KEY_STORAGE, JSON.stringify({ id: id, k: k }));
      localStorage.setItem("maxfitMemberId", id);
    } catch (err) {
      return false;
    }
    return true;
  }

  /** A member request: adds id + key automatically. */
  function call(action, fields, options) {
    const who = identity();
    return post(Object.assign({ action: action, id: who.id, k: who.k }, fields || {}), options);
  }

  /** A coach request: PIN instead of a member key. */
  function coach(action, pin, fields) {
    return post(Object.assign({ action: action, pin: pin }, fields || {}));
  }

  return { configured: configured, identity: identity, saveLink: saveLink, call: call, coach: coach };
})();
