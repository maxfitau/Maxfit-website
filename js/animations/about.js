/* 02 · Manifesto —
   - The manifesto pins briefly while the pull-quote reveals word by word
     (SplitText), from 15% to full opacity per the brief. It pins when its
     middle reaches the middle of the screen and holds for 70% of a screen, so
     there is no empty band on the way in and it doesn't hold the page for long.
   - The About photo no longer has a scroll-scrubbed mask: About is one compact
     block now, and the photo just fades in with the other .reveal elements.

   Fails safe: the manifesto quote defaults to fully visible in CSS. The active
   (non-reduced-motion) branch below is what explicitly hides it via gsap.set
   right before animating — so a GSAP/CDN failure, which skips this whole
   function, leaves it simply visible instead of hidden. */
document.addEventListener("DOMContentLoaded", function () {
  if (!window.MaxFitAnim || !window.MaxFitAnim.ready) return;

  var manifesto = document.getElementById("manifesto");
  var quoteText = document.getElementById("manifestoQuoteText");

  if (window.MaxFitAnim.prefersReducedMotion) {
    if (manifesto) gsap.set(manifesto.querySelector(".manifesto__quote"), { opacity: 1 });
    return;
  }

  if (manifesto && quoteText && typeof SplitText !== "undefined") {
    var split = new SplitText(quoteText, { type: "words", wordsClass: "manifesto__word" });
    gsap.set(split.words, { opacity: 0.15 });
    gsap.set(manifesto.querySelector(".manifesto__quote"), { opacity: 0 });

    gsap.timeline({
      scrollTrigger: {
        trigger: manifesto,
        start: "center center",
        end: "+=70%",
        pin: true,
        scrub: true
      }
    })
      .to(manifesto.querySelector(".manifesto__quote"), { opacity: 1, duration: 0.15 })
      .to(split.words, { opacity: 1, duration: 0.7, stagger: 0.05 });
  }
});
