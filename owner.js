// ================= KG Print — owner dashboard =================
const { sb, $, $$, esc, rupees, rupeesExact, STATUS, toast, fmtTime, fmtDay, todayIST } = KG;

const KIND_LABEL = { pdf: "PDF", image: "IMG", docx: "DOCX", doc: "DOC" };
const DAY = 864e5;
const CLEANUP_AFTER_DAYS = 3;

let user = null;
let settings = null;
let orders = [];
let tab = "payment_review";
let query = "";
let knownIds = new Set();
let firstLoadDone = false;
let alertsOn = false;
let wakeLock = null;
const urlCache = new Map(); // "bucket/path" -> { url, exp }

init();

async function init() {
  if (!KG.configured) {
    $("#setupNeeded").innerHTML = KG.setupNeededHTML();
    $("#setupNeeded").hidden = false;
    return;
  }
  $("#googleBtn").onclick = KG.signInWithGoogle;
  $("#logoutBtn").onclick = KG.signOut;
  $("#logoutBtn2").onclick = KG.signOut;

  const { data } = await sb.auth.getSession();
  user = data.session?.user || null;
  if (!user) { $("#signedOut").hidden = false; return; }

  const { data: isOwner, error } = await sb.rpc("is_owner");
  if (error || !isOwner) {
    $("#notOwner").hidden = false;
    $("#notOwnerEmail").textContent = user.email;
    $("#ownerSql").textContent = `insert into public.owners (email) values ('${user.email}');`;
    return;
  }

  $("#dash").hidden = false;
  $("#topActions").hidden = false;
  wireEvents();
  await loadSettings();
  await loadOrders();
  subscribe();
  cleanup(false);

  setInterval(() => { if (!document.hidden) loadOrders(); }, 45000);
  setInterval(remindPending, 3 * 60000);
  setInterval(() => cleanup(false), 60 * 60000);
}

// ---------------- events ----------------
function wireEvents() {
  $$(".tabs button").forEach((b) => (b.onclick = () => { tab = b.dataset.tab; render(); }));
  $("#search").oninput = (e) => { query = e.target.value.trim().toLowerCase(); render(); };
  $("#alertsBtn").onclick = enableAlerts;
  $("#orderGrid").addEventListener("click", onGridClick);

  $("#openToggle").onchange = async (e) => {
    const open = e.target.checked;
    const { error } = await sb.from("settings").update({ shop_open: open }).eq("id", 1);
    if (error) { toast(error.message, "error"); e.target.checked = !open; return; }
    settings.shop_open = open;
    renderOpen();
    toast(open ? "Shop is OPEN for orders" : "Shop CLOSED — students can't order", open ? "ok" : "warn");
  };

  $("#settingsBtn").onclick = openSettings;
  $("#settingsCancel").onclick = () => ($("#settingsModal").hidden = true);
  $("#settingsForm").onsubmit = saveSettings;
  $("#cleanupBtn").onclick = () => cleanup(true);

  $("#newView").onclick = () => {
    $("#newModal").hidden = true;
    tab = "payment_review";
    render();
    KG.stopFlash();
  };
  $("#verNo").onclick = () => ($("#verifyModal").hidden = true);
  $("#verYes").onclick = confirmVerify;
  $("#verOpenJob").onchange = (e) => { try { localStorage.setItem("kg_open_job", e.target.checked ? "1" : "0"); } catch (err) { /* ignore */ } };
  $("#adjCancel").onclick = () => ($("#adjustModal").hidden = true);
  $("#adjustForm").onsubmit = saveAdjust;
  $("#adjFiles").addEventListener("input", updateAdjust);
  $("#rejCancel").onclick = () => ($("#rejectModal").hidden = true);
  $("#rejectForm").onsubmit = submitReject;
  $("#rejectForm").addEventListener("change", (e) => {
    if (e.target.name === "reason") $("#rejFake").checked = e.target.dataset.fake === "1";
  });
  $("#rejOther").onfocus = () => { $("#rejectForm").querySelector("input[value=other]").checked = true; $("#rejFake").checked = false; };
  $("#blockedList").addEventListener("click", unblock);

  $("#shotClose").onclick = () => ($("#shotModal").hidden = true);
  $("#shotModal").onclick = (e) => { if (e.target.id === "shotModal") $("#shotModal").hidden = true; };

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (alertsOn) keepAwake();
    loadOrders();
  });
}

// ---------------- alerts ----------------
async function enableAlerts() {
  KG.unlockAudio();
  KG.chime(1);
  const notifOk = await KG.askNotify();
  await keepAwake();
  alertsOn = true;
  const bar = $("#alertBar");
  bar.classList.add("on");
  bar.innerHTML = `<span><b>🔔 Alerts are ON.</b> ${notifOk ? "Sound + notifications" : "Sound only (notifications blocked in browser settings)"} · keep this page open.</span>
    <button class="btn small" id="testBtn">Test sound</button>`;
  $("#testBtn").onclick = () => KG.chime(1);
}

async function keepAwake() {
  try {
    if ("wakeLock" in navigator && !document.hidden) wakeLock = await navigator.wakeLock.request("screen");
  } catch (e) { /* not supported or denied */ }
}

