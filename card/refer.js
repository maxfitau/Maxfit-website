/*
 * Refer a friend — opened from the membership card (card/index.html ->
 * refer.html?id=<slug>). Same identity as the rest of the card: ?id= in the
 * URL, falling back to whatever the card last saved in localStorage.
 *
 * A client's referral code is a separate personal code from their check-in
 * QR (issueReferralCodes() in Code.gs) — 6 characters, same style as a
 * booking code, so it's short enough to say out loud or type. It's read
 * straight from the public CRM sheet (never a secret — see CLAUDE.md), same
 * as the rest of this page's data. Sharing it takes a friend to
 * join.html?ref=<code>; the backend recognises that as this client's own
 * Referral Code (see findClientNameByReferralCode_ in Code.gs).
 *
 * "Clients Referred" and "Tokens Owed" are read the same way — plain columns
 * on the sheet the card already reads, kept up to date by the check-in
 * backend's referral payout. This page never writes anything.
 */
(function () {
  const JOIN_URL_BASE = "https://maxfit.now/join.html";
  const MEMBER_ID_STORAGE_KEY = "maxfitMemberId"; // shared with card/app.js and card/book.js
  const SHARE_TEXT = "Train with me at MaxFit — use my link and your first 1-on-1 session is free.";

  const params = new URLSearchParams(window.location.search);
  let memberId = params.get("id");
  if (memberId) {
    try {
      localStorage.setItem(MEMBER_ID_STORAGE_KEY, memberId);
    } catch (err) {
      // Private browsing or storage disabled — nothing to fall back on later.
    }
  } else {
    try {
      memberId = localStorage.getItem(MEMBER_ID_STORAGE_KEY);
    } catch (err) {
      // Ignore — memberId stays null, handled in init().
    }
  }

  const $ = (id) => document.getElementById(id);
  const els = {
    back: $("backLink"),
    loading: $("referLoading"),
    notice: $("referNotice"),
    noticeTitle: $("noticeTitle"),
    noticeText: $("noticeText"),
    content: $("referContent"),
    code: $("referCode"),
    count: $("referCount"),
    bonus: $("referBonus"),
    bonusWrap: $("referBonusWrap"),
    shareBtn: $("shareBtn"),
    copiedNote: $("copiedNote"),
    linkValue: $("linkValue"),
    qr: $("qrCode"),
  };

  function showScreen(name) {
    els.loading.hidden = name !== "loading";
    els.notice.hidden = name !== "notice";
    els.content.hidden = name !== "content";
  }

  function showNotice(title, text) {
    els.noticeTitle.textContent = title;
    els.noticeText.textContent = text;
    showScreen("notice");
  }

  /** Who is asking: name, Referral Code and referral stats, from the public CRM sheet. */
  async function resolveMember() {
    const { rows, col } = await fetchSheet();
    const wanted = slugify(memberId);
    const match = rows.find((r) => r[col.name] && slugify(r[col.name]) === wanted);
    if (!match) return null;
    return {
      code: col.referralCode >= 0 ? String(match[col.referralCode] || "").trim().toUpperCase() : "",
      tokensOwed: col.tokensOwed >= 0 ? String(match[col.tokensOwed] || "").trim() : "",
      clientsReferred: col.clientsReferred >= 0 ? String(match[col.clientsReferred] || "").trim() : "",
    };
  }

  function renderQR(value) {
    els.qr.innerHTML = "";
    const qr = qrcode(0, "M"); // type 0 = auto-size, M = ~15% error correction
    qr.addData(value);
    qr.make();
    els.qr.innerHTML = qr.createSvgTag({ scalable: true });
  }

  /**
   * Shares the link with the OS share sheet where available; otherwise
   * copies it to the clipboard. The plain-text link is always shown on the
   * page too (see render()), so a friend can still be sent it even where
   * neither of those work.
   */
  async function shareLink(url) {
    els.copiedNote.textContent = "";
    if (navigator.share) {
      try {
        await navigator.share({ title: "MaxFit", text: SHARE_TEXT, url });
      } catch (err) {
        // Cancelled, or sharing isn't allowed here — nothing to do either way.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      els.copiedNote.textContent = "Link copied — paste it anywhere.";
    } catch (err) {
      // No clipboard access — the link is already shown as selectable text.
    }
  }

  function render(member) {
    const url = `${JOIN_URL_BASE}?ref=${encodeURIComponent(member.code)}`;
    els.code.textContent = member.code;
    els.count.textContent = member.clientsReferred || "0";
    els.bonus.textContent = member.tokensOwed || "0";
    els.linkValue.textContent = url;
    renderQR(url);
    els.shareBtn.addEventListener("click", () => shareLink(url));
    showScreen("content");
  }

  els.bonusWrap.addEventListener("click", () => {
    els.bonusWrap.classList.toggle("card__sessions--revealed");
  });

  async function init() {
    if (!memberId) {
      showNotice("Open this from your card", "Referring a friend works from your membership card. Open your card, then tap Refer a friend.");
      return;
    }
    els.back.href = "./?id=" + encodeURIComponent(memberId);

    let member;
    try {
      member = await resolveMember();
    } catch (err) {
      showNotice("Can't load your link", "Check your connection and try again.");
      return;
    }
    if (!member) {
      showNotice("We couldn't find you", "Open this from your own membership card.");
      return;
    }
    if (!member.code) {
      showNotice("Not ready yet", "Max hasn't switched this on for you yet — check back soon.");
      return;
    }
    render(member);
  }

  init();
})();
