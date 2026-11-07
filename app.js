// ================= KG Print — student page =================
const { sb, $, $$, esc, rupees, rupeesExact, linePrice, STATUS, toast, fmtTime, fmtDay } = KG;

const KINDS = {
  pdf: ["pdf"],
  image: ["jpg", "jpeg", "png", "webp"],
  docx: ["docx"],
  doc: ["doc"],
};
const KIND_LABEL = { pdf: "PDF", image: "IMG", docx: "DOCX", doc: "DOC" };
const MAX_FILE = 25 * 1024 * 1024;
const MAX_SHOT = 8 * 1024 * 1024;
const MAX_FILES = 20;

let user = null;
let settings = null;
let items = [];          // files the student added
let myOrders = [];
let ordersChannel = null;
let lastQrText = "";
let blocked = false;
let shotFile = null;     // in-memory copy of the payment screenshot
let shotOcr = null;      // { file, promise, text, error }
let ocrFails = 0;        // how many times the UTR wasn't found in the screenshot

// ---- unique paise: a random 1–99 paise added to every order so the owner can
// find this exact payment in his UPI app. Kept on this device until the order
// is placed, so it doesn't change if the student reloads after paying.
function getPaise() {
  let p = parseInt(localStorageGet("kg_paise"), 10);
  if (!(p >= 1 && p <= 99)) {
    p = 1 + Math.floor(Math.random() * 99);
    localStorageSet("kg_paise", String(p));
  }
  return p;
}
function resetPaise() { try { localStorage.removeItem("kg_paise"); } catch (e) { /* ignore */ } }

init();

async function init() {
  if (!KG.configured) {
    $("#setupNeeded").innerHTML = KG.setupNeededHTML();
    $("#setupNeeded").hidden = false;
    return;
  }
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }
  wireStaticEvents();
  await loadSettings();

  const { data } = await sb.auth.getSession();
  user = data.session?.user || null;
  render();
  sb.auth.onAuthStateChange((_evt, session) => {
    const u = session?.user || null;
    if ((u && u.id) !== (user && user.id)) { user = u; render(); }
  });
}

// ---------------- settings ----------------
async function loadSettings() {
  const { data, error } = await sb.from("settings").select("*").eq("id", 1).single();
  if (error) { toast("Couldn't load shop settings: " + error.message, "error"); return; }
  applySettings(data);
  sb.channel("settings-public")
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "settings" }, (p) => applySettings(p.new))
    .subscribe();
}
function applySettings(s) {
  settings = s;
  $("#shopName").textContent = s.shop_name;
  document.title = s.shop_name + " — Skip the xerox queue";
  $("#closedBanner").hidden = s.shop_open;
  $("#notice").hidden = !s.notice;
  $("#notice").textContent = s.notice || "";
  $("#submitBtn").disabled = !s.shop_open || blocked;
  renderItems();
}

// ---------------- auth / layout ----------------
function render() {
  $("#signedOut").hidden = !!user;
  $("#signedIn").hidden = !user;
  const box = $("#userBox");
  if (!user) { box.innerHTML = ""; return; }
  const meta = user.user_metadata || {};
  box.innerHTML = `<div class="userchip">
      ${meta.avatar_url ? `<img src="${esc(meta.avatar_url)}" alt="" referrerpolicy="no-referrer">` : ""}
      <span class="name">${esc(meta.full_name || user.email)}</span>
      <button class="btn small" id="logoutBtn">Logout</button></div>`;
  $("#logoutBtn").onclick = KG.signOut;

  // prefill details (remembered on this device)
  const saved = JSON.parse(localStorageGet("kg_details") || "{}");
  $("#fName").value = saved.name || meta.full_name || "";
  $("#fPhone").value = saved.phone || "";
  $("#fFlat").value = saved.flat || "";

  checkBlocked();
  loadMyOrders();
}

async function checkBlocked() {
  const { data } = await sb.from("blocked_users").select("user_id").eq("user_id", user.id).maybeSingle();
  blocked = !!data;
  $("#blockedBanner").hidden = !blocked;
  $("#submitBtn").disabled = blocked || !(settings && settings.shop_open);
}

function localStorageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