function alertNew(o) {
  KG.chime(3);
  KG.notify(`New order ${o.token} · ${rupeesExact(o.total)}`, `${o.student_name} (${o.flat}) · ${o.files.length} file(s)`);
  KG.flashTitle(`🔔 New ${o.token}!`);
  $("#newToken").textContent = o.token;
  $("#newInfo").innerHTML = `<b>${esc(o.student_name)}</b> · ${esc(o.flat)}<br>${o.files.length} file(s) · <b>${rupeesExact(o.total)}</b>`;
  $("#newModal").hidden = false;
  if (!alertsOn) toast("New order! Tap 'Turn on alerts' to hear a sound next time.", "warn", 8000);
}

function remindPending() {
  const old = orders.filter((o) => o.status === "payment_review" && Date.now() - new Date(o.created_at) > 3 * 60000);
  if (old.length && alertsOn) {
    KG.chime(1);
    KG.notify(`${old.length} order(s) waiting`, "Payments waiting to be verified.");
  }
}

// ---------------- settings ----------------
async function loadSettings() {
  const { data, error } = await sb.from("settings").select("*").eq("id", 1).single();
  if (error) { toast(error.message, "error"); return; }
  settings = data;
  renderOpen();
}
function renderOpen() {
  $("#shopName").textContent = settings.shop_name;
  $("#openToggle").checked = settings.shop_open;
  $("#openLabel").textContent = settings.shop_open ? "Open" : "Closed";
  $("#upiWarn").hidden = !!settings.upi_id && settings.upi_id !== "owner@upi";
}
function openSettings() {
  const f = $("#settingsForm");
  ["shop_name", "upi_id", "payee_name", "bw_single", "bw_double", "color_single", "color_double", "notice"].forEach((k) => (f.elements[k].value = settings[k] ?? ""));
  $("#settingsModal").hidden = false;
  loadBlocked();
}

// ---------------- blocked students ----------------
async function loadBlocked() {
  const box = $("#blockedList");
  const { data, error } = await sb.from("blocked_users").select("*").order("created_at", { ascending: false });
  if (error) { box.innerHTML = `<small class="muted">${esc(error.message)}</small>`; return; }
  box.innerHTML = data.length
    ? data.map((b) => `<div class="blocked-row"><div><b>${esc(b.email || b.user_id)}</b><br><small class="muted">${esc(b.reason || "")} · ${new Date(b.created_at).toLocaleDateString("en-IN")}</small></div>
        <button type="button" class="btn small" data-unblock="${b.user_id}">Unblock</button></div>`).join("")
    : `<small class="muted">No one is blocked.</small>`;
}
async function unblock(e) {
  const btn = e.target.closest("[data-unblock]");
  if (!btn) return;
  if (!confirm("Unblock this student? (One more fake payment will block them again.)")) return;
  const { error } = await sb.from("blocked_users").delete().eq("user_id", btn.dataset.unblock);
  if (error) { toast(error.message, "error"); return; }
  toast("Student unblocked", "ok");
  loadBlocked();
}

// ---------------- payment received → print job ----------------
let verifying = null;
function openVerify(o) {
  verifying = o;
  $("#verAmt").innerHTML = findAmountHTML(o.total);
  $("#verUtr").textContent = o.utr;
  $("#verWho").textContent = `${o.token} · ${o.student_name}`;
  let pref = "1";
  try { pref = localStorage.getItem("kg_open_job") ?? "1"; } catch (e) { /* ignore */ }
  $("#verOpenJob").checked = pref === "1";
  const many = o.files.length > 1 && !o.files_deleted;
  $("#verOpenJob").closest("label").hidden = !many;
  $("#verOneFile").hidden = many;
  $("#verifyModal").hidden = false;
}
async function confirmVerify() {
  const o = verifying;
  if (!o) return;
  $("#verifyModal").hidden = true;
  // Open one window per document FIRST (inside the tap, so the browser allows it),
  // save "accepted", then load each document into its window.
  const wantDocs = o.files.length > 1 && $("#verOpenJob").checked && !o.files_deleted;
  const wins = wantDocs ? openDocWindows(o) : [];
  const saved = await setStatus(o, { status: "queued" }, o.files.length > 1 ? `${o.token} accepted — student notified` : `${o.token} accepted — tap ⬇ Download on the card`);
  if (!wantDocs) return;
  if (!saved) { wins.forEach((w) => w && w.close()); return; }
  loadDocWindows(o, wins);
}

