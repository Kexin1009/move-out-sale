(function () {
"use strict";

/* ---- Where the site lives on GitHub. Filled in automatically on <user>.github.io/<repo>/ ---- */
var CONFIG = { owner: "", repo: "", branch: "main" };
(function inferRepo() {
  var host = location.hostname, m = host.match(/^([^.]+)\.github\.io$/i);
  if (m) {
    CONFIG.owner = CONFIG.owner || m[1];
    var seg = location.pathname.split("/").filter(Boolean)[0];
    CONFIG.repo = CONFIG.repo || (seg && seg.indexOf(".") < 0 ? seg : host);
  }
})();

var TOKEN_KEY = "mos-gh-token";
var CONDITIONS = ["New", "Like new", "Good", "Fair", "Needs work"];
var state = null, published = "", ui = { filter: "all", sort: "default" };
var token = null, canEdit = false, editMode = false, saving = false;
var imgCache = {}; // path -> data URL, so freshly committed photos show before Pages rebuilds
var app = document.getElementById("app");

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }
function isDirty() { return state && JSON.stringify(state) !== published; }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function money(n) { if (n === 0) return "FREE"; if (n == null || n === "") return ""; return (state.settings.currency || "$") + (Math.round(n * 100) / 100); }
function src(p) { return imgCache[p] || p; }
function daysLeft() { var dl = state.settings.deadline; if (!dl) return null; var end = new Date(dl + "T23:59:59"); if (isNaN(end)) return null; return Math.ceil((end - new Date()) / 86400000); }
function fmtDate(dl) { var p = String(dl || "").split("-"), M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; return p.length === 3 ? M[+p[1] - 1] + " " + (+p[2]) : dl; }
function uid() { return "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function find(id) { for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return state.items[i]; }
function b64utf8(str) { return btoa(unescape(encodeURIComponent(str))); }
function utf8b64(b64) { return decodeURIComponent(escape(atob(b64.replace(/\s/g, "")))); }

/* ---------------- GitHub API ---------------- */
function gh(method, path, body) {
  return fetch("https://api.github.com/repos/" + CONFIG.owner + "/" + CONFIG.repo + path, {
    method: method,
    headers: { "Authorization": "Bearer " + token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store"
  }).then(function (r) {
    return r.text().then(function (t) {
      var j = t ? JSON.parse(t) : {};
      if (!r.ok) { var e = new Error(j.message || ("HTTP " + r.status)); e.status = r.status; throw e; }
      return j;
    });
  });
}

/* ---------------- Loading ---------------- */
function loadPublic() {
  return fetch("data/items.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) {
    if (!r.ok) throw new Error("items.json " + r.status);
    return r.json();
  });
}
function loadFromRepo() {
  return gh("GET", "/contents/data/items.json?ref=" + encodeURIComponent(CONFIG.branch) + "&t=" + Date.now())
    .then(function (j) { return JSON.parse(utf8b64(j.content)); });
}
function setState(s) { s.settings = s.settings || {}; s.items = s.items || []; state = s; published = JSON.stringify(s); }

/* ---------------- Rendering ---------------- */
function render() {
  if (!state) return;
  var s = state.settings, items = visibleItems(), dl = daysLeft();
  var avail = state.items.filter(function (i) { return i.status !== "sold"; }).length, sold = state.items.length - avail;
  var exN = state.items.filter(function (i) { return i.example; }).length;
  document.title = s.title || "Move Out Sale";
  var h = '<div class="tape" aria-hidden="true"><span>' + esc("EVERYTHING MUST GO · MOVING OUT · FURNITURE SALE · ".repeat(16)) + "</span></div>";
  h += '<header class="hero wrap"><div class="hero-top"><div style="min-width:0;flex:1 1 320px"><h1>' + esc(s.title) + "</h1>" + (s.intro ? '<p class="intro">' + esc(s.intro) + "</p>" : "") + "</div>";
  if (dl != null) h += '<div class="deadline" aria-label="Sale ends ' + esc(fmtDate(s.deadline)) + '">' + (dl > 1 ? "<b>" + dl + "</b><small>days left</small><small>ends " + esc(fmtDate(s.deadline)) + "</small>" : dl === 1 ? "<small>ends</small><b>Tmrw</b>" : dl === 0 ? "<small>last</small><b>Day</b>" : "<small>sale</small><b>Over</b><small>thank you</small>") + "</div>";
  h += '</div></header><main class="wrap"><div class="toolbar"><div class="chips" role="group" aria-label="Filter">';
  [["all", "All", state.items.length], ["available", "Available", avail], ["sold", "Sold", sold]].forEach(function (f) { h += '<button class="chip" data-filter="' + f[0] + '" aria-pressed="' + (ui.filter === f[0]) + '">' + f[1] + '<span class="n">' + f[2] + "</span></button>"; });
  h += '</div><div class="tools"><select id="sort" aria-label="Sort"><option value="default"' + (ui.sort === "default" ? " selected" : "") + '>Available first</option><option value="low"' + (ui.sort === "low" ? " selected" : "") + '>Price: low to high</option><option value="high"' + (ui.sort === "high" ? " selected" : "") + ">Price: high to low</option></select></div></div>";
  h += '<div class="count">' + avail + " available · " + sold + " sold</div>";
  if (canEdit && exN) h += '<div class="notice"><span>' + exN + ' example items are on the page (marked “Example”). Add your own furniture, then remove them.</span><button class="btn danger" data-act="clear-examples">Remove examples</button></div>';
  h += '<div class="grid">';
  if (!items.length) h += '<div class="empty">' + (state.items.length ? "Nothing here yet." : (canEdit ? "No furniture yet. Click “Add item” below to post your first piece." : "Furniture coming soon. Check back shortly.")) + "</div>";
  items.forEach(function (it) {
    h += '<article class="card' + (it.status === "sold" ? " sold" : "") + '" data-id="' + esc(it.id) + '" tabindex="0" aria-label="' + esc(it.name + ", " + (it.status === "sold" ? "sold" : money(it.price))) + '"><div class="photo">';
    h += it.photos && it.photos[0] ? '<img src="' + esc(src(it.photos[0])) + '" alt="' + esc(it.name) + '" loading="lazy">' : '<div class="ph">No photo yet</div>';
    h += it.status === "sold" ? '<div class="stamp">SOLD</div>' : '<div class="price' + (it.price === 0 ? " free" : "") + '">' + esc(money(it.price)) + "</div>";
    h += '</div><div class="body"><div class="name">' + esc(it.name) + '</div><div class="meta">' + (it.example ? '<span class="tag ex">Example</span>' : "") + (it.condition ? '<span class="tag">' + esc(it.condition) + "</span>" : "") + (it.dims ? "<span>" + esc(it.dims) + "</span>" : "") + (it.orig ? '<span>Retail <span class="orig">' + esc(money(it.orig)) + "</span></span>" : "") + "</div>";
    if (canEdit && editMode) {
      h += '<div class="edit-row"><span class="cur">' + esc(s.currency || "$") + '</span><input type="number" min="0" step="1" inputmode="decimal" id="p-' + esc(it.id) + '" data-price="' + esc(it.id) + '" value="' + esc(it.price) + '" aria-label="Price for ' + esc(it.name) + '"><button data-act="edit">Edit</button></div>';
      h += '<div class="edit-row2"><button data-act="status" data-k="available" class="' + (it.status !== "sold" ? "on" : "") + '">Available</button><button data-act="status" data-k="sold" class="' + (it.status === "sold" ? "on" : "") + '">Sold</button></div>';
    }
    h += "</div></article>";
  });
  h += '</div></main><footer class="wrap">' + esc(s.title) + ' · <button class="link" data-act="' + (canEdit ? "logout" : "login") + '">' + (canEdit ? "Seller log out" : "Seller login") + "</button></footer>";
  if (canEdit) {
    var dirty = isDirty();
    h += '<div class="adminbar"><div class="in"><div class="grp"><button data-act="toggle-edit" aria-pressed="' + editMode + '">' + (editMode ? "Done editing" : "Edit prices & status") + '</button><button data-act="add">+ Add item</button><button data-act="settings">Page settings</button></div><div class="grp"><span class="st">' + (saving ? "Publishing…" : dirty ? "Unpublished changes" : "All changes published") + '</span><button class="pub" data-act="publish"' + (dirty && !saving ? "" : " disabled") + ">Publish changes</button></div></div></div>";
  }
  document.body.classList.toggle("has-admin", canEdit);
  app.innerHTML = h;
}
function visibleItems() {
  var list = state.items.map(function (it, i) { return { it: it, i: i }; }).filter(function (x) { return ui.filter === "all" || (ui.filter === "sold") === (x.it.status === "sold"); });
  list.sort(function (a, b) {
    if (ui.sort === "low") return (a.it.price || 0) - (b.it.price || 0);
    if (ui.sort === "high") return (b.it.price || 0) - (a.it.price || 0);
    return ((a.it.status === "sold") - (b.it.status === "sold")) || (a.i - b.i);
  });
  return list.map(function (x) { return x.it; });
}

/* ---------------- Modal + toast ---------------- */
var overlay = null;
function openModal(html) {
  closeModal(); overlay = document.createElement("div"); overlay.className = "overlay";
  overlay.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><button class="x" data-act="close" aria-label="Close">×</button>' + html + "</div>";
  document.body.appendChild(overlay); document.body.style.overflow = "hidden";
  overlay.addEventListener("click", function (e) { if (e.target === overlay) closeModal(); else onClick(e); });
  overlay.querySelector(".x").focus();
}
function closeModal() { if (overlay) { overlay.remove(); overlay = null; document.body.style.overflow = ""; } }
document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); if (e.key === "Enter" && e.target.classList && e.target.classList.contains("card")) openDetail(e.target.dataset.id); });
var toastT;
function toast(msg, ms) { var t = document.querySelector(".toast"); if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); } t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, ms || 3000); }

