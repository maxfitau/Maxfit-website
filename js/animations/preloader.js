/* 00 · Preloader — huge 0→100 counter, a red hairline growing across,
   then the brand chevron (same clip-path as .shape--chevron) scales up
   to wipe the screen away. Skipped via sessionStorage on repeat visits
   in the same session, and skipped outright for reduced motion or if
   the GSAP CDN failed to load — either way the page must still work. */
document.addEventListener("DOMContentLoaded", function () {
  var el = document.getElementById("gsap-preloader");
  if (!el) return;

  function finish() {
    el.remove();
    document.body.classList.remove("is-preloading");
  }

  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var alreadySeen = false;
  try {
    alreadySeen = sessionStorage.getItem("maxfitPreloaderSeen") === "1";
  } catch (e) {
    // Private browsing or storage disabled — just show the preloader
    // every time rather than blocking on it.
  }

  if (prefersReducedMotion || alreadySeen || typeof gsap === "undefined") {
    finish();
    return;
  }

  try {
    sessionStorage.setItem("maxfitPreloaderSeen", "1");
  } catch (e) {}

  document.body.classList.add("is-preloading");

  var numEl = document.getElementById("gsapPreloaderNum");
  var hairlineEl = document.getElementById("gsapPreloaderHairline");
  var chevronEl = document.getElementById("gsapPreloaderChevron");
  var counter = { value: 0 };

  var tl = gsap.timeline({
    defaults: { ease: "power2.inOut" },
    onComplete: finish
  });

  tl.to(counter, {
    value: 100,
    duration: 1.1,
    onUpdate: function () {
      numEl.textContent = Math.round(counter.value);
    }
  });
  tl.fromTo(hairlineEl, { scaleX: 0 }, { scaleX: 1, duration: 1.1, ease: "none" }, 0);
  tl.to(chevronEl, { scale: 32, duration: 0.45, ease: "power3.in" }, 1.05);
  tl.to(el, { autoAlpha: 0, duration: 0.35 }, 1.45);
});