function viewUrl(o, i) {
  return new URL(`view.html?id=${encodeURIComponent(o.id)}&i=${i}`, location.href).href;
}
// opens empty windows synchronously (must run inside the tap)
function openDocWindows(o) {
  return o.files.map((f, i) => {
    const w = window.open("", `kgdoc-${o.id}-${i}`);
    if (w) { try { w.document.write(`<p style="font:16px system-ui;padding:24px">Opening ${o.token} · file ${i + 1}…</p>`); } catch (e) { /* ignore */ } }
    return w;
  });
}
// Direct links to the files: PDFs and photos open in the browser's own viewer
// (instant), Word files download straight away.
async function directUrls(o) {
  const out = [];
  for (let i = 0; i < o.files.length; i++) out.push(await fileUrl(o, i));
  return out;
}
// PDF → Chrome's own PDF viewer (has download + print)
// Photo → tiny instant page with Download + Print buttons
// Word → downloads straight away
async function fileUrl(o, i) {
  const f = o.files[i];
  const name = `${o.token}_${i + 1}_${f.name}`.replace(/[\\/:*?"<>|]+/g, "_");
  if (f.kind === "doc" || f.kind === "docx") return signedUrl("prints", f.path, name);
  if (f.kind === "image") {
    const [view, dl] = await Promise.all([signedUrl("prints", f.path), signedUrl("prints", f.path, name)]);
    const info = `${f.name} · file ${i + 1} of ${o.files.length} · ${f.range ? `PAGES ${f.range} · ` : ""}${f.pages}p × ${f.copies} · ${f.color ? "COLOUR" : "B/W"} · ${f.double ? "both sides" : "single side"}`;
    const hash = new URLSearchParams({ u: view, d: dl, t: o.token, n: f.name, i: info }).toString();
    return new URL("img.html", location.href).href + "#" + hash;
  }
  return signedUrl("prints", f.path);
}

async function loadDocWindows(o, wins) {
  let urls;
  try { urls = await directUrls(o); }
  catch (err) { wins.forEach((w) => w && w.close()); return toast("Couldn't open files: " + err.message, "error"); }
  let blocked = 0;
  wins.forEach((w, i) => { if (w) w.location = urls[i]; else blocked++; });
  if (blocked) showPopupHelp(blocked, o.files.length);
}
function showPopupHelp(blocked, total) {
  $("#popupHelpCount").textContent = `${blocked} of ${total}`;
  $("#popupHelp").hidden = false;
}
function openAllDocs(o) {
  if (o.files_deleted) return toast("Files of this order were already deleted.", "warn");
  loadDocWindows(o, openDocWindows(o));
}

// ---------------- adjust pages (e.g. wrong Word page count) ----------------
function adjustInfo(o) {
  if (o.adjusted_total == null) return "";
  const d = Math.round((Number(o.adjusted_total) - Number(o.total)) * 100) / 100;
  return `<div class="adj-box ${d < 0 ? "refund" : ""}">✏ Pages corrected${o.adjust_note ? `: ${esc(o.adjust_note)}` : ""}<br>
    New total <b>${rupeesExact(o.adjusted_total)}</b> — ${d > 0 ? `<b>COLLECT ${rupeesExact(d)} extra</b>` : d < 0 ? `<b>GIVE BACK ${rupeesExact(-d)}</b>` : "no change"}</div>`;
}
let adjusting = null;
function fileRate(f) {
  if (f.rate != null) return Number(f.rate);
  return Number(f.color ? (f.double ? settings.color_double : settings.color_single) : (f.double ? settings.bw_double : settings.bw_single));
}
function adjustTotal(o, pagesList) {
  const sum = o.files.reduce((t, f, i) => t + Math.round(pagesList[i] * f.copies * fileRate(f) * 100) / 100, 0);
  return Math.round((sum + (o.paise || 0) / 100) * 100) / 100;
}
function openAdjust(o) {
  adjusting = o;
  $("#adjToken").textContent = o.token;
  $("#adjFiles").innerHTML = o.files.map((f, i) => `
    <label class="adj-row"><span><b>${esc(f.name)}</b><br><small class="muted">${f.range ? `pages ${esc(f.range)} · ` : ""}× ${f.copies} · ${f.color ? "colour" : "B/W"} · ${f.double ? "2-side" : "1-side"} · ₹${fileRate(f)}/page</small></span>
      <input type="number" min="1" max="2000" value="${f.pages}" data-i="${i}"></label>`).join("");
  updateAdjust();
  $("#adjustModal").hidden = false;
}
function adjPages() { return $$("#adjFiles input").map((x) => Math.max(1, Math.min(2000, parseInt(x.value, 10) || 1))); }
function updateAdjust() {
  const o = adjusting;
  const newTotal = adjustTotal(o, adjPages());
  const d = Math.round((newTotal - Number(o.total)) * 100) / 100;
  $("#adjSummary").innerHTML = `Paid <b>${rupeesExact(o.total)}</b> → new total <b>${rupeesExact(newTotal)}</b><br>` +
    (d > 0 ? `<span class="warn-t">Collect ${rupeesExact(d)} extra at the counter</span>` : d < 0 ? `<span class="ok-t">Give back ${rupeesExact(-d)} at the counter</span>` : "No change in amount");
}
async function saveAdjust(e) {
  e.preventDefault();
  const o = adjusting;
  const pages = adjPages();
  const changes = o.files.map((f, i) => (pages[i] !== f.pages ? `${f.name}: ${f.pages}→${pages[i]} pages` : null)).filter(Boolean);
  if (!changes.length) { $("#adjustModal").hidden = true; return; }
  const files = o.files.map((f, i) => ({ ...f, pages: pages[i], price: Math.round(pages[i] * f.copies * fileRate(f) * 100) / 100, pages_source: pages[i] !== f.pages ? "owner" : f.pages_source }));
  const newTotal = adjustTotal(o, pages);
  $("#adjustModal").hidden = true;
  await setStatus(o, { files, adjusted_total: newTotal, adjust_note: changes.join("; ").slice(0, 300) }, `${o.token} updated — student notified`);
}

// ---------------- reject dialog ----------------
let rejecting = null;
function openReject(o) {
  rejecting = o;
  const f = $("#rejectForm");
  f.reset();
  $("#rejFake").checked = true;
  $("#rejToken").textContent = o.token;
  $("#rejectModal").hidden = false;
}
async function submitReject(e) {
  e.preventDefault();
  const o = rejecting;
  if (!o) return;
  const picked = $("#rejectForm").querySelector("input[name=reason]:checked");
  let reason = picked.value;
  if (reason === "other") reason = $("#rejOther").value.trim() || "Rejected by the shop";
  const fake = $("#rejFake").checked;
  $("#rejectModal").hidden = true;
  await setStatus(o, { status: "rejected", reject_reason: reason.slice(0, 200), fake },
    fake ? `${o.token} rejected as FAKE` : `${o.token} rejected`);
}
async function saveSettings(e) {
  e.preventDefault();
  const f = e.target.elements;
  const upi = f.upi_id.value.trim();
  if (!/^[\w.\-]{2,}@[a-zA-Z][a-zA-Z0-9]{1,}$/.test(upi)) { toast("UPI ID looks wrong (example: name@okaxis)", "error"); return; }
  const patch = {
    shop_name: f.shop_name.value.trim(),
    upi_id: upi,
    payee_name: f.payee_name.value.trim(),
    bw_single: +f.bw_single.value, bw_double: +f.bw_double.value,
    color_single: +f.color_single.value, color_double: +f.color_double.value,
    notice: f.notice.value.trim(),
  };
  const { data, error } = await sb.from("settings").update(patch).eq("id", 1).select().single();
  if (error) { toast(error.message, "error"); return; }
  settings = data;
  renderOpen();
  $("#settingsModal").hidden = true;
  toast("Settings saved", "ok");
}

// ---------------- orders ----------------
async function loadOrders() {
  const since = new Date(Date.now() - CLEANUP_AFTER_DAYS * DAY).toISOString();
  const { data, error } = await sb.from("orders").select("*")
    .or(`status.in.(payment_review,queued,ready),created_at.gte."${since}"`)
    .order("created_at", { ascending: true }).limit(500);
  if (error) { toast("Couldn't load orders: " + error.message, "error"); return; }

  if (firstLoadDone) {
    data.filter((o) => !knownIds.has(o.id) && o.status === "payment_review").forEach(alertNew);
  }
  data.forEach((o) => knownIds.add(o.id));
  firstLoadDone = true;
  orders = data;
  render();
}

function subscribe() {
  sb.channel("owner-orders")
    .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (p) => {
      if (p.eventType === "DELETE") { orders = orders.filter((o) => o.id !== p.old.id); render(); return; }
      const o = p.new;
      const isNew = !knownIds.has(o.id);
      knownIds.add(o.id);
      upsert(o);
      if (isNew && p.eventType === "INSERT") { alertNew(o); flashCard(o.id); }
    })
    .subscribe((status) => {
      const dot = $("#liveDot");
      if (status === "SUBSCRIBED") { dot.textContent = "● live"; dot.style.color = "var(--ok)"; }
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") { dot.textContent = "● reconnecting… (auto-refresh every 45s)"; dot.style.color = "var(--warn)"; }
    });
}

function upsert(o) {
  const i = orders.findIndex((x) => x.id === o.id);
  if (i >= 0) orders[i] = o; else orders.push(o);
  render();
}
function byId(id) { return orders.find((o) => o.id === id); }
function flashCard(id) {
  setTimeout(() => { const el = document.querySelector(`.ocard[data-id="${id}"]`); el && el.classList.add("flash"); }, 50);
}

// ---------------- render ----------------
function render() {
  const today = todayIST();
  const count = (s) => orders.filter((o) => o.status === s).length;
  const review = count("payment_review"), queue = count("queued"), ready = count("ready");
  $("#cReview").textContent = review || "";
  $("#cQueue").textContent = queue || "";
  $("#cReady").textContent = ready || "";
  $("#stReview").textContent = review;
  $("#stQueue").textContent = queue;
  $("#stReady").textContent = ready;
  const todays = orders.filter((o) => o.token_day === today);
  $("#stToday").textContent = todays.length;
  $("#stMoney").textContent = rupees(todays.filter((o) => ["queued", "ready", "collected"].includes(o.status)).reduce((s, o) => s + Number(o.total), 0));
  $$(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));

  let list = tab === "done"
    ? orders.filter((o) => o.status === "collected" || o.status === "rejected").sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    : orders.filter((o) => o.status === tab);
  if (query) {
    list = list.filter((o) => [o.token, o.student_name, o.flat, o.utr, o.phone, o.email].join(" ").toLowerCase().includes(query));
  }

  const grid = $("#orderGrid");
  if (!list.length) {
    const msg = { payment_review: "No payments to verify 👍", queued: "Print queue is empty", ready: "Nothing waiting for pickup", done: "No finished orders in the last 3 days" }[tab];
    grid.innerHTML = `<div class="empty card" style="grid-column:1/-1">${query ? "No match for your search" : msg}</div>`;
    return;
  }
  grid.innerHTML = list.map(cardHTML).join("");
  hydrateThumbs();
  list.filter((o) => o.status === "payment_review" && !isChecked(o)).forEach(queueAutoCheck);
}

