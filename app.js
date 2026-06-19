"use strict";

const DB_NAME = "hi-moments-v1";
const DB_VERSION = 1;
const stores = ["moments", "people", "settings"];
const defaultMe = () => ({ name: "", headline: "", phone: "", email: "", x: "", website: "", linkedin: "", shareContacts: false });

const state = {
  db: null,
  view: "today",
  moments: [],
  people: [],
  activeMomentId: null,
  selectedAppearanceId: null,
  peopleFilter: "all",
  mediaUrls: new Map(),
  settings: { retentionDays: 30, detectionEnabled: true },
  me: defaultMe(),
  pendingAfterMe: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const uid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const normalize = (value = "") => value.trim().toLowerCase().replace(/\s+/g, " ");
const initials = (name = "") => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2600);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      stores.forEach((name) => {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbStore(name, mode = "readonly") {
  return state.db.transaction(name, mode).objectStore(name);
}

function dbAll(name) {
  return new Promise((resolve, reject) => {
    const request = dbStore(name).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbPut(name, value) {
  return new Promise((resolve, reject) => {
    const request = dbStore(name, "readwrite").put(value);
    request.onsuccess = () => resolve(value);
    request.onerror = () => reject(request.error);
  });
}

function dbClear(name) {
  return new Promise((resolve, reject) => {
    const request = dbStore(name, "readwrite").clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function loadState() {
  state.moments = (await dbAll("moments")).sort((a, b) => b.createdAt - a.createdAt);
  state.people = (await dbAll("people")).sort((a, b) => b.updatedAt - a.updatedAt);
  const settings = await dbAll("settings");
  const saved = settings.find((item) => item.id === "privacy");
  if (saved) state.settings = { ...state.settings, ...saved.value };
  const savedMe = settings.find((item) => item.id === "me");
  if (savedMe) state.me = { ...defaultMe(), ...savedMe.value };
  await applyRetention();
  rebuildMediaUrls();
}

function rebuildMediaUrls() {
  state.mediaUrls.forEach((url) => URL.revokeObjectURL(url));
  state.mediaUrls.clear();
  state.moments.forEach((moment) => {
    if (moment.mediaBlob) state.mediaUrls.set(moment.id, URL.createObjectURL(moment.mediaBlob));
  });
}

async function applyRetention() {
  const days = Number(state.settings.retentionDays);
  if (!days) return;
  const cutoff = Date.now() - days * 86400000;
  const expired = state.moments.filter((moment) => moment.createdAt < cutoff && moment.mediaBlob);
  if (!expired.length) return;
  for (const moment of expired) {
    moment.mediaBlob = null;
    moment.mediaType = null;
    moment.mediaExpired = true;
    await dbPut("moments", moment);
  }
}

function activeMoment() {
  return state.moments.find((moment) => moment.id === state.activeMomentId) || null;
}

function selectedAppearance() {
  const moment = activeMoment();
  return moment?.appearances?.find((appearance) => appearance.id === state.selectedAppearanceId) || null;
}

function personForAppearance(appearance) {
  return appearance?.personId ? state.people.find((person) => person.id === appearance.personId) : null;
}

function switchView(view) {
  state.view = view;
  $$(".view").forEach((element) => element.classList.toggle("active", element.dataset.view === view));
  $$('[data-nav]').forEach((button) => button.classList.toggle("active", button.dataset.nav === view));
  if (view === "review") renderReview();
  if (view === "people") renderPeople();
  if (view === "privacy") renderPrivacy();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function formatDay(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(timestamp));
}

function peopleForMoment(moment) {
  const ids = new Set((moment.appearances || []).map((item) => item.personId).filter(Boolean));
  return state.people.filter((person) => ids.has(person.id));
}

function renderToday() {
  const today = new Date().toDateString();
  const moments = state.moments.filter((moment) => new Date(moment.createdAt).toDateString() === today);
  $("#todayLabel").textContent = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date());
  $("#todayCount").textContent = `${moments.length} moment${moments.length === 1 ? "" : "s"}`;
  const list = $("#momentList");
  $("#meSetup").hidden = Boolean(state.me.name);
  list.innerHTML = "";

  if (!moments.length) {
    list.innerHTML = `
      <div class="empty-card">
        <div><i data-lucide="coffee"></i><strong>No one yet today</strong><p>Capture a moment or write a quick note. Everything begins privately on this device.</p></div>
      </div>`;
    refreshIcons();
    return;
  }

  moments.forEach((moment) => {
    const people = peopleForMoment(moment);
    const row = document.createElement("article");
    row.className = "moment-row";
    const url = state.mediaUrls.get(moment.id);
    const thumb = url && moment.mediaType?.startsWith("image/")
      ? `<img src="${url}" alt="" />`
      : `<i data-lucide="${moment.mediaType?.startsWith("video/") ? "video" : "message-circle"}"></i>`;
    row.innerHTML = `
      <button class="moment-thumb" type="button" aria-label="Review moment">${thumb}</button>
      <div><strong>${escapeHtml(moment.title || people.map((person) => person.name).join(", ") || "Untitled moment")}</strong><small>${formatTime(moment.createdAt)}${moment.note ? ` · ${escapeHtml(moment.note)}` : ""}</small></div>
      <div class="moment-people">${people.slice(0, 4).map((person) => `<span class="mini-avatar" title="${escapeHtml(person.name)}">${initials(person.name)}</span>`).join("")}</div>`;
    row.querySelector("button").addEventListener("click", () => {
      state.activeMomentId = moment.id;
      state.selectedAppearanceId = moment.appearances?.[0]?.id || null;
      switchView("review");
    });
    list.append(row);
  });
  refreshIcons();
}

function escapeHtml(value = "") {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

async function createMediaMoment(file) {
  const moment = {
    id: uid("moment"),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    title: file.name.replace(/\.[^.]+$/, "") || "New moment",
    note: "",
    mediaBlob: file,
    mediaType: file.type,
    source: "user",
    appearances: [],
  };
  await dbPut("moments", moment);
  state.moments.unshift(moment);
  state.mediaUrls.set(moment.id, URL.createObjectURL(file));
  state.activeMomentId = moment.id;
  state.selectedAppearanceId = null;
  renderToday();
  switchView("review");
  toast("Saved privately. Review visible people when ready.");
}

function demoSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 820">
    <rect width="1400" height="820" fill="#c9d8d1"/><rect y="570" width="1400" height="250" fill="#8ba89a"/>
    <rect x="55" y="54" width="1290" height="585" rx="18" fill="#f5efe2"/>
    <rect x="100" y="100" width="1200" height="28" rx="14" fill="#dbe2df"/>
    <circle cx="285" cy="273" r="78" fill="#9a6750"/><path d="M196 602V430c0-62 40-105 89-105s89 43 89 105v172" fill="#2f7390"/>
    <circle cx="663" cy="244" r="82" fill="#b37659"/><path d="M568 602V405c0-64 42-108 95-108s95 44 95 108v197" fill="#24765d"/>
    <circle cx="1047" cy="293" r="74" fill="#78564b"/><path d="M960 602V444c0-60 39-100 87-100s87 40 87 100v158" fill="#ca684d"/>
    <circle cx="454" cy="552" r="58" fill="#835f4e"/><path d="M390 770V665c0-48 29-78 64-78s64 30 64 78v105" fill="#364458"/>
  </svg>`;
}

async function loadDemo() {
  const blob = new Blob([demoSvg()], { type: "image/svg+xml" });
  const moment = {
    id: uid("moment"),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    title: "Community dinner demo",
    note: "Synthetic media. No real people are shown.",
    mediaBlob: blob,
    mediaType: "image/svg+xml",
    source: "demo",
    appearances: [
      makeAppearance("Person A", { x: 13, y: 17, w: 16, h: 51 }),
      makeAppearance("Person B", { x: 39, y: 13, w: 17, h: 57 }),
      makeAppearance("Person C", { x: 68, y: 20, w: 16, h: 49 }),
      makeAppearance("Person D", { x: 27, y: 58, w: 13, h: 38 }),
    ],
  };
  await dbPut("moments", moment);
  state.moments.unshift(moment);
  state.mediaUrls.set(moment.id, URL.createObjectURL(blob));
  state.activeMomentId = moment.id;
  state.selectedAppearanceId = moment.appearances[0].id;
  renderToday();
  switchView("review");
  toast("Synthetic demo loaded. No identity matching was performed.");
}

function makeAppearance(label, box = null) {
  return { id: uid("appearance"), label, personId: null, box: box || nextManualBox(), source: "manual" };
}

function nextManualBox() {
  const moment = activeMoment();
  const count = moment?.appearances?.length || 0;
  const positions = [
    { x: 35, y: 22, w: 24, h: 45 },
    { x: 10, y: 26, w: 22, h: 42 },
    { x: 64, y: 24, w: 22, h: 43 },
    { x: 37, y: 50, w: 21, h: 38 },
  ];
  return positions[count % positions.length];
}

async function addAppearance() {
  const moment = activeMoment();
  if (!moment) {
    toast("Choose a photo or video first.");
    return;
  }
  const appearance = makeAppearance(`Person ${String.fromCharCode(65 + moment.appearances.length)}`);
  moment.appearances.push(appearance);
  moment.updatedAt = Date.now();
  await dbPut("moments", moment);
  state.selectedAppearanceId = appearance.id;
  renderReview();
}

async function detectVisiblePeople() {
  const moment = activeMoment();
  if (!moment?.mediaBlob) {
    toast("Choose media first.");
    return;
  }
  if (!state.settings.detectionEnabled) {
    toast("Native detection is disabled in Privacy settings.");
    return;
  }
  if (!("FaceDetector" in window)) {
    $("#analysisStatus").innerHTML = '<i data-lucide="info"></i> Native detection unavailable; add people manually';
    refreshIcons();
    toast("This browser does not expose local face detection. Manual labeling remains available.");
    return;
  }

  try {
    $("#detectButton").disabled = true;
    $("#analysisStatus").textContent = "Detecting locally…";
    const detector = new FaceDetector({ fastMode: true, maxDetectedFaces: 24 });
    const target = moment.mediaType.startsWith("video/") ? $("#videoPreview") : $("#imagePreview");
    const faces = await detector.detect(target);
    const width = target.videoWidth || target.naturalWidth;
    const height = target.videoHeight || target.naturalHeight;
    moment.appearances = faces.map((face, index) => {
      const box = face.boundingBox;
      return makeAppearance(`Person ${String.fromCharCode(65 + index)}`, {
        x: (box.x / width) * 100,
        y: (box.y / height) * 100,
        w: (box.width / width) * 100,
        h: (box.height / height) * 100,
      });
    });
    moment.updatedAt = Date.now();
    await dbPut("moments", moment);
    state.selectedAppearanceId = moment.appearances[0]?.id || null;
    $("#analysisStatus").innerHTML = `<i data-lucide="scan-face"></i> ${faces.length} visible ${faces.length === 1 ? "person" : "people"} detected locally`;
    renderReview();
    toast(`${faces.length} visible ${faces.length === 1 ? "person" : "people"} detected. No identities were searched.`);
  } catch (error) {
    console.warn(error);
    toast("Local detection could not analyze this frame. Add people manually.");
  } finally {
    $("#detectButton").disabled = false;
    refreshIcons();
  }
}

function renderReview() {
  const moment = activeMoment();
  const stage = $("#mediaStage");
  const image = $("#imagePreview");
  const video = $("#videoPreview");
  const empty = $("#mediaEmpty");
  stage.classList.remove("image-mode", "video-mode");
  $("#appearanceLayer").innerHTML = "";

  if (!moment) {
    stage.classList.add("empty");
    empty.hidden = false;
    $("#appearanceCount").textContent = "0 people";
    $("#appearanceList").innerHTML = '<div class="empty-card"><p>Visible people will appear here after local detection or manual labeling.</p></div>';
    renderEditor();
    refreshIcons();
    return;
  }

  stage.classList.remove("empty");
  empty.hidden = true;
  const url = state.mediaUrls.get(moment.id);
  if (url && moment.mediaType?.startsWith("video/")) {
    video.src = url;
    stage.classList.add("video-mode");
  } else if (url) {
    image.src = url;
    stage.classList.add("image-mode");
  } else {
    stage.classList.add("empty");
    empty.hidden = false;
    empty.querySelector("strong").textContent = "Media expired";
    empty.querySelector("span").textContent = "Notes and people remain available.";
  }

  const appearances = moment.appearances || [];
  $("#appearanceCount").textContent = `${appearances.length} ${appearances.length === 1 ? "person" : "people"}`;
  const list = $("#appearanceList");
  list.innerHTML = "";
  appearances.forEach((appearance, index) => {
    const person = personForAppearance(appearance);
    const name = person?.name || appearance.label || `Person ${index + 1}`;
    const status = person?.hiOwner ? "Hi profile confirmed" : person ? "Saved locally" : "Unlabeled appearance";
    const card = document.createElement("button");
    card.type = "button";
    card.className = `appearance-card ${appearance.id === state.selectedAppearanceId ? "active" : ""}`;
    card.innerHTML = `<span class="person-avatar">${initials(name)}</span><span><strong>${escapeHtml(name)}</strong><small>${status}</small></span><span class="state-dot ${person?.hiOwner ? "connected" : ""}"></span>`;
    card.addEventListener("click", () => selectAppearance(appearance.id));
    list.append(card);

    if (appearance.box) {
      const box = document.createElement("button");
      box.type = "button";
      box.className = `face-box ${appearance.id === state.selectedAppearanceId ? "selected" : ""}`;
      Object.assign(box.style, { left: `${appearance.box.x}%`, top: `${appearance.box.y}%`, width: `${appearance.box.w}%`, height: `${appearance.box.h}%` });
      box.innerHTML = `<span>${escapeHtml(name)}</span>`;
      box.addEventListener("click", () => selectAppearance(appearance.id));
      $("#appearanceLayer").append(box);
    }
  });
  renderEditor();
  refreshIcons();
}

function selectAppearance(id) {
  state.selectedAppearanceId = id;
  renderReview();
}

function renderEditor() {
  const appearance = selectedAppearance();
  const person = personForAppearance(appearance);
  const disabled = !appearance;
  ["#personNameInput", "#personContextInput", "#hiSearchInput", "#hiSearchButton", "#savePersonButton", "#inviteButton"].forEach((selector) => { $(selector).disabled = disabled; });
  $("#searchResults").innerHTML = "";
  if (!appearance) {
    $("#editorAvatar").textContent = "?";
    $("#editorTitle").textContent = "Choose an appearance";
    $("#editorState").textContent = "Detection is not identity.";
    $("#personNameInput").value = "";
    $("#personContextInput").value = "";
    $("#hiSearchInput").value = "";
    return;
  }
  const name = person?.name || appearance.label;
  $("#editorAvatar").textContent = initials(name);
  $("#editorTitle").textContent = name;
  $("#editorState").textContent = person?.hiOwner ? "Existing Hi profile confirmed by you." : person ? "Private local person." : "Unlabeled appearance. Not a profile.";
  $("#personNameInput").value = person?.name || appearance.label;
  $("#personContextInput").value = person?.context || "";
  $("#hiSearchInput").value = "";
}

async function saveSelectedPerson({ quiet = false } = {}) {
  const appearance = selectedAppearance();
  if (!appearance) return null;
  const name = $("#personNameInput").value.trim() || appearance.label;
  const context = $("#personContextInput").value.trim();
  let person = personForAppearance(appearance);
  if (!person) {
    person = {
      id: uid("person"),
      name,
      nameLower: normalize(name),
      context,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      invitationState: "none",
      followUp: false,
      hiOwner: null,
    };
    state.people.unshift(person);
    appearance.personId = person.id;
  } else {
    person.name = name;
    person.nameLower = normalize(name);
    person.context = context;
    person.updatedAt = Date.now();
  }
  appearance.label = name;
  await dbPut("people", person);
  await dbPut("moments", activeMoment());
  renderReview();
  renderToday();
  if (!quiet) toast(`${name} saved privately on this device.`);
  return person;
}

async function searchHi() {
  const query = $("#hiSearchInput").value.trim();
  if (query.length < 2) {
    toast("Type at least 2 characters to search Hi.");
    return;
  }
  const results = $("#searchResults");
  results.innerHTML = '<div class="search-result"><span class="person-avatar">…</span><span><strong>Searching Hi</strong><small>By name and profile text, never by face.</small></span></div>';
  $("#hiSearchButton").disabled = true;
  try {
    const response = await fetch("https://hi.hirey.ai/v1/capabilities/hi.owners/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "search", q: query, limit: 5, typeahead: true }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const data = payload.result || payload;
    const people = data.people || data.items || [];
    renderHiResults(people);
  } catch (error) {
    console.warn(error);
    results.innerHTML = '<div class="search-result"><span class="person-avatar">!</span><span><strong>Hi search unavailable</strong><small>Keep this person local and try again later.</small></span></div>';
  } finally {
    $("#hiSearchButton").disabled = false;
  }
}

function renderHiResults(people) {
  const results = $("#searchResults");
  results.innerHTML = "";
  if (!people.length) {
    results.innerHTML = '<div class="search-result"><span class="person-avatar">0</span><span><strong>No Hi profiles found</strong><small>This person remains local and private.</small></span></div>';
    return;
  }
  people.slice(0, 5).forEach((candidate) => {
    const name = candidate.display_name || candidate.owner_profile?.display_name || "Hi member";
    const headline = candidate.headline || candidate.owner_profile?.headline || "Profile on Hi";
    const ownerPublicId = candidate.owner_public_id || candidate.public_id || candidate.owner_profile?.owner_public_id || null;
    const ownerUrl = candidate.owner_public_url || candidate.owner_profile?.owner_public_url || (ownerPublicId ? `https://hi.hirey.ai/owner/${ownerPublicId}` : null);
    const row = document.createElement("div");
    row.className = "search-result";
    row.innerHTML = `<span class="person-avatar">${initials(name)}</span><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(headline)}</small></span><button class="secondary-button" type="button">Confirm</button>`;
    row.querySelector("button").addEventListener("click", () => confirmHiIdentity({ name, headline, ownerPublicId, ownerUrl }));
    results.append(row);
  });
}

async function confirmHiIdentity(candidate) {
  const person = await saveSelectedPerson({ quiet: true });
  if (!person) return;
  person.hiOwner = candidate;
  person.name = candidate.name;
  person.nameLower = normalize(candidate.name);
  person.updatedAt = Date.now();
  await dbPut("people", person);
  $("#personNameInput").value = person.name;
  renderReview();
  renderPeople();
  toast(`${candidate.name}'s Hi profile linked after your confirmation.`);
}

function openModal(id) {
  $("#modalBackdrop").hidden = false;
  $$(".modal").forEach((modal) => { modal.hidden = modal.id !== id; });
  document.body.style.overflow = "hidden";
}

function closeModal() {
  $("#modalBackdrop").hidden = true;
  $$(".modal").forEach((modal) => { modal.hidden = true; });
  document.body.style.overflow = "";
}

function openMeModal() {
  $("#meNameInput").value = state.me.name;
  $("#meHeadlineInput").value = state.me.headline;
  $("#mePhoneInput").value = state.me.phone;
  $("#meEmailInput").value = state.me.email;
  $("#meXInput").value = state.me.x ? `@${state.me.x.replace(/^@/, "")}` : "";
  $("#meWebsiteInput").value = state.me.website;
  $("#meLinkedinInput").value = state.me.linkedin;
  $("#meShareCheck").checked = state.me.shareContacts;
  openModal("meModal");
  requestAnimationFrame(() => $("#meNameInput").focus());
}

async function saveMe() {
  const name = $("#meNameInput").value.trim();
  if (!name) {
    toast("Add your name first.");
    return;
  }
  state.me = {
    name,
    headline: $("#meHeadlineInput").value.trim(),
    phone: $("#mePhoneInput").value.trim(),
    email: $("#meEmailInput").value.trim(),
    x: $("#meXInput").value.trim().replace(/^@/, ""),
    website: $("#meWebsiteInput").value.trim(),
    linkedin: $("#meLinkedinInput").value.trim(),
    shareContacts: $("#meShareCheck").checked,
  };
  await dbPut("settings", { id: "me", value: state.me });
  closeModal();
  renderMe();
  renderToday();
  toast("Your card is ready.");
  if (state.pendingAfterMe === "invite") {
    state.pendingAfterMe = null;
    await openInvite();
  }
}

function renderMe() {
  const me = state.me;
  $("#identityStatus").textContent = me.name ? `${me.name} · local card` : "Set up your card";
  $("#meSetup").hidden = Boolean(me.name);
  $("#meCardAvatar").textContent = initials(me.name);
  $("#meCardName").textContent = me.name || "Not set up";
  $("#meCardSummary").textContent = me.headline || (me.name ? "Stored privately on this device." : "Add your name and optional links.");
  $("#editMeButton").textContent = me.name ? "Edit" : "Set up";

  const details = [];
  if (me.phone) details.push(["phone", me.phone]);
  if (me.email) details.push(["mail", me.email]);
  if (me.x) details.push(["at-sign", `@${me.x}`]);
  if (me.website) details.push(["globe-2", me.website]);
  if (me.linkedin) details.push(["linkedin", me.linkedin]);
  $("#meCardDetails").innerHTML = details.map(([icon, value]) => `<span><i data-lucide="${icon}"></i>${escapeHtml(value)}</span>`).join("");
  refreshIcons();
}

async function openInvite() {
  const person = await saveSelectedPerson({ quiet: true });
  if (!person) return;
  if (!state.me.name) {
    state.pendingAfterMe = "invite";
    openMeModal();
    toast("Set up your card before sending an invitation.");
    return;
  }
  $("#inviteContactInput").value = "";
  $("#permissionCheck").checked = false;
  $("#confirmInviteButton").disabled = true;
  openModal("inviteModal");
}

async function confirmInvite() {
  const contact = $("#inviteContactInput").value.trim();
  if (!contact) {
    toast("Add an email or phone number.");
    return;
  }
  if (!$("#permissionCheck").checked) return;
  const person = personForAppearance(selectedAppearance());
  if (!person) return;
  const lines = [`Hi ${person.name}, it’s ${state.me.name}. I saved a private note about meeting you in Hi Moments.`];
  if (state.me.headline) lines.push(state.me.headline);
  if (state.me.shareContacts) {
    const details = [
      state.me.phone && `Phone: ${state.me.phone}`,
      state.me.email && `Email: ${state.me.email}`,
      state.me.x && `X: @${state.me.x}`,
      state.me.website && `Web: ${state.me.website}`,
      state.me.linkedin && `LinkedIn: ${state.me.linkedin}`,
    ].filter(Boolean);
    if (details.length) lines.push(details.join(" · "));
  }
  lines.push("If you’d like, connect with me on Hi: https://hi.hirey.ai");
  const message = lines.join("\n");
  person.invitationState = "prepared";
  person.invitedAt = Date.now();
  person.updatedAt = Date.now();
  await dbPut("people", person);
  closeModal();

  try {
    if (navigator.share) {
      await navigator.share({ title: "Connect on Hi", text: message, url: "https://hi.hirey.ai" });
    } else {
      await navigator.clipboard.writeText(message);
      toast("Invitation copied. The contact detail was not stored.");
    }
  } catch (error) {
    if (error?.name !== "AbortError") toast("Invitation prepared, but could not open sharing.");
  }
  renderPeople();
}

async function saveQuickMoment() {
  const names = $("#quickNamesInput").value.split(/,|\band\b/i).map((name) => name.trim()).filter(Boolean);
  const note = $("#quickNoteInput").value.trim();
  if (!names.length && !note) {
    toast("Add a name or note first.");
    return;
  }
  const appearances = [];
  for (const name of names) {
    let person = state.people.find((item) => item.nameLower === normalize(name));
    if (!person) {
      person = { id: uid("person"), name, nameLower: normalize(name), context: note, createdAt: Date.now(), updatedAt: Date.now(), invitationState: "none", followUp: false, hiOwner: null };
      state.people.unshift(person);
      await dbPut("people", person);
    }
    appearances.push({ id: uid("appearance"), label: person.name, personId: person.id, box: null, source: "manual" });
  }
  const moment = { id: uid("moment"), createdAt: Date.now(), updatedAt: Date.now(), title: names.join(", ") || "Quick note", note, mediaBlob: null, mediaType: null, source: "note", appearances };
  state.moments.unshift(moment);
  await dbPut("moments", moment);
  closeModal();
  $("#quickNamesInput").value = "";
  $("#quickNoteInput").value = "";
  renderToday();
  toast("Moment saved privately.");
}

function renderPeople() {
  const grid = $("#peopleGrid");
  grid.innerHTML = "";
  let people = state.people;
  if (state.peopleFilter === "follow-up") people = people.filter((person) => person.followUp);
  if (state.peopleFilter === "connected") people = people.filter((person) => person.hiOwner);
  if (!people.length) {
    grid.innerHTML = '<div class="empty-card"><div><i data-lucide="users"></i><strong>No people in this view</strong><p>People appear after you label a moment or add a quick note.</p></div></div>';
    refreshIcons();
    return;
  }
  people.forEach((person) => {
    const moments = state.moments.filter((moment) => moment.appearances?.some((appearance) => appearance.personId === person.id));
    const status = person.hiOwner ? "Hi profile confirmed" : person.invitationState === "prepared" ? "Invite prepared" : "Local only";
    const card = document.createElement("article");
    card.className = "person-card";
    card.innerHTML = `
      <div class="person-card-head"><span class="person-avatar">${initials(person.name)}</span><div><h2>${escapeHtml(person.name)}</h2><p>${escapeHtml(person.context || "Private person in your diary")}</p></div></div>
      <div class="person-meta"><span>${moments.length} moment${moments.length === 1 ? "" : "s"}</span><span class="status-tag ${person.hiOwner ? "connected" : ""}">${status}</span></div>`;
    grid.append(card);
  });
  refreshIcons();
}

function renderPrivacy() {
  $("#retentionSelect").value = String(state.settings.retentionDays);
  $("#detectionToggle").checked = state.settings.detectionEnabled;
  renderMe();
}

async function savePrivacy() {
  state.settings.retentionDays = Number($("#retentionSelect").value);
  state.settings.detectionEnabled = $("#detectionToggle").checked;
  await dbPut("settings", { id: "privacy", value: state.settings });
  toast("Privacy settings saved.");
}

async function deleteAllData() {
  if (!window.confirm("Delete every local moment, person, and media file from this browser? This cannot be undone.")) return;
  await Promise.all(stores.map(dbClear));
  state.moments = [];
  state.people = [];
  state.activeMomentId = null;
  state.selectedAppearanceId = null;
  state.settings = { retentionDays: 30, detectionEnabled: true };
  state.me = defaultMe();
  state.pendingAfterMe = null;
  rebuildMediaUrls();
  renderToday();
  renderPeople();
  renderReview();
  renderPrivacy();
  toast("All local data deleted.");
}

function startDictation() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    toast("Voice dictation is not available in this browser.");
    return;
  }
  const recognition = new Recognition();
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = true;
  const button = $("#dictateButton");
  button.classList.add("listening");
  button.querySelector("span").textContent = "Listening…";
  recognition.onresult = (event) => {
    $("#quickNoteInput").value = [...event.results].map((result) => result[0].transcript).join(" ");
  };
  recognition.onend = () => {
    button.classList.remove("listening");
    button.querySelector("span").textContent = "Dictate instead";
  };
  recognition.onerror = recognition.onend;
  recognition.start();
}

function wireEvents() {
  $$('[data-nav]').forEach((button) => button.addEventListener("click", () => switchView(button.dataset.nav)));
  $("#settingsButton").addEventListener("click", () => switchView("privacy"));
  $("#identityButton").addEventListener("click", openMeModal);
  $("#setupMeButton").addEventListener("click", openMeModal);
  $("#editMeButton").addEventListener("click", openMeModal);
  $("#saveMeButton").addEventListener("click", saveMe);
  $("#cameraButton").addEventListener("click", () => $("#cameraInput").click());
  $("#libraryButton").addEventListener("click", () => $("#libraryInput").click());
  $("#cameraInput").addEventListener("change", (event) => { if (event.target.files[0]) createMediaMoment(event.target.files[0]); event.target.value = ""; });
  $("#libraryInput").addEventListener("change", (event) => { if (event.target.files[0]) createMediaMoment(event.target.files[0]); event.target.value = ""; });
  $("#noteButton").addEventListener("click", () => openModal("noteModal"));
  $("#loadDemoButton").addEventListener("click", loadDemo);
  $("#addAppearanceButton").addEventListener("click", addAppearance);
  $("#detectButton").addEventListener("click", detectVisiblePeople);
  $("#savePersonButton").addEventListener("click", () => saveSelectedPerson());
  $("#hiSearchButton").addEventListener("click", searchHi);
  $("#hiSearchInput").addEventListener("keydown", (event) => { if (event.key === "Enter") searchHi(); });
  $("#inviteButton").addEventListener("click", openInvite);
  $("#permissionCheck").addEventListener("change", (event) => { $("#confirmInviteButton").disabled = !event.target.checked; });
  $("#confirmInviteButton").addEventListener("click", confirmInvite);
  $("#saveQuickMomentButton").addEventListener("click", saveQuickMoment);
  $("#dictateButton").addEventListener("click", startDictation);
  $$(".modal-close").forEach((button) => button.addEventListener("click", closeModal));
  $("#modalBackdrop").addEventListener("click", (event) => { if (event.target === $("#modalBackdrop")) closeModal(); });
  $$("[data-filter]").forEach((button) => button.addEventListener("click", () => {
    state.peopleFilter = button.dataset.filter;
    $$("[data-filter]").forEach((item) => item.classList.toggle("active", item === button));
    renderPeople();
  }));
  $("#retentionSelect").addEventListener("change", savePrivacy);
  $("#detectionToggle").addEventListener("change", savePrivacy);
  $("#deleteAllButton").addEventListener("click", deleteAllData);
  $("#connectHiButton").addEventListener("click", () => openModal("connectModal"));
  $$("#connectModal .connect-options button").forEach((button) => button.addEventListener("click", () => toast("Secure Hi sign-in is the next production integration step.")));
  window.addEventListener("beforeunload", () => state.mediaUrls.forEach((url) => URL.revokeObjectURL(url)));
}

async function init() {
  try {
    state.db = await openDatabase();
    await loadState();
    wireEvents();
    renderToday();
    renderReview();
    renderPeople();
    renderPrivacy();
    renderMe();
    refreshIcons();
  } catch (error) {
    console.error(error);
    toast("Local storage could not start in this browser.");
  }
}

init();
