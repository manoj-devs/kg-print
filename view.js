// ================= KG Print — view one document in the browser =================
// view.html?id=<order id>&i=<file index>   (owner only)
// Shows the document inside the browser with Download + Print buttons,
// instead of downloading it into a desktop app.
const { sb, $, esc } = KG;

const params = new URLSearchParams(location.search);
const orderId = params.get("id");
let index = Math.max(0, parseInt(params.get("i") || "0", 10) || 0);
let order = null;
let blobUrl = null;
let pdfFrame = null;

init();

async function init() {
  if (!KG.configured) return msg(KG.setupNeededHTML());
  if (!orderId) return msg("No document selected.");
  const { data: s } = await sb.auth.getSession();
  if (!s.session) return msg("Please log in on the owner dashboard first, then open the document again.");
  const { data: isOwner } = await sb.rpc("is_owner");
  if (!isOwner) return msg("Only the shop owner can open documents.");
  const { data, error } = await sb.from("orders").select("*").eq("id", orderId).single();
  if (error || !data) return msg("Order not found.");
  order = data;
  if (order.files_deleted) return msg("The files of this order were already deleted (after pickup / 3 days).");
  if (index >= order.files.length) index = 0;

  $("#prev").onclick = () => go(index - 1);
  $("#next").onclick = () => go(index + 1);
  $("#dl").onclick = download;
  $("#pr").onclick = printIt;
  show();
}

function msg(html) {
  $("#bar").hidden = true;
  $("#stage").innerHTML = `<div class="msg">${html}</div>`;
}

function go(i) {
  if (i < 0 || i >= order.files.length) return;
  index = i;
  history.replaceState(null, "", `?id=${encodeURIComponent(orderId)}&i=${i}`);
  show();
}

function fileName(f, i) {
  return `${order.token}_${i + 1}_${f.name}`.replace(/[\\/:*?"<>|]+/g, "_");
}

function mimeOf(f) {
  return { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword" }[f.kind]
    || (/\.png$/i.test(f.name) ? "image/png" : /\.webp$/i.test(f.name) ? "image/webp" : "image/jpeg");
}

async function show() {
  const f = order.files[index];
  document.title = `${order.token} · ${f.name}`;
  $("#bar").hidden = false;
  $("#tok").textContent = order.token;
  $("#name").textContent = f.name;
  $("#name").title = f.name;
  $("#count").textContent = order.files.length > 1 ? `File ${index + 1} of ${order.files.length}` : "";
  $("#spec").innerHTML = `
    <span>${f.pages} page${f.pages > 1 ? "s" : ""}</span>
    <span>× ${f.copies} cop${f.copies > 1 ? "ies" : "y"}</span>
    <span class="${f.color ? "color" : ""}">${f.color ? "COLOUR" : "B/W"}</span>
    <span class="${f.double ? "dbl" : ""}">${f.double ? "BOTH SIDES" : "Single side"}</span>`;
  $("#warn").textContent = f.pages_source === "manual" || f.pages_source === "estimate" ? "⚠ check page count" : "";
  $("#prev").hidden = $("#next").hidden = order.files.length < 2;
  $("#prev").disabled = index === 0;
  $("#next").disabled = index === order.files.length - 1;
  $("#stage").innerHTML = `<div class="msg">Loading ${esc(f.name)}…</div>`;
  pdfFrame = null;

  try {
    const { data, error } = await sb.storage.from("prints").createSignedUrl(f.path, 3600);
    if (error) throw error;
    const res = await fetch(data.signedUrl);
    if (!res.ok) throw new Error("download failed (" + res.status + ")");
    const blob = new Blob([await res.arrayBuffer()], { type: mimeOf(f) });
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(blob);

    if (f.kind === "pdf") {
      // the browser's own PDF viewer (zoom, pages, download, print)
      $("#stage").innerHTML = "";
      pdfFrame = document.createElement("iframe");
      pdfFrame.src = blobUrl;
      pdfFrame.title = f.name;
      $("#stage").appendChild(pdfFrame);
    } else if (f.kind === "image") {
      $("#stage").innerHTML = `<div class="img-wrap"><img src="${blobUrl}" alt="${esc(f.name)}"></div>`;
    } else if (f.kind === "docx" && window.docx) {
      $("#stage").innerHTML = `<div class="docx-wrap" id="docxBox"></div>`;
      await window.docx.renderAsync(blob, $("#docxBox"), null, { inWrapper: true, ignoreLastRenderedPageBreak: false });
    } else {
      $("#stage").innerHTML = `<div class="msg"><b>${esc(f.name)}</b><br><br>This old Word format (.doc) can't be shown in the browser.<br>
        Tap <b>⬇ Download</b> and open it in Word / WPS to print.</div>`;
    }
  } catch (e) {
    msg(`Couldn't open this file: ${esc(e.message || e)}`);
  }
}

function download() {
  if (!blobUrl) return;
  const f = order.files[index];
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = fileName(f, index);
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function printIt() {
  const f = order.files[index];
  if (f.kind === "doc") return download();
  if (pdfFrame) {
    try { pdfFrame.contentWindow.focus(); pdfFrame.contentWindow.print(); return; }
    catch (e) { /* fall back to the viewer's own print button */ }
    alert("Use the printer icon in the PDF toolbar.");
    return;
  }
  window.print();
}
