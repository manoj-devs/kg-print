// ================= KG Print — print job window =================
// Opened from the owner dashboard after "Payment received".
// Shows how to print each file and downloads them all.
const { sb, $, esc, rupeesExact, STATUS, toast, fmtTime, fmtDay } = KG;
const KIND_LABEL = { pdf: "PDF", image: "IMG", docx: "DOCX", doc: "DOC" };

const params = new URLSearchParams(location.search);
const orderId = params.get("id");
const autoDownload = params.get("auto") === "1";
let order = null;
const done = new Set(); // indexes of files already downloaded

init();

async function init() {
  if (!KG.configured) return show(KG.setupNeededHTML());
  if (!orderId) return show("No order selected.");

  const { data: s } = await sb.auth.getSession();
  if (!s.session) return show("Please log in on the owner dashboard first, then open the print job again.");
  const { data: isOwner } = await sb.rpc("is_owner");
  if (!isOwner) return show("Only the shop owner can open print jobs.");

  const { data: st } = await sb.from("settings").select("shop_name").eq("id", 1).single();
  if (st) $("#shopName").textContent = st.shop_name;

  const { data, error } = await sb.from("orders").select("*").eq("id", orderId).single();
  if (error || !data) return show("Order not found.");
  order = data;
  render();

  $("#dlAll").onclick = downloadAll;
  $("#dlZip").onclick = downloadZip;
  $("#markReady").onclick = markReady;
  $("#jFiles").addEventListener("click", onFileClick);

  if (autoDownload && !order.files_deleted) downloadAll();
}

function show(html) {
  $("#msg").innerHTML = html;
  $("#msg").hidden = false;
  $("#job").hidden = true;
}

function fileName(f, i) {
  // e.g. "KG-7_1_DBMS_notes.pdf" so files from different students never mix up
  return `${order.token}_${i + 1}_${f.name}`.replace(/[\\/:*?"<>|]+/g, "_");
}

function render() {
  document.title = `${order.token} — Print job`;
  $("#msg").hidden = true;
  $("#job").hidden = false;
  $("#jToken").textContent = order.token;
  $("#jDay").textContent = `${fmtDay(order.token_day)} · ${fmtTime(order.created_at)}`;
  $("#jName").textContent = order.student_name;
  $("#jFlat").textContent = order.flat;
  $("#jPhone").textContent = order.phone;
  $("#jPhone").href = "tel:" + order.phone;
  $("#jStatus").textContent = STATUS[order.status];
  $("#jStatus").className = "badge st-" + order.status;
  $("#jTotal").textContent = rupeesExact(order.total);
  $("#jNotes").hidden = !order.notes;
  $("#jNotes").textContent = "📝 " + (order.notes || "");
  $("#jCount").textContent = order.files.length;
  $("#markReady").hidden = order.status !== "queued";

  if (order.files_deleted) {
    $("#dlAll").hidden = $("#dlZip").hidden = $("#dlHint").hidden = true;
  }

  $("#jFiles").innerHTML = order.files.map((f, i) => `
    <div class="job-file" data-i="${i}">
      <span class="ficon ${esc(f.kind)}">${KIND_LABEL[f.kind] || "FILE"}</span>
      <div>
        <div class="name">${i + 1}. ${esc(f.name)}</div>
        <div class="print-spec">
          <span class="spec">${f.pages} page${f.pages > 1 ? "s" : ""}</span>
          <span class="spec">× ${f.copies} cop${f.copies > 1 ? "ies" : "y"}</span>
          <span class="spec ${f.color ? "color" : ""}">${f.color ? "COLOUR" : "B/W"}</span>
          <span class="spec ${f.double ? "dbl" : ""}">${f.double ? "BOTH SIDES" : "Single side"}</span>
        </div>
        ${f.pages_source === "manual" || f.pages_source === "estimate" ? `<small style="color:var(--warn);font-weight:600">⚠ Page count ${f.pages_source === "estimate" ? "estimated" : "typed by student"} — check before printing</small>` : ""}
      </div>
      <div class="btns">
        ${order.files_deleted ? `<small class="muted">File already deleted</small>` : `
        <button class="btn small" data-act="open">👁 Open / print</button>
        <button class="btn small" data-act="dl">⬇ Download</button>
        <span class="dl-state" data-state></span>`}
      </div>
    </div>`).join("");
}

async function signed(path, downloadName) {
  const { data, error } = await sb.storage.from("prints").createSignedUrl(path, 900, downloadName ? { download: downloadName } : undefined);
  if (error) throw error;
  return data.signedUrl;
}

function markDone(i) {
  done.add(i);
  const el = document.querySelector(`.job-file[data-i="${i}"] [data-state]`);
  if (el) { el.textContent = "✓ downloaded"; el.className = "dl-state ok"; }
}

async function downloadOne(i) {
  const f = order.files[i];
  const url = await signed(f.path, fileName(f, i));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName(f, i);
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  markDone(i);
}

async function downloadAll() {
  const btn = $("#dlAll");
  btn.disabled = true;
  try {
    for (let i = 0; i < order.files.length; i++) {
      btn.innerHTML = `<span class="spinner"></span> ${i + 1} / ${order.files.length}`;
      await downloadOne(i);
      await new Promise((r) => setTimeout(r, 900)); // small gap so the browser doesn't drop any
    }
    toast(`All ${order.files.length} file(s) downloading — check your Downloads`, "ok");
  } catch (e) {
    toast("Download failed: " + e.message, "error", 7000);
  } finally {
    btn.disabled = false;
    btn.textContent = "⬇ Download all";
  }
}

async function downloadZip() {
  const btn = $("#dlZip");
  btn.disabled = true;
  try {
    const zip = new JSZip();
    for (let i = 0; i < order.files.length; i++) {
      btn.innerHTML = `<span class="spinner"></span> ${i + 1} / ${order.files.length}`;
      const f = order.files[i];
      const res = await fetch(await signed(f.path));
      if (!res.ok) throw new Error(`${f.name}: ${res.status}`);
      zip.file(fileName(f, i), await res.blob());
    }
    btn.innerHTML = `<span class="spinner"></span> zipping…`;
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${order.token}_${order.student_name}.zip`.replace(/[\\/:*?"<>|\s]+/g, "_");
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    order.files.forEach((_, i) => markDone(i));
  } catch (e) {
    toast("ZIP failed: " + e.message, "error", 7000);
  } finally {
    btn.disabled = false;
    btn.textContent = "🗜 Download as ZIP";
  }
}

async function onFileClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const i = +btn.closest(".job-file").dataset.i;
  const f = order.files[i];
  try {
    if (btn.dataset.act === "dl") return await downloadOne(i);
    // open in a new tab — PDFs and photos open in the browser viewer with a Print button
    const w = window.open("", "_blank");
    const url = await signed(f.path, f.kind === "doc" || f.kind === "docx" ? fileName(f, i) : undefined);
    if (w) w.location = url; else location.href = url;
  } catch (err) {
    toast("Couldn't open file: " + err.message, "error");
  }
}

async function markReady() {
  const { data, error } = await sb.from("orders").update({ status: "ready" }).eq("id", order.id).select().single();
  if (error) return toast(error.message, "error");
  order = data;
  render();
  toast(`${order.token} marked ready — student notified`, "ok");
  setTimeout(() => window.close(), 1500);
}
