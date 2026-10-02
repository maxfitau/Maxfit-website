/*
 * Self-mounting bottom nav for client-facing pages — Train / Muscles /
 * Macros / Profile — same self-mounting pattern as exercise-picker.js, so
 * no host page needs any markup of its own, just this script loaded
 * (plus its styles, in card/styles.css, already shared everywhere).
 *
 * There's no SPA router here: each tab is a real link between the site's
 * existing pages (`/card/`, `/workout/`, `/workout/library.html`), using
 * root-absolute paths so the same script works unchanged regardless of
 * which directory the current page lives in. Active-tab highlighting is
 * worked out once, from the page this loaded on (path + hash) — it
 * doesn't re-check if the page's own content changes under it later (e.g.
 * tapping the Card/Fuel switcher within card/index.html).
 */
(function () {
  const ICONS_ = {
    train:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h16M4 9v6M8 7v10M16 7v10M20 9v6"/></svg>',
    muscles:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 20c0-4 1-6 3-7-2-2-2-5 1-7 1 2 3 2 4 0 3 2 3 5 1 7 2 1 3 3 3 7"/></svg>',
    macros:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c-1 3-5 5-5 10a5 5 0 0 0 10 0c0-2-1-3-2-2 .5 2-1 3-2 2-1.5-1-1-5-1-10z"/></svg>',
    profile:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>',
  };

  /** The client's id for building nav links: the URL first, else whatever the card itself last saved on this phone. */
  function memberId_() {
    const fromUrl = new URLSearchParams(window.location.search).get("id");
    if (fromUrl) return fromUrl;
    try {
      return localStorage.getItem("maxfitMemberId") || "";
    } catch (err) {
      return "";
    }
  }

  function activeKey_() {
    const path = window.location.pathname;
    if (/\/workout\/library\.html$/.test(path)) return "muscles";
    if (/\/workout\/(index\.html)?$/.test(path)) return "train";
    if (/\/card\/(index\.html)?$/.test(path)) return window.location.hash === "#fuel" ? "macros" : "profile";
    return "";
  }

  function mount() {
    if (document.querySelector(".bottom-nav")) return; // a page that includes this twice by mistake
    const id = memberId_();
    const qs = id ? `?id=${encodeURIComponent(id)}` : "";
    const active = activeKey_();
    // Home (Profile) leftmost — Max's own convention for where "home" sits.
    const items = [
      { key: "profile", label: "Profile", href: `/card/${qs}` },
      { key: "train", label: "Train", href: `/workout/${qs}` },
      { key: "muscles", label: "Muscles", href: `/workout/library.html${qs}` },
      { key: "macros", label: "Macros", href: `/card/${qs}#fuel` },
    ];

    const nav = document.createElement("nav");
    nav.className = "bottom-nav";
    nav.setAttribute("aria-label", "Main");
    nav.innerHTML = items
      .map(
        (item) =>
          `<a class="bottom-nav__item${item.key === active ? " is-active" : ""}" href="${item.href}"${item.key === active ? ' aria-current="page"' : ""}>` +
          `<span class="bottom-nav__icon">${ICONS_[item.key]}</span>` +
          `<span class="bottom-nav__label">${item.label}</span>` +
          "</a>"
      )
      .join("");

    document.body.appendChild(nav);

    // `body` centres `.card` with flexbox and a fixed (not just minimum)
    // viewport height — content taller than the viewport overflows it
    // symmetrically instead of growing it, so body padding never creates
    // real scroll room here. A spacer inside `.card` itself does, since
    // `.card` is a normal block that's already proven to scroll correctly
    // for long content (a big workout list, say). Sized to the nav's own
    // rendered height (safe-area and all) plus a little breathing room, so
    // it's exactly enough on every device, not a guessed fixed number.
    const main = document.querySelector("main.card");
    if (main) {
      const spacer = document.createElement("div");
      spacer.style.height = nav.offsetHeight + 16 + "px";
      spacer.style.flexShrink = "0";
      main.appendChild(spacer);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
