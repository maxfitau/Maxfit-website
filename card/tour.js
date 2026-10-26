/*
 * First-launch tour (2026-10-26, reworked same day to spotlight real
 * elements) — a short, skippable walkthrough shown once per client per
 * phone, the first time they open their real card (never the demo card).
 * Self-mounting like bottom-nav.js/exercise-picker.js: no host markup
 * needed beyond an optional #replayTourLink to wire up a "watch it again"
 * link, if the page has one.
 *
 * Most steps point at a REAL element already on the page (a card tile, a
 * bottom-nav icon) rather than describing it in the abstract — Max's call,
 * so a client can actually see where each thing lives, not just read about
 * it. The step dims the rest of the page and lifts that one element above
 * the dim layer (z-index + a glow ring, not a cut-out mask — simpler, and
 * the element never leaves its real on-page position, so what you're
 * shown is exactly where you'll find it afterwards), with a small callout
 * card pointing at it. Welcome/closing have no target and use the plain
 * centered layout, since there's nothing specific to point at yet.
 *
 * Sequencing: app.js calls Tour.show() in place of starting the week
 * recap/goal popup (WeekCard.init) for a first-time client, and only starts
 * WeekCard once the tour is dismissed — otherwise the two full-screen
 * takeovers could show at once. A returning client (already seen it) skips
 * straight to WeekCard.init as before; nothing changes for them.
 */
