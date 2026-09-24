/* 01 · Hero — split headline reveals once on load (SplitText, masked
   lines, staggered). The video plays as a normal small, looping card
   (see .hero__showcase in styles.css) — no scroll-scrub to full-bleed.
   That technique was dropped: scrubbing intro.mp4's playback time to
   scroll position could land on an arbitrary, confusing frame, and it
   pinned the whole section for an extra scroll of empty distance.

   Fails safe: if GSAP/SplitText didn't load, or the required elements
   aren't on the page, this does nothing and the plain CSS layout
   (everything simply visible, video autoplaying via its own HTML
   attributes) stands on its own. */
document.addEventListener("DOMContentLoaded", function () {
  if (!window.MaxFitAnim || !window.MaxFitAnim.ready) return;
  if (typeof SplitText === "undefined") return;

  var hero = document.getElementById("hero");
  if (!hero) return;

  // SplitText measures rendered line breaks, so it must run after the
  // Barlow Condensed web font has actually swapped in — otherwise it
  // splits against the fallback font's metrics and the "lines" can be
  // wrong once the real font loads (GSAP's own documented gotcha).
  // document.fonts.ready alone can resolve before a <link>-loaded
  // Google Font has even started fetching (fonts load lazily, on first
  // use), so explicitly load the exact weight this headline uses too.
  var fontsReady = document.fonts
    ? Promise.all([
        document.fonts.ready,
        document.fonts.load('800 1em "Barlow Condensed"').catch(function () {})
      ])
    : Promise.resolve();

  fontsReady.then(setupHero, setupHero);

  function setupHero() {
    var reduced = window.MaxFitAnim.prefersReducedMotion;
    var halves = hero.querySelectorAll(".hero__split-half");

    if (reduced) {
      gsap.set(halves, { autoAlpha: 1, y: 0 });
      return;
    }

    var splits = [];
    halves.forEach(function (el) {
      var split = new SplitText(el, { type: "lines", linesClass: "hero__split-line" });
      splits.push(split);
      gsap.set(split.lines, { autoAlpha: 0, yPercent: 110 });
    });
    var allLines = splits.reduce(function (acc, s) { return acc.concat(s.lines); }, []);

    gsap.to(allLines, {
      autoAlpha: 1,
      yPercent: 0,
      duration: 0.9,
      ease: "expo.out",
      stagger: 0.06,
      delay: 0.15
    });
  }
});