function cardHTML(o) {
  const today = todayIST();
  const pages = o.files.reduce((s, f) => s + f.pages * f.copies, 0);
  const filesHTML = o.files.map((f, i) => {
    const flag = f.pages_source === "manual" ? `<small class="warn">⚠ pages typed by student — check</small>`
      : f.pages_source === "estimate" ? `<small class="warn">⚠ Word page count estimated — check</small>` : "";
    return `<div class="ofile">
      <span class="ficon ${esc(f.kind)}">${KIND_LABEL[f.kind] || "FILE"}</span>
      <div class="meta"><div title="${esc(f.name)}">${esc(f.name)}</div>
        <small>${f.range ? `<b class="range-tag">PRINT ONLY pages ${esc(f.range)}</b><br>` : ""}<b>${f.pages}p × ${f.copies}</b> · ${f.color ? "<b>COLOUR</b>" : "B/W"} · ${f.double ? "2-side" : "1-side"} · ${rupees(f.price)}</small>${flag ? "<br>" + flag : ""}</div>
      ${o.files_deleted ? `<small class="muted">deleted</small>` : `<span class="fbtns"><button class="btn small primary" data-act="dl" data-i="${i}">⬇ Download</button><button class="btn small" data-act="open" data-i="${i}" title="View / print">👁</button></span>`}
    </div>`;
  }).join("");

  const actions = {
    payment_review: `${o.files.length > 1 && !o.files_deleted ? `<button class="btn" data-act="job">📂 Open all ${o.files.length} docs</button>` : ""}<button class="btn ok" data-act="verify">✓ Payment received</button><button class="btn bad" data-act="reject">✕ Reject</button>`,
    queued: `${o.files.length > 1 && !o.files_deleted ? `<button class="btn" data-act="job">📂 Open all ${o.files.length} docs</button>` : ""}<button class="btn primary" data-act="ready">🖨 Printed — mark ready</button><button class="btn small ghost" data-act="back">↺</button>`,
    ready: `<button class="btn dark" data-act="collected">✓ Collected</button>${o.files.length > 1 && !o.files_deleted ? `<button class="btn small" data-act="job" title="Open all documents">📂</button>` : ""}<a class="btn small" href="${waLink(o)}" target="_blank" rel="noopener">WhatsApp</a><button class="btn small ghost" data-act="back">↺</button>`,
    collected: `<button class="btn small ghost" data-act="back">↺ Move back</button>`,
    rejected: `<button class="btn small ghost" data-act="back">↺ Move back to verify</button>`,
  }[o.status];

  return `<article class="ocard" data-id="${o.id}">
    <div class="ocard-top">
      <div class="otoken"><b>${esc(o.token)}</b><small>${o.token_day === today ? fmtTime(o.created_at) : fmtDay(o.token_day)}</small></div>
      <div class="who">
        <b>${esc(o.student_name)}</b><br>
        <small>Flat <b>${esc(o.flat)}</b> · <a href="tel:${esc(o.phone)}">${esc(o.phone)}</a></small><br>
        <span class="badge st-${o.status}">${STATUS[o.status]}</span>${o.fake ? `<span class="badge fake">FAKE</span>` : ""}
      </div>
      <div class="amt">${rupeesExact(o.total)}<br><small class="muted" style="font:400 12px Inter">${pages} pages</small></div>
    </div>
    ${o.status === "payment_review" || o.status === "rejected" ? payHTML(o) : `<div class="ocard-sec"><small class="muted">UTR</small> <span class="utr" style="font-size:14px">${esc(o.utr)}</span></div>`}
    <div class="ocard-sec">${filesHTML}${o.notes ? `<div class="note">📝 ${esc(o.notes)}</div>` : ""}
      ${adjustInfo(o)}
      ${["payment_review", "queued", "ready"].includes(o.status) ? `<button class="btn small" data-act="adjust" style="margin-top:6px">✏ Adjust pages</button>` : ""}</div>
    ${o.status === "rejected" && o.reject_reason ? `<div class="ocard-sec"><small class="muted">Rejected:</small> ${esc(o.reject_reason)}</div>` : ""}
    <div class="actions">${actions}</div>
  </article>`;
}

