/*
 * Family Grocery List.
 *
 * One shared access code gets any family member into the app (keeps random
 * visitors out, nothing more) — after that, everyone finds their own list by
 * searching their surname, and any family member can add or remove items.
 * Removing is a double-tap/double-click on the item itself, per the brief.
 *
 * The code and remembered surname are both stashed in localStorage so
 * nobody has to re-enter either on repeat visits from the same phone.
 */
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbya8dm8g5eC4ldAbNYmMCccDCZ6K7encj_q4IzXtKMOpd007RMYhnR3_PJ2eL2gjVDQ/exec";
const CODE_STORAGE_KEY = "maxfitGroceryCode";
const SURNAME_STORAGE_KEY = "maxfitGrocerySurname";

const els = {
  gate: document.getElementById("groceryGate"),
  codeInput: document.getElementById("codeInput"),
  codeSubmit: document.getElementById("codeSubmit"),
  codeError: document.getElementById("codeError"),
  search: document.getElementById("grocerySearch"),
  surnameInput: document.getElementById("surnameInput"),
  surnameSubmit: document.getElementById("surnameSubmit"),
  surnameError: document.getElementById("surnameError"),
  listView: document.getElementById("groceryListView"),
  familyName: document.getElementById("groceryFamilyName"),
  switchFamily: document.getElementById("switchFamily"),
  itemInput: document.getElementById("itemInput"),
  itemAdd: document.getElementById("itemAdd"),
  items: document.getElementById("groceryItems"),
  empty: document.getElementById("groceryEmpty"),
  status: document.getElementById("groceryStatus"),
};

let code = null;
let surname = null;

function showStatus(message, isError) {
  els.status.textContent = message;
  els.status.hidden = false;
  els.status.classList.toggle("status--error", Boolean(isError));
}

function clearStatus() {
  els.status.hidden = true;
}

function titleCase(s) {
  return s.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

function showStep(step) {
  els.gate.hidden = step !== "gate";
  els.search.hidden = step !== "search";
  els.listView.hidden = step !== "list";
}

async function submitCode() {
  const entered = els.codeInput.value.trim();
  els.codeError.hidden = true;
  if (!entered) return;

  els.codeSubmit.disabled = true;
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "checkGroceryCode", code: entered }),
    });
    const result = await res.json();
    if (result.status !== "success") {
      els.codeError.textContent = "That code isn't right — check with whoever set it up.";
      els.codeError.hidden = false;
      return;
    }
    code = entered;
    try {
      localStorage.setItem(CODE_STORAGE_KEY, code);
    } catch (err) {
      // Storage unavailable — they'll just re-enter the code next visit.
    }
    showStep("search");
  } catch (err) {
    els.codeError.textContent = "Couldn't check that — check your connection and try again.";
    els.codeError.hidden = false;
  } finally {
    els.codeSubmit.disabled = false;
  }
}

async function submitSurname() {
  const entered = els.surnameInput.value.trim();
  els.surnameError.hidden = true;
  if (!entered) return;

  surname = entered;
  try {
    localStorage.setItem(SURNAME_STORAGE_KEY, surname);
  } catch (err) {
    // Storage unavailable — they'll just re-type it next visit.
  }
  els.familyName.textContent = `${titleCase(surname)} Family`;
  showStep("list");
  await loadItems();
}

function buildItemRow(id, text) {
  const row = document.createElement("div");
  row.className = "grocery__item";
  row.textContent = text;

  let lastTap = 0;
  async function remove() {
    if (row.classList.contains("grocery__item--removing")) return; // already on its way out
    row.classList.add("grocery__item--removing");
    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "deleteGroceryItem", code, id }),
      });
      const result = await res.json();
      if (result.status !== "success") throw new Error("delete failed");
      setTimeout(() => {
        row.remove();
        if (!els.items.children.length) els.empty.hidden = false;
      }, 150);
    } catch (err) {
      row.classList.remove("grocery__item--removing");
      showStatus("Couldn't remove that — check your connection and try again.", true);
    }
  }

  row.addEventListener("dblclick", remove);
  // Some mobile browsers don't reliably synthesize dblclick from two taps —
  // fall back to manually timing consecutive taps within 400ms.
  row.addEventListener("touchend", () => {
    const now = Date.now();
    if (now - lastTap < 400) remove();
    lastTap = now;
  });

  return row;
}

async function loadItems() {
  clearStatus();
  els.items.innerHTML = "";
  els.empty.hidden = true;

  try {
    const { rows, col } = await fetchGroceryItems();
    const wanted = surname.toLowerCase();
    const mine = rows.filter((r) => String(r[col.surname] || "").trim().toLowerCase() === wanted);

    if (!mine.length) {
      els.empty.hidden = false;
      return;
    }
    for (const r of mine) {
      const id = col.id >= 0 ? r[col.id] : "";
      const text = (col.item >= 0 ? r[col.item] : "").trim();
      if (!text) continue;
      els.items.appendChild(buildItemRow(id, text));
    }
    if (!els.items.children.length) els.empty.hidden = false;
  } catch (err) {
    showStatus("Couldn't load your list — check your connection and try again.", true);
  }
}

async function addItem() {
  const text = els.itemInput.value.trim();
  if (!text) return;

  els.itemAdd.disabled = true;
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "addGroceryItem", code, surname, item: text }),
    });
    const result = await res.json();
    if (result.status !== "success") throw new Error("add failed");
    els.itemInput.value = "";
    els.empty.hidden = true;
    els.items.appendChild(buildItemRow(result.id, text));
  } catch (err) {
    showStatus("Couldn't add that — check your connection and try again.", true);
  } finally {
    els.itemAdd.disabled = false;
  }
}

els.codeSubmit.addEventListener("click", submitCode);
els.codeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitCode();
});

els.surnameSubmit.addEventListener("click", submitSurname);
els.surnameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitSurname();
});

els.itemAdd.addEventListener("click", addItem);
els.itemInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addItem();
});

els.switchFamily.addEventListener("click", () => {
  surname = null;
  try {
    localStorage.removeItem(SURNAME_STORAGE_KEY);
  } catch (err) {
    // Storage unavailable — harmless, they'll just re-type it.
  }
  els.surnameInput.value = "";
  showStep("search");
});

function init() {
  let rememberedCode = null;
  let rememberedSurname = null;
  try {
    rememberedCode = localStorage.getItem(CODE_STORAGE_KEY);
    rememberedSurname = localStorage.getItem(SURNAME_STORAGE_KEY);
  } catch (err) {
    // Storage unavailable — just start from the gate.
  }

  if (!rememberedCode) {
    showStep("gate");
    return;
  }
  code = rememberedCode;

  if (!rememberedSurname) {
    showStep("search");
    return;
  }
  surname = rememberedSurname;
  els.familyName.textContent = `${titleCase(surname)} Family`;
  showStep("list");
  loadItems();
}

init();
