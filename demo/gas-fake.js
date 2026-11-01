/*
 * MaxFit website demo — a pretend Google Apps Script, for the demo worker only.
 *
 * The demo runs the real backends (apps-script/Code.gs and
 * apps-script/macros/Macros.gs) inside the visitor's browser, against
 * spreadsheets that live in memory here. Nothing in this file talks to
 * Google: SpreadsheetApp, PropertiesService and friends are stand-ins with
 * just enough behaviour for those two files. Formatting calls (colours,
 * widths, validation) are accepted and ignored.
 *
 * Loaded by demo/backend-worker.js. Never loaded by the real card.
 */
(function (g) {
  "use strict";

  const TZ_DEFAULT = "Australia/Sydney";
  const books = {}; // spreadsheet id -> FakeBook
  let activeId = null;
  let nextSheetId = 5000;
  let props = {};
  const cache = {};

  // Any setter/formatting method we haven't written returns the object itself, so chains keep working.
  function chain(target) {
    let proxy;
    proxy = new Proxy(target, {
      get(obj, key) {
        if (key in obj) return obj[key];
        if (typeof key === "symbol" || key === "then") return undefined;
        if (/^(set|auto|hide|show|merge|protect|clear|add|apply|remove|activate|copy|build|require|with|on|after|at|every|use|toast|in|for|time|near|everyDays|everyHours|everyMinutes|everyWeeks)/.test(key)) {
          return function () { return proxy; };
        }
        return undefined;
      },
    });
    return proxy;
  }

  function blank(v) {
    return v === "" || v === null || v === undefined;
  }

  function copyCell(v) {
    return v instanceof Date ? new Date(v.getTime()) : blank(v) ? "" : v;
  }

  // ---- Sheets ---------------------------------------------------------------

  function FakeSheet(book, name, id) {
    this._book = book;
    this._name = name;
    this._id = id;
    this._v = [];
    this._maxRows = 1000;
    this._maxCols = 26;
    this._frozen = 0;
    this._tab = null;
    this._hidden = false;
  }
  FakeSheet.prototype = {
    getName() { return this._name; },
    setName(n) { this._name = String(n); return this._p; },
    getSheetId() { return this._id; },
    getParent() { return this._book._p; },
    getIndex() { return this._book._sheets.indexOf(this) + 1; },
    getLastRow() {
      let r = this._v.length;
      while (r > 0 && (this._v[r - 1] || []).every(blank)) r--;
      return r;
    },
    getLastColumn() {
      let m = 0;
      this._v.forEach((row) => {
        for (let c = row.length; c > m; c--) {
          if (!blank(row[c - 1])) { m = c; break; }
        }
      });
      return m;
    },
    getMaxRows() { return Math.max(this._maxRows, this._v.length); },
    getMaxColumns() { return Math.max(this._maxCols, this.getLastColumn()); },
    getFrozenRows() { return this._frozen; },
    setFrozenRows(n) { this._frozen = n; return this._p; },
    getTabColor() { return this._tab; },
    setTabColor(c) { this._tab = c; return this._p; },
    isSheetHidden() { return this._hidden; },
    hideSheet() { this._hidden = true; return this._p; },
    showSheet() { this._hidden = false; return this._p; },
    getRange(a, b, c, d) {
      if (typeof a === "string") return a1Range_(this, a);
      return rangeOf(this, a, b, c || 1, d || 1);
    },
    getDataRange() {
      return rangeOf(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
    },
    appendRow(values) {
      this._write(this.getLastRow() + 1, 1, [values]);
      return this._p;
    },
    deleteRow(r) { this._v.splice(r - 1, 1); return this._p; },
    deleteRows(r, n) { this._v.splice(r - 1, n); return this._p; },
    insertRowsAfter(r, n) {
      this._maxRows += n;
      if (r < this._v.length) this._v.splice(r, 0, ...Array.from({ length: n }, () => []));
      return this._p;
    },
    insertRowAfter(r) { return this.insertRowsAfter(r, 1); },
    insertRowsBefore(r, n) { return this.insertRowsAfter(r - 1, n); },
    insertRowBefore(r) { return this.insertRowsAfter(r - 1, 1); },
    insertColumnsAfter(c, n) {
      this._maxCols += n;
      this._v.forEach((row) => { if (c < row.length) row.splice(c, 0, ...Array(n).fill("")); });
      return this._p;
    },
    insertColumnAfter(c) { return this.insertColumnsAfter(c, 1); },
    insertColumnsBefore(c, n) { return this.insertColumnsAfter(c - 1, n); },
    insertColumnBefore(c) { return this.insertColumnsAfter(c - 1, 1); },
    deleteColumn(c) { this._v.forEach((row) => row.splice(c - 1, 1)); return this._p; },
    deleteColumns(c, n) { this._v.forEach((row) => row.splice(c - 1, n)); return this._p; },
    clear() { this._v = []; return this._p; },
    clearContents() { this._v = []; return this._p; },
    sort(col, ascending) {
      const head = this._v.slice(0, Math.max(1, this._frozen));
      const body = this._v.slice(head.length);
      const dir = ascending === false ? -1 : 1;
      body.sort((x, y) => {
        const a = x[col - 1], b = y[col - 1];
        return (a > b ? 1 : a < b ? -1 : 0) * dir;
      });
      this._v = head.concat(body);
      return this._p;
    },
    activate() { this._book._active = this; return this._p; },
    _read(r, c, nr, nc) {
      const out = [];
      for (let i = 0; i < nr; i++) {
        const row = this._v[r - 1 + i] || [];
        const line = [];
        for (let j = 0; j < nc; j++) line.push(copyCell(row[c - 1 + j]));
        out.push(line);
      }
      return out;
    },
    _write(r, c, values) {
      values.forEach((line, i) => {
        const at = r - 1 + i;
        while (this._v.length <= at) this._v.push([]);
        const row = this._v[at];
        line.forEach((v, j) => {
          while (row.length < c - 1 + j) row.push("");
          row[c - 1 + j] = copyCell(v);
        });
      });
      if (this._v.length > this._maxRows) this._maxRows = this._v.length;
    },
  };

  function a1Col_(letters) {
    let n = 0;
    for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  }

  function a1Range_(sheet, a1) {
    const ref = String(a1).replace(/^.*!/, "");
    const m = /^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/i.exec(ref);
    if (!m) throw new Error("Demo: can't read range " + a1);
    const c1 = a1Col_(m[1]);
    const r1 = m[2] ? Number(m[2]) : 1;
    const c2 = m[3] ? a1Col_(m[3]) : c1;
    const r2 = m[4] ? Number(m[4]) : m[3] ? sheet.getMaxRows() : r1;
    return rangeOf(sheet, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
  }

  function colLetters_(n) {
    let s = "";
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function rangeOf(sheet, r, c, nr, nc) {
    return chain({
      _s: sheet,
      getRow() { return r; },
      getColumn() { return c; },
      getLastRow() { return r + nr - 1; },
      getLastColumn() { return c + nc - 1; },
      getNumRows() { return nr; },
      getNumColumns() { return nc; },
      getSheet() { return sheet._p; },
      getA1Notation() { return colLetters_(c) + r + (nr > 1 || nc > 1 ? ":" + colLetters_(c + nc - 1) + (r + nr - 1) : ""); },
      getValues() { return sheet._read(r, c, nr, nc); },
      getValue() { return sheet._read(r, c, 1, 1)[0][0]; },
      getDisplayValues() { return sheet._read(r, c, nr, nc).map((row) => row.map(displayOf_)); },
      getDisplayValue() { return displayOf_(sheet._read(r, c, 1, 1)[0][0]); },
      getFormulas() { return sheet._read(r, c, nr, nc).map((row) => row.map((v) => (typeof v === "string" && v[0] === "=" ? v : ""))); },
      getFormula() { const v = sheet._read(r, c, 1, 1)[0][0]; return typeof v === "string" && v[0] === "=" ? v : ""; },
      getBackground() { return "#ffffff"; },
      getBackgrounds() { return sheet._read(r, c, nr, nc).map((row) => row.map(() => "#ffffff")); },
      getNumberFormat() { return "General"; },
      isBlank() { return sheet._read(r, c, nr, nc).every((row) => row.every(blank)); },
      setValues(values) {
        if (!Array.isArray(values) || values.length !== nr || values.some((row) => row.length !== nc)) {
          throw new Error("Demo: setValues size doesn't match the range");
        }
        sheet._write(r, c, values);
        return this;
      },
      setValue(v) {
        const rows = [];
        for (let i = 0; i < nr; i++) rows.push(Array(nc).fill(v));
        sheet._write(r, c, rows);
        return this;
      },
      setFormula(f) { return this.setValue(f); },
      clearContent() { return this.setValue(""); },
      clear() { return this.setValue(""); },
      offset(dr, dc, nr2, nc2) { return rangeOf(sheet, r + dr, c + dc, nr2 || nr, nc2 || nc); },
      createTextFinder(text) {
        const needle = String(text);
        return chain({
          findAll() {
            const out = [];
            sheet._read(r, c, nr, nc).forEach((row, i) => row.forEach((v, j) => {
              if (String(v).indexOf(needle) >= 0) out.push(rangeOf(sheet, r + i, c + j, 1, 1));
            }));
            return out;
          },
          findNext() { return this.findAll()[0] || null; },
        });
      },
    });
  }

  function displayOf_(v) {
    if (v instanceof Date) return formatDate_(v, TZ_DEFAULT, "d/M/yyyy");
    return blank(v) ? "" : String(v);
  }

  // ---- Spreadsheets ---------------------------------------------------------

  function FakeBook(id, name) {
    this._id = id;
    this._name = name;
    this._sheets = [];
    this._tz = TZ_DEFAULT;
    this._active = null;
    this._p = chain(this);
  }
  FakeBook.prototype = {
    getId() { return this._id; },
    getName() { return this._name; },
    rename(n) { this._name = n; },
    getUrl() { return "https://maxfit.now/#demo"; },
    getSpreadsheetTimeZone() { return this._tz; },
    setSpreadsheetTimeZone(tz) { this._tz = tz; },
    getSheets() { return this._sheets.map((s) => s._p); },
    getSheetByName(n) {
      const s = this._sheets.find((x) => x._name === n);
      return s ? s._p : null;
    },
    getSheetById(id) {
      const s = this._sheets.find((x) => x._id === Number(id));
      return s ? s._p : null;
    },
    insertSheet(name, index) {
      if (typeof name === "number") { index = name; name = undefined; }
      const sheetName = name || "Sheet" + (this._sheets.length + 1);
      if (this.getSheetByName(sheetName)) throw new Error("A sheet named " + sheetName + " already exists.");
      const s = makeSheet_(this, sheetName);
      if (typeof index === "number") this._sheets.splice(index, 0, s);
      else this._sheets.push(s);
      return s._p;
    },
    deleteSheet(p) {
      const i = this._sheets.findIndex((s) => s._p === p || s._id === p.getSheetId());
      if (i >= 0) this._sheets.splice(i, 1);
    },
    setActiveSheet(p) {
      this._active = this._sheets.find((s) => s._p === p) || this._active;
      return p;
    },
    getActiveSheet() { return (this._active || this._sheets[0])._p; },
    moveActiveSheet(pos) {
      const s = this._active;
      if (!s) return;
      this._sheets.splice(this._sheets.indexOf(s), 1);
      this._sheets.splice(Math.max(0, pos - 1), 0, s);
    },
    getNumSheets() { return this._sheets.length; },
  };

  function makeSheet_(book, name, id) {
    const s = new FakeSheet(book, name, id || nextSheetId++);
    s._p = chain(s);
    return s;
  }

  function newBook_(name, id) {
    const bookId = id || "demo-" + Object.keys(books).length + "-" + Math.random().toString(36).slice(2, 8);
    const b = new FakeBook(bookId, name);
    books[bookId] = b;
    return b;
  }

  // ---- Dates ----------------------------------------------------------------

  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function partsIn_(date, tz) {
    const f = new Intl.DateTimeFormat("en-AU", {
      timeZone: tz || TZ_DEFAULT,
      year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
      weekday: "short", hourCycle: "h23",
    });
    const out = {};
    f.formatToParts(date).forEach((p) => { out[p.type] = p.value; });
    const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(out.weekday);
    // Offset from UTC, in minutes, for Z / XXX.
    const asUtc = Date.UTC(+out.year, +out.month - 1, +out.day, +out.hour, +out.minute, +out.second);
    return {
      y: +out.year, M: +out.month, d: +out.day, H: +out.hour, m: +out.minute, s: +out.second,
      wd: wd, offset: Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000),
    };
  }

  function pad(n, w) {
    return String(n).padStart(w, "0");
  }

  function formatDate_(date, tz, fmt) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) throw new Error("Demo: formatDate got an invalid date");
    const p = partsIn_(d, tz);
    let out = "";
    let i = 0;
    while (i < fmt.length) {
      const ch = fmt[i];
      if (ch === "'") {
        const end = fmt.indexOf("'", i + 1);
        if (end === i + 1) { out += "'"; i += 2; continue; }
        out += fmt.slice(i + 1, end < 0 ? fmt.length : end);
        i = end < 0 ? fmt.length : end + 1;
        continue;
      }
      let j = i;
      while (j < fmt.length && fmt[j] === ch) j++;
      const n = j - i;
      i = j;
      switch (ch) {
        case "y": out += n === 2 ? pad(p.y % 100, 2) : String(p.y); break;
        case "M": out += n >= 4 ? MONTHS[p.M - 1] : n === 3 ? MONTHS[p.M - 1].slice(0, 3) : pad(p.M, n); break;
        case "d": out += pad(p.d, n); break;
        case "H": out += pad(p.H, n); break;
        case "h": out += pad(p.H % 12 || 12, n); break;
        case "m": out += pad(p.m, n); break;
        case "s": out += pad(p.s, n); break;
        case "S": out += pad(d.getMilliseconds(), n); break;
        case "a": out += p.H < 12 ? "AM" : "PM"; break;
        case "E": out += n >= 4 ? DAYS[p.wd] : DAYS[p.wd].slice(0, 3); break;
        case "u": out += String(p.wd || 7); break;
        case "Z": {
          const o = p.offset, sign = o < 0 ? "-" : "+", a = Math.abs(o);
          out += sign + pad(Math.floor(a / 60), 2) + pad(a % 60, 2);
          break;
        }
        case "X": {
          const o = p.offset, sign = o < 0 ? "-" : "+", a = Math.abs(o);
          out += sign + pad(Math.floor(a / 60), 2) + (n >= 3 ? ":" : "") + pad(a % 60, 2);
          break;
        }
        default: out += ch.repeat(n);
      }
    }
    return out;
  }

  /** Enough of Utilities.parseDate for "yyyy-MM-dd HH:mm(:ss)" style patterns. */
  function parseDate_(text, tz, fmt) {
    const nums = String(text).match(/\d+/g) || [];
    const order = (fmt.match(/y+|M+|d+|H+|m+|s+/g) || []).map((t) => t[0]);
    const v = { y: 1970, M: 1, d: 1, H: 0, m: 0, s: 0 };
    order.forEach((k, i) => { if (nums[i] !== undefined) v[k] = Number(nums[i]); });
    // Treat the fields as wall-clock time in tz.
    const guess = new Date(Date.UTC(v.y, v.M - 1, v.d, v.H, v.m, v.s));
    const off = partsIn_(guess, tz).offset;
    return new Date(guess.getTime() - off * 60000);
  }

  // ---- Services -------------------------------------------------------------

  const lock = { waitLock() {}, tryLock() { return true; }, releaseLock() {}, hasLock() { return true; } };

  const store = {
    getProperty(k) { return Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null; },
    setProperty(k, v) { props[k] = String(v); return store; },
    deleteProperty(k) { delete props[k]; return store; },
    getProperties() { return Object.assign({}, props); },
    setProperties(obj, deleteOthers) {
      if (deleteOthers) props = {};
      Object.keys(obj || {}).forEach((k) => { props[k] = String(obj[k]); });
      return store;
    },
    getKeys() { return Object.keys(props); },
  };

  const scriptCache = {
    get(k) { const e = cache[k]; return e && e.until > Date.now() ? e.v : null; },
    put(k, v, secs) { cache[k] = { v: String(v), until: Date.now() + (secs || 600) * 1000 }; },
    remove(k) { delete cache[k]; },
    getAll(keys) {
      const out = {};
      (keys || []).forEach((k) => { const v = scriptCache.get(k); if (v !== null) out[k] = v; });
      return out;
    },
    putAll(obj, secs) { Object.keys(obj || {}).forEach((k) => scriptCache.put(k, obj[k], secs)); },
    removeAll(keys) { (keys || []).forEach((k) => delete cache[k]); },
  };

  g.SpreadsheetApp = chain({
    getActiveSpreadsheet() { return activeId ? books[activeId]._p : null; },
    getActive() { return this.getActiveSpreadsheet(); },
    openById(id) {
      if (!books[id]) throw new Error("Demo: no spreadsheet " + id);
      return books[id]._p;
    },
    create(name) {
      const b = newBook_(name);
      b._sheets.push(makeSheet_(b, "Sheet1"));
      return b._p;
    },
    flush() {},
    newDataValidation() { return chain({}); },
    newRichTextValue() { return chain({}); },
    newConditionalFormatRule() { return chain({}); },
    WrapStrategy: {}, BorderStyle: {}, DataValidationCriteria: {}, ProtectionType: {},
  });

  g.PropertiesService = {
    getScriptProperties() { return store; },
    getUserProperties() { return store; },
    getDocumentProperties() { return store; },
  };
  g.CacheService = { getScriptCache() { return scriptCache; }, getUserCache() { return scriptCache; }, getDocumentCache() { return scriptCache; } };
  g.LockService = { getScriptLock() { return lock; }, getDocumentLock() { return lock; }, getUserLock() { return lock; } };

  g.Utilities = {
    formatDate: formatDate_,
    parseDate: parseDate_,
    getUuid() { return crypto.randomUUID(); },
    sleep() {},
    newBlob(data, type, name) {
      return chain({ getDataAsString() { return String(data); }, getBytes() { return []; }, getContentType() { return type || ""; }, getName() { return name || ""; } });
    },
    base64Encode(s) { return btoa(unescape(encodeURIComponent(String(s)))); },
    base64EncodeWebSafe(s) { return g.Utilities.base64Encode(s).replace(/\+/g, "-").replace(/\//g, "_"); },
    computeDigest() { return []; },
    computeHmacSha256Signature() { return []; },
    DigestAlgorithm: {}, Charset: {},
  };

  g.Session = {
    getScriptTimeZone() { return TZ_DEFAULT; },
    getActiveUser() { return { getEmail() { return ""; } }; },
    getEffectiveUser() { return { getEmail() { return ""; } }; },
    getTemporaryActiveUserKey() { return "demo"; },
  };

  g.MailApp = { sendEmail() {}, getRemainingDailyQuota() { return 100; } };
  g.GmailApp = { sendEmail() {} };

  g.ScriptApp = chain({
    getProjectTriggers() { return []; },
    newTrigger() { return chain({}); },
    deleteTrigger() {},
    getService() { return { getUrl() { return "https://maxfit.now/#demo"; } }; },
    WeekDay: { MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6, SUNDAY: 7 },
    AuthMode: {},
  });

  // The calendar is empty: no busy times, and new events go nowhere.
  const calendar = chain({
    getEvents() { return []; },
    getEventById() { return null; },
    createEvent() { return chain({ getId() { return "demo-event"; } }); },
  });
  g.CalendarApp = chain({ getDefaultCalendar() { return calendar; }, getCalendarById() { return calendar; } });

  g.ContentService = {
    MimeType: { JSON: "json", TEXT: "text" },
    createTextOutput(text) {
      const out = { _t: String(text == null ? "" : text) };
      out.setMimeType = () => out;
      out.getContent = () => out._t;
      return out;
    },
  };

  g.HtmlService = chain({ createHtmlOutput(h) { return chain({ getContent() { return String(h || ""); } }); } });

  g.Logger = { log() {}, clear() {}, getLog() { return ""; } };

  // Outbound calls (Claude, Open Food Facts, Stripe) are answered by the demo, never sent.
  g.UrlFetchApp = {
    fetch(url, opts) {
      const ans = g.__demoUrlFetch ? g.__demoUrlFetch(String(url), opts || {}) : { status: 503, body: "{}" };
      return {
        getResponseCode() { return ans.status; },
        getContentText() { return ans.body; },
        getHeaders() { return {}; },
        getAllHeaders() { return {}; },
        getBlob() { return g.Utilities.newBlob(ans.body); },
      };
    },
    fetchAll(reqs) { return reqs.map((r) => g.UrlFetchApp.fetch(r.url || r, r)); },
  };

  // ---- Demo-only helpers ----------------------------------------------------

  g.GasFake = {
    /** A new in-memory spreadsheet; active: true makes it the CRM (getActiveSpreadsheet). */
    newSpreadsheet(name, active) {
      const b = newBook_(name);
      if (active) activeId = b._id;
      return b._p;
    },
    /** Adds a tab with a fixed gid (the card reads "Sessions Remaining" by gid). */
    insertSheetWithId(ssProxy, name, id) {
      const b = books[ssProxy.getId()];
      const s = makeSheet_(b, name, id);
      b._sheets.push(s);
      return s._p;
    },
    formatDate: formatDate_,
    /** Everything, as plain JSON (dates marked), for keeping between pages. */
    snapshot() {
      const enc = (v) => (v instanceof Date ? { $d: v.getTime() } : v);
      return {
        activeId: activeId,
        nextSheetId: nextSheetId,
        props: props,
        books: Object.keys(books).map((id) => ({
          id: id,
          name: books[id]._name,
          sheets: books[id]._sheets.map((s) => ({
            name: s._name, id: s._id, frozen: s._frozen, tab: s._tab, maxRows: s._maxRows,
            v: s._v.map((row) => row.map(enc)),
          })),
        })),
      };
    },
    restore(snap) {
      const dec = (v) => (v && typeof v === "object" && "$d" in v ? new Date(v.$d) : v);
      Object.keys(books).forEach((k) => delete books[k]);
      activeId = snap.activeId;
      nextSheetId = snap.nextSheetId || nextSheetId;
      props = snap.props || {};
      (snap.books || []).forEach((sb) => {
        const b = newBook_(sb.name, sb.id);
        sb.sheets.forEach((ss) => {
          const s = makeSheet_(b, ss.name, ss.id);
          s._frozen = ss.frozen || 0;
          s._tab = ss.tab || null;
          s._maxRows = ss.maxRows || 1000;
          s._v = ss.v.map((row) => row.map(dec));
          b._sheets.push(s);
        });
      });
    },
    /** One tab, by gid or by name, as the CSV Google's export would give the card. */
    csv(query) {
      let sheet = null;
      Object.keys(books).some((id) => {
        sheet = books[id]._sheets.find((s) => (query.gid ? String(s._id) === String(query.gid) : s._name === query.name)) || null;
        return !!sheet;
      });
      if (!sheet) return null;
      const width = sheet.getLastColumn();
      const rows = sheet._read(1, 1, sheet.getLastRow(), width);
      const cell = (v) => {
        let t;
        if (v instanceof Date) {
          const full = formatDate_(v, TZ_DEFAULT, "yyyy-MM-dd HH:mm:ss");
          t = full.slice(11) === "00:00:00" ? full.slice(0, 10) : formatDate_(v, TZ_DEFAULT, "dd/MM/yyyy HH:mm:ss");
        } else t = blank(v) ? "" : String(v);
        return query.quoteAll || /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
      };
      return rows.map((row) => row.map(cell).join(",")).join("\n");
    },
  };
})(self);
