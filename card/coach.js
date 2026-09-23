/*
 * MaxFit coach view for the macro tracker (card/coach.html).
 *
 * PIN-gated with the same STAFF_PIN as check-in. The PIN is kept in
 * sessionStorage only, so it's forgotten when the tab closes. From here
 * Max can:
 *   - issue a client's personal Fuel link (id + secret key) to text them
 *   - set a client's targets in grams (kcal = 4P + 4C + 9F), approving
 *     anything under the 1,500 / 1,200 kcal floor explicitly
 *   - hand targets back to the client's own calculator
 */
(function () {
  const body = document.getElementById("coachBody");
  const toastEl = document.getElementById("fuelToast");
  const PIN_STORAGE = "maxfitCoachPin";
  let pin = "";
  let clients = [];
  const open = {}; // slug -> which inline form is showing

  try {
    pin = sessionStorage.getItem(PIN_STORAGE) || "";
  } catch (err) {
    pin = "";
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function int(n) {
    return Math.round(Number(n) || 0).toLocaleString("en-AU");
  }

  let toastTimer;
  function toast(message) {
    clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.hidden = false;
    toastEl.style.whiteSpace = "normal";
    toastEl.style.textTransform = "none";
    toastTimer = setTimeout(() => (toastEl.hidden = true), 4000);
  }

  function renderPin(error) {
    body.innerHTML = `
      <form class="coach-form" id="pinForm" autocomplete="off">
        <span class="card__label card__label--red">Staff PIN</span>
        <input class="fuel-input" name="pin" type="password" inputmode="numeric" autocomplete="off" />
        ${error ? `<p class="fuel-error">${esc(error)}</p>` : ""}
        <button class="fuel-btn" type="submit">Open</button>
      </form>`;
    document.getElementById("pinForm").addEventListener("submit", (e) => {
      e.preventDefault();
      pin = e.target.pin.value.trim();
      load();
    });
  }

  async function load() {
    if (!MacroApi.configured()) {
      body.innerHTML = '<p class="fuel-error">Paste the Macros web app URL into card/macros-api.js first.</p>';
      return;
    }
    if (!pin) return renderPin();
    body.innerHTML = '<div class="fuel-loading"><div class="fuel-spinner"></div><span class="fuel-loading__text">Loading clients</span></div>';
    try {
      const data = await MacroApi.coach("coachList", pin);
      try {
        sessionStorage.setItem(PIN_STORAGE, pin);
      } catch (err) {
        // ignore
      }
      clients = data.clients;
      render();
    } catch (err) {
      if (err.code === "bad_pin") {
        pin = "";
        try {
          sessionStorage.removeItem(PIN_STORAGE);
        } catch (e) {
          // ignore
        }
        renderPin("Wrong PIN.");
      } else {
        body.innerHTML = `<p class="fuel-error">${esc(err.message)}</p>`;
      }
    }
  }

  function targetsText(c) {
    const t = c.targets;
    if (!t) return "No targets yet";
    const who = t.set_by === "coach" ? "set by you" : "from their calculator";
    return `${int(t.protein_g)}P · ${int(t.carbs_g)}C · ${int(t.fat_g)}F · ${int(t.kcal)} kcal (${who}${t.coach_approved ? ", under floor, approved" : ""})`;
  }

  function sexSeg(slug, current) {
    return `<div class="fuel-seg" data-sex="${esc(slug)}">
      <button type="button" data-v="F" class="${current === "F" ? "is-on" : ""}">Female</button>
      <button type="button" data-v="M" class="${current === "M" ? "is-on" : ""}">Male</button>
    </div>`;
  }

  function clientHtml(c) {
    const form = open[c.slug];
    const t = c.targets || {};
    return `
      <div class="fuel-panel coach-client" data-slug="${esc(c.slug)}">
        <div class="coach-client__head">
          <span class="coach-client__name">${esc(c.name)}</span>
          <span class="coach-client__meta">${c.lastLog ? `Last log ${esc(c.lastLog)}` : "Never logged"}</span>
        </div>
        <span class="coach-client__meta">${esc(targetsText(c))}</span>
        ${c.link ? `<div class="coach-link">${esc(c.link)}</div>` : ""}
        <div class="coach-actions">
          ${c.link ? '<button class="fuel-btn" type="button" data-a="copy">Copy link</button>' : '<button class="fuel-btn" type="button" data-a="issue">Create Fuel link</button>'}
          <button class="fuel-btn fuel-btn--ghost" type="button" data-a="targets">Set targets</button>
          ${c.link ? '<button class="fuel-btn fuel-btn--ghost" type="button" data-a="rotate">New link</button>' : ""}
        </div>
        ${
          form === "targets"
            ? `<div class="coach-form" data-targets-form>
                ${sexSeg(c.slug, c.sex)}
                <div class="fuel-fields3">
                  <label class="fuel-field"><span class="card__label">Protein g</span><input class="fuel-input" name="protein_g" type="number" inputmode="numeric" value="${t.protein_g || ""}" /></label>
                  <label class="fuel-field"><span class="card__label">Carbs g</span><input class="fuel-input" name="carbs_g" type="number" inputmode="numeric" value="${t.carbs_g || ""}" /></label>
                  <label class="fuel-field"><span class="card__label">Fat g</span><input class="fuel-input" name="fat_g" type="number" inputmode="numeric" value="${t.fat_g || ""}" /></label>
                </div>
                <span class="coach-client__meta" data-kcal></span>
                <label class="coach-check" data-approve hidden><input type="checkbox" name="approve" /> I approve going under the floor for this client</label>
                <div class="coach-actions">
                  <button class="fuel-btn" type="button" data-a="saveTargets">Save targets</button>
                  ${c.targets ? '<button class="fuel-btn fuel-btn--ghost" type="button" data-a="clearTargets">Let them use the calculator</button>' : ""}
                </div>
              </div>`
            : ""
        }
        ${
          form === "issue" || form === "rotate"
            ? `<div class="coach-form">
                <span class="coach-client__meta">${form === "rotate" ? "Their old link will stop working for Fuel." : "Pick their sex for the calorie floor, then create the link."}</span>
                ${sexSeg(c.slug, c.sex)}
                <button class="fuel-btn" type="button" data-a="confirmIssue">${form === "rotate" ? "Replace link" : "Create link"}</button>
              </div>`
            : ""
        }
      </div>`;
  }

  function render() {
    body.innerHTML = `
      <p class="fuel-disclaimer" style="margin-bottom:14px">Text each client their Fuel link. They open it once and add it to their home screen again. Only you (with the PIN) and that client can see their food log.</p>
      ${clients.map(clientHtml).join("")}`;
    clients.forEach((c) => {
      if (open[c.slug] === "targets") paintKcal(c.slug);
    });
  }

  function formFor(slug) {
    return body.querySelector(`[data-slug="${CSS.escape(slug)}"]`);
  }

  function selectedSex(slug) {
    const on = formFor(slug).querySelector("[data-sex] .is-on");
    return on ? on.dataset.v : "";
  }

  function paintKcal(slug) {
    const el = formFor(slug);
    const val = (n) => el.querySelector(`[name="${n}"]`).value;
    const check = MacroCore.checkCoachTargets(val("protein_g"), val("carbs_g"), val("fat_g"), selectedSex(slug) || "M");
    el.querySelector("[data-kcal]").textContent = check.kcal
      ? `= ${int(check.kcal)} kcal${check.belowFloor ? ` · under the ${int(check.floor)} kcal floor` : ""}`
      : "";
    el.querySelector("[data-approve]").hidden = !check.belowFloor;
  }

  body.addEventListener("input", (e) => {
    const card = e.target.closest("[data-slug]");
    if (card && e.target.closest("[data-targets-form]")) paintKcal(card.dataset.slug);
  });

  body.addEventListener("click", async (e) => {
    const sexBtn = e.target.closest("[data-sex] button");
    if (sexBtn) {
      sexBtn.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("is-on", b === sexBtn));
      const card = sexBtn.closest("[data-slug]");
      if (open[card.dataset.slug] === "targets") paintKcal(card.dataset.slug);
      return;
    }
    const btn = e.target.closest("[data-a]");
    if (!btn) return;
    const slug = btn.closest("[data-slug]").dataset.slug;
    const c = clients.find((x) => x.slug === slug);
    const a = btn.dataset.a;

    if (a === "copy") {
      try {
        await navigator.clipboard.writeText(c.link);
        toast(`Copied ${c.name}'s link`);
      } catch (err) {
        toast("Couldn't copy. Press and hold the link to copy it.");
      }
      return;
    }
    if (a === "issue" || a === "rotate" || a === "targets") {
      open[slug] = open[slug] === a ? null : a;
      render();
      return;
    }

    btn.disabled = true;
    try {
      if (a === "confirmIssue") {
        const data = await MacroApi.coach("issueKey", pin, {
          slug: slug,
          name: c.name,
          sex: selectedSex(slug),
          rotate: open[slug] === "rotate",
        });
        c.link = data.link;
        c.hasKey = true;
        c.sex = selectedSex(slug) || c.sex;
        open[slug] = null;
        render();
        toast("Link ready. Tap Copy link and text it to them.");
      } else if (a === "saveTargets") {
        const el = formFor(slug);
        const val = (n) => el.querySelector(`[name="${n}"]`).value;
        await MacroApi.coach("coachSetTargets", pin, {
          slug: slug,
          sex: selectedSex(slug),
          protein_g: val("protein_g"),
          carbs_g: val("carbs_g"),
          fat_g: val("fat_g"),
          approveBelowFloor: el.querySelector('[name="approve"]').checked,
        });
        open[slug] = null;
        await load();
        toast(`Saved ${c.name}'s targets`);
      } else if (a === "clearTargets") {
        await MacroApi.coach("coachSetTargets", pin, { slug: slug, clear: true });
        open[slug] = null;
        await load();
        toast(`${c.name} can now use the calculator`);
      }
    } catch (err) {
      btn.disabled = false;
      toast(err.message);
    }
  });

  load();
})();
