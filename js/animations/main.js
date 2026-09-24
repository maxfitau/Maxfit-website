/* Redesign: shared GSAP/Lenis bootstrap. Every other file in
   js/animations/ reads window.MaxFitAnim instead of re-registering
   plugins or re-checking prefers-reduced-motion itself. */
window.MaxFitAnim = window.MaxFitAnim || {};

(function () {
  if (typeof gsap === "undefined") {
    // CDN failed to load — the static page still works, just without
    // the new motion layer. Nothing else in js/animations/ should throw.
    window.MaxFitAnim.ready = false;
    return;
  }

  if (typeof ScrollTrigger !== "undefined") gsap.registerPlugin(ScrollTrigger);
  if (typeof SplitText !== "undefined") gsap.registerPlugin(SplitText);
  if (typeof CustomEase !== "undefined") gsap.registerPlugin(CustomEase);

  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.MaxFitAnim.prefersReducedMotion = prefersReducedMotion;

  function initSmoothScroll() {
    if (prefersReducedMotion || typeof Lenis === "undefined") return null;

    var lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1 });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add(function (time) {
      lenis.raf(time * 1000);
    });
    gsap.ticker.lagSmoothing(0);
    return lenis;
  }

  window.MaxFitAnim.lenis = initSmoothScroll();
  window.MaxFitAnim.ready = true;

  // Web fonts and images finish loading after the pins are created, and
  // that can change section heights, so a ScrollTrigger's start/end can
  // be computed against a page that has since shifted. A couple of
  // refreshes after the page settles re-syncs everyone against final
  // layout, regardless of the order sections happened to initialize in.
  window.addEventListener("load", function () {
    ScrollTrigger.refresh();
  });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      ScrollTrigger.refresh();
    });
  }
})();
