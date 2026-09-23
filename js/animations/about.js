/* 04 · About Max + 02 · Manifesto —
   - Headshot un-clips upward as you scroll past it (no pin, just a
     scrubbed clip-path tied to its own scroll position).
   - Manifesto pins briefly while the pull-quote reveals word by word
     (SplitText), from 15% to full opacity per the brief.

   Fails safe: both the headshot mask and the manifesto quote default
   to fully visible in CSS. The active (non-reduced-motion) branch
   below is what explicitly closes/hides them via gsap.set right
   before animating — so a GSAP/CDN failure, which skips this whole
   function, leaves both simply visible instead of hidden. */
document.addEventListener("DOMContentLoaded", function () {
  if (!window.MaxFitAnim || !window.MaxFitAnim.ready) return;

  var mask = document.getElementById("aboutHeadshotMask");
  var manifesto = document.getElementById("manifesto");
  var quoteText = document.getElementById("manifestoQuoteText");

  if (window.MaxFitAnim.prefersReducedMotion) {
    if (mask) gsap.set(mask, { clipPath: "inset(0% 0 0 0)" });
    if (manifesto) gsap.set(manifesto.querySelector(".manifesto__quote"), { opacity: 1 });
    return;
  }

  if (mask) {
    gsap.set(mask, { clipPath: "inset(100% 0 0 0)" });
    gsap.to(mask, {
      clipPath: "inset(0% 0 0 0)",
      ease: "none",
      scrollTrigger: {
        trigger: mask,
        start: "top 85%",
        end: "top 35%",
        scrub: true
      }
    });
  }

  if (manifesto && quoteText && typeof SplitText !== "undefined") {
    var split = new SplitText(quoteText, { type: "words", wordsClass: "manifesto__word" });
    gsap.set(split.words, { opacity: 0.15 });
    gsap.set(manifesto.querySelector(".manifesto__quote"), { opacity: 0 });

    gsap.timeline({
      scrollTrigger: {
        trigger: manifesto,
        start: "top top",
        end: "+=120%",
        pin: true,
        scrub: true
      }
    })
      .to(manifesto.querySelector(".manifesto__quote"), { opacity: 1, duration: 0.15 })
      .to(split.words, { opacity: 1, duration: 0.7, stagger: 0.05 });
  }
});
