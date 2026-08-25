document.addEventListener("DOMContentLoaded", function () {
  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Intro: scroll-scrubbed preloader ----------
     #hero-pin (the .hero section) sticks to the top of the viewport while
     #intro-spacer scrolls underneath it. Scroll position within that
     spacer drives a 0-1 progress value that scrubs the intro video's
     currentTime and stages the hero content in — so scrolling back up
     rewinds the whole thing, since nothing here is a one-shot animation. */
  var introSpacer = document.getElementById("intro-spacer");
  var heroPin = document.getElementById("hero-pin");
  var preloader = document.getElementById("preloader");
  var preloaderVideo = preloader ? preloader.querySelector(".preloader__video") : null;
  var preloaderCaption = preloader ? preloader.querySelector(".preloader__caption") : null;
  var preloaderHint = preloader ? preloader.querySelector(".preloader__hint") : null;

  var introEls = {
    label: document.querySelector(".hero__label"),
    logo: document.querySelector(".hero__logo-wrap"),
    tagline: document.querySelector(".hero__tagline"),
    sub: document.querySelector(".hero__sub"),
    badge: document.querySelector(".hero__free-badge"),
    actions: document.querySelector(".hero__actions"),
    scrollHint: document.querySelector(".hero__scroll")
  };

  // Falls back to a plain, non-pinned hero with everything simply visible —
  // used for reduced-motion, missing markup, a video load error, or any
  // unexpected error in the setup below, so the page never gets stuck.
  function fallbackToStaticHero() {
    if (introSpacer) introSpacer.classList.add("is-static");
    if (heroPin) heroPin.classList.add("is-static");
    if (preloader) preloader.remove();
    Object.keys(introEls).forEach(function (key) {
      var el = introEls[key];
      if (el) {
        el.style.opacity = "";
        el.style.transform = "";
      }
    });
  }

  if (!introSpacer || !heroPin || !preloader || !preloaderVideo) {
    fallbackToStaticHero();
  } else if (prefersReducedMotion) {
    fallbackToStaticHero();
  } else {
    try {
      var videoReady = false;
      preloaderVideo.addEventListener("loadedmetadata", function () {
        videoReady = true;
      });
      preloaderVideo.addEventListener("error", fallbackToStaticHero);

      // The video's logo needs to land exactly where the real
      // .hero__logo-wrap sits, so the swap from video to live logo at the
      // end of the intro doesn't visibly jump. Measured against the logo's
      // resting position (transform cleared) since it's mid-reveal
      // (translateY-animating) most of the time this runs.
      var heroLogoWrap = document.querySelector(".hero__logo-wrap");
      var alignPreloaderVideo = function () {
        if (!heroLogoWrap) return;
        var prevTransform = heroLogoWrap.style.transform;
        heroLogoWrap.style.transform = "none";
        var containerRect = preloader.getBoundingClientRect();
        var logoRect = heroLogoWrap.getBoundingClientRect();
        heroLogoWrap.style.transform = prevTransform;

        if (!logoRect.width || !containerRect.width) return;
        preloaderVideo.style.left = (logoRect.left - containerRect.left + logoRect.width / 2) + "px";
        preloaderVideo.style.top = (logoRect.top - containerRect.top + logoRect.height / 2) + "px";
        preloaderVideo.style.width = logoRect.width + "px";
      };

      // Progress ranges each hero element reveals across, staggered so
      // they cascade in one after another as the intro finishes.
      var bands = {
        label: [0.70, 0.80],
        logo: [0.75, 0.88],
        tagline: [0.80, 0.92],
        sub: [0.85, 1.00],
        badge: [0.85, 1.00],
        actions: [0.85, 1.00],
        scrollHint: [0.90, 1.00]
      };

      var bandProgress = function (range, p) {
        var t = (p - range[0]) / (range[1] - range[0]);
        return Math.max(0, Math.min(1, t));
      };

      // Cheap ease-out so each reveal decelerates into place instead of
      // moving at a constant linear rate — reads as noticeably smoother
      // even though the underlying scroll math is unchanged.
      var easeOutCubic = function (t) {
        return 1 - Math.pow(1 - t, 3);
      };

      var applyReveal = function (el, t) {
        if (!el) return;
        var eased = easeOutCubic(t);
        el.style.opacity = eased.toFixed(3);
        el.style.transform = "translateY(" + ((1 - eased) * 16).toFixed(2) + "px)";
      };

      Object.keys(introEls).forEach(function (key) {
        applyReveal(introEls[key], 0);
      });

      var lastVideoTime = -1;

      // The raw scroll position (targetProgress) updates instantly, but
      // everything on screen tracks a lagged, lerped currentProgress
      // instead — same damping technique as the cursor-dot follower above.
      // That turns choppy trackpad/wheel deltas into one continuous glide.
      var targetProgress = 0;
      var currentProgress = 0;
      var introSmoothing = 0.16;
      var introRafRunning = false;

      var readTargetProgress = function () {
        var rect = introSpacer.getBoundingClientRect();
        var vh = window.innerHeight;
        var total = rect.height - vh;
        var p = total > 0 ? -rect.top / total : 1;
        targetProgress = Math.max(0, Math.min(1, p));
      };

      var applyIntroFrame = function (progress) {
        if (videoReady && preloaderVideo.duration) {
          var t = progress * preloaderVideo.duration;
          if (Math.abs(t - lastVideoTime) > 0.005) {
            preloaderVideo.currentTime = t;
            lastVideoTime = t;
          }
        }

        if (preloaderCaption) {
          var captionOut = bandProgress([0.80, 1.00], progress);
          preloaderCaption.style.opacity = (1 - easeOutCubic(captionOut)).toFixed(3);
        }

        if (preloaderHint) {
          var hintOut = bandProgress([0.02, 0.12], progress);
          preloaderHint.style.opacity = (1 - easeOutCubic(hintOut)).toFixed(3);
        }

        var overlayOut = bandProgress([0.72, 0.96], progress);
        preloader.style.opacity = (1 - easeOutCubic(overlayOut)).toFixed(3);
        preloader.style.pointerEvents = progress >= 0.96 ? "none" : "";

        Object.keys(bands).forEach(function (key) {
          applyReveal(introEls[key], bandProgress(bands[key], progress));
        });
      };

      var introTick = function () {
        currentProgress += (targetProgress - currentProgress) * introSmoothing;
        if (Math.abs(targetProgress - currentProgress) < 0.0008) {
          currentProgress = targetProgress;
        }
        applyIntroFrame(currentProgress);

        if (currentProgress !== targetProgress) {
          requestAnimationFrame(introTick);
        } else {
          introRafRunning = false;
        }
      };

      var scheduleIntroUpdate = function () {
        readTargetProgress();
        if (!introRafRunning) {
          introRafRunning = true;
          requestAnimationFrame(introTick);
        }
      };

      window.addEventListener("scroll", scheduleIntroUpdate, { passive: true });
      window.addEventListener("resize", function () {
        alignPreloaderVideo();
        scheduleIntroUpdate();
      });
      alignPreloaderVideo();
      scheduleIntroUpdate();
    } catch (err) {
      fallbackToStaticHero();
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
    var heroForParallax = document.querySelector(".hero");
    window.addEventListener("scroll", function () {
      // .hero is pinned (position: sticky) during the intro scrub, so its
      // own rect.top stays at 0 the whole time the intro is running and
      // only goes negative once it un-pins and scrolls with the page —
      // using that instead of window.scrollY keeps the shapes still while
      // pinned instead of flinging them off-screen from the spacer scroll.
      var offset = heroForParallax ? -heroForParallax.getBoundingClientRect().top : 0;
      scrollShapes.forEach(function (shape, i) {
        var speed = 0.06 + i * 0.02;
        shape.style.marginTop = -(offset * speed) + "px";
      });
    }, { passive: true });
  }

  /* ---------- Client video testimonials ----------
     Edit this list to swap in real client videos. For each entry:
       - name / caption: shown on the card and in the lightbox
       - thumbnail: path to a poster image, or null to keep the
         dashed "video placeholder" card until you add one
       - video.type: "local" | "youtube" | "vimeo" | "placeholder"
       - video.src:
           local    -> path to the video file, e.g. "assets/videos/jordan.mp4"
           youtube  -> the video ID only (the part after "v=" or after "youtu.be/")
           vimeo    -> the numeric video ID only
           placeholder -> leave src empty; the lightbox will show a
                          "no video yet" notice instead of trying to play one
  ---------------------------------------------------- */
  var videoTestimonials = [
    { name: "J.H", caption: "", thumbnail: "assets/images/jh-testimonial-thumb.jpg", video: { type: "local", src: "assets/videos/client-testimonial-1.mov" } },
    { name: "J.F", caption: "", thumbnail: "assets/images/client2-testimonial-thumb.jpg", video: { type: "local", src: "assets/videos/client-testimonial-2.mp4" } }
  ];

  var vtTrack = document.querySelector(".vt__track");

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function buildVideoCard(item, isDuplicate) {
    var card = document.createElement("button");
    card.type = "button";
    card.className = "vt-card";

    var thumbHtml = item.thumbnail
      ? '<img class="vt-card__thumb" src="' + item.thumbnail + '" alt="Video testimonial from ' + escapeHtml(item.name) + '" />'
      : '<span class="vt-card__thumb media-placeholder media-placeholder--video">' +
          '<span class="media-placeholder__inner">' +
            '<span class="media-placeholder__label">Video placeholder</span>' +
            '<span class="media-placeholder__hint">Add ' + escapeHtml(item.name) + '&rsquo;s video</span>' +
          '</span>' +
        '</span>';

    card.innerHTML =
      thumbHtml +
      '<span class="vt-card__play" aria-hidden="true">' +
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' +
      '</span>' +
      '<span class="vt-card__who">' +
        '<span class="vt-card__name">' + escapeHtml(item.name) + '</span>' +
        (item.caption ? '<span class="vt-card__caption">' + escapeHtml(item.caption) + '</span>' : '') +
      '</span>';

    if (isDuplicate) {
      card.setAttribute("aria-hidden", "true");
      card.tabIndex = -1;
    } else {
      card.setAttribute("aria-label", "Play video testimonial from " + item.name);
      card.addEventListener("click", function () {
        openVideoLightbox(item);
      });
    }

    return card;
  }

  if (vtTrack) {
    videoTestimonials.forEach(function (item) {
      vtTrack.appendChild(buildVideoCard(item, false));
    });
  }

  /* ---------- Video lightbox ---------- */
  var vtLightbox = document.getElementById("vt-lightbox");
  var vtLightboxBody = vtLightbox ? vtLightbox.querySelector(".vt-lightbox__body") : null;
  var vtLightboxTitle = vtLightbox ? vtLightbox.querySelector(".vt-lightbox__title") : null;
  var vtLightboxClose = vtLightbox ? vtLightbox.querySelector(".vt-lightbox__close") : null;
  var vtLastFocused = null;

  function openVideoLightbox(item) {
    if (!vtLightbox || !vtLightboxBody) return;

    var media;
    if (item.video.type === "youtube") {
      media = document.createElement("iframe");
      media.className = "vt-lightbox__frame";
      media.src = "https://www.youtube-nocookie.com/embed/" + item.video.src + "?autoplay=1&rel=0";
      media.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
      media.setAttribute("allowfullscreen", "");
    } else if (item.video.type === "vimeo") {
      media = document.createElement("iframe");
      media.className = "vt-lightbox__frame";
      media.src = "https://player.vimeo.com/video/" + item.video.src + "?autoplay=1";
      media.setAttribute("allow", "autoplay; fullscreen; picture-in-picture");
      media.setAttribute("allowfullscreen", "");
    } else if (item.video.type === "local") {
      media = document.createElement("video");
      media.className = "vt-lightbox__frame";
      media.src = item.video.src;
      media.controls = true;
      media.autoplay = true;
      media.playsInline = true;
    } else {
      media = document.createElement("div");
      media.className = "vt-lightbox__placeholder";
      media.innerHTML =
        '<div class="media-placeholder__label">No video yet</div>' +
        '<div class="media-placeholder__hint">Add ' + escapeHtml(item.name) + '&rsquo;s testimonial video in script.js (videoTestimonials list)</div>';
    }

    vtLightboxBody.innerHTML = "";
    vtLightboxBody.appendChild(media);
    if (vtLightboxTitle) vtLightboxTitle.textContent = item.name;

    vtLightbox.classList.add("is-open");
    document.body.classList.add("vt-lightbox-open");
    vtLastFocused = document.activeElement;
    if (vtLightboxClose) vtLightboxClose.focus();
  }

  function closeVideoLightbox() {
    if (!vtLightbox || !vtLightboxBody) return;
    vtLightbox.classList.remove("is-open");
    document.body.classList.remove("vt-lightbox-open");
    vtLightboxBody.innerHTML = "";
    if (vtLastFocused && typeof vtLastFocused.focus === "function") vtLastFocused.focus();
  }

  if (vtLightbox) {
    if (vtLightboxClose) vtLightboxClose.addEventListener("click", closeVideoLightbox);

    vtLightbox.addEventListener("click", function (e) {
      if (e.target === vtLightbox) closeVideoLightbox();
    });

    window.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && vtLightbox.classList.contains("is-open")) closeVideoLightbox();
    });
  }
});
