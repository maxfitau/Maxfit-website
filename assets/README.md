# Assets to add

The site is a single page (`index.html`) with a strict red/black/white
theme and Barlow Condensed + Barlow typography, matching your real brand
docs. Your real logo is already wired in at `assets/images/maxfit-logo.png`
(processed from `hd maxfit transparent.png` — background flattened to
true transparency) and used in the nav, hero, footer, and the Wall of Fame
watermarks.

Placeholder blocks (dashed border, "Add ___ to /assets/..." hint text) mark
everywhere a real photo/video still needs to go. Replace them as you
gather the content:

## Photos needed

- **About section** — coach photo (portrait)
- **Wall of Fame section** (replaces the old Results grid) — 5 landscape
  training/gym photos:
  - Abs transformation card (real stat: −14kg)
  - Back transformation card (real stat: +23kg)
  - Antonio, 56
  - Valérie, 50
  - Gaël, 35

Swap a placeholder for a real image by finding its
`<div class="media-placeholder ...">...</div>` (or, in the Wall of Fame
cards, `<div class="media-placeholder wof-card__media">`) and replacing it
with:

```html
<img src="assets/images/your-photo.jpg" alt="Description of the photo" class="wof-card__media" />
```

(keep the same class so it still fills the card correctly)

## Video

No intro video wired in — the original brief referenced "maxfit intro
video.mp4" but it isn't in the current hero. Add it back in if you want it.

## Still placeholder / sample content (marked in the page copy itself)

- **Wall of Fame card names** — `[Client Name]` on the two real-stat cards
  (abs/back transformation). Antonio, Valérie, and Gaël are real names you
  gave but still need real photos and (if available) real stats instead of
  just their age.
- **Testimonials section** (the layered black section with the scrolling
  card columns) — your 3 real quotes are in, `[Client Name]` is still a
  placeholder on each.
- **Weekly Plans program examples** — 3 client-example cards under
  "Personalized Weekly Plans" in Programs, fully bracketed placeholders.
- **Instagram link** — the floating circular button in the Wall of Fame
  section links to `#` right now. I didn't want to guess your handle and
  link to the wrong account — update the `href` on `.wof__insta` in
  `index.html` with your real Instagram URL.

## Real content already wired in

- Logo: your actual processed logo file (see above)
- Bio: 6 years training, Cert III & IV Fitness (NHFA, 2026), your bio blurb,
  your training-philosophy quote
- Programs: One-on-One Coaching, Personalized Weekly Plans, Group Classes —
  all "Book a call for pricing"
- Group Classes expand into your 3 real signature classes (Heart & Hustle /
  Mission: Slimpossible / Strong & Sculpted) described by format and goal
  only — no exercises, timing, or scripts from your program docs are
  reproduced, to protect that IP
- Stats: 6 years training, 5 active clients, 4+ sessions/week avg,
  125kg bench PR (age 17) — all real
- Booking: direct `tel:` and `mailto:` links to 0490 952 388 and
  maxfrenchfitness@gmail.com — no external form
- Wall of Fame: your real abs/back transformation stats (−14kg / +23kg)