/* ---------------- Detail ---------------- */
function openDetail(id, idx) {
  var it = find(id); if (!it) return; idx = idx || 0; var ph = it.photos || [];
  var h = '<div class="detail"><div class="gallery"><div class="main">' + (ph[idx] ? '<img src="' + esc(src(ph[idx])) + '" alt="' + esc(it.name) + '">' : '<div class="ph">No photo yet</div>') + "</div>";
  if (ph.length > 1) h += '<div class="thumbs">' + ph.map(function (p, i) { return '<button data-act="thumb" data-id="' + esc(it.id) + '" data-i="' + i + '" aria-current="' + (i === idx) + '" aria-label="Photo ' + (i + 1) + '"><img src="' + esc(src(p)) + '" alt=""></button>'; }).join("") + "</div>";
  h += '</div><div class="info"><h2>' + esc(it.name) + "</h2>";
  h += '<div class="big-price">' + (it.status === "sold" ? '<span style="color:var(--sold)">Sold</span>' : esc(money(it.price))) + (it.orig ? '<span class="orig">Retail ' + esc(money(it.orig)) + "</span>" : "") + "</div>";
  if (it.example) h += '<div class="meta"><span class="tag ex">Example</span></div>';
  h += '<div class="status-line ' + (it.status === "sold" ? "sold" : "available") + '">● ' + (it.status === "sold" ? "Sold" : "Available") + "</div>";
  h += '<dl class="specs">' + (it.condition ? "<dt>Condition</dt><dd>" + esc(it.condition) + "</dd>" : "") + (it.dims ? "<dt>Size</dt><dd>" + esc(it.dims) + "</dd>" : "") + "</dl>";
  if (it.desc) h += '<p class="desc">' + esc(it.desc) + "</p>";
  if (canEdit) h += '<button class="btn alt" data-act="edit" data-id="' + esc(it.id) + '">Edit this item</button>';
  h += "</div></div>";
  openModal(h);
}

