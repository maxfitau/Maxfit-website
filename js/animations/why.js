/* 03 · Why it matters — ten public-health stats, each its own pinned
   beat: the number counts up, then blurs/melts (SVG goo filter) into
   the next one. Resolves to "Max Fit is built to keep you on the
   right side of these numbers," with sources in a footnote list.

   Fails safe: with no GSAP, or reduced motion, every beat and the
   resolve just show at once via plain CSS opacity, and every number
   shows its final value immediately — nothing here is required to
   read the section. */
document.addEventListener("DOMContentLoaded", function () {
  if (!window.MaxFitAnim || !window.MaxFitAnim.ready) return;

  var section = document.getElementById("why");
  if (!section) return;

  var beats = section.querySelectorAll(".why-beat");
  var stack = section.querySelector(".why__stack");
  var resolve = section.querySelector(".why__resolve");
  var footnotes = section.querySelector(".why__footnotes");
  var goo = document.querySelector("#why-goo feGaussianBlur");

  function finalizeNumbers() {
    beats.forEach(function (beat) {
      var numEl = beat.querySelector(".num");
      if (!numEl) return;
      var decimals = parseInt(numEl.getAttribute("data-decimals") || "0", 10);
      numEl.textContent = parseFloat(numEl.getAttribute("data-count")).toFixed(decimals);
    });
  }

  if (window.MaxFitAnim.prefersReducedMotion) {
    finalizeNumbers();
    gsap.set(beats, { opacity: 1 });
    gsap.set(resolve, { opacity: 1 });
    return;
  }

  gsap.set(beats, { opacity: 0 });
  gsap.set(beats[0], { opacity: 1 });

  var perBeat = 0.8; // screens of scroll per stat
  var totalBeats = beats.length;

  var tl = gsap.timeline({
    scrollTrigger: {
      trigger: section,
      start: "top top",
      end: "+=" + Math.round((totalBeats * perBeat + 1) * 100) + "%",
      pin: true,
      scrub: true
    }
  });

  beats.forEach(function (beat, i) {
    var numEl = beat.querySelector(".num");
    var isLast = i === totalBeats - 1;

    if (numEl) {
      var target = parseFloat(numEl.getAttribute("data-count"));
      var decimals = parseInt(numEl.getAttribute("data-decimals") || "0", 10);
      var proxy = { value: 0 };
      tl.to(proxy, {
        value: target,
        duration: perBeat * 0.55,
        ease: "power1.out",
        onUpdate: function () {
          numEl.textContent = proxy.value.toFixed(decimals);
        }
      });
    } else {
      tl.to({}, { duration: perBeat * 0.55 });
    }

    if (!isLast) {
      // The goo "melt": blur up, swap opacity while blurred (so the
      // feColorMatrix threshold reads as one shape merging into the
      // next rather than a plain crossfade), then blur back to 0.
      tl.to(goo, { attr: { stdDeviation: 18 }, duration: perBeat * 0.15, ease: "power1.in" });
      tl.to(beat, { opacity: 0, duration: perBeat * 0.001 }, ">");
      tl.to(beats[i + 1], { opacity: 1, duration: perBeat * 0.001 }, "<");
      tl.to(goo, { attr: { stdDeviation: 0 }, duration: perBeat * 0.15, ease: "power1.out" });
    } else {
      tl.to(goo, { attr: { stdDeviation: 18 }, duration: perBeat * 0.15, ease: "power1.in" });
      tl.to(beat, { opacity: 0, duration: perBeat * 0.001 }, ">");
      tl.to(stack, { opacity: 0, duration: perBeat * 0.001 }, "<");
      tl.to(goo, { attr: { stdDeviation: 0 }, duration: perBeat * 0.15, ease: "power1.out" });
    }
  });

  tl.to(resolve, { opacity: 1, duration: 0.4 });
  if (footnotes) tl.to(footnotes, { opacity: 0.7, duration: 0.3 }, "<");
});
