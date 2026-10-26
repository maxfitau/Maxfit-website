/*
 * First-launch tour (2026-10-26) — a short, skippable walkthrough shown once
 * per client per phone, the first time they open their real card (never the
 * demo card). Self-mounting like bottom-nav.js/exercise-picker.js: no host
 * markup needed beyond an optional #replayTourLink to wire up a "watch it
 * again" link, if the page has one.
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
    train: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h16M4 9v6M8 7v10M16 7v10M20 9v6"/></svg>',
    muscles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 20c0-4 1-6 3-7-2-2-2-5 1-7 1 2 3 2 4 0 3 2 3 5 1 7 2 1 3 3 3 7"/></svg>',
    macros: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c-1 3-5 5-5 10a5 5 0 0 0 10 0c0-2-1-3-2-2 .5 2-1 3-2 2-1.5-1-1-5-1-10z"/></svg>',
    profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>',
  };

  // Copy confirmed with Max 2026-10-26 — don't reword without checking with
  // him, this is his coaching voice, not boilerplate UI text.
  const STEPS = [
    {
      icon: "wave",
      eyebrow: "Welcome",
      headline: "Hey, I'm glad you're here",
      html: "This is your MaxFit card — everything for your training lives here. Takes about 30 seconds to show you around.",
      next: "Let's go",
    },
    {
      icon: "train",
      eyebrow: "Train",
      headline: "Log Every Set",
      html: 'Each session, log the weight and reps for every set. Here’s why it matters: <b>to build muscle, you need to gradually lift a little more over time</b> — that’s called progressive overload. Logging is how you (and I) can actually see it happening, set by set.',
    },
    {
      icon: "muscles",
      eyebrow: "Muscles",
      headline: "See What You're Training",
      html: "A figure that lights up red for every muscle you've worked this week — primary muscles bright, secondary muscles lighter. A quick gut-check that nothing's being missed.",
    },
    {
      icon: "macros",
      eyebrow: "Macros",
      headline: "Fuel the Work You're Putting In",
      html: "Snap a photo of a meal or scan a barcode and it's logged. Training builds the signal to grow — <b>what you eat is what you actually grow with</b>.",
    },
    {
      icon: "profile",
      eyebrow: "Profile",
      headline: "Everything Else, One Tap Away",
      html: "Sessions left, your loyalty card, check-in QR code, and booking your next session — all right here on your home screen.",
    },
    {
      icon: "check",
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

  /** Renders the tour overlay and steps through it. Calls onDone (if given) once it's closed, whether by finishing or skipping. */
  function show(onDone) {
    let i = 0;

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

    const body = document.createElement("div");
    body.className = "tour__body";

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
    overlay.appendChild(body);
    overlay.appendChild(bottom);
    document.body.appendChild(overlay);

    function close() {
      markSeen();
      overlay.remove();
      if (typeof onDone === "function") onDone();
    }

    function render() {
      const s = STEPS[i];
      dots.innerHTML = "";
      STEPS.forEach((_, idx) => {
        const d = document.createElement("span");
        d.className = "tour__dot" + (idx === i ? " is-active" : "");
        dots.appendChild(d);
      });

      body.innerHTML = "";
      const icon = document.createElement("div");
      icon.className = "tour__icon";
      icon.innerHTML = ICONS[s.icon];
      const eyebrow = document.createElement("p");
      eyebrow.className = "tour__eyebrow";
      eyebrow.textContent = s.eyebrow;
      const headline = document.createElement("h1");
      headline.className = "tour__headline";
      headline.textContent = s.headline;
      const text = document.createElement("p");
      text.className = "tour__text";
      text.innerHTML = s.html; // fixed copy written here, never user/sheet input
      body.appendChild(icon);
      body.appendChild(eyebrow);
      body.appendChild(headline);
      body.appendChild(text);

      back.hidden = i === 0;
      next.textContent = s.next || "Next";
      skip.hidden = i === STEPS.length - 1;
    }

    next.addEventListener("click", () => {
      if (i < STEPS.length - 1) {
        i++;
        render();
      } else {
        close();
      }
    });
    back.addEventListener("click", () => {
      if (i > 0) {
        i--;
        render();
      }
    });
    skip.addEventListener("click", close);

    render();
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
