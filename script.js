document.addEventListener("DOMContentLoaded", function () {
  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Preloader: logo resolve ---------- */
  var preloader = document.getElementById("preloader");

  if (preloader) {
    if (prefersReducedMotion) {
      preloader.remove();
    } else {
      document.body.classList.add("is-loading");

      var hidePreloader = function () {
        preloader.classList.add("is-hidden");
        document.body.classList.remove("is-loading");
      };

      var preloaderTimer = setTimeout(hidePreloader, 3170);

      var skipPreloader = function () {
        clearTimeout(preloaderTimer);
        hidePreloader();
      };

      preloader.addEventListener("click", skipPreloader);
      window.addEventListener("keydown", skipPreloader, { once: true });
    }
  }

  /* ---------- Mobile nav ---------- */
  var toggle = document.querySelector(".nav__toggle");
  var links = document.querySelector(".nav__links");

  if (toggle && links) {
    toggle.addEventListener("click", function () {
      links.classList.toggle("is-open");
    });

    links.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        links.classList.remove("is-open");
      });
    });
  }

  /* ---------- Hide/show nav on scroll ---------- */
  var header = document.querySelector(".site-header");
  var lastScroll = window.scrollY;

  window.addEventListener("scroll", function () {
    var current = window.scrollY;
    if (header) {
      if (current > lastScroll && current > 160) {
        header.classList.add("is-hidden");
      } else {
        header.classList.remove("is-hidden");
      }
    }
    lastScroll = current;
  }, { passive: true });

  /* ---------- Active section highlight ---------- */
  var sections = document.querySelectorAll("section[id]");
  var navLinks = document.querySelectorAll(".nav__links a[href^='#']");

  if (sections.length && navLinks.length && "IntersectionObserver" in window) {
    var sectionObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var id = entry.target.getAttribute("id");
          navLinks.forEach(function (link) {
            link.classList.toggle("is-active", link.getAttribute("href") === "#" + id);
          });
        }
      });
    }, { rootMargin: "-40% 0px -50% 0px", threshold: 0 });

    sections.forEach(function (section) { sectionObserver.observe(section); });
  }

  /* ---------- Grow into frame on scroll ---------- */
  var growEl = document.querySelector(".grow-in");

  if (growEl && !prefersReducedMotion) {
    var updateGrow = function () {
      var rect = growEl.getBoundingClientRect();
      var vh = window.innerHeight;
      var start = vh;
      var end = vh * 0.4;
      var progress = (start - rect.top) / (start - end);
      progress = Math.max(0, Math.min(1, progress));
      var scale = 0.85 + progress * 0.15;
      var opacity = 0.4 + progress * 0.6;
      growEl.style.transform = "scale(" + scale.toFixed(3) + ")";
      growEl.style.opacity = opacity.toFixed(3);
    };

    window.addEventListener("scroll", updateGrow, { passive: true });
    window.addEventListener("resize", updateGrow);
    updateGrow();
  }

  /* ---------- Scroll reveal ---------- */
  var revealEls = document.querySelectorAll(".reveal, .reveal-scale, .reveal-fade");

  if (revealEls.length) {
    if ("IntersectionObserver" in window && !prefersReducedMotion) {
      var revealObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.15 });

      revealEls.forEach(function (el, i) {
        el.style.setProperty("--i", i % 6);
        revealObserver.observe(el);
      });
    } else {
      revealEls.forEach(function (el) { el.classList.add("is-visible"); });
    }
  }

  /* ---------- Animated counters ---------- */
  var counters = document.querySelectorAll("[data-count]");

  function animateCounter(el) {
    var target = parseFloat(el.getAttribute("data-count"));
    var numEl = el.querySelector(".num");
    if (!numEl) return;

    if (prefersReducedMotion) {
      numEl.textContent = target;
      return;
    }

    var start = 0;
    var duration = 1400;
    var startTime = null;

    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      var progress = Math.min((timestamp - startTime) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      var value = Math.round(start + (target - start) * eased);
      numEl.textContent = value;
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        numEl.textContent = target;
      }
    }

    requestAnimationFrame(step);
  }

  if (counters.length && "IntersectionObserver" in window) {
    var counterObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          counterObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });

    counters.forEach(function (el) { counterObserver.observe(el); });
  }

  /* ---------- Expandable bio card ---------- */
  var bioCard = document.querySelector(".bio-card");
  var bioSummary = document.querySelector(".bio-card__summary");

  if (bioCard && bioSummary) {
    bioSummary.addEventListener("click", function () {
      bioCard.classList.toggle("is-open");
    });
  }

  /* ---------- Expandable program rows ---------- */
  document.querySelectorAll(".program__head").forEach(function (head) {
    head.addEventListener("click", function () {
      head.closest(".program").classList.toggle("is-open");
    });
  });

  /* ---------- Drag-to-scroll strips ---------- */
  document.querySelectorAll(".drag-strip").forEach(function (dragStrip) {
    var isDown = false;
    var startX = 0;
    var scrollStart = 0;

    dragStrip.addEventListener("pointerdown", function (e) {
      isDown = true;
      dragStrip.classList.add("is-dragging");
      startX = e.clientX;
      scrollStart = dragStrip.scrollLeft;
      dragStrip.setPointerCapture(e.pointerId);
    });

    dragStrip.addEventListener("pointermove", function (e) {
      if (!isDown) return;
      var dx = e.clientX - startX;
      dragStrip.scrollLeft = scrollStart - dx;
    });

    ["pointerup", "pointerleave", "pointercancel"].forEach(function (evt) {
      dragStrip.addEventListener(evt, function () {
        isDown = false;
        dragStrip.classList.remove("is-dragging");
      });
    });
  });

  /* ---------- Cursor follower (fine pointer only) ---------- */
  var supportsHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  if (supportsHover && !prefersReducedMotion) {
    var cursorDot = document.createElement("div");
    cursorDot.className = "cursor-dot";
    document.body.appendChild(cursorDot);

    var cx = 0, cy = 0, dx = 0, dy = 0;
    var active = false;

    document.addEventListener("mousemove", function (e) {
      cx = e.clientX;
      cy = e.clientY;
      if (!active) {
        active = true;
        cursorDot.classList.add("is-active");
      }
    });

    function raf() {
      dx += (cx - dx) * 0.18;
      dy += (cy - dy) * 0.18;
      cursorDot.style.transform = "translate(" + dx + "px," + dy + "px) translate(-50%, -50%)";
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);

    document.querySelectorAll("a, button, .program__head, .bio-card__summary").forEach(function (el) {
      el.addEventListener("mouseenter", function () { cursorDot.classList.add("is-hover"); });
      el.addEventListener("mouseleave", function () { cursorDot.classList.remove("is-hover"); });
    });

    /* ---------- Hero floating shapes: cursor parallax ---------- */
    var hero = document.querySelector(".hero");
    var shapes = document.querySelectorAll(".hero .shape");

    if (hero && shapes.length) {
      hero.addEventListener("mousemove", function (e) {
        var rect = hero.getBoundingClientRect();
        var relX = (e.clientX - rect.left) / rect.width - 0.5;
        var relY = (e.clientY - rect.top) / rect.height - 0.5;

        shapes.forEach(function (shape, i) {
          var depth = (i + 1) * 8;
          shape.style.transform = "translate(" + (relX * depth) + "px, " + (relY * depth) + "px)";
        });
      });
    }
  }

  /* ---------- Hero shapes: scroll parallax ---------- */
  if (!prefersReducedMotion) {
    var scrollShapes = document.querySelectorAll(".hero .shape");
    window.addEventListener("scroll", function () {
      var offset = window.scrollY;
      scrollShapes.forEach(function (shape, i) {
        var speed = 0.06 + i * 0.02;
        shape.style.marginTop = -(offset * speed) + "px";
      });
    }, { passive: true });
  }
});
