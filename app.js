const TOKEN_KEY = "xmasWishlistSessionV1";
const API_BASE = String(window.XMAS_CONFIG?.apiBase || "").replace(/\/+$/, "");
const BACKEND_CONFIGURED = API_BASE && !API_BASE.includes("REPLACE-WITH-WORKER");

const canonicalMembers = [
  { member_key: "ub", display_name: "UB", setup_state: "setup" },
  { member_key: "bill", display_name: "Bill", setup_state: "awaiting-invite" },
  { member_key: "michele", display_name: "Michele", setup_state: "awaiting-invite" },
  { member_key: "mac", display_name: "Mac", setup_state: "awaiting-invite" },
  { member_key: "mollie", display_name: "Mollie", setup_state: "awaiting-invite" },
  { member_key: "brett", display_name: "Brett", setup_state: "awaiting-invite" }
];

let token = localStorage.getItem(TOKEN_KEY) || "";
let publicMembers = [];
let selectedMember = null;
let currentUser = null;
let currentWishlist = null;

const $ = id => document.getElementById(id);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[ch]));
}

function memberInitials(name) {
  return String(name || "?")
    .split(/\s+/)
    .map(part => part[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function portrait(member) {
  const src = member.avatarAsset || member.avatar_asset;
  const name = member.displayName || member.display_name;
  if (src) return `<div class="portrait"><img src="${esc(src)}" alt=""></div>`;
  return `<div class="portrait" aria-hidden="true">${esc(memberInitials(name))}</div>`;
}

function setStatus(text) {
  $("statusText").textContent = text;
}

function showNotice(text) {
  $("backendNotice").textContent = text;
  $("backendNotice").classList.remove("hidden");
}

function hideNotice() {
  $("backendNotice").classList.add("hidden");
}

async function api(path, options = {}) {
  if (!BACKEND_CONFIGURED) throw new Error("The Cloudflare backend has not been connected yet.");

  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(API_BASE + path, { ...options, headers });
  let data = {};
  try { data = await response.json(); } catch {}

  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }

  return data;
}

async function boot() {
  if (!BACKEND_CONFIGURED) {
    showNotice("Foundation code is loaded, but the Cloudflare Worker URL has not been connected yet.");
    publicMembers = canonicalMembers;
    renderAuthMembers();
    setStatus("Backend connection pending");
    window.__XMAS_READY__ = true;
    return;
  }

  hideNotice();

  if (token) {
    try {
      const data = await api("/api/me");
      currentUser = data.member;
      await enterApp();
      window.__XMAS_READY__ = true;
      return;
    } catch (error) {
      token = "";
      currentUser = null;
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  await loadPublicMembers();
  window.__XMAS_READY__ = true;
}

async function loadPublicMembers() {
  try {
    const data = await api("/api/members/public");
    publicMembers = data.members || [];
    renderAuthMembers();
    setStatus("Choose your elf");
  } catch (error) {
    publicMembers = canonicalMembers;
    showNotice(error.message);
    renderAuthMembers();
    setStatus("Could not reach the family workshop");
  }
}

function renderAuthMembers() {
  $("authView").classList.remove("hidden");
  $("homeView").classList.add("hidden");
  $("authForm").classList.add("hidden");
  $("memberPicker").classList.remove("hidden");

  $("memberPicker").innerHTML = publicMembers.map(member => {
    const state = member.setup_state || "ready";
    const label = state === "ready"
      ? "Ready"
      : state === "setup"
        ? "First-time setup"
        : "Waiting for invite code";

    return `
      <button class="member-card" data-member-key="${esc(member.member_key)}" type="button">
        ${portrait(member)}
        <span class="nameplate">${esc(member.display_name)}</span>
        <span class="setup-state">${esc(label)}</span>
      </button>
    `;
  }).join("");

  $("memberPicker").querySelectorAll("[data-member-key]").forEach(button => {
    button.addEventListener("click", () => chooseMember(button.dataset.memberKey));
  });
}

function chooseMember(memberKey) {
  selectedMember = publicMembers.find(member => member.member_key === memberKey);
  if (!selectedMember) return;

  $("memberPicker").classList.add("hidden");
  $("authForm").classList.remove("hidden");

  const state = selectedMember.setup_state || "ready";
  const isSetup = state !== "ready";

  $("authTitle").textContent = `Welcome, ${selectedMember.display_name}`;
  $("setupCodeLabel").classList.toggle("hidden", !isSetup);
  $("passwordLabel").textContent = isSetup ? "Create your password" : "Password";
  $("password").autocomplete = isSetup ? "new-password" : "current-password";
  $("setupCode").value = "";
  $("password").value = "";

  if (state === "awaiting-invite") {
    $("authHelp").textContent = "UB needs to issue your one-time setup code first.";
    $("authSubmit").disabled = true;
  } else if (state === "setup") {
    $("authHelp").textContent = "Enter your one-time setup code, then choose a password. This device will remember you.";
    $("authSubmit").disabled = false;
  } else {
    $("authHelp").textContent = "Enter your password. This device will stay signed in until you log out or its session expires.";
    $("authSubmit").disabled = false;
  }
}

$("authBack").addEventListener("click", renderAuthMembers);

$("authForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!selectedMember) return;

  const state = selectedMember.setup_state || "ready";
  const password = $("password").value;

  try {
    setStatus("Opening the workshop…");
    const data = state === "ready"
      ? await api("/api/login", {
          method: "POST",
          body: JSON.stringify({ memberKey: selectedMember.member_key, password })
        })
      : await api("/api/setup", {
          method: "POST",
          body: JSON.stringify({
            memberKey: selectedMember.member_key,
            setupCode: $("setupCode").value,
            password
          })
        });

    token = data.token;
    currentUser = data.member;
    localStorage.setItem(TOKEN_KEY, token);
    await enterApp();
  } catch (error) {
    setStatus(error.message);
  }
});

async function enterApp() {
  $("authView").classList.add("hidden");
  $("homeView").classList.remove("hidden");
  $("adminButton").classList.toggle("hidden", currentUser?.role !== "admin");
  setStatus(`Signed in as ${currentUser.displayName}`);
  await showHome();
}

function showOnly(panelId) {
  for (const id of ["homePanel", "wishlistPanel", "shoppingPanel", "adminPanel"]) {
    $(id).classList.toggle("hidden", id !== panelId);
  }
}

async function showHome() {
  showOnly("homePanel");
  const data = await api("/api/home");
  currentUser = data.currentUser;
  renderFamily(data.members || []);
}

function renderFamily(members) {
  $("familyGrid").innerHTML = members.map(member => `
    <button class="member-card" data-open-list="${esc(member.memberKey)}" type="button">
      ${portrait(member)}
      <span class="nameplate">${esc(member.displayName)}</span>
      ${member.hasNew ? '<span class="new-bulb" title="New wish added" aria-label="New wish added"></span>' : ""}
      <span class="setup-state">${member.isSelf ? "My wishlist" : "Open wishlist"}</span>
    </button>
  `).join("");

  $("familyGrid").querySelectorAll("[data-open-list]").forEach(button => {
    button.addEventListener("click", () => openWishlist(button.dataset.openList));
  });
}

async function openWishlist(memberKey) {
  showOnly("wishlistPanel");
  $("wishForm").classList.add("hidden");
  $("wishList").innerHTML = '<div class="empty">Loading wishlist…</div>';

  try {
    const data = await api(`/api/wishlists/${encodeURIComponent(memberKey)}`);
    currentWishlist = data;

    $("wishlistTitle").textContent = data.isOwner
      ? "My wishlist"
      : `${data.owner.displayName}'s wishlist`;

    $("wishlistMode").textContent = data.isOwner
      ? "Add, edit, or remove your wishes. Claim information is never shown here."
      : "Available gifts can be reserved. Taken gifts never reveal who selected them.";

    $("addWishButton").classList.toggle("hidden", !data.isOwner);
    renderWishlist();

    if (!data.isOwner) {
      await api(`/api/wishlists/${encodeURIComponent(memberKey)}/viewed`, { method: "POST" });
    }
  } catch (error) {
    $("wishList").innerHTML = `<div class="empty">${esc(error.message)}</div>`;
  }
}

function renderWishlist() {
  const data = currentWishlist;
  if (!data) return;

  if (!data.items.length) {
    $("wishList").innerHTML = `<div class="empty">${data.isOwner ? "Your wishlist is empty." : "No wishes here yet."}</div>`;
    return;
  }

  $("wishList").innerHTML = data.items.map(item => {
    const ownerControls = data.isOwner
      ? `<button class="secondary compact" data-edit-wish="${item.id}">Edit</button>
         <button class="secondary compact" data-delete-wish="${item.id}">Remove</button>`
      : item.availability === "available"
        ? `<span class="badge available">AVAILABLE</span>
           <button class="primary compact" data-reserve-wish="${item.id}">Reserve</button>`
        : '<span class="badge taken">TAKEN</span>';

    return `
      <article class="wish-card">
        <h3>${esc(item.title)}</h3>
        ${item.notes ? `<p>${esc(item.notes)}</p>` : ""}
        ${item.url ? `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Open gift link</a>` : ""}
        <div class="wish-meta">${ownerControls}</div>
      </article>
    `;
  }).join("");

  $("wishList").querySelectorAll("[data-edit-wish]").forEach(button => {
    button.addEventListener("click", () => {
      const item = data.items.find(x => x.id === Number(button.dataset.editWish));
      openWishForm(item);
    });
  });

  $("wishList").querySelectorAll("[data-delete-wish]").forEach(button => {
    button.addEventListener("click", () => removeWish(Number(button.dataset.deleteWish)));
  });

  $("wishList").querySelectorAll("[data-reserve-wish]").forEach(button => {
    button.addEventListener("click", () => reserveWish(Number(button.dataset.reserveWish)));
  });
}

function openWishForm(item = null) {
  $("wishForm").classList.remove("hidden");
  $("wishId").value = item?.id || "";
  $("wishTitle").value = item?.title || "";
  $("wishUrl").value = item?.url || "";
  $("wishNotes").value = item?.notes || "";
  $("wishTitle").focus();
}

function closeWishForm() {
  $("wishForm").classList.add("hidden");
  $("wishForm").reset();
  $("wishId").value = "";
}

$("addWishButton").addEventListener("click", () => openWishForm());
$("cancelWish").addEventListener("click", closeWishForm);

$("wishForm").addEventListener("submit", async event => {
  event.preventDefault();
  const id = Number($("wishId").value || 0);
  const payload = {
    title: $("wishTitle").value,
    url: $("wishUrl").value,
    notes: $("wishNotes").value
  };

  try {
    if (id) {
      await api(`/api/wishes/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
    } else {
      await api("/api/wishes", { method: "POST", body: JSON.stringify(payload) });
    }
    closeWishForm();
    await openWishlist(currentWishlist.owner.memberKey);
  } catch (error) {
    setStatus(error.message);
  }
});

async function removeWish(id) {
  if (!confirm("Remove this wish from your list?")) return;
  try {
    await api(`/api/wishes/${id}`, { method: "DELETE" });
    await openWishlist(currentWishlist.owner.memberKey);
  } catch (error) {
    setStatus(error.message);
  }
}

async function reserveWish(id) {
  try {
    await api(`/api/wishes/${id}/reserve`, { method: "POST" });
    setStatus("Gift reserved privately.");
    await openWishlist(currentWishlist.owner.memberKey);
  } catch (error) {
    setStatus(error.message);
    await openWishlist(currentWishlist.owner.memberKey);
  }
}

async function showShopping() {
  showOnly("shoppingPanel");
  $("shoppingList").innerHTML = '<div class="empty">Loading your private list…</div>';

  try {
    const data = await api("/api/shopping");
    renderShopping(data.items || []);
  } catch (error) {
    $("shoppingList").innerHTML = `<div class="empty">${esc(error.message)}</div>`;
  }
}

function renderShopping(items) {
  if (!items.length) {
    $("shoppingList").innerHTML = '<div class="empty">You have not reserved any gifts yet.</div>';
    return;
  }

  $("shoppingList").innerHTML = items.map(item => {
    const status = item.status.toUpperCase();
    const changed = item.changed
      ? `<div class="warning"><strong>${esc(item.owner.displayName)} changed this wish after you reserved it.</strong><br>
         Originally: ${esc(item.original.title)}${item.original.notes ? " — " + esc(item.original.notes) : ""}<br>
         Current: ${esc(item.current.title)}${item.current.notes ? " — " + esc(item.current.notes) : ""}</div>`
      : "";

    const removed = item.removed
      ? `<div class="warning"><strong>${esc(item.owner.displayName)} removed this item from the wishlist.</strong><br>
         Your original reservation is preserved here.</div>`
      : "";

    const controls = item.status === "reserved"
      ? `<button class="primary compact" data-purchase="${item.wishId}">Mark purchased</button>
         <button class="secondary compact" data-release="${item.wishId}">Release</button>`
      : "";

    return `
      <article class="wish-card">
        <h3>${esc(item.original.title)}</h3>
        <p>For ${esc(item.owner.displayName)}</p>
        <span class="badge ${esc(item.status)}">${esc(status)}</span>
        ${changed}
        ${removed}
        <div class="wish-meta">${controls}</div>
      </article>
    `;
  }).join("");

  $("shoppingList").querySelectorAll("[data-purchase]").forEach(button => {
    button.addEventListener("click", async () => {
      try {
        await api(`/api/wishes/${button.dataset.purchase}/purchase`, { method: "POST" });
        await showShopping();
      } catch (error) { setStatus(error.message); }
    });
  });

  $("shoppingList").querySelectorAll("[data-release]").forEach(button => {
    button.addEventListener("click", async () => {
      if (!confirm("Release this reservation so someone else can take it?")) return;
      try {
        await api(`/api/wishes/${button.dataset.release}/release`, { method: "POST" });
        await showShopping();
      } catch (error) { setStatus(error.message); }
    });
  });
}

async function showAdmin() {
  showOnly("adminPanel");
  $("memberForm").classList.add("hidden");
  $("inviteResult").classList.add("hidden");
  $("adminList").innerHTML = '<div class="empty">Loading members…</div>';

  try {
    const data = await api("/api/admin/members");
    renderAdminMembers(data.members || []);
  } catch (error) {
    $("adminList").innerHTML = `<div class="empty">${esc(error.message)}</div>`;
  }
}

function renderAdminMembers(members) {
  $("adminList").innerHTML = members.map(member => {
    const access = member.setupComplete
      ? "Set up"
      : member.invitePending ? "Invite code issued" : "Not set up";

    const inviteButton = member.setupComplete
      ? `<button class="secondary compact" data-reset-member="${member.id}">Reset access</button>`
      : `<button class="secondary compact" data-invite-member="${member.id}">Issue setup code</button>`;

    const activeButton = member.memberKey === currentUser.memberKey
      ? ""
      : member.active
        ? `<button class="secondary compact" data-active-member="${member.id}" data-active-value="false">Deactivate</button>`
        : `<button class="secondary compact" data-active-member="${member.id}" data-active-value="true">Reactivate</button>`;

    return `
      <article class="wish-card">
        <h3>${esc(member.displayName)} ${member.role === "admin" ? '<span class="badge reserved">ADMIN</span>' : ""}</h3>
        <p>${esc(access)} · ${member.active ? "Active" : "Inactive"}</p>
        <div class="wish-meta">${inviteButton}${activeButton}</div>
      </article>
    `;
  }).join("");

  $("adminList").querySelectorAll("[data-invite-member]").forEach(button => {
    button.addEventListener("click", () => issueCode(button.dataset.inviteMember, false));
  });

  $("adminList").querySelectorAll("[data-reset-member]").forEach(button => {
    button.addEventListener("click", () => issueCode(button.dataset.resetMember, true));
  });

  $("adminList").querySelectorAll("[data-active-member]").forEach(button => {
    button.addEventListener("click", async () => {
      try {
        await api(`/api/admin/members/${button.dataset.activeMember}`, {
          method: "PATCH",
          body: JSON.stringify({ active: button.dataset.activeValue === "true" })
        });
        await showAdmin();
      } catch (error) { setStatus(error.message); }
    });
  });
}

async function issueCode(memberId, reset) {
  if (reset && !confirm("Reset this person's access? Their signed-in devices will be logged out.")) return;

  try {
    const action = reset ? "reset-access" : "invite";
    const data = await api(`/api/admin/members/${memberId}/${action}`, { method: "POST" });
    $("inviteResult").innerHTML = `Setup code for <strong>${esc(data.member.displayName)}</strong>: <strong>${esc(data.setupCode)}</strong><br>This code is shown once. Give it directly to that person.`;
    $("inviteResult").classList.remove("hidden");
    await showAdmin();
    $("inviteResult").innerHTML = `Setup code for <strong>${esc(data.member.displayName)}</strong>: <strong>${esc(data.setupCode)}</strong><br>This code is shown once. Give it directly to that person.`;
    $("inviteResult").classList.remove("hidden");
  } catch (error) {
    setStatus(error.message);
  }
}

$("addMemberButton").addEventListener("click", () => {
  $("memberForm").classList.remove("hidden");
  $("newMemberName").focus();
});
$("cancelMember").addEventListener("click", () => $("memberForm").classList.add("hidden"));

$("memberForm").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const data = await api("/api/admin/members", {
      method: "POST",
      body: JSON.stringify({
        displayName: $("newMemberName").value,
        memberKey: $("newMemberKey").value
      })
    });

    $("memberForm").reset();
    $("memberForm").classList.add("hidden");
    $("inviteResult").innerHTML = `Added <strong>${esc(data.displayName)}</strong>. Setup code: <strong>${esc(data.setupCode)}</strong><br>This code is shown once.`;
    $("inviteResult").classList.remove("hidden");
    const keep = $("inviteResult").innerHTML;
    await showAdmin();
    $("inviteResult").innerHTML = keep;
    $("inviteResult").classList.remove("hidden");
  } catch (error) {
    setStatus(error.message);
  }
});

$("logoutButton").addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST" }); } catch {}
  token = "";
  currentUser = null;
  currentWishlist = null;
  localStorage.removeItem(TOKEN_KEY);
  await loadPublicMembers();
});

$("homeButton").addEventListener("click", showHome);
$("wishlistBack").addEventListener("click", showHome);
$("shoppingButton").addEventListener("click", showShopping);
$("shoppingBack").addEventListener("click", showHome);
$("adminButton").addEventListener("click", showAdmin);
$("adminBack").addEventListener("click", showHome);

window.addEventListener("pageshow", () => {
  if (token && currentUser) setStatus(`Signed in as ${currentUser.displayName}`);
});

window.__XMAS_APP_STATE__ = () => ({
  ready: Boolean(window.__XMAS_READY__),
  backendConfigured: BACKEND_CONFIGURED,
  signedIn: Boolean(currentUser),
  currentMemberKey: currentUser?.memberKey || null
});

boot().catch(error => {
  console.error(error);
  showNotice(error.message || "The app could not start.");
  setStatus("Startup problem");
  window.__XMAS_READY__ = true;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(error => {
      console.warn("Service worker registration failed", error);
    });
  });
}
