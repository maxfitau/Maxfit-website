/* 03 · Why it matters: public-health stats, each its own pinned
   beat. The number counts up, then blurs/melts (SVG goo filter) into
   the next one. Only after the last stat has melted away does "Max Fit
   is built to keep you on the right side of these numbers" appear,
   along with the sources footnote list.

   Fails safe: .why-beat defaults to hidden and .why__resolve and
   .why__footnotes default to visible in CSS, so a GSAP/CDN failure
   shows the resolve line rather than nothing. The gsap.set() calls
   below are what hide the resolve and footnotes, and they only run
   once GSAP is confirmed working. Reduced motion gets a fuller, still
   static fallback: every stat listed in a normal stack, each showing
   its final value. */
document.addEventListener("DOMContentLoaded", function () {
  var section = document.getElementById("why");
  if (!section) return;
  if (!window.MaxFitAnim || !window.MaxFitAnim.ready) return;

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
    stack.classList.add("is-static");
    gsap.set(beats, { opacity: 1 });
    gsap.set(resolve, { opacity: 1 });
    if (footnotes) gsap.set(footnotes, { opacity: 0.7 });
    return;
  }

  gsap.set(beats, { opacity: 0 });
  gsap.set(beats[0], { opacity: 1 });
  gsap.set(resolve, { opacity: 0 });
  if (footnotes) gsap.set(footnotes, { opacity: 0 });

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
  tl.to({}, { duration: 0.6 });
});
