// Owner-only screenshot tester: runs the SAME checks as the student page,
// without creating an order. Nothing is uploaded or saved.
const { $, esc, rupeesExact } = KG;
const sb = KG.sb;
let settings = null, read = null, file = null;

init();

async function init() {
  const gate = $("#gate");
  if (!KG.configured) { gate.innerHTML = KG.setupNeededHTML(); gate.hidden = false; return; }
  const { data } = await sb.auth.getSession();
  const user = data.session?.user || null;
  if (!user) {
    gate.innerHTML = `Please log in on the <a href="owner.html">owner dashboard</a> first, then open this page again.`;
    gate.hidden = false; return;
  }
  const { data: isOwner } = await sb.rpc("is_owner");
  if (!isOwner) { gate.textContent = `${user.email} is not an owner account.`; gate.hidden = false; return; }
  const s = await sb.from("settings").select("*").eq("id", 1).single();
  settings = s.data || {};
  $("#tool").hidden = false;
  setWhen(new Date());
  KG.warmOcr && KG.warmOcr();

  $("#tShot").onchange = onFile;
  $("#tRun").onclick = run;
  $("#tAmt").oninput = $("#tUtr").oninput = $("#tWhen").oninput = () => { if (read) run(); };
}

function setWhen(d) {
  const p = (n) => String(n).padStart(2, "0");
  const ist = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  $("#tWhen").value = `${ist.getFullYear()}-${p(ist.getMonth() + 1)}-${p(ist.getDate())}T${p(ist.getHours())}:${p(ist.getMinutes())}`;
}

async function onFile() {
  file = $("#tShot").files[0] || null;
  read = null;
  $("#out").hidden = true;
  if (!file) return;
  const img = $("#shotImg"); img.src = URL.createObjectURL(file); img.hidden = false;
  $("#tRun").disabled = true; $("#tRun").textContent = "Reading screenshot…";
  try {
    const buf = await file.arrayBuffer();
    const [meta, o] = await Promise.all([KG.inspectImage(buf, file).catch(() => ({})), KG.ocrImage(file)]);
    read = { meta, ...o };
    const cands = KG.utrCandidates(o.text || "");
    if (!$("#tUtr").value && cands[0]) $("#tUtr").value = cands[0];
    // an old screenshot: default the "order time" to the payment time it shows
    const t = KG.timeCheck(o.text || "", Date.now());
    const dm = (o.text || "").match(/\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*,?\s+(20\d\d)\b/);
    if (dm && t.timeSeen && t.timeSeen[0]) {
      const tm = t.timeSeen[0].match(/(\d{1,2}):(\d{2})\s*([ap])?/i);
      if (tm) {
        let h = +tm[1]; const ap = (tm[3] || "").toLowerCase();
        if (ap === "p" && h < 12) h += 12; if (ap === "a" && h === 12) h = 0;
        const d = new Date(`${dm[2]} ${dm[1]}, ${dm[3]} ${h}:${tm[2]}:00 GMT+0530`);
        if (!isNaN(d)) setWhen(new Date(d.getTime() + 2 * 60000));
      }
    }
  } catch (e) {
    read = { error: e, meta: {}, text: "" };
  }
  $("#tRun").disabled = false; $("#tRun").textContent = "Check screenshot";
  if ($("#tAmt").value) run(); else $("#tAmt").focus();
}

function run() {
  if (!read) return;
  const total = Number($("#tAmt").value);
  if (!(total > 0)) { KG.toast("Type the order amount first", "warn"); return; }
  const utr = $("#tUtr").value.trim();
  const when = new Date($("#tWhen").value + ":00+05:30").getTime() || Date.now();
  const ctx = { utr, total, settings, when, lines: read.lines, mainDigits: read.mainDigits, bigReads: read.bigReads, forensic: read.forensic, statusTime: read.statusTime };
  const text = read.text || "";
  const j = KG.judgeScreenshot(text, read.meta || {}, ctx);

  // the same decision the student page makes
  const proof = j.hard.filter((h) => h.proof);
  const problems = [...j.hard.map((h) => h.msg), ...(j.soft || []).map((c) => ({
    utr: "This exact UTR is not in the screenshot.",
    amount: `Couldn't read ${rupeesExact(total)} in the screenshot.`,
    payee: `The screenshot doesn't show payment to ${settings.payee_name || "the shop"}.`,
  }[c] || c))];
  const v = $("#verdict");
  if (read.error || text.replace(/\s/g, "").length < 15) {
    v.className = "verdict v-retry";
    v.innerHTML = "⚠ The website couldn't read this screenshot. The student types the UTR and the order goes to you for a manual check.";
  } else if (proof.length) {
    v.className = "verdict v-block";
    v.innerHTML = `✕ BLOCKED — the student can't place the order.<br>${esc(proof[0].msg)}`;
  } else if (problems.length) {
    v.className = "verdict v-retry";
    v.innerHTML = `⚠ REFUSED at first — after 2 tries the student can send it to you for a manual check.<br>${problems.map(esc).join("<br>")}`;
  } else {
    v.className = "verdict v-ok";
    v.innerHTML = `✓ ACCEPTED — the order would go through.${(j.warn || []).length ? "<br><small>You'd see a ⚠ Check note on the order (see below).</small>" : ""}`;
  }
  // what? — note: a UTR already used for another order is checked on the real page only
  const WARN = { status: "phone clock doesn't match", patch: "possible edit (patch)", glyph: "odd-looking digit in UTR", layout: "unusual receipt layout", paise: "rupees found, paise not readable" };
  const row = (k, val) => `<b>${k}</b><span>${val}</span>`;
  $("#facts").innerHTML = [
    row("App", esc(j.app || "not recognised (fine)")),
    row("Amount", j.amount ? `✓ ${rupeesExact(total)} found` : (j.wrongAmounts || []).length ? `✕ shows ${rupeesExact(j.wrongAmounts[0])}` : "not found"),
    row("Big amount read", esc(j.mainAmount || "—")),
    row("UTR", j.utr ? `✓ ${esc(utr)} found` : j.utrSeen ? `✕ screenshot shows ${esc(j.utrSeen)}` : "not found"),
    row("UTRs in screenshot", esc((j.utrCandidates || []).join(", ") || "—")),
    row("Paid to shop", j.payee === true ? "✓ yes" : j.payee === false ? "✕ shop name / UPI ID not seen" : "?"),
    row("Time / date", `${esc((j.timeSeen || []).join(", ") || "—")} ${j.timeOk === false ? "✕ doesn't fit order time" : j.timeOk ? "✓" : ""} · ${esc(j.dateSeen || "—")}${j.dateOld ? " ✕ old" : ""}`),
    row("Status", j.failed && !j.success ? "✕ failed / pending" : j.success ? "✓ successful" : "—"),
    row("File", `${esc((read.meta.type || "?").toUpperCase())} ${read.meta.w || "?"}×${read.meta.h || "?"}${read.meta.software ? " · edited by " + esc(read.meta.software) : ""}${read.meta.ai ? " · AI label " + esc(read.meta.ai) : ""}`),
    row("Owner notes", (j.warn || []).length ? "⚠ " + j.warn.map((w) => WARN[w] || w).join(", ") : "none"),
  ].join("");
  $("#ocrText").textContent = text || "(nothing read)";
  $("#out").hidden = false;
}