function payHTML(o) {
  const chips = checkChips(o);
  const red = (chips.match(/chip bad/g) || []).length;
  const risk = red ? `<div class="risk">⚠ ${red} red flag${red > 1 ? "s" : ""} — be extra careful. Only accept if ${rupeesExact(o.total)} really arrived.</div>` : "";
  return `${risk}<div class="ocard-sec paybox">
    ${o.shot_deleted ? `<div class="thumb" style="display:grid;place-items:center;font-size:11px">deleted</div>` : `<img class="thumb" data-shot="${esc(o.screenshot_path)}" data-act="shot" alt="screenshot">`}
    <div style="flex:1;min-width:0">
      <small class="muted">Find EXACTLY this amount in your UPI app / bank SMS:</small>
      <div class="find-amt">${findAmountHTML(o.total)}</div>
      <div class="utr"><small class="muted" style="font:400 12px Inter">UTR</small> ${esc(o.utr)} <button class="btn small ghost" data-act="copy" title="Copy UTR">⧉</button></div>
      <div class="chips">${chips}</div>
    </div>
  </div>`;
}

function findAmountHTML(total) {
  const [r, p] = rupeesExact(total).split(".");
  return `${r}.<span class="p">${p}</span>`;
}

function checkChips(o) {
  const chips = [`<span class="chip good">✓ UTR not used before</span>`, `<span class="chip good">✓ Screenshot not reused</span>`];

  // another recent order with the very same amount? (rare, but then the paise can't tell them apart)
  const twin = orders.find((x) => x.id !== o.id && Number(x.total) === Number(o.total) &&
    ["payment_review", "queued"].includes(x.status) && Math.abs(new Date(x.created_at) - new Date(o.created_at)) < DAY);
  if (twin) chips.push(`<span class="chip meh">⚠ Same amount as ${esc(twin.token)} — match by UTR too</span>`);

  // what the student's phone found when reading the screenshot
  const s = o.student_check;
  if (s && s.override) {
    const LABEL = { utr: "UTR doesn't match", amount: "amount", payee: "shop name", time: "payment time", date: "date", failed: "failed/pending", small: "small/forwarded image" };
    chips.push(`<span class="chip bad">✕ Student sent for MANUAL CHECK — problem: ${esc((s.missing || ["utr"]).map((m) => LABEL[m] || m).join(", "))}</span>`);
    if (s.utrSeen) chips.push(`<span class="chip bad">✕ Screenshot shows UTR ${esc(s.utrSeen)}, student typed ${esc(o.utr)}</span>`);
  }
  else if (s && s.unavailable) chips.push(`<span class="chip meh">Student's phone couldn't read screenshot</span>`);

  const c = o.auto_check;
  const chip = (cls, txt, tip) => `<span class="chip ${cls}"${tip ? ` title="${esc(tip)}"` : ""}>${txt}</span>`;
  if (!c || (!isChecked(o) && o.status === "payment_review")) chips.push(`<span class="chip"><span class="spinner" style="width:10px;height:10px"></span> checking screenshot…</span>`);
  else if (c.error) chips.push(`<span class="chip meh">Couldn't read screenshot</span> <button class="btn small ghost" data-act="recheck">retry</button>`);
  else {
    if (c.reusedBy) chips.push(chip("bad", `✕ Payment already used for ${esc(c.reusedBy)}`));
    if (c.utr) chips.push(chip("good", "✓ Exact UTR seen in screenshot"));
    else if (c.utrSeen) chips.push(chip("bad", `✕ Screenshot shows UTR ${esc(c.utrSeen)} — not ${esc(o.utr)}`));
    else chips.push(chip("meh", "UTR not seen in screenshot"));
    if (c.amount) chips.push(chip("good", `✓ ${rupeesExact(o.total)} seen`));
    else if (c.wrongAmounts && c.wrongAmounts.length) chips.push(chip("bad", `✕ Shows ${rupeesExact(c.wrongAmounts[0])}, not ${rupeesExact(o.total)}`));
    else chips.push(chip("meh", `${rupeesExact(o.total)} not seen`));
    if (c.demo) chips.push(chip("bad", `✕ Says "${esc(c.demo.toUpperCase())}"`));
    if (c.failed && !c.success) chips.push(chip("bad", "✕ says failed / pending"));
    else if (c.success) chips.push(chip("good", "✓ says successful"));

    // was it paid to THIS shop?
    if (c.payee === true) chips.push(chip("good", "✓ Paid to this shop"));
    else if (c.payee === false) chips.push(chip("bad", "✕ Shop name / UPI ID not in screenshot", "Could be a screenshot of money sent to someone else. Tip: set 'Name on UPI account' in Settings exactly as your bank shows it."));

    // payment time / date
    if (c.dateOld) chips.push(chip("bad", `✕ Old date in screenshot: ${esc(c.dateSeen)}`));
    if (c.timeOk === true) chips.push(chip("good", "✓ Payment time matches order"));
    else if (c.timeOk === false) chips.push(chip("bad", `✕ Time in screenshot (${esc((c.timeSeen || []).join(", "))}) ≠ order time`));

    // the file itself
    if (c.ai) chips.push(chip("bad", `✕ AI image label found (${esc(c.ai)})`, "Hidden content-credential / AI tool label inside the file."));
    if (c.software) chips.push(chip("bad", `✕ Saved by editing app: ${esc(c.software)}`));
    if (c.type === "png") chips.push(chip("good", "✓ PNG screenshot"));
    else if (c.type === "jpeg") chips.push(chip("", "JPEG file", "Some phones (e.g. Xiaomi) save screenshots as JPEG. Editing apps and WhatsApp also turn images into JPEG."));
    else if (c.type) chips.push(chip("meh", `${esc(c.type.toUpperCase())} file`));
    if (c.tooSmall) chips.push(chip("bad", `✕ Too small ${c.w}×${c.h} — resized/forwarded`));
    else if (c.phoneShape === false) chips.push(chip("meh", `Unusual size ${c.w}×${c.h}`, "Real phone screenshots are tall (like 1080×2400). Cropped or made-up images often aren't."));
  }
  if (o.shot_taken_at) {
    const mins = Math.round((new Date(o.created_at) - new Date(o.shot_taken_at)) / 60000);
    if (mins > 120) chips.push(`<span class="chip meh">Screenshot file is ${mins > 2880 ? Math.round(mins / 1440) + " days" : Math.round(mins / 60) + " h"} old</span>`);
  }
  return chips.join("");
}

