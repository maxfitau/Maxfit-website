/* "Leave a review" section.

   - With an apiUrl (js/reviews-config.js): a review form that saves to the
     private reviews sheet, plus the list of reviews Max has approved.
   - With a googleUrl: after sending, EVERY reviewer (whatever their star
     rating) is offered a button that copies their text and opens Google's own
     review page. Google only lets the reviewer post their own review, so
     that is the closest legitimate way to get reviews onto the Business
     Profile. Never show that step only to happy customers: Google bans it.
   - With neither, the section stays hidden.

   Everything from the server is put on the page with textContent, never
   innerHTML, so a review can't inject markup. */
document.addEventListener("DOMContentLoaded", function () {
  var section = document.getElementById("reviews");
  if (!section) return;

  var cfg = window.MAXFIT_REVIEWS || {};
  var apiUrl = httpsOnly(cfg.apiUrl);
  var googleUrl = httpsOnly(cfg.googleUrl);
  if (!apiUrl && !googleUrl) return; // not set up yet, stay hidden

  var NAME_MAX = 40;
  var TEXT_MIN = 10;
  var TEXT_MAX = 600;
  var PAGE_SIZE = 6;

  var form = document.getElementById("reviewForm");
  var thanks = document.getElementById("reviewThanks");
  var thanksName = document.getElementById("reviewThanksName");
  var googleStep = document.getElementById("reviewGoogleStep");
  var googleBtn = document.getElementById("reviewGoogleBtn");
  var googleHint = document.getElementById("reviewGoogleHint");
  var copyBox = document.getElementById("reviewCopy");
  var direct = document.getElementById("reviewGoogleOnly");
  var directBtn = document.getElementById("reviewGoogleDirect");
  var readCol = document.getElementById("reviewsRead");
  var list = document.getElementById("reviewsList");
  var more = document.getElementById("reviewsMore");
  var empty = document.getElementById("reviewsEmpty");
  var errorEl = document.getElementById("reviewError");
  var submitBtn = document.getElementById("reviewSubmit");
  var counter = document.getElementById("reviewCount");

  function httpsOnly(u) {
    u = String(u || "").trim();
    return /^https:\/\//i.test(u) ? u : "";
  }

  function show(el, on) {
    if (el) el.hidden = !on;
  }

  // ---------------------------------------------------------------- Google
  if (googleUrl) {
    directBtn.href = googleUrl;
    googleBtn.href = googleUrl;
    show(direct, true);
  }

  // ------------------------------------------------------------ Write side
  var startedAt = Date.now();
  var lastText = "";

  if (apiUrl) {
    show(form, true);
    section.classList.add("has-form");

    var textArea = form.elements.text;
    var updateCount = function () {
      counter.textContent = textArea.value.length + " / " + TEXT_MAX;
    };
    textArea.addEventListener("input", updateCount);
    updateCount();

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      showError("");

      var rating = form.querySelector('input[name="rating"]:checked');
      var name = clean(form.elements.name.value);
      var text = form.elements.text.value.trim();
      var consent = form.elements.consent.checked;

      var problem = null;
      if (!rating) problem = ["Please choose a star rating.", form.querySelector('input[name="rating"]')];
      else if (!name) problem = ["Please add your name. First name and last initial is fine.", form.elements.name];
      else if (text.length < TEXT_MIN) problem = ["Please write a little more, at least " + TEXT_MIN + " characters.", form.elements.text];
      else if (text.length > TEXT_MAX) problem = ["That's a bit long. Please keep it under " + TEXT_MAX + " characters.", form.elements.text];
      else if (!consent) problem = ["Please tick the box so we can show your review.", form.elements.consent];
      if (problem) {
        showError(problem[0]);
        if (problem[1]) problem[1].focus();
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Sending...";

      fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // no CORS preflight
        body: JSON.stringify({
          action: "submitReview",
          name: name,
          rating: Number(rating.value),
          text: text,
          consent: true,
          website: form.elements.website.value, // honeypot, people never fill it
          elapsedMs: Date.now() - startedAt
        })
      })
        .then(function (res) { return res.json(); })
        .then(function (result) {
          if (result && result.ok) {
            done(name, text);
          } else {
            fail((result && result.message) || "Something went wrong. Please try again.");
          }
        })
        .catch(function () {
          fail("Couldn't send your review. Check your connection and try again.");
        });
    });
  }

  function fail(message) {
    showError(message);
    submitBtn.disabled = false;
    submitBtn.textContent = "Send review";
  }

  function done(name, text) {
    lastText = text;
    thanksName.textContent = " " + name.split(" ")[0];
    show(form, false);
    show(direct, false); // the thank-you panel has its own Google step
    if (googleUrl) {
      copyBox.textContent = text;
      show(googleStep, true);
    }
    show(thanks, true);
    thanks.focus();
  }

  function showError(message) {
    errorEl.textContent = message;
    show(errorEl, !!message);
  }

  // Copy the review as the Google link opens (a plain link, so pop-up
  // blockers never get in the way). If copying isn't allowed, the text is
  // shown right there to copy by hand.
  if (googleBtn) {
    googleBtn.addEventListener("click", function () {
      copyToClipboard(lastText).then(function (ok) {
        googleHint.textContent = ok
          ? "Copied! On Google, paste it into the box (Cmd+V, or press and hold then tap Paste) and tap Post."
          : "On Google, paste your review into the box and tap Post. Your review is below to copy.";
      });
    });
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return legacyCopy(); }
      );
    }
    return Promise.resolve(legacyCopy());
  }

  function legacyCopy() {
    try {
      var range = document.createRange();
      range.selectNodeContents(copyBox);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return document.execCommand("copy");
    } catch (err) {
      return false;
    }
  }

  // ------------------------------------------------------------- Read side
  var all = [];
  var shown = 0;

  if (apiUrl) {
    fetch(apiUrl + (apiUrl.indexOf("?") > -1 ? "&" : "?") + "action=reviews")
      .then(function (res) { return res.json(); })
      .then(function (result) {
        all = result && result.ok && Array.isArray(result.reviews) ? result.reviews : [];
        show(readCol, true);
        show(empty, all.length === 0);
        showMore();
      })
      .catch(function () {
        // Can't load the list: the form still works, so just leave it out.
      });

    more.addEventListener("click", showMore);
  }

  function showMore() {
    var next = all.slice(shown, shown + PAGE_SIZE);
    next.forEach(function (r) { list.appendChild(card(r)); });
    shown += next.length;
    show(more, shown < all.length);
  }

  function card(r) {
    var el = document.createElement("article");
    el.className = "review-card";

    var stars = document.createElement("div");
    stars.className = "review-card__stars";
    stars.setAttribute("role", "img");
    stars.setAttribute("aria-label", r.rating + " out of 5 stars");
    for (var i = 1; i <= 5; i++) stars.appendChild(starSvg(i <= r.rating));
    el.appendChild(stars);

    var p = document.createElement("p");
    p.className = "review-card__text";
    p.textContent = String(r.text || "");
    el.appendChild(p);

    var meta = document.createElement("p");
    meta.className = "review-card__meta";
    meta.textContent = String(r.name || "") + (r.date ? "  ·  " + r.date : "");
    el.appendChild(meta);
    return el;
  }

  function starSvg(filled) {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    if (filled) svg.setAttribute("class", "is-filled");
    var path = document.createElementNS(ns, "path");
    path.setAttribute("d", "M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.6 6.1 20.7l1.2-6.6L2.5 9.6l6.6-.9z");
    svg.appendChild(path);
    return svg;
  }

  function clean(s) {
    return String(s || "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  }

  // Reveal only now that something is configured and wired up.
  section.hidden = false;
});
