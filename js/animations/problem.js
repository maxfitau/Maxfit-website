/* 01b · The Problem — each line crosses itself off as the next appears,
   pinned over a short scroll beat, resolving to "It was never you. It
   was the plan." Fails safe: with no GSAP, or reduced motion, all 4
   lines and the resolve are simply visible at once via plain CSS. */
document.addEventListener("DOMContentLoaded", function () {
  if (!window.MaxFitAnim || !window.MaxFitAnim.ready) return;

  var section = document.getElementById("problem");
  if (!section) return;

  if (window.MaxFitAnim.prefersReducedMotion) {
    gsap.set(".problem__resolve", { opacity: 1 });
    return;
  }

  var lines = section.querySelectorAll(".problem__line");
  var strikes = section.querySelectorAll(".problem__strike");
  var resolve = section.querySelector(".problem__resolve");

  gsap.set(lines, { autoAlpha: 0 });
  gsap.set(lines[0], { autoAlpha: 1 });

  var tl = gsap.timeline({
    scrollTrigger: {
      trigger: section,
      start: "top top",
      end: "+=150%",
      pin: true,
      scrub: true
    }
  });

  lines.forEach(function (line, i) {
    var strike = strikes[i];
    var isLast = i === lines.length - 1;

    tl.to(strike, { scaleX: 1, duration: 0.6, ease: "power2.inOut" });
    tl.to(line, { autoAlpha: 0, duration: 0.3 }, isLast ? ">-0.1" : ">-0.1");
    if (!isLast) {
      tl.to(lines[i + 1], { autoAlpha: 1, duration: 0.3 }, "<");
    }
  });

  tl.to(resolve, { opacity: 1, duration: 0.6, ease: "power2.out" });
});