function waLink(o) {
  const msg = `Hi ${o.student_name}, your print order ${o.token} is ready at ${settings ? settings.shop_name : "the shop"}. Please collect it.`;
  return `https://wa.me/91${o.phone}?text=${encodeURIComponent(msg)}`;
}

// ---------------- signed URLs & thumbnails ----------------
async function signedUrl(bucket, path, downloadName) {
  const key = bucket + "/" + path + (downloadName ? "#dl" : "");
  const hit = urlCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 3600, downloadName ? { download: downloadName } : undefined);
  if (error) throw error;
  urlCache.set(key, { url: data.signedUrl, exp: Date.now() + 50 * 60000 });
  return data.signedUrl;
}

async function hydrateThumbs() {
  const imgs = $$("img[data-shot]").filter((i) => !i.src);
  if (!imgs.length) return;
  const need = imgs.map((i) => i.dataset.shot).filter((p) => !urlCache.has("payments/" + p) || urlCache.get("payments/" + p).exp < Date.now());
  if (need.length) {
    const { data } = await sb.storage.from("payments").createSignedUrls([...new Set(need)], 3600);
    (data || []).forEach((r) => { if (r.signedUrl) urlCache.set("payments/" + r.path, { url: r.signedUrl, exp: Date.now() + 50 * 60000 }); });
  }
  imgs.forEach((i) => { const c = urlCache.get("payments/" + i.dataset.shot); if (c) i.src = c.url; });
}