/* ---------------- Item editor ---------------- */
var draft = null;
function openEditor(id) { var it = id ? find(id) : null; draft = it ? JSON.parse(JSON.stringify(it)) : { id: uid(), name: "", price: "", orig: null, condition: "Good", dims: "", desc: "", status: "available", photos: [] }; draft._new = !it; renderEditor(); }
function renderEditor() {
  var d = draft;
  var h = '<form class="form" id="item-form" novalidate><h2>' + (d._new ? "Add item" : "Edit item") + "</h2>";
  h += '<div class="field"><span class="lbl">Photos (first one is the cover, up to 6)</span><div class="pics">' + d.photos.map(function (p, i) { return '<div class="pic"><img src="' + esc(src(p)) + '" alt="Photo ' + (i + 1) + '"><button type="button" class="rm" data-act="rm-pic" data-i="' + i + '" aria-label="Remove photo">×</button>' + (i === 0 ? '<span class="cv" style="text-align:center">Cover</span>' : '<button type="button" class="cv" data-act="cover-pic" data-i="' + i + '">Make cover</button>') + "</div>"; }).join("") + (d.photos.length < 6 ? '<label class="addpic">+ Add photos<input type="file" id="f-photos" accept="image/*" multiple></label>' : "") + "</div></div>";
  h += '<div class="field"><label for="f-name">Name</label><input id="f-name" maxlength="80" value="' + esc(d.name) + '" placeholder="e.g. IKEA bookshelf"></div>';
  h += '<div class="row2"><div class="field"><label for="f-price">Price (0 = free)</label><input id="f-price" type="number" min="0" step="1" inputmode="decimal" value="' + esc(d.price) + '"></div><div class="field"><label for="f-orig">Retail price (optional)</label><input id="f-orig" type="number" min="0" step="1" inputmode="decimal" value="' + esc(d.orig == null ? "" : d.orig) + '"></div></div>';
  h += '<div class="row2"><div class="field"><label for="f-cond">Condition</label><select id="f-cond">' + CONDITIONS.map(function (c) { return "<option" + (d.condition === c ? " selected" : "") + ">" + c + "</option>"; }).join("") + '</select></div><div class="field"><label for="f-dims">Size (optional)</label><input id="f-dims" maxlength="60" value="' + esc(d.dims) + '" placeholder="W × D × H"></div><div class="field"><label for="f-status">Status</label><select id="f-status"><option value="available"' + (d.status !== "sold" ? " selected" : "") + '>Available</option><option value="sold"' + (d.status === "sold" ? " selected" : "") + ">Sold</option></select></div></div>";
  h += '<div class="field"><label for="f-desc">Description (optional)</label><textarea id="f-desc" maxlength="1000" placeholder="Age, wear, anything a buyer should know">' + esc(d.desc) + "</textarea></div>";
  h += '<p class="err" id="f-err" role="alert"></p><div class="form-actions">' + (d._new ? "" : '<button type="button" class="btn danger" data-act="delete-item">Delete</button>') + '<div class="right"><button type="button" class="btn alt" data-act="close">Cancel</button><button type="submit" class="btn">' + (d._new ? "Add" : "Save") + "</button></div></div></form>";
  openModal(h);
  var form = document.getElementById("item-form");
  form.addEventListener("submit", function (e) { e.preventDefault(); saveDraft(); });
  form.addEventListener("input", syncDraft);
  var fp = document.getElementById("f-photos"); if (fp) fp.addEventListener("change", function () { addPhotos(fp.files); });
  if (d._new) document.getElementById("f-name").focus();
}
function syncDraft() { if (!draft) return; var g = function (id) { var el = document.getElementById(id); return el ? el.value : ""; }; draft.name = g("f-name"); draft.price = g("f-price"); draft.orig = g("f-orig"); draft.condition = g("f-cond"); draft.dims = g("f-dims"); draft.status = g("f-status"); draft.desc = g("f-desc"); }
function resize(file) {
  return new Promise(function (res, rej) {
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () { var M = 1400, w = img.naturalWidth, h = img.naturalHeight, s = Math.min(1, M / Math.max(w, h)), c = document.createElement("canvas"); c.width = Math.round(w * s); c.height = Math.round(h * s); var x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", 0.78)); };
    img.onerror = function () { URL.revokeObjectURL(url); rej(new Error("bad")); };
    img.src = url;
  });
}
function addPhotos(files) {
  syncDraft(); var list = Array.prototype.slice.call(files, 0, 6 - draft.photos.length), bad = 0; toast("Processing photos…");
  Promise.all(list.map(function (f) { return resize(f).catch(function () { bad++; return null; }); })).then(function (out) { out.forEach(function (u) { if (u) draft.photos.push(u); }); renderEditor(); toast(bad ? bad + " photo(s) could not be read. Convert HEIC photos to JPG and try again." : "Photos added"); });
}
function saveDraft() {
  syncDraft(); var err = document.getElementById("f-err");
  if (!draft.name.trim()) { err.textContent = "Add a name for this item."; document.getElementById("f-name").focus(); return; }
  if (draft.price === "" || isNaN(+draft.price) || +draft.price < 0) { err.textContent = "Add a price. Use 0 for free."; document.getElementById("f-price").focus(); return; }
  var it = { id: draft.id, name: draft.name.trim(), price: +draft.price, orig: draft.orig === "" || draft.orig == null ? null : +draft.orig, condition: draft.condition, dims: draft.dims.trim(), desc: draft.desc.trim(), status: draft.status, photos: draft.photos };
  var i = state.items.findIndex(function (x) { return x.id === it.id; });
  if (i < 0) state.items.unshift(it); else state.items[i] = it;
  closeModal(); draft = null; render();
  toast(i < 0 ? "Added. Click “Publish changes” to put it on the site." : "Saved. Click “Publish changes” to put it on the site.");
}

/* ---------------- Settings ---------------- */
function openSettings() {
  var s = state.settings;
  var h = '<form class="form" id="set-form" novalidate><h2>Page settings</h2>';
  h += '<div class="field"><label for="s-title">Title</label><input id="s-title" maxlength="60" value="' + esc(s.title) + '"></div>';
  h += '<div class="field"><label for="s-intro">Intro</label><textarea id="s-intro" maxlength="400">' + esc(s.intro) + "</textarea></div>";
  h += '<div class="row2"><div class="field"><label for="s-deadline">Sale ends (leave empty to hide)</label><input id="s-deadline" type="date" value="' + esc(s.deadline) + '"></div><div class="field"><label for="s-cur">Currency symbol</label><input id="s-cur" maxlength="4" value="' + esc(s.currency || "$") + '"></div></div>';
  h += '<div class="form-actions"><div class="right"><button type="button" class="btn alt" data-act="close">Cancel</button><button type="submit" class="btn">Save</button></div></div></form>';
  openModal(h);
  document.getElementById("set-form").addEventListener("submit", function (e) { e.preventDefault(); var g = function (id) { return document.getElementById(id).value.trim(); }; s.title = g("s-title") || "Move Out Sale"; s.intro = g("s-intro"); s.deadline = g("s-deadline"); s.currency = g("s-cur") || "$"; closeModal(); render(); toast("Saved. Click “Publish changes” to put it on the site."); });
}

/* ---------------- Seller login ---------------- */
function openLogin(msg) {
  var repoKnown = CONFIG.owner && CONFIG.repo;
  var newTok = "https://github.com/settings/personal-access-tokens/new";
  var h = '<form class="form" id="login-form" novalidate><h2>Seller login</h2>';
  h += '<p class="hint" style="font-size:14px">Editing saves straight to your GitHub repository' + (repoKnown ? " <b>" + esc(CONFIG.owner + "/" + CONFIG.repo) + "</b>" : "") + '. You need a GitHub access token that can write to it. You only do this once per browser.</p>';
  h += '<ol class="steps"><li>Open <a href="' + newTok + '" target="_blank" rel="noopener">GitHub → New fine-grained token</a>.</li><li>Repository access: <b>Only select repositories</b> → pick this repo.</li><li>Permissions → Repository permissions → <b>Contents: Read and write</b>.</li><li>Generate the token, copy it, and paste it below.</li></ol>';
  if (!repoKnown) h += '<div class="row2"><div class="field"><label for="l-owner">GitHub username</label><input id="l-owner" autocomplete="off"></div><div class="field"><label for="l-repo">Repository</label><input id="l-repo" autocomplete="off"></div></div>';
  h += '<div class="field"><label for="l-token">Access token</label><input id="l-token" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…"></div>';
  h += '<p class="hint">The token is saved only in this browser. Never share it; anyone with it can edit your sale.</p>';
  h += '<p class="err" id="l-err" role="alert">' + esc(msg || "") + '</p><div class="form-actions"><div class="right"><button type="button" class="btn alt" data-act="close">Cancel</button><button type="submit" class="btn" id="l-go">Log in</button></div></div></form>';
  openModal(h);
  document.getElementById("l-token").focus();
  document.getElementById("login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!repoKnown) { CONFIG.owner = document.getElementById("l-owner").value.trim(); CONFIG.repo = document.getElementById("l-repo").value.trim(); }
    var t = document.getElementById("l-token").value.trim(), err = document.getElementById("l-err");
    if (!t) { err.textContent = "Paste your access token."; return; }
    if (!CONFIG.owner || !CONFIG.repo) { err.textContent = "Enter your GitHub username and repository name."; return; }
    document.getElementById("l-go").disabled = true; err.textContent = "Checking…";
    login(t).then(function () { closeModal(); toast("Logged in. You can edit now."); }, function (e2) {
      document.getElementById("l-go").disabled = false;
      err.textContent = e2.message;
    });
  });
}
function login(t) {
  token = t;
  return gh("GET", "").then(function (repo) {
    if (!repo.permissions || !repo.permissions.push) throw new Error("This token can read the repo but cannot write to it. Give it Contents: Read and write.");
    CONFIG.branch = repo.default_branch || CONFIG.branch;
    return loadFromRepo();
  }).then(function (s) {
    if (!isDirty()) setState(s);
    lsSet(TOKEN_KEY, t); canEdit = true; editMode = true; render();
  }).catch(function (e) {
    token = null;
    if (e.status === 401) throw new Error("GitHub rejected this token. Check that you copied all of it and that it hasn't expired.");
    if (e.status === 404) throw new Error("Couldn't find " + CONFIG.owner + "/" + CONFIG.repo + " with this token. Make sure the token has access to this repository.");
    throw e;
  });
}
function logout() { lsSet(TOKEN_KEY, null); token = null; canEdit = false; editMode = false; render(); toast("Logged out on this browser."); }