function wireStaticEvents() {
  $("#googleBtn").onclick = KG.signInWithGoogle;

  $$(".tabs button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

  const dz = $("#dropzone");
  $("#fileInput").onchange = (e) => { addFiles(e.target.files); e.target.value = ""; };
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

  const list = $("#fileList");
  list.addEventListener("input", onItemInput);
  list.addEventListener("click", onItemClick);

  $("#fPhone").addEventListener("input", (e) => {
    let d = e.target.value.replace(/\D/g, "");
    if (d.length > 10 && (d.startsWith("91") || d.startsWith("0"))) d = d.slice(-10); // +91 / 0 prefix
    e.target.value = d.slice(0, 10);
  });
  $("#fUtr").addEventListener("input", (e) => {
    e.target.dataset.auto = "0"; // the student typed it themselves
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 12);
    showShotStatus();
  });
  $("#fShot").onchange = async (e) => {
    const picked = e.target.files[0];
    const img = $("#shotPreview");
    ocrFails = 0;
    $("#overrideBox").hidden = true;
    $("#fOverride").checked = false;
    shotFile = null;
    if (!picked) { img.hidden = true; shotOcr = null; showShotStatus(); return; }
    let f;
    try { f = await keepInMemory(picked); }
    catch (err) { e.target.value = ""; img.hidden = true; shotOcr = null; showShotStatus(); return toast("Couldn't read that screenshot. Please select it again.", "error", 6000); }
    shotFile = f;
    img.src = URL.createObjectURL(f);
    img.hidden = false;
    startShotOcr(f);
  };
  $("#copyUpi").onclick = async () => {
    try { await navigator.clipboard.writeText(settings.upi_id); toast("UPI ID copied", "ok", 2000); }
    catch (e) { toast(settings.upi_id); }
    startPaying();
  };
  const onSave = () => {
    saveQr();
    qrSaved = true;
    $("#qrSavedNote").innerHTML = "✓ QR saved to your phone. Now open your UPI app (step 2).";
    $("#qrSavedNote").classList.add("qr-saved");
  };
  $("#saveQr").onclick = onSave;
  $("#saveQrBig").onclick = onSave;
  $$(".app-btn").forEach((btn) => (btn.onclick = () => openUpiApp(btn.dataset.app)));
  $("#copyAmt").onclick = async () => {
    const v = orderTotal().toFixed(2);
    try { await navigator.clipboard.writeText(v); toast(`Amount ${v} copied`, "ok", 2000); } catch (e) { toast(v); }
    startPaying();
  };
  $("#upiBtn").addEventListener("click", startPaying);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (payingSince) leftForPayment = true; return; }
    if (leftForPayment) welcomeBack();
  });
  window.addEventListener("focus", () => { if (leftForPayment) welcomeBack(); });
  $("#orderForm").onsubmit = submitOrder;

  $("#successClose").onclick = () => { $("#successModal").hidden = true; showTab("orders"); };
  $("#notifyBtn").onclick = async () => {
    KG.unlockAudio();
    const ok = await KG.askNotify();
    toast(ok ? "We'll notify you when it's ready (keep this page open)." : "Notifications are blocked — just check My orders.", ok ? "ok" : "warn");
    $("#successModal").hidden = true;
    showTab("orders");
  };
}