// ---------------- actions ----------------
async function onGridClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const card = btn.closest(".ocard");
  const o = card && byId(card.dataset.id);
  if (!o) return;
  const act = btn.dataset.act;

  if (act === "adjust") return openAdjust(o);
  if (act === "dl") {
    const i = +btn.dataset.i, f = o.files[i];
    const name = `${o.token}_${i + 1}_${f.name}`.replace(/[\\/:*?"<>|]+/g, "_");
    try {
      const url = await signedUrl("prints", f.path, name); // server sends it as a download
      const a = document.createElement("a");
      a.href = url; a.download = name; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
      btn.textContent = "✓ Downloaded";
    } catch (err) { toast("Couldn't download: " + err.message, "error"); }
    return;
  }
  if (act === "open") {
    const i = +btn.dataset.i;
    const w = window.open("", `kgdoc-${o.id}-${i}`); // open first, inside the tap
    try {
      const url = await fileUrl(o, i);
      if (w) w.location = url; else location.href = url;
    } catch (err) { if (w) w.close(); toast("Couldn't open file: " + err.message, "error"); }
    return;
  }
  if (act === "shot") {
    $("#shotBig").src = btn.src;
    $("#shotModal").hidden = false;
    return;
  }
  if (act === "copy") {
    try { await navigator.clipboard.writeText(o.utr); toast("UTR copied", "ok", 1500); } catch (err) { toast(o.utr); }
    return;
  }
  if (act === "recheck") { ocrQueued.delete(o.id); upsertLocal({ ...o, auto_check: null }); return; }

  if (act === "verify") return openVerify(o);
  if (act === "job") return openAllDocs(o);

  if (act === "reject") return openReject(o);
  if (act === "ready") return setStatus(o, { status: "ready" }, `${o.token} is ready — student notified`);
  if (act === "collected") {
    const ok = await setStatus(o, { status: "collected" }, `${o.token} collected`);
    if (ok) deletePrints([ok]);
    return;
  }
  if (act === "back") {
    const prev = { queued: "payment_review", ready: "queued", collected: "ready", rejected: "payment_review" }[o.status];
    if (o.status === "collected" && o.files_deleted && !confirm("Files of this order are already deleted. Move back anyway?")) return;
    return setStatus(o, { status: prev, reject_reason: null, fake: false }, `${o.token} moved back`);
  }
}

async function setStatus(o, patch, msg) {
  const { data, error } = await sb.from("orders").update(patch).eq("id", o.id).select().single();
  if (error) { toast(error.message, "error"); return null; }
  upsert(data);
  toast(msg, "ok", 2500);
  return data;
}

function upsertLocal(o) { upsert(o); }

// ---------------- screenshot auto-check (free OCR in the browser) ----------------
const ocrQueue = [];
const ocrQueued = new Set();
let ocrBusy = false;

function queueAutoCheck(o) {
  if (ocrQueued.has(o.id) || o.shot_deleted) return;
  ocrQueued.add(o.id);
  ocrQueue.push(o.id);
  runOcr();
}

async function runOcr() {
  if (ocrBusy) return;
  ocrBusy = true;
  while (ocrQueue.length) {
    const o = byId(ocrQueue.shift());
    if (!o || isChecked(o) || o.status !== "payment_review") continue;
    try {
      const url = await signedUrl("payments", o.screenshot_path);
      const buf = await (await fetch(url)).arrayBuffer();
      const blob = new Blob([buf]);
      const [read, meta] = await Promise.all([KG.ocrImage(blob), KG.inspectImage(buf, blob)]);
      const j = KG.judgeScreenshot(read.text, meta, { utr: o.utr, total: o.total, settings, when: o.created_at, lines: read.lines, mainDigits: read.mainDigits, bigReads: read.bigReads });
      const result = { ...j, v: CHECK_VERSION, at: new Date().toISOString() };

      // Was any UTR in this screenshot already used by ANOTHER order? (reused payment)
      if (j.utrCandidates && j.utrCandidates.length) {
        const { data: others } = await sb.from("orders").select("token,utr").in("utr", j.utrCandidates.slice(0, 6)).neq("id", o.id).limit(1);
        if (others && others.length) {
          result.reusedBy = others[0].token;
          j.hard.unshift({ code: "reused", proof: true, fake: true, msg: `This payment (UTR ${others[0].utr}) was already used for order ${others[0].token}.` });
          result.hard = j.hard;
        }
      }

      // Safety net: CERTAIN cheating is rejected automatically as FAKE.
      // Anything less certain stays for the owner to check (shown as red flags),
      // so an honest student is never rejected just because the reader misread.
      const latest = byId(o.id);
      const proof = j.hard.filter((h) => h.proof);
      if (proof.length && latest && latest.status === "payment_review") {
        const { data: rej } = await sb.from("orders").update({
          auto_check: result, status: "rejected", fake: true,
          reject_reason: ("Auto-rejected: " + proof[0].msg).slice(0, 200),
        }).eq("id", o.id).eq("status", "payment_review").select().maybeSingle();
        if (rej) {
          upsert(rej);
          toast(`${o.token} auto-rejected as FAKE: ${proof[0].msg}`, "error", 9000);
          continue;
        }
      }
      const { data: saved } = await sb.from("orders").update({ auto_check: result }).eq("id", o.id).select().single();
      upsert(saved || { ...o, auto_check: result });
    } catch (err) {
      console.warn("auto-check failed", err);
      upsertLocal({ ...o, auto_check: { error: true } });
    }
  }
  ocrBusy = false;
}

const CHECK_VERSION = 5;
function isChecked(o) { return !!o.auto_check && (o.auto_check.error || o.auto_check.v === CHECK_VERSION); }

// ---------------- storage cleanup (keeps free 1 GB from filling up) ----------------
async function deletePrints(list) {
  for (const o of list) {
    const paths = o.files.map((f) => f.path);
    const { error } = await sb.storage.from("prints").remove(paths);
    if (!error) {
      const { data } = await sb.from("orders").update({ files_deleted: true }).eq("id", o.id).select().single();
      if (data) upsert(data);
    }
  }
}

async function cleanup(manual) {
  const cutoff = new Date(Date.now() - CLEANUP_AFTER_DAYS * DAY).toISOString();
  const [a, b] = await Promise.all([
    // print files: collected orders, or anything older than 3 days
    sb.from("orders").select("id,files,status,created_at").eq("files_deleted", false)
      .or(`status.eq.collected,created_at.lt."${cutoff}"`).limit(200),
    // screenshots: older than 3 days
    sb.from("orders").select("id,screenshot_path").eq("shot_deleted", false).lt("created_at", cutoff).limit(200),
  ]);
  if (a.error || b.error) { if (manual) toast((a.error || b.error).message, "error"); return; }

  let n = 0;
  if (a.data.length) {
    const paths = a.data.flatMap((o) => o.files.map((f) => f.path));
    const { error } = await sb.storage.from("prints").remove(paths);
    if (!error) {
      await sb.from("orders").update({ files_deleted: true }).in("id", a.data.map((o) => o.id));
      n += paths.length;
    }
  }
  if (b.data.length) {
    const paths = b.data.map((o) => o.screenshot_path);
    const { error } = await sb.storage.from("payments").remove(paths);
    if (!error) {
      await sb.from("orders").update({ shot_deleted: true }).in("id", b.data.map((o) => o.id));
      n += paths.length;
    }
  }
  if (manual) toast(n ? `Cleaned up ${n} old file(s)` : "Nothing to clean up", "ok");
  if (n) loadOrders();
}