(function () {
  const SEEN_KEY = "maxfitTourSeen";

  const ICONS = {
    wave: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 11c1-4 3-6 3-9 2 1 2 4 1 6 2-1 4 0 4 2 2 0 3 1 3 3 0 4-3 7-7 7-4 0-6-3-6-6 0-1 1-2 2-3z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>',
  };

  // Copy confirmed with Max 2026-10-26 — don't reword without checking with
  // him, this is his coaching voice, not boilerplate UI text. The three
  // nav-icon steps (Train/Muscles/Macros) carry his approved copy verbatim;
  // only the `target` selectors were added when the tour was reworked to
  // spotlight real elements, same day.
  //
  // `target` is a selector resolved fresh each time that step renders (not
  // cached), since bottom-nav mounts after tour.js loads and book/refer
  // tiles start out hidden until app.js unhides them for a real member —
  // by the time Tour.show() actually runs (after that same real-member
  // block), they're all in the DOM and visible, but resolving late is
  // simply safer than assuming a load order.
  //
  // `.bottom-nav__item:nth-of-type(N)` depends on bottom-nav.js's item
  // order (Profile, Train, Muscles, Macros — "Max's own convention for
  // where home sits", per that file's comments). If that order ever
  // changes, update the N here to match.
  const STEPS = [
    {
      eyebrow: "Welcome",
      headline: "Hey, I'm glad you're here",
      html: "This is your MaxFit card — everything for your training lives here. Let's take a quick look around at where things are.",
      next: "Let's go",
    },
    {
      target: () => document.querySelector(".bottom-nav__item:nth-of-type(2)"),
      eyebrow: "Train",
      headline: "Log Every Set",
      html: 'Each session, log the weight and reps for every set. Here’s why it matters: <b>to build muscle, you need to gradually lift a little more over time</b> — that’s called progressive overload. Logging is how you (and I) can actually see it happening, set by set.',
    },
    {
      target: () => document.querySelector(".bottom-nav__item:nth-of-type(3)"),
      eyebrow: "Muscles",
      headline: "See What You're Training",
      html: "A figure that lights up red for every muscle you've worked this week — primary muscles bright, secondary muscles lighter. A quick gut-check that nothing's being missed.",
    },
    {
      target: () => document.querySelector(".bottom-nav__item:nth-of-type(4)"),
      eyebrow: "Macros",
      headline: "Fuel the Work You're Putting In",
      html: "Snap a photo of a meal or scan a barcode and it's logged. Training builds the signal to grow — <b>what you eat is what you actually grow with</b>.",
    },
    {
      target: () => document.getElementById("checkinTile"),
      eyebrow: "Check In",
      headline: "Show This When You Arrive",
      html: "Tap here to pull up your QR code — scan it and you're checked in.",
    },
    {
      target: () => document.getElementById("bookLink"),
      eyebrow: "1-on-1 Sessions",
      headline: "Book Straight From Here",
      html: "See your real open times and book a session, any time — no need to text me for it.",
    },
    {
      target: () => document.getElementById("referLink"),
      eyebrow: "Refer a Friend",
      headline: "Know Someone Who'd Love This?",
      html: "Your own link and QR code — send it on, and you'll both benefit.",
    },
    {
      target: () => document.querySelector(".card__loyalty"),
      eyebrow: "Loyalty",
      headline: "Every Session Counts",
      html: "This fills up with every paid session — <b>the 10th one's on me</b>.",
    },
    {
      eyebrow: "All set",
      headline: "You're Ready",
      html: "That's the whole tour. Jump in — and you can always find this again from your Profile if you want a refresher.",
      next: "Get started",
    },
  ];

  function hasSeen() {
    try {
      return localStorage.getItem(SEEN_KEY) === "1";
    } catch (err) {
      return false; // storage unavailable — treat as not-seen rather than crash; worst case it shows every time on that device
    }
  }

  function markSeen() {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch (err) {
      // Ignore — it'll just show again next time on this device.
    }
  }

  function reducedMotion_() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /** Renders the tour overlay and steps through it. Calls onDone (if given) once it's closed, whether by finishing or skipping. Steps whose target can't be found on this page (layout changed, element genuinely missing) are skipped automatically rather than shown pointing at nothing. */
  function show(onDone) {
    let i = 0;
    let spotlighted = null; // the real page element currently lifted above the dim layer, if any

    const overlay = document.createElement("div");
    overlay.className = "tour";

    const top = document.createElement("div");
    top.className = "tour__top";
    const dots = document.createElement("div");
    dots.className = "tour__dots";
    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "tour__skip";
    skip.textContent = "Skip";
    top.appendChild(dots);
    top.appendChild(skip);

    const card = document.createElement("div");
    card.className = "tour__card";

    const bottom = document.createElement("div");
    bottom.className = "tour__bottom";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "tour__back";
    back.setAttribute("aria-label", "Back");
    back.textContent = "←";
    const next = document.createElement("button");
    next.type = "button";
    next.className = "tour__next";
    bottom.appendChild(back);
    bottom.appendChild(next);

    overlay.appendChild(top);
    overlay.appendChild(card);
    overlay.appendChild(bottom);
    document.body.appendChild(overlay);

    function unspotlight() {
      if (spotlighted) {
        spotlighted.classList.remove("tour-spotlight-target");
        spotlighted = null;
      }
    }

    function close() {
      unspotlight();
      markSeen();
      overlay.remove();
      if (typeof onDone === "function") onDone();
    }

    /** Places `card` near `rect` (a target's bounding box), below if there's room, above otherwise, clamped so it never runs off-screen. */
    function positionCard(rect) {
      card.classList.add("tour__card--pointing");
      overlay.classList.add("tour--spotlight");
      // Measure after it's in the DOM and visible, so offsetHeight is real.
      const margin = 14;
      const cardH = card.offsetHeight;
      const cardW = card.offsetWidth;
      const spaceBelow = window.innerHeight - rect.bottom;
      const below = spaceBelow >= cardH + margin + 20 || spaceBelow >= rect.top;
      card.classList.toggle("tour__card--below", below);
      card.classList.toggle("tour__card--above", !below);
      const top = below ? rect.bottom + margin : rect.top - margin - cardH;
      let left = rect.left + rect.width / 2 - cardW / 2;
      left = Math.max(16, Math.min(left, window.innerWidth - cardW - 16));
      card.style.top = Math.max(16, Math.min(top, window.innerHeight - cardH - 16)) + "px";
      card.style.left = left + "px";
      // The little arrow points at the target's horizontal centre, wherever that lands relative to the (possibly clamped) card.
      const arrowLeft = Math.max(16, Math.min(rect.left + rect.width / 2 - left, cardW - 16));
      card.style.setProperty("--tour-arrow-left", arrowLeft + "px");
    }

    function renderStep() {
      const s = STEPS[i];
      unspotlight();
      overlay.classList.remove("tour--spotlight");
      card.classList.remove("tour__card--below", "tour__card--above", "tour__card--pointing");
      card.style.top = "";
      card.style.left = "";

      dots.innerHTML = "";
      STEPS.forEach((_, idx) => {
        const d = document.createElement("span");
        d.className = "tour__dot" + (idx === i ? " is-active" : "");
        dots.appendChild(d);
      });

      card.innerHTML = "";
      if (!s.target) {
        const icon = document.createElement("div");
        icon.className = "tour__icon";
        icon.innerHTML = ICONS[i === 0 ? "wave" : "check"];
        card.appendChild(icon);
      }
      const eyebrow = document.createElement("p");
      eyebrow.className = "tour__eyebrow";
      eyebrow.textContent = s.eyebrow;
      const headline = document.createElement("h1");
      headline.className = "tour__headline";
      headline.textContent = s.headline;
      const text = document.createElement("p");
      text.className = "tour__text";
      text.innerHTML = s.html; // fixed copy written here, never user/sheet input
      card.appendChild(eyebrow);
      card.appendChild(headline);
      card.appendChild(text);

      back.hidden = i === 0;
      next.textContent = s.next || "Next";
      skip.hidden = i === STEPS.length - 1;

      const el = s.target ? s.target() : null;
      if (s.target && !el) {
        // This client's page doesn't have this element right now (e.g. a
        // tile stayed hidden for some reason) — don't point at nothing,
        // just move past it in whichever direction got us here.
        advance(lastDirection);
        return;
      }
      if (!el) return; // welcome/closing — plain centered card, nothing more to do

      el.classList.add("tour-spotlight-target");
      spotlighted = el;
      el.scrollIntoView({ behavior: reducedMotion_() ? "auto" : "smooth", block: "center" });
      // Position after the scroll has (roughly) settled — smooth scrolling
      // has no reliable "done" event, so this is a pragmatic fixed delay
      // rather than something exact; a frame or two late just means the
      // callout animates into its final spot instead of landing instantly,
      // not a visible bug.
      setTimeout(() => positionCard(el.getBoundingClientRect()), reducedMotion_() ? 0 : 320);
    }

    let lastDirection = 1;
    function advance(direction) {
      lastDirection = direction;
      const nextIndex = i + direction;
      if (nextIndex < 0) return; // can't go back past the first step
      if (nextIndex >= STEPS.length) {
        close();
        return;
      }
      i = nextIndex;
      renderStep();
    }

    next.addEventListener("click", () => {
      if (i < STEPS.length - 1) advance(1);
      else close();
    });
    back.addEventListener("click", () => advance(-1));
    skip.addEventListener("click", close);
    window.addEventListener("resize", () => {
      if (spotlighted) positionCard(spotlighted.getBoundingClientRect());
    });

    renderStep();
  }

  window.Tour = { hasSeen: hasSeen, show: show };

  // Wire up an optional "watch it again" link, if this page has one. With
  // this script deferred, the DOM is usually already parsed by the time
  // this runs — DOMContentLoaded may have already fired, so check
  // readyState rather than just listening for it (same pattern as
  // bottom-nav.js's own mount()).
  function wireReplay() {
    const replay = document.getElementById("replayTourLink");
    if (replay) replay.addEventListener("click", () => show());
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireReplay);
  } else {
    wireReplay();
  }
})();