function showTab(name) {
  $$(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $("#tab-new").hidden = name !== "new";
  $("#tab-orders").hidden = name !== "orders";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------------- files ----------------
function kindOf(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return Object.keys(KINDS).find((k) => KINDS[k].includes(ext)) || null;
}

function addFiles(fileList) {
  KG.warmOcr(); // start loading the screenshot reader now
  for (const file of Array.from(fileList || [])) {
    if (items.length >= MAX_FILES) { toast(`Max ${MAX_FILES} files per order`, "warn"); break; }
    const kind = kindOf(file.name);
    if (!kind) { toast(`${file.name}: only PDF, Word or photo files`, "error"); continue; }
    if (file.size > MAX_FILE) { toast(`${file.name} is bigger than 25 MB`, "error"); continue; }
    if (file.size === 0) { toast(`${file.name} is empty`, "error"); continue; }
    const it = {
      id: crypto.randomUUID(), file, name: file.name, kind,
      pages: 1, pagesSource: kind === "image" ? "auto" : "manual",
      copies: 1, color: kind === "image", double: false,
      loading: true,
    };
    items.push(it);
    // Copy the file into memory NOW. On phones, the browser loses access to picked
    // files after you switch apps (e.g. to Paytm to pay), so we never read it again later.
    keepInMemory(file)
      .then((copy) => { it.file = copy; return it.kind === "pdf" || it.kind === "docx" ? countPages(it) : null; })
      .catch(() => {
        items = items.filter((x) => x !== it);
        toast(`Couldn't read ${file.name}. Please select it again.`, "error", 6000);
      })
      .finally(() => { it.loading = false; renderItems(); });
  }
  renderItems();
}

async function keepInMemory(file) {
  const buf = await file.arrayBuffer();
  return new File([buf], file.name, { type: file.type, lastModified: file.lastModified });
}

async function countPages(it) {
  try {
    const buf = await it.file.arrayBuffer();
    if (it.kind === "pdf") {
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      it.pages = pdf.numPages;
      it.pagesSource = "auto";
      pdf.destroy();
    } else if (it.kind === "docx") {
      const zip = await JSZip.loadAsync(buf);
      const xml = zip.file("docProps/app.xml") ? await zip.file("docProps/app.xml").async("string") : "";
      const m = xml.match(/<Pages>(\d+)<\/Pages>/);
      if (m && +m[1] > 0) { it.pages = +m[1]; it.pagesSource = "estimate"; }
      else it.pagesSource = "manual";
    }
  } catch (e) {
    it.pagesSource = "manual";
    toast(`Couldn't count pages in ${it.name}. Please type the page count.`, "warn", 6000);
  }
}

function pagesNote(it) {
  if (it.loading) return `<span class="spinner"></span> counting pages…`;
  if (it.kind === "image") return "Photo · 1 page per copy";
  if (it.pagesSource === "auto") return `${it.pages} page${it.pages > 1 ? "s" : ""} (counted)`;
  if (it.pagesSource === "estimate") return `<span class="warn">≈ ${it.pages} pages — please check</span>`;
  return `<span class="warn">Enter the number of pages</span>`;
}

function renderItems() {
  const list = $("#fileList");
  if (!list) return;
  list.innerHTML = items.map((it) => {
    const locked = it.kind === "image" || it.pagesSource === "auto";
    return `<div class="file" data-id="${it.id}">
      <div class="file-head">
        <span class="ficon ${it.kind}">${KIND_LABEL[it.kind]}</span>
        <div class="fname"><div title="${esc(it.name)}">${esc(it.name)}</div><small>${pagesNote(it)}</small></div>
        <button type="button" class="icon-btn" data-act="remove" aria-label="Remove">✕</button>
      </div>
      <div class="file-opts">
        <label>Pages<input type="number" min="1" max="2000" data-f="pages" value="${it.pages}" ${locked || it.loading ? "readonly" : ""}></label>
        <label>Copies<input type="number" min="1" max="100" data-f="copies" value="${it.copies}"></label>
        <div><div class="seg" data-f="color">
          <button type="button" data-v="0" class="${!it.color ? "on" : ""}">B/W</button>
          <button type="button" data-v="1" class="${it.color ? "on" : ""}">Colour</button></div></div>
        <div><div class="seg" data-f="double">
          <button type="button" data-v="0" class="${!it.double ? "on" : ""}">1-side</button>
          <button type="button" data-v="1" class="${it.double ? "on" : ""}">2-side</button></div></div>
        <div class="fprice" data-price></div>
      </div>
    </div>`;
  }).join("");
  $("#wordHint").hidden = !items.some((i) => i.kind === "docx" || i.kind === "doc");
  updateTotals();
}

function onItemInput(e) {
  const el = e.target;
  const row = el.closest(".file");
  if (!row || !el.dataset.f) return;
  const it = items.find((i) => i.id === row.dataset.id);
  const n = parseInt(el.value, 10);
  if (el.dataset.f === "pages") it.pages = Math.min(2000, Math.max(1, n || 1));
  if (el.dataset.f === "copies") it.copies = Math.min(100, Math.max(1, n || 1));
  updateTotals();
}

function onItemClick(e) {
  const row = e.target.closest(".file");
  if (!row) return;
  const it = items.find((i) => i.id === row.dataset.id);
  if (e.target.closest("[data-act=remove]")) {
    items = items.filter((i) => i !== it);
    renderItems();
    return;
  }
  const btn = e.target.closest(".seg button");
  if (btn) {
    const f = btn.parentElement.dataset.f;
    it[f] = btn.dataset.v === "1";
    renderItems();
  }
}

function baseTotal() {
  if (!settings) return 0;
  return Math.round(items.reduce((sum, it) => sum + linePrice(settings, it), 0) * 100) / 100;
}
function orderTotal() {
  return Math.round((baseTotal() + getPaise() / 100) * 100) / 100;
}

function updateTotals() {
  if (!settings) return;
  $$("#fileList .file").forEach((row) => {
    const it = items.find((i) => i.id === row.dataset.id);
    if (it) row.querySelector("[data-price]").textContent = rupees(linePrice(settings, it));
  });
  const busy = items.some((i) => i.loading);
  const show = items.length > 0 && !busy;
  $("#payCard").hidden = !show;
  $("#confirmCard").hidden = !show;
  if (!show) return;

  const total = orderTotal();
  const paise = getPaise();
  $("#totalAmt").textContent = rupeesExact(total);
  $("#upiBtnAmt").textContent = rupeesExact(total);
  $("#manualAmt").textContent = rupeesExact(total);
  $("#manualAmt2").textContent = rupeesExact(total);
  $("#upiIdText").textContent = settings.upi_id;
  $("#paiseNote").innerHTML = `Prints ${rupees(baseTotal())} + <b>${paise} paise</b> payment ID. Pay <b>exactly ${rupeesExact(total)}</b> — the paise help the shop find your payment instantly.`;
  showShotStatus();

  const upi = upiLink(total);
  $("#upiBtn").href = upi;
  if (upi !== lastQrText && window.QRCode) {
    lastQrText = upi;
    const box = $("#qr");
    box.innerHTML = "";
    new QRCode(box, { text: upi, width: 168, height: 168, correctLevel: QRCode.CorrectLevel.M });
  }
}

function upiLink(total) {
  const params = new URLSearchParams({
    pn: settings.payee_name,
    am: total.toFixed(2),
    cu: "INR",
    tn: "KG Print order",
  });
  // keep the @ in the UPI ID unencoded — some UPI apps are picky
  return `upi://pay?pa=${settings.upi_id}&${params.toString().replace(/\+/g, "%20")}`;
}

// A big, clean QR image (with the white border scanners need) for "scan from gallery".
function qrImageDataUrl() {
  const total = orderTotal();
  const holder = document.createElement("div");
  new QRCode(holder, { text: upiLink(total), width: 640, height: 640, correctLevel: QRCode.CorrectLevel.M });
  const src = holder.querySelector("canvas");
  const W = 800, H = 1000, c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#17171a"; g.textAlign = "center";
  g.font = "bold 44px sans-serif"; g.fillText(`Pay ${rupeesExact(total)}`, W / 2, 80);
  g.font = "30px sans-serif"; g.fillText(`to ${settings.payee_name}`, W / 2, 125);
  g.imageSmoothingEnabled = false;
  g.drawImage(src, 80, 170, 640, 640);
  g.font = "26px sans-serif"; g.fillStyle = "#555";
  g.fillText("UPI app → Scan → gallery → pick this image", W / 2, 880);
  g.fillText(settings.shop_name, W / 2, 930);
  return c.toDataURL("image/png");
}

function saveQr() {
  const a = document.createElement("a");
  a.href = qrImageDataUrl();
  a.download = `kg-print-pay-${orderTotal().toFixed(2)}.png`;
  document.body.appendChild(a); a.click(); a.remove();
  startPaying();
}

// Open just the UPI app (its normal home screen) — nothing else.
// The payment itself happens by scanning the saved QR, which UPI allows.
const UPI_APPS = {
  gpay: { name: "GPay", pkg: "com.google.android.apps.nbu.paisa.user", ios: "gpay://" },
  phonepe: { name: "PhonePe", pkg: "com.phonepe.app", ios: "phonepe://" },
  paytm: { name: "Paytm", pkg: "net.one97.paytm", ios: "paytmmp://" },
};
let qrSaved = false;
function openUpiApp(key) {
  const app = UPI_APPS[key];
  startPaying();
  if (!qrSaved) toast("Tip: save the payment QR first (step 1), so you can pick it from the gallery.", "warn", 6000);
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isAndroid = /Android/i.test(navigator.userAgent);
  if (!isIOS && !isAndroid) { toast("On a laptop, scan the QR on screen with your phone.", "warn", 6000); return; }
  location.href = isIOS
    ? app.ios
    : `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${app.pkg};end`;
  // if the app didn't open (not installed / browser blocked it), say what to do
  setTimeout(() => {
    if (!document.hidden) toast(`Couldn't open ${app.name} from here. Open it yourself → Scan → gallery → pick the saved QR.`, "warn", 9000);
  }, 2500);
}

// ---------------- leaving to pay → coming back ----------------
let payingSince = 0;        // when the student started paying (tapped pay / copied)
let leftForPayment = false; // the page went to the background after that
function startPaying() { payingSince = Date.now(); leftForPayment = false; }
function welcomeBack() {
  leftForPayment = false;
  if (!payingSince || Date.now() - payingSince > 30 * 60000) return; // only within 30 min
  if ($("#confirmCard").hidden) return;
  $("#backBanner").hidden = false;
  const card = $("#confirmCard");
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  card.classList.remove("glow"); void card.offsetWidth; card.classList.add("glow");

}

// ---------------- screenshot check ----------------
function startShotOcr(file) {
  const job = { file, text: null, lines: [], meta: null, error: null };
  job.promise = Promise.all([
    file.arrayBuffer().then((buf) => KG.inspectImage(buf, file)).then((m) => { job.meta = m; }).catch(() => { job.meta = {}; }),
    KG.ocrImage(file).then((res) => { job.text = res.text; job.lines = res.lines; job.mainDigits = res.mainDigits; job.bigReads = res.bigReads; if (shotOcr === job) autoFillUtr(); }).catch((e) => { job.error = e; console.warn("OCR failed", e); }),
  ]).finally(() => { if (shotOcr === job) showShotStatus(); });
  shotOcr = job;
  showShotStatus();
}

// Everything the screenshot tells us, judged against this order.
function shotResult() {
  if (!shotOcr) return null;
  if (shotOcr.meta === null || (shotOcr.text === null && !shotOcr.error)) return { state: "reading" };
  const utr = $("#fUtr").value.trim();
  const ctx = { utr, total: orderTotal(), settings, when: Date.now(), lines: shotOcr.lines, mainDigits: shotOcr.mainDigits, bigReads: shotOcr.bigReads };
  if (shotOcr.error) {
    // couldn't read the text, but the file's hidden labels still count
    const j = KG.judgeScreenshot("", shotOcr.meta, ctx);
    return { state: "unavailable", hard: j.hard.filter((h) => h.code === "ai" || h.code === "edited") };
  }
  const j = KG.judgeScreenshot(shotOcr.text, shotOcr.meta, ctx);
  // a wrong-time/date result only makes sense once we know which UTR they mean; the rest is always definite
  return { state: "read", ...j, utrTyped: /^\d{12}$/.test(utr) };
}

function showShotStatus() {
  const box = $("#shotStatus");
  if (!box) return;
  const r = shotResult();
  if (!r) { box.hidden = true; return; }
  box.hidden = false;
  box.className = "shot-status";
  if (r.state === "reading") { box.innerHTML = `<span class="spinner"></span> Checking your screenshot…`; return; }
  if (r.hard && r.hard.length) {
    box.classList.add("bad");
    const proof = r.hard.some((h) => h.proof);
    box.innerHTML = `✕ <b>This screenshot can't be accepted.</b><br>${r.hard.map((h) => esc(h.msg)).join("<br>")}`
      + (r.utrSeen ? `<br><button type="button" class="btn small" id="useSeenUtr" style="margin-top:6px">Use ${esc(r.utrSeen)}</button>` : "");
    if (proof) { $("#overrideBox").hidden = true; $("#fOverride").checked = false; }
    const useBtn = $("#useSeenUtr");
    if (useBtn) useBtn.onclick = () => { $("#fUtr").value = r.utrSeen; showShotStatus(); };
    return;
  }
  if (r.state === "unavailable") { box.classList.add("meh"); box.textContent = "Couldn't read the screenshot automatically — the owner will check it."; return; }
  if (!r.utrTyped) { box.textContent = "✓ Screenshot looks fine. Now type the 12-digit UTR from it."; return; }
  if (r.utr && r.amount) { box.classList.add("good"); box.textContent = `✓ UTR and ${rupeesExact(orderTotal())} found in your screenshot`; return; }
  box.classList.add("meh");
  box.textContent = !r.utr
    ? "⚠ Couldn't find this exact UTR in your screenshot. Check every digit, or upload the screenshot that shows it."
    : `⚠ UTR found, but couldn't read ${rupeesExact(orderTotal())} clearly. Make sure you paid EXACTLY this amount.`;
}

// Fill the UTR from the screenshot when the student hasn't typed one yet.
function autoFillUtr() {
  if (!shotOcr || !shotOcr.text) return;
  const c = KG.utrCandidates(shotOcr.text);
  const box = $("#fUtr"), hint = $("#utrHint");
  if (!c.length) {
    hint.innerHTML = "⚠ Couldn't read the UTR from the screenshot — please type it (UPI app → payment details → UPI Ref No.).";
    return;
  }
  if (!box.value.trim() || box.dataset.auto === "1") {
    box.value = c[0];
    box.dataset.auto = "1";
    hint.innerHTML = "✓ Filled from your screenshot — check it matches your UPI app.";
    hint.classList.add("qr-saved");
    showShotStatus();
  }
}

// ---------------- submit ----------------
async function sha256Hex(file) {
  const buf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeName(name) {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name).normalize("NFKD").replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").slice(0, 60) || "file";
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "bin";
  return `${base}.${ext}`;
}
function mimeFor(it) {
  if (it.file.type) return it.file.type;
  return { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword" }[it.kind] || "application/octet-stream";
}
function setBusy(text) {
  const b = $("#submitBtn");
  b.disabled = !!text;
  b.innerHTML = text ? `<span class="spinner"></span> ${esc(text)}` : "Submit order &amp; get token";
}
function fail(msg, focusSel) {
  toast(msg, "error", 6000);
  if (focusSel) { const el = $(focusSel); el && el.focus(); el && el.scrollIntoView({ block: "center", behavior: "smooth" }); }
  return false;
}

async function submitOrder(e) {
  e.preventDefault();
  if (!settings.shop_open) return fail("Shop is closed right now.");

  const name = $("#fName").value.trim();
  const phone = $("#fPhone").value.trim();
  const flat = $("#fFlat").value.trim();
  const utr = $("#fUtr").value.trim();
  const shot = shotFile;
  const notes = $("#fNotes").value.trim();

  if (name.length < 2) return fail("Enter your name", "#fName");
  if (!/^[6-9]\d{9}$/.test(phone)) return fail("Enter a valid 10-digit phone number", "#fPhone");
  if (!flat) return fail("Enter your flat / room number", "#fFlat");
  if (!items.length) return fail("Add at least one file to print");
  if (items.some((i) => i.loading)) return fail("Wait — still counting pages");
  if (!/^\d{12}$/.test(utr)) return fail("UTR must be exactly 12 digits", "#fUtr");
  if (!shot) return fail("Upload your payment screenshot", "#fShot");
  if (!shot.type.startsWith("image/")) return fail("Screenshot must be an image", "#fShot");
  if (shot.size > MAX_SHOT) return fail("Screenshot is too big (max 8 MB)", "#fShot");

  localStorageSet("kg_details", JSON.stringify({ name, phone, flat }));
  KG.unlockAudio();

  if (blocked) return fail("Your account is blocked because of fake payments. Please talk to the shop owner.");

  const uploaded = [];
  try {
    // 1. the screenshot must actually show the UTR the student typed
    setBusy("Reading your screenshot…");
    if (!shotOcr || shotOcr.file !== shot) startShotOcr(shot);
    await shotOcr.promise;
    const r = shotResult();
    let studentCheck;
    // 1. certain cheating — never accepted
    const proof = (r.hard || []).filter((h) => h.proof);
    if (proof.length) return fail("This screenshot can't be accepted: " + proof[0].msg, "#fShot");

    // 2. a UTR in this screenshot was already used for another order → reused payment
    setBusy("Checking payment details…");
    for (const c of (r.utrCandidates || []).slice(0, 4)) {
      const { data: used } = await sb.rpc("check_payment", { p_utr: c, p_sha: "0".repeat(64) });
      if (used === "utr") return fail(`This payment (UTR ${c}) was already used for another order. Each payment can be used only once.`, "#fShot");
    }

    // 3. things that look wrong or couldn't be confirmed — retry first; after 2 tries
    //    the student may send it to the owner for a manual check (marked in red)
    const problems = [...(r.hard || []).map((h) => h.code), ...(r.soft || [])];
    if (r.state === "unavailable") {
      studentCheck = { unavailable: true, why: String((shotOcr.error && (shotOcr.error.message || shotOcr.error)) || "").slice(0, 120) };
    } else {
      if (problems.length && !$("#fOverride").checked) {
        ocrFails++;
        if (ocrFails >= 2) $("#overrideBox").hidden = false;
        const first = (r.hard || [])[0];
        const what = first ? first.msg
          : problems.includes("utr") ? "This exact UTR is not in your screenshot. Check every digit, or upload the screenshot that shows the UTR."
          : problems.includes("amount") ? `Couldn't read ${rupeesExact(orderTotal())} in your screenshot. Pay EXACTLY ${rupeesExact(orderTotal())} and upload the original screenshot (not from WhatsApp).`
          : `The screenshot doesn't show payment to ${settings.payee_name}. Make sure you paid the shop.`;
        return fail(ocrFails >= 2 ? what + " If your payment is correct, tick the box below to send it to the shop owner." : what, problems.includes("utr") ? "#fUtr" : "#fShot");
      }
      studentCheck = { utr: r.utr, amount: r.amount, payee: r.payee, override: problems.length > 0, missing: problems, utrSeen: r.utrSeen || null };
    }

    setBusy("Checking payment details…");
    const sha = await sha256Hex(shot);
    const { data: dup, error: dupErr } = await sb.rpc("check_payment", { p_utr: utr, p_sha: sha });
    if (dupErr) throw dupErr;
    if (dup === "utr") return fail("This UTR was already used for another order. Each payment can be used only once.", "#fUtr");
    if (dup === "shot") return fail("This screenshot was already uploaded before. Please upload the screenshot of THIS payment.", "#fShot");

    const batch = crypto.randomUUID();
    const files = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      setBusy(`Uploading file ${i + 1} of ${items.length}…`);
      const path = `${user.id}/${batch}/${i + 1}-${safeName(it.name)}`;
      const { error } = await sb.storage.from("prints").upload(path, it.file, { contentType: mimeFor(it), upsert: false });
      if (error) throw error;
      uploaded.push(["prints", path]);
      files.push({
        path, name: it.name, kind: it.kind, size: it.file.size,
        pages: it.pages, pages_source: it.pagesSource,
        copies: it.copies, color: it.color, double: it.double,
      });
    }

    setBusy("Uploading screenshot…");
    const shotExt = (shot.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
    const shotPath = `${user.id}/${batch}/payment.${shotExt}`;
    const { error: shotErr } = await sb.storage.from("payments").upload(shotPath, shot, { contentType: shot.type, upsert: false });
    if (shotErr) throw shotErr;
    uploaded.push(["payments", shotPath]);

    setBusy("Getting your token…");
    const { data: order, error: insErr } = await sb.from("orders").insert({
      student_name: name, phone, flat, files, notes, utr,
      screenshot_path: shotPath, screenshot_sha256: sha,
      paise: getPaise(), student_check: studentCheck,
      shot_taken_at: shot.lastModified ? new Date(shot.lastModified).toISOString() : null,
    }).select().single();
    if (insErr) throw insErr;

    onOrderPlaced(order);
  } catch (err) {
    // clean up anything we uploaded for this failed order
    for (const [bucket, path] of uploaded) { sb.storage.from(bucket).remove([path]).catch(() => {}); }
    toast(friendlyError(err), "error", 7000);
  } finally {
    setBusy("");
  }
}

function friendlyError(err) {
  const msg = (err && (err.message || err.error_description)) || String(err);
  if (/could not be read|NotReadable|permission problems/i.test(msg)) return "Your phone lost access to a file. Please remove the files, select them again, and submit.";
  if (/orders_utr_unique/.test(msg)) return "This UTR was already used for another order.";
  if (/orders_shot_unique/.test(msg)) return "This screenshot was already uploaded before.";
  if (/blocked/i.test(msg)) { blocked = true; $("#blockedBanner").hidden = false; return "Your account is blocked because of fake payments. Please talk to the shop owner."; }
  if (/Invalid payment amount/i.test(msg)) return "Something changed with the amount. Refresh the page and try again.";
  if (/closed/i.test(msg)) return "Shop is closed right now.";
  if (/JWT|not authenticated|sign in/i.test(msg)) return "Your login expired. Please log out and sign in again.";
  if (/exceeded|too large|maximum allowed size/i.test(msg)) return "A file is too large. Max 25 MB per file.";
  if (/Failed to fetch|NetworkError/i.test(msg)) return "No internet connection. Please try again.";
  return "Something went wrong: " + msg;
}

function onOrderPlaced(order) {
  resetPaise();
  payingSince = 0; leftForPayment = false;
  qrSaved = false;
  $("#qrSavedNote").innerHTML = 'If your browser asks "Download?", tap <b>Download</b>.';
  $("#qrSavedNote").classList.remove("qr-saved");
  $("#backBanner").hidden = true;
  shotOcr = null;
  ocrFails = 0;
  $("#overrideBox").hidden = true;
  $("#fOverride").checked = false;
  $("#shotStatus").hidden = true;
  items = [];
  renderItems();
  $("#fUtr").value = "";
  $("#fShot").value = "";
  shotFile = null;
  $("#fUtr").dataset.auto = "0";
  $("#utrHint").textContent = "Upload the screenshot above — we read the UTR from it. You can also type it.";
  $("#utrHint").classList.remove("qr-saved");
  $("#shotPreview").hidden = true;
  $("#fNotes").value = "";
  $("#successToken").textContent = order.token;
  $("#successInfo").textContent = `${order.files.length} file${order.files.length > 1 ? "s" : ""} · ${rupeesExact(order.total)} · ${KG.fmtTime(order.created_at)}`;
  $("#notifyBtn").hidden = !("Notification" in window) || Notification.permission === "granted";
  $("#successModal").hidden = false;
  upsertOrder(order);
}

// ---------------- my orders ----------------
async function loadMyOrders() {
  const { data, error } = await sb.from("orders").select("*")
    .eq("user_id", user.id).order("created_at", { ascending: false }).limit(30);
  if (error) { $("#ordersList").innerHTML = `<div class="empty">Couldn't load orders: ${esc(error.message)}</div>`; return; }
  myOrders = data;
  renderOrders();

  if (ordersChannel) sb.removeChannel(ordersChannel);
  ordersChannel = sb.channel("my-orders-" + user.id)
    .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `user_id=eq.${user.id}` }, (p) => {
      if (p.eventType === "DELETE") { myOrders = myOrders.filter((o) => o.id !== p.old.id); renderOrders(); return; }
      const old = myOrders.find((o) => o.id === p.new.id);
      if (old && old.status !== p.new.status) onStatusChange(p.new);
      upsertOrder(p.new);
    })
    .subscribe();

  // refresh when coming back to the tab (in case the live connection slept)
  if (!loadMyOrders.wired) {
    loadMyOrders.wired = true;
    document.addEventListener("visibilitychange", () => { if (!document.hidden && user) refreshOrders(); });
    setInterval(() => { if (user && !document.hidden) refreshOrders(); }, 60000);
  }
}

async function refreshOrders() {
  const { data } = await sb.from("orders").select("*")
    .eq("user_id", user.id).order("created_at", { ascending: false }).limit(30);
  if (!data) return;
  data.forEach((o) => {
    const old = myOrders.find((x) => x.id === o.id);
    if (old && old.status !== o.status) onStatusChange(o);
  });
  myOrders = data;
  renderOrders();
}

function upsertOrder(o) {
  const i = myOrders.findIndex((x) => x.id === o.id);
  if (i >= 0) myOrders[i] = o; else myOrders.unshift(o);
  renderOrders();
}

function onStatusChange(o) {
  if (o.status === "ready") {
    KG.chime(2);
    toast(`${o.token} is READY — collect your prints!`, "ok", 8000);
    KG.notify(`${o.token} is ready 🖨️`, "Your prints are ready. Collect them at the shop.");
    KG.flashTitle(`✅ ${o.token} ready!`);
  } else if (o.status === "queued") {
    KG.chime(1);
    toast(`✅ ${o.token} ACCEPTED — payment confirmed, your prints are being made`, "ok", 8000);
    KG.notify(`${o.token} accepted ✅`, "Payment confirmed. We'll tell you when it's ready to collect.");
  } else if (o.status === "rejected") {
    KG.chime(1);
    toast(`${o.token} was rejected${o.reject_reason ? ": " + o.reject_reason : ""}`, "error", 9000);
    KG.notify(`${o.token} was rejected`, o.reject_reason || "Please contact the shop.");
    checkBlocked();
  }
}

function renderOrders() {
  const box = $("#ordersList");
  const active = myOrders.filter((o) => ["payment_review", "queued", "ready"].includes(o.status)).length;
  $("#activeCount").textContent = active || "";
  if (!myOrders.length) { box.innerHTML = `<div class="empty">No orders yet. Your orders will show here.</div>`; return; }
  box.innerHTML = myOrders.map((o) => {
    const files = o.files.map((f) => `${esc(f.name)} <span class="muted">(${f.pages}p × ${f.copies}, ${f.color ? "colour" : "B/W"}${f.double ? ", 2-side" : ""})</span>`).join("<br>");
    return `<div class="order">
      <div class="otoken"><b>${esc(o.token)}</b><small>${fmtDay(o.token_day)}</small></div>
      <div class="obody">
        <div class="row" style="justify-content:space-between">
          <span class="badge st-${o.status}">${STATUS[o.status]}</span>
          <b>${rupeesExact(o.total)}</b>
        </div>
        <div style="font-size:13px;margin-top:6px">${files}</div>
        ${o.status === "rejected" && o.reject_reason ? `<div class="banner bad" style="margin:8px 0 0;padding:8px 10px">Reason: ${esc(o.reject_reason)}${o.fake ? "<br><b>Marked as a fake payment.</b> 2 fake payments block your account." : ""}</div>` : ""}
        ${o.status === "ready" ? `<div class="banner" style="margin:8px 0 0;padding:8px 10px;background:var(--ok-soft);border-color:#bfe3c9">Show token <b>${esc(o.token)}</b> at the shop to collect.</div>` : ""}
        <small>Placed ${fmtTime(o.created_at)} · UTR ${esc(o.utr)}</small>
      </div>
    </div>`;
  }).join("");
}
