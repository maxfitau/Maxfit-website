/* 01 · Hero — split headline reveals once on load (SplitText, masked
   lines, staggered), then the section pins while intro.mp4 scrubs from
   a small card to full-bleed and the headline fades out. The CTA and
   free-session badge sit above the video (z-index) and stay visible
   throughout — nothing about booking should ever be covered up.

   Fails safe: if GSAP/SplitText didn't load, or the required elements
   aren't on the page, this does nothing and the plain CSS layout (small
   static video card, everything visible) stands on its own. */
document.addEventListener("DOMContentLoaded", function () {
  if (!window.MaxFitAnim || !window.MaxFitAnim.ready) return;
  if (typeof SplitText === "undefined") return;

  var hero = document.getElementById("hero");
  var video = document.getElementById("heroVideo");
  var frame = document.getElementById("heroVideoFrame");
  if (!hero || !video || !frame) return;

  // iOS Safari won't paint a frame from a programmatic currentTime seek
  // on a video that has never played — priming it with an immediate
  // muted play-then-pause fixes that once, before any scroll-driven seek.
  var videoReady = false;
  video.addEventListener("loadedmetadata", function () {
    var p = video.play();
    if (p && typeof p.then === "function") {
      p.then(function () { video.pause(); videoReady = true; }).catch(function () { videoReady = true; });
    } else {
      video.pause();
      videoReady = true;
    }
  });
  video.addEventListener("error", function () {
    videoReady = false;
  });

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
    var isMobile = window.matchMedia("(max-width: 1023px)").matches;
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

    // Mobile keeps the entrance reveal above but skips the pin/scrub —
    // the video frame is a normal static card there (see styles.css),
    // no 400vh-style pin, per the brief's "simpler pins on mobile" rule.
    if (isMobile) return;

    // The frame starts as a normal absolutely-positioned card filling
    // its slot (see .hero__video-slot in styles.css). Capturing its
    // current on-screen rect and switching it to position: fixed at
    // those exact pixel coordinates is a no-op visually (fixed is
    // viewport-relative, same as getBoundingClientRect) — the slot
    // below keeps reserving the layout space, so nothing jumps. From
    // there the timeline can animate it straight to a full-viewport
    // fixed box for the scrub-to-full-bleed effect.
    var rect = frame.getBoundingClientRect();
    gsap.set(frame, {
      position: "fixed",
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      margin: 0
    });

    gsap
      .timeline({
        scrollTrigger: {
          trigger: hero,
          start: "top top",
          end: "+=180%",
          pin: true,
          scrub: true
        },
        onUpdate: function () {
          if (!videoReady || !video.duration) return;
          var progress = this.scrollTrigger ? this.scrollTrigger.progress : 0;
          var t = progress * video.duration;
          if (Math.abs(video.currentTime - t) > 0.01) video.currentTime = t;
        }
      })
      .to(frame, { left: 0, top: 0, width: "100vw", height: "100vh", borderRadius: 0, duration: 1 }, 0)
      .to([".hero__hairline", ".hero__label-top", ".hero__label-bottom", ".hero__split"], { autoAlpha: 0, duration: 0.35 }, 0.1);
  }
});
