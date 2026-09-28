/*
 * Refer a friend — opened from the membership card (card/index.html ->
 * refer.html?id=<slug>). Same identity as the rest of the card: ?id= in the
 * URL, falling back to whatever the card last saved in localStorage.
 *
 * No codes: the QR and link take a friend to the sign-up form as
 * join.html?ref=<card id>, and the backend writes this client's name into
 * the new Lead's "Referred By" (findClientNameBySlug_ in Code.gs). Once Max
 * has them as a client, every session they pay for adds a punch to this
 * client's card ("Referral Punches", read from the public CRM sheet like the
 * rest of the card). This page never writes anything.
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
    punches: $("referPunches"),
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

  /** Who is asking: their card id and referral punches, from the public CRM sheet. */
  async function resolveMember() {
    const { rows, col } = await fetchSheet();
    const wanted = slugify(memberId);
    const match = rows.find((r) => r[col.name] && slugify(r[col.name]) === wanted);
    if (!match) return null;
    return {
      slug: wanted,
      punches: col.referralPunches >= 0 ? parseSessions(match[col.referralPunches], 0) : 0,
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
    const url = `${JOIN_URL_BASE}?ref=${encodeURIComponent(member.slug)}`;
    els.punches.textContent = String(member.punches);
    els.linkValue.textContent = url;
    renderQR(url);
    els.shareBtn.addEventListener("click", () => shareLink(url));
    showScreen("content");
  }

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
    render(member);
  }

  init();
})();
