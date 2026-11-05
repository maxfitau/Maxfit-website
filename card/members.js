/*
 * App members (coach's phone, card/members.html): everyone who isn't a client
 * (Client isn't Yes on the Sessions Remaining tab; see card/people.js). Shows
 * when they joined, when they were last active, their Fuel plan and how they
 * joined. People who tapped "Become a member" on their card go at the top.
 * "Make client" has its own in-page "Are you sure?". Nothing about their
 * history changes either way. Everything is put on the page with textContent.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const els = {
    gate: $("gate"), pageStatus: $("pageStatus"), listView: $("listView"),
    switchHost: $("switchHost"), listStatus: $("listStatus"), list: $("memberList"),
  };
  const el = People.el;
  let pin = "";
  let data = null;
  let message = "";

  function howJoined(p) {
    if (p.referredBy) return "Refer a Friend: " + p.referredBy;
    if (p.joinedVia) return p.joinedVia;
    return "Added by Max";
  }

  /** People who asked first (newest ask first), then newest joiners. */
  function ordered() {
    const list = data.people.filter((p) => !p.isClient);
    const asked = list.filter((p) => p.asked).sort((a, b) => String(b.asked.last).localeCompare(String(a.asked.last)));
    const rest = list.filter((p) => !p.asked).sort((a, b) => String(b.signupDate).localeCompare(String(a.signupDate)) || a.name.localeCompare(b.name));
    return asked.concat(rest);
  }

  function render() {
    els.switchHost.textContent = "";
    els.switchHost.appendChild(People.switcher("members", data.people.filter((p) => !p.isClient && p.asked).length));
    els.list.textContent = "";
    els.listStatus.textContent = message || data.notes[0] || "";
    if (!data.hasClientColumn) {
      els.list.appendChild(People.needsSetupNote());
      return;
    }
    const list = ordered();
    if (!list.length) {
      els.listStatus.textContent = els.listStatus.textContent || "No app members yet.";
      return;
    }
    list.forEach((p) => {
      const card = el("div", "pcard" + (p.asked ? " pcard--ask" : ""));
      const head = el("div", "pcard__head");
      head.appendChild(el("h2", "pcard__name", p.name));
      head.appendChild(el("span", "pcard__chip" + (p.asked ? "" : " pcard__chip--quiet"), p.asked ? "Asked to train" : "Hasn't asked"));
      card.appendChild(head);
      if (p.asked) {
        const times = p.asked.count > 1 ? ` (${p.asked.count} times)` : "";
        card.appendChild(el("p", "pcard__asked", "Tapped Become a member · " + People.agoWithTime(p.asked.last) + times));
      }
      const facts = el("dl", "pfacts");
      facts.appendChild(People.fact("Joined", p.signupDate ? People.niceDate(p.signupDate) : "Not recorded"));
      facts.appendChild(People.fact("Last active", People.lastActive(p) ? People.ago(People.lastActive(p)) : "Not yet"));
      facts.appendChild(People.fact("Fuel plan", p.plan));
      facts.appendChild(People.fact("How they joined", howJoined(p)));
      card.appendChild(facts);
      const row = el("div", "prow");
      row.appendChild(People.button("Make client", "", () => {
        const first = p.name.split(" ")[0];
        People.confirmSheet(card, {
          title: `Make ${first} a client?`,
          text: `${first} will move to My clients and the Become a member button disappears from their card. Their Fuel plan and history stay exactly as they are, and you can move them back any time.`,
          yesLabel: "Yes, make client",
          onYes: async () => {
            await People.setClient(pin, p, true);
            p.isClient = true;
            message = `${first} is now a client. Find them under My clients.`;
            render();
            window.scrollTo(0, 0);
          },
        });
      }));
      row.appendChild(p.phone ? People.linkButton("Message", "sms:" + p.phone, "ghost") : People.linkButton("Open card", "./?id=" + encodeURIComponent(p.slug), "ghost"));
      card.appendChild(row);
      els.list.appendChild(card);
    });
  }

  People.open(els.gate, els.pageStatus, (thePin, loaded) => {
    pin = thePin;
    data = loaded;
    els.listView.hidden = false;
    render();
  });
})();
