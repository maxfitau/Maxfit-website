/* 01b · The Problem: each excuse crosses itself off as the next appears,
   pinned over a scroll beat. Only once the last one is struck out does
   "It was never you. It was the plan." pop in, then it holds for a beat
   so it can actually be read before the page scrolls on.

   Fails safe: .problem__line defaults to hidden and .problem__resolve
   defaults to visible in CSS, so with no GSAP at all (or reduced motion)
   the punchline is what shows, never four overlapping lines and a blank
   resolve. The gsap.set() below is what hides the resolve, and it only
   runs once GSAP is confirmed working. */
document.addEventListener("DOMContentLoaded", function () {
  var section = document.getElementById("problem");
  if (!section) return;
  if (!window.MaxFitAnim || !window.MaxFitAnim.ready) return;
  if (window.MaxFitAnim.prefersReducedMotion) return;

  var lines = section.querySelectorAll(".problem__line");
  var strikes = section.querySelectorAll(".problem__strike");
  var resolve = section.querySelector(".problem__resolve");

  gsap.set(lines, { autoAlpha: 0 });
  gsap.set(lines[0], { autoAlpha: 1 });
  gsap.set(resolve, { autoAlpha: 0, y: 28, scale: 0.94 });

  var tl = gsap.timeline({
    scrollTrigger: {
      trigger: section,
      start: "top top",
      end: "+=190%",
      pin: true,
      scrub: true
    }
  });

  lines.forEach(function (line, i) {
    var strike = strikes[i];
    var isLast = i === lines.length - 1;

    tl.to(strike, { scaleX: 1, duration: 0.6, ease: "power2.inOut" });
    tl.to(line, { autoAlpha: 0, duration: 0.3 }, ">-0.1");
    if (!isLast) {
      tl.to(lines[i + 1], { autoAlpha: 1, duration: 0.3 }, "<");
    }
  });

  tl.to(resolve, { autoAlpha: 1, y: 0, scale: 1, duration: 0.6, ease: "back.out(1.7)" });
  tl.to({}, { duration: 1 });
});
