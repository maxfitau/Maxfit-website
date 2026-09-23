/* 01b · The Problem — each line crosses itself off as the next appears,
   pinned over a short scroll beat, resolving to "It was never you. It
   was the plan." Fails safe: .problem__line defaults to hidden and
   .problem__resolve defaults to visible in CSS, so with no GSAP at
   all (or reduced motion) the punchline is what shows — never four
   overlapping lines and a blank resolve. */
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