/* ---------------- Publish (one commit) ---------------- */
function photoPaths(s) { var out = {}; (s.items || []).forEach(function (it) { (it.photos || []).forEach(function (p) { if (/^images\//.test(p)) out[p] = 1; }); }); return out; }
function publishNow() {
  if (!token || saving || !isDirty()) return;
  saving = true; render();
  var next = JSON.parse(JSON.stringify(state)), oldPaths = photoPaths(JSON.parse(published)), tree = [], newCache = {}, baseSha, baseTree;
  gh("GET", "/git/ref/heads/" + CONFIG.branch).then(function (ref) {
    baseSha = ref.object.sha;
    return gh("GET", "/git/commits/" + baseSha);
  }).then(function (c) {
    baseTree = c.tree.sha;
    var uploads = [];
    next.items.forEach(function (it) {
      it.photos = it.photos || [];
      it.photos.forEach(function (p, i) {
        if (p.indexOf("data:") !== 0) return;
        var path = "images/" + it.id + "-" + Math.random().toString(36).slice(2, 8) + ".jpg";
        it.photos[i] = path; newCache[path] = p;
        uploads.push(gh("POST", "/git/blobs", { content: p.split(",")[1], encoding: "base64" }).then(function (b) { tree.push({ path: path, mode: "100644", type: "blob", sha: b.sha }); }));
      });
    });
    return Promise.all(uploads);
  }).then(function () {
    var keep = photoPaths(next);
    Object.keys(oldPaths).forEach(function (p) { if (!keep[p]) tree.push({ path: p, mode: "100644", type: "blob", sha: null }); });
    tree.push({ path: "data/items.json", mode: "100644", type: "blob", content: JSON.stringify(next, null, 2) + "\n" });
    return gh("POST", "/git/trees", { base_tree: baseTree, tree: tree });
  }).then(function (t) {
    return gh("POST", "/git/commits", { message: "Update sale items", tree: t.sha, parents: [baseSha] });
  }).then(function (c) {
    return gh("PATCH", "/git/refs/heads/" + CONFIG.branch, { sha: c.sha });
  }).then(function () {
    Object.keys(newCache).forEach(function (k) { imgCache[k] = newCache[k]; });
    saving = false; setState(next); render();
    toast("Published. The public site updates in about a minute.", 5000);
  }).catch(function (e) {
    saving = false; render();
    if (e.status === 401) { logout(); openLogin("Your token stopped working (expired or revoked). Paste a new one, then publish again. Your edits are still here."); return; }
    if (e.status === 403 || e.status === 404) { toast("GitHub refused the change. Check the token has Contents: Read and write on this repo.", 6000); return; }
    if (e.status === 422 || e.status === 409) { toast("The repo changed somewhere else. Reload the page and make your edit again.", 6000); return; }
    toast("Publishing failed (" + e.message + "). Your edits are still here; try again.", 6000);
  });
}

/* ---------------- Events ---------------- */
function onClick(e) {
  var b = e.target.closest("[data-act]"), card = e.target.closest(".card");
  if (e.target.closest("input")) return;
  if (b) {
    var act = b.dataset.act, id = b.dataset.id || (card && card.dataset.id); e.stopPropagation();
    if (act === "close") { closeModal(); return; }
    if (act === "thumb") { openDetail(id, +b.dataset.i); return; }
    if (act === "login") { openLogin(); return; }
    if (!canEdit) return;
    if (act === "logout") { if (isDirty() && !b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Unpublished changes will be lost. Click again to log out"; return; } logout(); return; }
    if (act === "edit") { openEditor(id); return; }
    if (act === "status") { find(id).status = b.dataset.k; render(); return; }
    if (act === "toggle-edit") { editMode = !editMode; render(); return; }
    if (act === "add") { openEditor(null); return; }
    if (act === "settings") { openSettings(); return; }
    if (act === "publish") { publishNow(); return; }
    if (act === "clear-examples") { state.items = state.items.filter(function (i) { return !i.example; }); render(); toast("Examples removed. Click “Publish changes” to put it on the site."); return; }
    if (act === "rm-pic") { syncDraft(); draft.photos.splice(+b.dataset.i, 1); renderEditor(); return; }
    if (act === "cover-pic") { syncDraft(); draft.photos.unshift(draft.photos.splice(+b.dataset.i, 1)[0]); renderEditor(); return; }
    if (act === "delete-item") { if (b.dataset.armed) { state.items = state.items.filter(function (i) { return i.id !== draft.id; }); closeModal(); draft = null; render(); toast("Deleted. Click “Publish changes” to put it on the site."); } else { b.dataset.armed = "1"; b.textContent = "Click again to delete"; } return; }
    return;
  }
  var chip = e.target.closest(".chip"); if (chip) { ui.filter = chip.dataset.filter; render(); return; }
  if (card && !overlay) openDetail(card.dataset.id);
}
app.addEventListener("click", onClick);
app.addEventListener("change", function (e) {
  if (e.target.id === "sort") { ui.sort = e.target.value; render(); return; }
  var pid = e.target.dataset && e.target.dataset.price;
  if (pid) { var v = e.target.value; if (v !== "" && !isNaN(+v) && +v >= 0) { find(pid).price = +v; render(); toast("Price updated. Click “Publish changes” to put it on the site."); } else toast("Enter a price of 0 or more."); }
});
window.addEventListener("beforeunload", function (e) { if (canEdit && isDirty()) { e.preventDefault(); e.returnValue = ""; } });

/* ---------------- Start ---------------- */
loadPublic().then(function (s) { setState(s); render(); }, function () {
  app.innerHTML = '<div class="wrap"><p class="loading">Couldn\'t load the furniture list. Refresh the page to try again.</p></div>';
}).then(function () {
  var saved = lsGet(TOKEN_KEY);
  if (saved && CONFIG.owner && CONFIG.repo) login(saved).catch(function (e) { lsSet(TOKEN_KEY, null); toast("Seller login expired: " + e.message, 6000); });
  else if (location.hash === "#seller") openLogin();
});
})();
