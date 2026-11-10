// Shared helpers for the student page and the owner dashboard.
(function () {
  const cfg = window.KG_CONFIG || {};
  const configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes("YOUR-PROJECT") && !cfg.SUPABASE_ANON_KEY.includes("YOUR-"));

  const sb = configured && window.supabase
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function rupees(n) {
    const v = Math.round(Number(n || 0) * 100) / 100;
    return "₹" + (Number.isInteger(v) ? v : v.toFixed(2));
  }
  function rupeesExact(n) {
    return "₹" + (Math.round(Number(n || 0) * 100) / 100).toFixed(2);
  }
  function rateFor(s, color, dbl) {
    return Number(color ? (dbl ? s.color_double : s.color_single) : (dbl ? s.bw_double : s.bw_single));
  }
  function linePrice(s, f) {
    return Math.round(f.pages * f.copies * rateFor(s, f.color, f.double) * 100) / 100;
  }
  function todayIST() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  }
  function fmtTime(iso) {
    return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
  }
  function fmtDay(isoDate) {
    if (!isoDate) return "";
    if (isoDate === todayIST()) return "Today";
    return new Date(isoDate + "T12:00:00+05:30").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  }

  const STATUS = {
    payment_review: "Checking payment",
    queued: "Accepted ✓ — printing",
    ready: "Ready — collect now",
    collected: "Collected",
    rejected: "Rejected",
  };

  function toast(msg, type = "info", ms = 4000) {
    let box = document.getElementById("toasts");
    if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.appendChild(box); }
    const t = document.createElement("div");
    t.className = "toast " + type;
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  // ---- sound (Web Audio: no sound file needed). Browsers only allow
  // sound after the user taps something once, so call unlockAudio() on a tap.
  let audioCtx = null;
  function unlockAudio() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      return true;
    } catch (e) { return false; }
  }
  function audioReady() { return !!audioCtx && audioCtx.state === "running"; }
  function chime(times = 1) {
    if (!audioCtx) return;
    const start = audioCtx.currentTime + 0.05;
    for (let r = 0; r < times; r++) {
      [880, 1175, 1568].forEach((freq, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = "sine";
        o.frequency.value = freq;
        const t = start + r * 0.9 + i * 0.16;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
        o.connect(g).connect(audioCtx.destination);
        o.start(t);
        o.stop(t + 0.6);
      });
    }
    if (navigator.vibrate) navigator.vibrate([300, 120, 300, 120, 300]);
  }

  // ---- system notifications (works on Android Chrome via the service worker)
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  async function askNotify() {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    return (await Notification.requestPermission()) === "granted";
  }
  async function notify(title, body) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
      const opts = { body, icon: "icon.svg", badge: "icon.svg", tag: "kg-" + Date.now(), renotify: true, vibrate: [300, 120, 300] };
      if (reg) return reg.showNotification(title, opts);
      new Notification(title, opts);
    } catch (e) { /* ignore */ }
  }

  // ---- title flashing while the tab is in the background
  let flashTimer = null;
  const baseTitle = document.title;
  function flashTitle(msg) {
    stopFlash();
    let on = false;
    flashTimer = setInterval(() => { document.title = (on = !on) ? msg : baseTitle; }, 900);
  }
  function stopFlash() { if (flashTimer) clearInterval(flashTimer); flashTimer = null; document.title = baseTitle; }
  window.addEventListener("focus", stopFlash);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) stopFlash(); });

  async function signInWithGoogle() {
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: "select_account" } },
    });
    if (error) toast(error.message, "error");
  }
  async function signOut() {
    await sb.auth.signOut();
    location.reload();
  }

  function setupNeededHTML() {
    return `<div class="setup-box"><h2>Almost there — connect Supabase</h2>
      <p>Open <code>config.js</code> and paste your Supabase Project URL and anon/publishable key.
      Follow <b>README.md</b> step by step.</p></div>`;
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => rej(new Error("Could not load " + src));
      document.head.appendChild(s);
    });
  }

  // ---- screenshot reading (free OCR that runs inside the browser) ----
  const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
  let ocrWorkerPromise = null;
  // Enlarge + greyscale the screenshot first so small text (like Paytm's tiny
  // paise "₹2.58") is read reliably.
  async function prepForOcr(source, maxWidth = 1400) {
    try {
      const bmp = await createImageBitmap(source);
      const scale = Math.min(maxWidth / bmp.width, Math.max(1, maxWidth / bmp.width), 3);
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      const g = c.getContext("2d");
      g.filter = "grayscale(1) contrast(1.25)";
      g.imageSmoothingQuality = "high";
      g.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close && bmp.close();
      return c;
    } catch (e) {
      return source;
    }
  }

  // A second OCR worker that only reads digits on ONE line — used to re-read the
  // big amount on its own, which is much more accurate than reading the whole page.
  let digitWorkerPromise = null;
  function digitWorker() {
    if (!digitWorkerPromise) {
      digitWorkerPromise = (async () => {
        const w = await Tesseract.createWorker("eng");
        await w.setParameters({ tessedit_char_whitelist: "0123456789.,", tessedit_pageseg_mode: "7" });
        return w;
      })();
    }
    return digitWorkerPromise;
  }

  // Load the reader in the background ahead of time (called when the student
  // adds files), so the screenshot check is quick when they get to it.
  let warmed = false;
  function warmOcr() {
    if (warmed) return;
    warmed = true;
    const go = async () => {
      try {
        if (!window.Tesseract) await loadScript(TESSERACT_URL);
        if (!ocrWorkerPromise) ocrWorkerPromise = Tesseract.createWorker("eng");
        await ocrWorkerPromise;
        await digitWorker();
        await sparseWorker();
      } catch (e) { warmed = false; ocrWorkerPromise = null; }
    };
    (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(go);
  }

  // Third reader: finds scattered numbers (sparse mode, digits only). Used on the
  // TOP half of the screenshot shrunk down — very big text (like Paytm's ₹2.58)
  // is often skipped by the normal reader but read well when made smaller.
  let sparseWorkerPromise = null;
  function sparseWorker() {
    if (!sparseWorkerPromise) {
      sparseWorkerPromise = (async () => {
        const w = await Tesseract.createWorker("eng");
        await w.setParameters({ tessedit_char_whitelist: "0123456789.,₹", tessedit_pageseg_mode: "11" });
        return w;
      })();
    }
    return sparseWorkerPromise;
  }
  // biggest number in the top half, read at one width
  async function bigNumberAt(source, width) {
    const bmp = await createImageBitmap(source);
    const top = Math.round(bmp.height * 0.5);
    const k = width / bmp.width;
    const c = document.createElement("canvas");
    c.width = width; c.height = Math.round(top * k);
    const g = c.getContext("2d");
    g.filter = "grayscale(1) contrast(1.3)";
    g.drawImage(bmp, 0, 0, bmp.width, top, 0, 0, c.width, c.height);
    bmp.close && bmp.close();
    const w = await sparseWorker();
    const { data } = await w.recognize(c);
    const lines = (data.lines || []).map((l) => ({ text: (l.text || "").trim(), h: l.bbox ? l.bbox.y1 - l.bbox.y0 : 0 }))
      .filter((l) => /\d/.test(l.text) && !/\d{8,}/.test(l.text.replace(/\D/g, "")) && l.text.replace(/\D/g, "").length <= 9);
    if (!lines.length) return null;
    return lines.sort((a, b) => b.h - a.h)[0].text;
  }

  async function blackAndWhite(source, width, thr) {
    const bmp = await createImageBitmap(source);
    const k = width / bmp.width;
    const c = document.createElement("canvas");
    c.width = width; c.height = Math.round(bmp.height * k);
    const g = c.getContext("2d", { willReadFrequently: true });
    g.imageSmoothingQuality = "high";
    g.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close && bmp.close();
    if (!thr) return c; // just enlarged
    const img = g.getImageData(0, 0, c.width, c.height), p = img.data;
    for (let i = 0; i < p.length; i += 4) {
      const v = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2] < thr ? 0 : 255;
      p[i] = p[i + 1] = p[i + 2] = v;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  // Returns { text, lines:[{text, h}], mainDigits, bigReads }
  //   h = height of each text line (the payment amount is the biggest)
  //   mainDigits = digits-only re-read of that biggest amount line
  async function ocrImage(source) {
    if (!window.Tesseract) await loadScript(TESSERACT_URL);
    if (!ocrWorkerPromise) ocrWorkerPromise = Tesseract.createWorker("eng");
    let worker;
    try { worker = await ocrWorkerPromise; }
    catch (e) { ocrWorkerPromise = null; throw e; } // allow a fresh try next time
    let img = source instanceof Blob ? await prepForOcr(source) : source;
    let data;
    try {
      ({ data } = await worker.recognize(img));
    } catch (e) {
      // low-memory phones: retry on a smaller copy
      if (!(source instanceof Blob)) throw e;
      img = await prepForOcr(source, 900);
      ({ data } = await worker.recognize(img));
    }
    const H = img.height || 0;
    const lines = (data.lines || []).map((l) => ({ text: (l.text || "").trim(), h: l.bbox ? l.bbox.y1 - l.bbox.y0 : 0, y: l.bbox ? l.bbox.y0 / (H || 1) : 0, bbox: l.bbox }));
    let mainDigits = null;
    try {
      const top = pickMainLine(lines);
      if (top && top.bbox && img instanceof HTMLCanvasElement) {
        const b = top.bbox, pad = Math.round(top.h * 0.25);
        const x = Math.max(0, b.x0 - pad), y = Math.max(0, b.y0 - pad);
        const w = Math.min(img.width - x, b.x1 - b.x0 + pad * 2), h = Math.min(img.height - y, b.y1 - b.y0 + pad * 2);
        const k = Math.max(1, 140 / h);
        const crop = document.createElement("canvas");
        crop.width = Math.round(w * k); crop.height = Math.round(h * k);
        const g = crop.getContext("2d");
        g.fillStyle = "#fff"; g.fillRect(0, 0, crop.width, crop.height);
        g.imageSmoothingQuality = "high";
        g.drawImage(img, x, y, w, h, 0, 0, crop.width, crop.height);
        const dw = await digitWorker();
        const { data: d2 } = await dw.recognize(crop);
        mainDigits = (d2.text || "").trim();
      }
    } catch (e) { /* the normal reading still counts */ }
    // No UTR found? Read the WHOLE screenshot again looking only for numbers —
    // small grey "Ref. No" text is often missed by the normal read.
    let text = data.text || "";
    if (source instanceof Blob && !utrCandidates(text).length) {
      // faint grey text on a light background → make it pure black on white
      for (const [width, thr] of [[1400, 200], [2000, 0], [1400, 175]]) {
        try {
          const c = await blackAndWhite(source, width, thr);
          const { data: d3 } = await worker.recognize(c);
          const found = (d3.text || "").split(/\n+/).filter((l) => utrCandidates(l).length);
          if (found.length) { text += "\n" + found.join("\n"); break; }
        } catch (e) { /* ignore */ }
      }
    }

    // two extra reads of the big amount, at two sizes
    const bigReads = [];
    if (source instanceof Blob) {
      for (const width of [540, 380]) {
        try { const t = await bigNumberAt(source, width); if (t) bigReads.push(t); } catch (e) { /* ignore */ }
      }
    }
    // pixel checks (edited spots, odd digits) + the phone clock in the status bar
    let forensic = null, statusTime = null;
    if (source instanceof Blob && img instanceof HTMLCanvasElement) {
      try { forensic = await forensicCheck(source, img, data, lines); } catch (e) { console.warn("forensic check failed", e); }
      try { statusTime = await readStatusBar(source); } catch (e) { /* ignore */ }
    }
    return { text, lines: lines.map(({ text, h, y }) => ({ text, h, y })), mainDigits, bigReads, forensic, statusTime };
  }

  // ================= pixel forensics =================
  // A real screenshot is drawn by the phone: flat/smooth backgrounds and every digit
  // in one number drawn with the same font, size, colour and baseline. When someone
  // changes the amount or UTR in an editor, it usually leaves:
  //   • a faint rectangle (patch) whose colour is slightly different from the background
  //   • a digit that is a bit taller/shorter, sits higher/lower, or has a different colour
  // These checks look ONLY around the amount, the UTR and the date/time lines.
  async function forensicCheck(blob, img, data, lines) {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.imageSmoothingQuality = "high";
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const origW = bmp.width;
    bmp.close && bmp.close();
    const W = c.width, H = c.height;
    const px = g.getImageData(0, 0, W, H).data;
    const scale = W / origW;
    const L = (x, y) => { const i = (y * W + x) * 4; return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; };
    const RGB = (x, y) => { const i = (y * W + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };

    // which lines to inspect: the biggest amount, any line with a 12-digit number, any line with a time
    const all = (data.lines || []).filter((l) => l.bbox);
    const targets = [];
    const main = pickMainLine(lines);
    if (main && main.bbox) targets.push({ what: "amount", bbox: main.bbox });
    // also the tallest line of text in the top half (= the big amount), found from the
    // pixels themselves — an edited amount is sometimes not read by OCR at all
    const band = tallestBand();
    if (band && !(main && main.bbox && Math.abs(main.bbox.y0 - band.y0) < band.y1 - band.y0)) targets.push({ what: "amount", bbox: band });
    for (const l of all) {
      const t = numberish(l.text || "");
      if (/(?<!\d)\d{12}(?!\d)/.test(t)) targets.push({ what: "UTR", bbox: l.bbox });
      else if (/\b([01]?\d|2[0-3]):[0-5]\d\b/.test(l.text || "") && l.bbox.y0 > H * 0.06) targets.push({ what: "date/time", bbox: l.bbox });
    }
    const patches = [];
    for (const t of targets.slice(0, 6)) {
      const hit = patchAround(t.bbox);
      if (hit) patches.push({ what: t.what, ...hit });
    }

    // digit consistency inside the UTR number and the amount
    const glyphIssues = [];
    for (const w of data.words || []) {
      const d = (w.text || "").replace(/[^\d]/g, "");
      const nSym = (w.symbols || []).length;
      const isUtr = d.length >= 10 && d.length <= 13 && nSym >= 11 && nSym <= 13; // a UTR (maybe with one odd-looking digit)
      const isAmt = main && main.bbox && w.bbox && w.bbox.y0 >= main.bbox.y0 - 4 && w.bbox.y1 <= main.bbox.y1 + 4 && d.length >= 2;
      if (!isUtr && !isAmt) continue;
      const issue = glyphCheck(w, isUtr ? "UTR" : "amount");
      if (issue) glyphIssues.push(issue);
    }
    return { patches, glyphIssues, checked: targets.length };

    function tallestBand() {
      const yA = Math.round(H * 0.06), yB = Math.round(H * 0.55);
      const rows = [];
      for (let y = yA; y < yB; y++) {
        const vals = [];
        for (let x = 0; x < W; x += 3) vals.push(L(x, y));
        const sorted = vals.slice().sort((a, b) => a - b), med = sorted[sorted.length >> 1];
        let ink = 0, minX = W, maxX = 0;
        for (let i = 0; i < vals.length; i++) if (Math.abs(vals[i] - med) > 60) { ink++; minX = Math.min(minX, i * 3); maxX = Math.max(maxX, i * 3); }
        rows.push(ink >= 3 && ink < vals.length * 0.6 ? { minX, maxX } : null);
      }
      let best = null;
      for (let i = 0; i < rows.length;) {
        if (!rows[i]) { i++; continue; }
        let j = i, x0 = W, x1 = 0;
        while (j < rows.length && rows[j]) { x0 = Math.min(x0, rows[j].minX); x1 = Math.max(x1, rows[j].maxX); j++; }
        const hgt = j - i;
        if (hgt >= H * 0.02 && hgt <= H * 0.12 && x1 - x0 < W * 0.9 && (!best || hgt > best.y1 - best.y0)) best = { x0, x1, y0: yA + i, y1: yA + j };
        i = j;
      }
      return best;
    }

    // ---- a faint straight edge in the background close to the text = pasted patch
    function patchAround(b) {
      const h = Math.max(8, b.y1 - b.y0);
      const x0 = Math.max(2, Math.round(b.x0 - h * 1.2)), x1 = Math.min(W - 3, Math.round(b.x1 + h * 1.2));
      const y0 = Math.max(2, Math.round(b.y0 - h * 0.7)), y1 = Math.min(H - 3, Math.round(b.y1 + h * 0.7));
      const rw = x1 - x0, rh = y1 - y0;
      if (rw < 20 || rh < 10) return null;
      // background = close to the row's typical colour; everything else (text, icons) = ink
      const bg = new Uint8Array(rw * rh);
      for (let y = 0; y < rh; y++) {
        const row = [];
        for (let x = 0; x < rw; x += 2) row.push(L(x0 + x, y0 + y));
        row.sort((a, b2) => a - b2);
        const med = row[row.length >> 1];
        for (let x = 0; x < rw; x++) bg[y * rw + x] = Math.abs(L(x0 + x, y0 + y) - med) < 12 ? 1 : 0;
      }
      // keep 3px away from any ink, so the soft edges of letters don't count
      const R = Math.max(2, Math.round(3 * scale));
      const clean = new Uint8Array(rw * rh);
      for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
        let ok = 1;
        for (let dy = -R; dy <= R && ok; dy++) for (let dx = -R; dx <= R; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || yy >= rh || xx < 0 || xx >= rw) continue;
          if (!bg[yy * rw + xx]) { ok = 0; break; }
        }
        clean[y * rw + x] = ok;
      }
      const need = Math.max(10, Math.round(h * 0.8));      // edge must be at least ~one text-line long
      const S = Math.max(2, Math.round(1.5 * scale));       // compare pixels a little apart (resizing blurs edges)
      const vRuns = [], hRuns = [];
      // vertical edges (left/right side of a patch)
      for (let x = S; x < rw - S; x++) {
        let run = 0, sign = 0;
        for (let y = 0; y <= rh; y++) {
          let s = 0;
          if (y < rh && clean[y * rw + x - S] && clean[y * rw + x + S - 1]) {
            const dd = L(x0 + x + S - 1, y0 + y) - L(x0 + x - S, y0 + y);
            if (Math.abs(dd) >= 2.5 && Math.abs(dd) <= 14) s = Math.sign(dd);
          }
          if (s && (s === sign || !run)) { run++; sign = s; continue; }
          if (run >= need) vRuns.push({ x, ya: y - run, yb: y - 1 });
          run = s ? 1 : 0; sign = s;
        }
      }
      // horizontal edges (top/bottom of a patch)
      for (let y = S; y < rh - S; y++) {
        let run = 0, sign = 0;
        for (let x = 0; x <= rw; x++) {
          let s = 0;
          if (x < rw && clean[(y - S) * rw + x] && clean[(y + S - 1) * rw + x]) {
            const dd = L(x0 + x, y0 + y + S - 1) - L(x0 + x, y0 + y - S);
            if (Math.abs(dd) >= 2.5 && Math.abs(dd) <= 14) s = Math.sign(dd);
          }
          if (s && (s === sign || !run)) { run++; sign = s; continue; }
          if (run >= need) hRuns.push({ y, xa: x - run, xb: x - 1 });
          run = s ? 1 : 0; sign = s;
        }
      }
      // a pasted patch = a RECTANGLE: a side edge and a top/bottom edge meeting at a corner
      const tol = Math.max(4, Math.round(4 * scale));
      for (const v of vRuns) for (const hr of hRuns) {
        const xMeets = Math.abs(v.x - hr.xa) <= tol || Math.abs(v.x - hr.xb) <= tol;
        const yMeets = Math.abs(hr.y - v.ya) <= tol || Math.abs(hr.y - v.yb) <= tol;
        if (xMeets && yMeets) return { edge: "corner", x: Math.round((x0 + v.x) / scale), y: Math.round((y0 + hr.y) / scale), len: Math.round((v.yb - v.ya) / scale) };
      }
      return null;
    }

    // ---- every digit of one number: same height, same baseline, same colour
    function glyphCheck(word, what) {
      const syms = (word.symbols || []).filter((s) => s.bbox && (what === "UTR" || /\d/.test(s.text || "")));
      if (syms.length < (what === "UTR" ? 10 : 2)) return null;
      const wb = word.bbox;
      // threshold between ink and background for this word (Otsu)
      const hist = new Array(256).fill(0);
      for (let y = wb.y0; y < wb.y1; y++) for (let x = wb.x0; x < wb.x1; x++) hist[Math.round(L(x, y))]++;
      const thr = otsu(hist);
      const bgDark = (() => { let a = 0, n = 0; for (let i = 0; i < 256; i++) { n += hist[i]; a += hist[i] * i; } return a / n > thr; })(); // dark text on light bg?
      const isInk = (x, y) => (bgDark ? L(x, y) < thr : L(x, y) > thr);
      const g2 = [];
      for (const s of syms) {
        const b = s.bbox;
        let top = null, bot = null, inkN = 0; const cols = [];
        for (let y = Math.max(0, b.y0 - 3); y <= Math.min(H - 1, b.y1 + 3); y++) {
          let any = false;
          for (let x = b.x0; x <= b.x1; x++) if (isInk(x, y)) { any = true; inkN++; cols.push(L(x, y)); }
          if (any) { if (top === null) top = y; bot = y; }
        }
        if (top === null || inkN < 6) continue;
        // core ink colour = the strongest 20% of ink pixels
        let core = [];
        for (let y = top; y <= bot; y++) for (let x = b.x0; x <= b.x1; x++) if (isInk(x, y)) core.push(RGB(x, y));
        core.sort((p, q) => (bgDark ? (p[0] + p[1] + p[2]) - (q[0] + q[1] + q[2]) : (q[0] + q[1] + q[2]) - (p[0] + p[1] + p[2])));
        core = core.slice(0, Math.max(3, Math.round(core.length * 0.2)));
        const col = [0, 1, 2].map((k) => core.reduce((a, p) => a + p[k], 0) / core.length);
        g2.push({ ch: s.text, top, bot, h: bot - top + 1, col });
      }
      if (g2.length < (what === "UTR" ? 10 : 2)) return null;
      const med = (arr) => arr.slice().sort((a, b) => a - b)[arr.length >> 1];
      const mh = med(g2.map((q) => q.h)), mb = med(g2.map((q) => q.bot));
      const mc = [0, 1, 2].map((k) => med(g2.map((q) => q.col[k])));
      if (mh < 10 || mh / scale < 9) return null; // too tiny / blurry to judge
      for (let i = 0; i < g2.length; i++) {
        const q = g2[i];
        const hOff = Math.abs(q.h - mh) / mh, bOff = Math.abs(q.bot - mb) / mh;
        const cOff = Math.abs(q.col[0] - mc[0]) + Math.abs(q.col[1] - mc[1]) + Math.abs(q.col[2] - mc[2]);
        // name the digit only for the UTR — in the amount the "₹" sign is often read as a digit
        const which = what === "UTR" ? `digit no. ${i + 1} ("${q.ch}")` : "part of the amount";
        if (hOff > 0.16) return { what, why: `${which} is a different size from the rest`, n: i + 1 };
        if (bOff > 0.14) return { what, why: `${which} sits higher/lower than the rest`, n: i + 1 };
        if (cOff > 60) return { what, why: `${which} is a different colour from the rest`, n: i + 1 };
      }
      return null;
    }
  }
  function otsu(hist) {
    let total = 0, sum = 0;
    for (let i = 0; i < 256; i++) { total += hist[i]; sum += i * hist[i]; }
    let sumB = 0, wB = 0, best = 0, thr = 128;
    for (let i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = i; }
    }
    return thr + 0.5;
  }

  // The phone's clock in the status bar — the first group of characters at the
  // top-left of a real screenshot (Android & iPhone both put the time there).
  async function readStatusBar(blob) {
    const bmp = await createImageBitmap(blob);
    const sh = Math.round(bmp.height * 0.045);
    if (sh < 12) { bmp.close && bmp.close(); return null; }
    const k = 120 / sh;
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * 0.5 * k); c.height = Math.round(sh * k);
    const g = c.getContext("2d", { willReadFrequently: true });
    g.imageSmoothingQuality = "high";
    g.drawImage(bmp, 0, 0, bmp.width * 0.5, sh, 0, 0, c.width, c.height);
    bmp.close && bmp.close();
    const W = c.width, H = c.height, p = g.getImageData(0, 0, W, H).data;
    const lum = new Float32Array(W * H);
    const hist = new Array(256).fill(0);
    for (let i = 0; i < W * H; i++) { lum[i] = 0.299 * p[i * 4] + 0.587 * p[i * 4 + 1] + 0.114 * p[i * 4 + 2]; hist[Math.round(lum[i])]++; }
    const thr = otsu(hist);
    let dark = 0; for (let i = 0; i < W * H; i++) if (lum[i] < thr) dark++;
    const inkDark = dark < W * H / 2;                // ink is the minority colour
    const ink = (i) => (inkDark ? lum[i] < thr : lum[i] > thr);
    const colInk = new Array(W).fill(0); let top = H, bot = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (ink(y * W + x)) { colInk[x]++; top = Math.min(top, y); bot = Math.max(bot, y); }
    const th = bot - top;
    if (th < 10) return null;
    // first group of ink columns, ending at a gap wider than ~0.45 × text height
    let x0 = colInk.findIndex((v) => v > 0);
    if (x0 < 0 || x0 > W * 0.6) return null;
    let x1 = x0, gap = 0;
    for (let x = x0; x < W; x++) {
      if (colInk[x] > 0) { x1 = x; gap = 0; } else if (++gap > th * 0.45) break;
    }
    const pad = Math.round(th * 0.4);
    const crop = document.createElement("canvas");
    crop.width = x1 - x0 + pad * 2; crop.height = th + pad * 2;
    const cg = crop.getContext("2d");
    cg.fillStyle = inkDark ? "#fff" : "#000"; cg.fillRect(0, 0, crop.width, crop.height);
    cg.drawImage(c, x0, top, x1 - x0 + 1, th + 1, pad, pad, x1 - x0 + 1, th + 1);
    if (!inkDark) { cg.globalCompositeOperation = "difference"; cg.fillStyle = "#fff"; cg.fillRect(0, 0, crop.width, crop.height); }
    const w = await digitWorker();
    const { data } = await w.recognize(crop);
    const t = (data.text || "").replace(/[^\d:.]/g, "");
    let m = t.match(/^([01]?\d|2[0-3])[:.]([0-5]\d)$/);
    if (!m) { const d = t.replace(/\D/g, ""); if (/^\d{3,4}$/.test(d)) m = d.match(/^(\d{1,2})(\d{2})$/); } // colon not read: last 2 digits are minutes
    if (!m || +m[1] > 23 || +m[2] > 59) return null;
    return { h: +m[1], m: +m[2], label: m[1] + ":" + m[2] };
  }

  // Status-bar clock vs. when the order is being placed (and vs. the payment time).
  function statusCheck(st, text, when) {
    if (!st) return { statusOk: null };
    const ist = new Date(new Date(when).toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const nowMin = ist.getHours() * 60 + ist.getMinutes();
    const cands = st.h <= 12 ? [st.h % 12, (st.h % 12) + 12] : [st.h];
    // minutes BEFORE the order the screenshot was taken (negative = in the future)
    const before = cands.map((hh) => { let d = nowMin - (hh * 60 + st.m); if (d < -720) d += 1440; if (d > 720) d -= 1440; return d; });
    const best = before.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
    const statusOk = best >= -3 && best <= 90;
    return { statusOk, statusSeen: st.label, statusAgo: best };
  }

  // Letters OCR confuses with digits, fixed only inside number-like chunks.
  const LOOKALIKE = { O: "0", o: "0", D: "0", Q: "0", I: "1", l: "1", "|": "1", i: "1", Z: "2", z: "2", S: "5", s: "5", G: "6", b: "6", T: "7", B: "8", g: "9", q: "9" };
  function numberish(line) {
    return line
      .split(/\s+/)
      .map((tok) => {
        const d = (tok.match(/\d/g) || []).length;
        return d >= 3 && d / tok.length >= 0.6 ? tok.replace(/./g, (c) => (/\d/.test(c) ? c : LOOKALIKE[c] || "")) : tok;
      })
      .join(" ")
      .replace(/(\d)[\s-]+(?=\d)/g, "$1"); // "6309 1234 5678" -> "630912345678"
  }

  // All 12-digit numbers in the screenshot = possible UTRs. The one on a line that
  // says Ref / UTR / UPI / transaction comes first.
  function utrCandidates(text) {
    const found = [];
    for (const line of (text || "").split(/\n+/)) {
      const keyword = /ref|utr|upi|transaction|txn/i.test(line);
      for (const m of numberish(line).matchAll(/(?<!\d)\d{12}(?!\d)/g)) found.push({ utr: m[0], keyword });
    }
    found.sort((x, y) => (y.keyword ? 1 : 0) - (x.keyword ? 1 : 0));
    return [...new Set(found.map((f) => f.utr))];
  }

  // Is this exact 12-digit UTR in the screenshot? (No digit is allowed to differ —
  // otherwise someone could change the last digit and still pass.)
  function utrInText(text, utr) {
    if (!/^\d{12}$/.test(utr)) return false;
    if (utrCandidates(text).includes(utr)) return true;
    const stream = (text || "").split(/\n+/).map(numberish).join(" ").replace(/\D/g, "");
    return stream.includes(utr);
  }
  function digitsDiff(a, b) {
    if (a.length !== b.length) return 99;
    let n = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
    return n;
  }

  // Is the exact amount (with paise, e.g. 62.37) visible in the text?
  // All rupee amounts with paise in the text. OCR often reads the "₹" sign as a
  // digit (3, 2, 7, 4, 1, Z), so "₹2.58" can come out as "32.58". For each amount
  // we keep the reading as-is AND the reading with that first digit dropped.
  const RUPEE_MISREADS = "12347";
  function readAmounts(text) {
    const out = [];
    for (const m of text.matchAll(/(?<![\d.\/:-])(\d{1,3}(?:,\d{3})+|\d{1,7})\.(\d{2})(?![\d.\/-])/g)) {
      const intPart = m[1].replace(/,/g, "");
      const vals = [Math.round(Number(intPart + "." + m[2]) * 100)];
      if (intPart.length >= 2 && RUPEE_MISREADS.includes(intPart[0])) {
        vals.push(Math.round(Number(intPart.slice(1) + "." + m[2]) * 100));
      }
      out.push(vals);
    }
    return out;
  }

  // Is the exact amount (with paise, e.g. 62.37) visible in the text?
  function amountInText(text, total) {
    const want = Math.round(Number(total) * 100);
    if (readAmounts(text).some((vals) => vals.includes(want))) return true;
    // whole-rupee amounts shown without paise, e.g. "₹62" (or misread "362")
    if (want % 100 === 0) {
      return (text.match(/\d[\d,]*/g) || []).some((t) => {
        const d = t.replace(/,/g, "");
        return Number(d) * 100 === want || (d.length >= 2 && RUPEE_MISREADS.includes(d[0]) && Number(d.slice(1)) * 100 === want);
      });
    }
    return false;
  }

  // ================= screenshot judge (used by student page AND owner) =================

  // Was the money sent to THIS shop? Looks for the owner's UPI ID or name.
  function payeeSeen(text, settings) {
    if (!settings) return null;
    const flat = text.toLowerCase().replace(/\s+/g, "");
    const upi = (settings.upi_id || "").toLowerCase();
    if (upi && upi !== "owner@upi" && flat.includes(upi.replace(/\s+/g, ""))) return true;
    const words = (settings.payee_name || "").toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4);
    if (!words.length) return null;
    return words.some((w) => flat.includes(w));
  }

  // Does the payment time/date in the screenshot fit "when" (order time)?
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  function timeCheck(text, when) {
    const ist = new Date(new Date(when).toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const orderMin = ist.getHours() * 60 + ist.getMinutes();
    // times like 7:58 pm / 19:58 (colon only, so ₹10.37 is never read as a time)
    const times = [];
    for (const m of text.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\s*([ap])?\.?\s*m?\b/gi)) {
      const h = +m[1], min = +m[2], ap = (m[3] || "").toLowerCase();
      const cands = ap ? [(h % 12) + (ap === "p" ? 12 : 0)] : h <= 12 ? [h, (h % 12) + 12] : [h];
      times.push({ label: m[0].trim(), mins: cands.map((x) => x * 60 + min) });
    }
    let timeOk = null;
    if (times.length) {
      timeOk = times.some((t) => t.mins.some((x) => {
        let d = orderMin - x;
        if (d < -720) d += 1440; // payment just before midnight
        return d >= -5 && d <= 45;
      }));
    }
    // dates like "5 Nov 2026", "Nov 5, 2026", "05/11/2026"
    const dates = [];
    for (const m of text.matchAll(/\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*,?\s+(20\d\d)\b/g)) dates.push([+m[3], MONTHS.indexOf(m[2].toLowerCase()), +m[1], m[0]]);
    for (const m of text.matchAll(/\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\b(?!,?\s*20\d\d)/g)) dates.push([ist.getFullYear(), MONTHS.indexOf(m[2].toLowerCase()), +m[1], m[0]]);
    for (const m of text.matchAll(/\b([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(20\d\d)\b/g)) dates.push([+m[3], MONTHS.indexOf(m[1].toLowerCase()), +m[2], m[0]]);
    for (const m of text.matchAll(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d\d)\b/g)) dates.push([+m[3], +m[2] - 1, +m[1], m[0]]);
    const valid = dates.filter((d) => d[1] >= 0 && d[1] <= 11 && d[2] >= 1 && d[2] <= 31);
    let dateOld = null, dateSeen = null;
    if (valid.length) {
      const orderDay = Date.UTC(ist.getFullYear(), ist.getMonth(), ist.getDate());
      dateOld = !valid.some(([y, mo, d]) => { const diff = (orderDay - Date.UTC(y, mo, d)) / 864e5; return diff >= 0 && diff <= 1; });
      dateSeen = valid[0][3];
    }
    return { timeOk, timeSeen: times.slice(0, 3).map((t) => t.label), dateOld, dateSeen };
  }

  // Other rupee amounts with paise in the screenshot (e.g. it shows ₹10.42 but the order is ₹14.69)
  // Possible amounts (in paise) in one line of text, allowing for "₹" read as a digit
  // and for the paise printed small / without a clear dot (Paytm: ₹2.58 -> "2 58").
  function amountsInLine(t) {
    const s = t.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/\s+/g, "");
    const out = new Set();
    const add = (i, p) => {
      const v = Math.round(Number(i + "." + (p || "00")) * 100);
      if (v > 0) out.add(v);
      if (i.length >= 2 && RUPEE_MISREADS.includes(i[0])) {
        const v2 = Math.round(Number(i.slice(1) + "." + (p || "00")) * 100);
        if (v2 > 0) out.add(v2);
      }
    };
    let m = s.match(/(\d[\d,]*)[.,·:](\d{2})(?!\d)/);
    if (m) { add(m[1].replace(/,/g, ""), m[2]); return [...out]; }
    m = s.match(/\d[\d,]*/);
    if (m) {
      const d = m[0].replace(/,/g, "");
      if (d.length <= 7) add(d);                           // ₹40
      if (d.length >= 3 && d.length <= 8) add(d.slice(0, -2), d.slice(-2)); // "258" = 2.58 with the dot lost
    }
    return [...out];
  }

  // The payment amount is the BIGGEST text with digits on a payment screen.
  function pickMainLine(lines) {
    const withDigits = (lines || []).filter((l) => l.h > 0 && /\d/.test(l.text)
      && !/\d{1,2}:\d{2}/.test(l.text)              // not a time
      && !/\d{8,}/.test(l.text.replace(/\s/g, ""))  // not a UTR / phone / account number
      && l.text.replace(/[^\d]/g, "").length <= 9
      && (l.text.replace(/rs|inr/gi, "").match(/[a-z]/gi) || []).length <= 3 // not a sentence like "11,000 Gold Coins"
      && (l.y === undefined || l.y < 0.55));          // the paid amount is in the top half
    if (!withDigits.length) return null;
    const all = (lines || []).filter((l) => l.h > 0).map((l) => l.h).sort((a, b) => a - b);
    const median = all[Math.floor(all.length / 2)] || 1;
    const top = withDigits.slice().sort((a, b) => b.h - a.h)[0];
    return top.h >= median * 1.5 ? top : null;    // must be clearly bigger than normal text
  }

  function amountsFromDigits(t) {
    const out = new Set();
    const m = (t || "").replace(/\s+/g, "").match(/(\d+)[.,](\d{2})/);
    if (!m) return [];
    const i = m[1];
    out.add(Math.round(Number(i + "." + m[2]) * 100));
    if (i.length >= 2 && RUPEE_MISREADS.includes(i[0])) out.add(Math.round(Number(i.slice(1) + "." + m[2]) * 100));
    return [...out].filter((v) => v > 0);
  }

  function mainAmount(lines, mainDigits, bigReads) {
    const top = pickMainLine(lines);
    const reads = [];
    if (top) reads.push({ text: top.text, vals: amountsInLine(top.text) });
    if (top && mainDigits) reads.push({ text: mainDigits, vals: amountsFromDigits(mainDigits) });
    for (const t of bigReads || []) reads.push({ text: t, vals: amountsInLine(t) });
    const used = reads.filter((r) => r.vals.length);
    if (!used.length) return null;
    const values = [...new Set(used.flatMap((r) => r.vals))];
    // "sure" = at least two separate readings agree on the same amount
    const agreed = values.filter((v) => used.filter((r) => r.vals.includes(v)).length >= 2);
    return { text: used.map((r) => r.text).join(" / "), values, agreed };
  }

  // OCR mixes up some look-alike digits. Two amounts "match" if they have the same
  // number of digits and differ in at most ONE look-alike digit (e.g. 6.58 vs 6.55).
  const LOOKALIKE_GROUPS = ["0689", "3568", "17", "147", "27"];
  function nearlySame(a, b) {
    if (a === b) return true;
    const x = String(a), y = String(b);
    if (x.length !== y.length) return false;
    let diff = 0;
    for (let i = 0; i < x.length; i++) {
      if (x[i] === y[i]) continue;
      if (++diff > 1 || !LOOKALIKE_GROUPS.some((g) => g.includes(x[i]) && g.includes(y[i]))) return false;
    }
    return true;
  }

  function otherAmounts(text, total) {
    const want = Math.round(Number(total) * 100);
    const out = [];
    for (const vals of readAmounts(text)) {
      if (vals.includes(want)) continue;          // this one IS the right amount (maybe with ₹ misread)
      if (vals[0] > 0) out.push(vals[0] / 100); // show the amount as read
    }
    return [...new Set(out)];
  }

  // What the FILE itself says (type, size, hidden editing / AI labels)
  const EDITORS = ["Adobe Photoshop", "Adobe Express", "Snapseed", "Canva", "PicsArt", "Picsart", "GIMP", "Lightroom", "Pixlr", "Fotor", "Meitu", "Photopea", "Paint.NET", "PhotoRoom", "Remini", "VSCO", "InShot", "PhotoDirector"];
  const AI_MARKERS = [
    ["trainedAlgorithmicMedia", "AI-generated (content credentials)"],
    ["compositeWithTrainedAlgorithmicMedia", "AI-edited (content credentials)"],
    ["OpenAI", "OpenAI / ChatGPT"], ["ChatGPT", "OpenAI / ChatGPT"], ["DALL-E", "DALL-E"], ["DALL·E", "DALL-E"],
    ["Midjourney", "Midjourney"], ["Stable Diffusion", "Stable Diffusion"], ["Firefly", "Adobe Firefly"],
    ["Imagen", "Google Imagen"], ["Gemini", "Google Gemini"], ["Ideogram", "Ideogram"], ["Leonardo", "Leonardo AI"], ["Grok", "Grok"],
    ["c2pa", "content credentials (c2pa)"], ["jumbf", "content credentials (c2pa)"], ["contentauth", "content credentials (c2pa)"],
  ];
  async function inspectImage(buf, blob) {
    const b = new Uint8Array(buf);
    let type = "other";
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) type = "png";
    else if (b[0] === 0xff && b[1] === 0xd8) type = "jpeg";
    else if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) type = "webp";
    else if (String.fromCharCode(...b.subarray(4, 12)).includes("ftyp")) type = "heic";
    const raw = new TextDecoder("windows-1252").decode(b);
    const lower = raw.toLowerCase();
    const software = EDITORS.find((s) => raw.includes(s)) || null;
    const aiHit = AI_MARKERS.find(([k]) => lower.includes(k.toLowerCase()));
    let w = null, h = null;
    try { const bmp = await createImageBitmap(blob); w = bmp.width; h = bmp.height; bmp.close && bmp.close(); } catch (e) { /* ignore */ }
    const ratio = w && h ? h / w : null;
    const phoneShape = ratio ? ratio >= 1.6 && ratio <= 2.5 && w >= 540 : null;
    const tooSmall = w ? Math.min(w, h) < 500 : null;
    return { type, software, ai: aiHit ? aiHit[1] : null, w, h, phoneShape, tooSmall };
  }

  // Put it all together. Every problem in `hard` is either:
  //   proof: true  → certain cheating (AI label, editing app, TEST/DEMO stamp, reused UTR).
  //                  Never accepted. The owner's dashboard auto-rejects these as FAKE.
  //   proof: false → the reader is fairly sure something is wrong (wrong UTR digits,
  //                  wrong amount, old date…). Refused at first; after 2 tries the student
  //                  may send it to the owner for a manual check (shown in red).
  //   soft         → couldn't confirm (blurry etc.) — same retry → manual-check path.
  // Which UPI app made this screenshot, and does it show that app's normal
  // "payment done" details? Prank / fake-payment apps usually miss some of them.
  const APPS = [
    { name: "Paytm", id: /paytm/i, marks: [/ref\.?\s*no/i, /upi\s*ref/i, /check\s*balance/i, /pay\s*again/i, /paid\s*success/i, /money\s*sent/i, /payment\s*success/i, /sent\s*success/i] },
    { name: "PhonePe", id: /phone\s*pe/i, marks: [/transaction\s*success/i, /payment\s*success/i, /paid\s*to/i, /\butr\b/i, /transaction\s*id/i, /debited\s*from/i] },
    { name: "Google Pay", id: /google\s*pay|\bg\s?pay\b|google\s*transaction/i, marks: [/upi\s*transaction\s*id/i, /google\s*transaction\s*id/i, /completed/i, /paid\s*to/i, /payment\s*(was\s*)?success/i] },
    { name: "BHIM", id: /\bbhim\b/i, marks: [/success/i, /\b(ref|rrn|utr)\b/i, /transaction\s*id/i] },
    { name: "Amazon Pay", id: /amazon\s*pay/i, marks: [/success/i, /bank\s*reference|upi\s*ref|\butr\b/i] },
    { name: "CRED", id: /\bcred\b/i, marks: [/success|paid/i, /\b(utr|ref|rrn)\b/i] },
  ];
  function layoutCheck(text) {
    const app = APPS.find((a) => a.id.test(text)) || null;
    const marks = app ? app.marks.filter((m) => m.test(text)).length : 0;
    const anySuccess = /\b(success|successful|successfully|completed|paid|sent|received|debited)\b/i.test(text);
    const refWord = /\b(ref|utr|rrn|upi|transaction|txn)\b/i.test(text);
    return { app: app ? app.name : null, appMarks: marks, layoutOk: app ? marks >= 1 : (anySuccess || refWord) ? null : false };
  }

  function judgeScreenshot(text, meta, ctx) {
    const cands = utrCandidates(text);
    const r = {
      utr: utrInText(text, ctx.utr),
      utrCandidates: cands,
      amount: amountInText(text, ctx.total),
      payee: payeeSeen(text, ctx.settings),
      wrongAmounts: [],
      demo: ((text.match(/\b(test|demo|sample|dummy|fake|mock|specimen|prank|spoof|for entertainment|entertainment purpose|fake payment)\b/i) || [])[0]) || null,
      failed: /\b(failed|declined|pending|processing|reversed)\b/i.test(text),
      success: /\b(success|successful|completed|paid)\b/i.test(text),
      ...timeCheck(text, ctx.when),
      ...statusCheck(ctx.statusTime, text, ctx.when),
      ...layoutCheck(text),
      ...meta,
    };
    const fz = ctx.forensic || null;
    r.patches = fz ? fz.patches : [];
    r.glyphIssues = fz ? fz.glyphIssues : [];
    // a UTR that differs from the typed one by a digit or two
    r.utrSeen = !r.utr && /^\d{12}$/.test(ctx.utr || "") ? cands.find((c) => digitsDiff(c, ctx.utr) <= 2) || null : null;

    // The big amount on the payment screen
    const want = Math.round(Number(ctx.total) * 100);
    const main = mainAmount(ctx.lines, ctx.mainDigits, ctx.bigReads);
    r.mainAmount = main ? main.text : null;
    if (main && main.values.some((v) => nearlySame(v, want))) r.amount = true;
    // only call the amount WRONG when both readings agree on a different amount
    const sureWrong = !r.amount && main && main.agreed.length && !main.agreed.some((v) => nearlySame(v, want));
    if (sureWrong) r.wrongAmounts = [main.agreed[0] / 100];

    const amt = rupeesExact(ctx.total);
    const readable = !r.tooSmall;
    const hard = [];
    const add = (code, proof, msg) => hard.push({ code, proof, fake: proof, msg });
    if (r.ai) add("ai", true, `This image is AI-generated or AI-edited (${r.ai}). Upload the real screenshot from your UPI app.`);
    if (r.software) add("edited", true, `This image was saved by an editing app (${r.software}). Upload the original screenshot from your UPI app.`);
    if (r.demo) add("demo", true, `The screenshot says "${r.demo.toUpperCase()}" — that's not a real payment.`);
    if (r.utrSeen) add("utr", false, `The UTR you typed doesn't match the screenshot. The screenshot shows ${r.utrSeen}. Copy the UTR exactly from your UPI app.`);
    if (r.failed && !r.success) add("failed", false, "The screenshot shows the payment as failed or pending. Wait until it says successful.");
    if (readable && sureWrong) add("amount", false, `The screenshot shows ${rupeesExact(r.wrongAmounts[0])}, but this order needs exactly ${amt}.`);
    if (readable && r.dateOld) add("date", false, `The screenshot is from ${r.dateSeen}. Upload the screenshot of today's payment.`);
    if (r.tooSmall) add("small", false, `The image is too small (${r.w}×${r.h}) — it was resized or forwarded. Upload the original screenshot from your phone's gallery.`);
    if (readable && r.timeOk === false) add("time", false, `The time in the screenshot (${r.timeSeen.join(", ")}) doesn't match this order. Take a fresh screenshot right after paying.`);
    if (readable && r.statusOk === false) add("status", false, `The phone clock in this screenshot shows ${r.statusSeen} — it wasn't taken just now. Pay for this order and take a fresh screenshot.`);
    if (readable && r.patches.length) add("patch", false, `The ${r.patches[0].what} area of this screenshot looks edited (a pasted patch). Upload the original screenshot from your UPI app, without editing.`);
    if (readable && r.glyphIssues.length) add("glyph", false, `This screenshot looks edited: in the ${r.glyphIssues[0].what}, ${r.glyphIssues[0].why}. Upload the original screenshot from your UPI app, without editing.`);
    if (readable && !r.app && r.layoutOk === false) add("layout", false, "This doesn't look like a UPI payment-success screen. Upload the screenshot of the success page (it shows the amount, the date/time and the UPI Ref No.).");
    if (readable && r.app && r.appMarks === 0) add("layout", false, `This doesn't look like a real ${r.app} payment-success screen. Upload the original screenshot of the success page.`);
    const soft = [];
    if (!r.utr && !r.utrSeen) soft.push("utr");
    if (!r.amount && !sureWrong) soft.push("amount");
    if (r.payee === false) soft.push("payee");
    return { ...r, hard, soft };
  }

  // open = the owner's Open/Closed switch
  function shopState(s) {
    if (!s) return { open: false, reason: "loading" };
    return s.shop_open ? { open: true } : { open: false, reason: "off" };
  }

  window.KG = {
    shopState,
    payeeSeen, timeCheck, otherAmounts, inspectImage, judgeScreenshot, utrCandidates, digitsDiff, mainAmount, amountsInLine, nearlySame,
    configured, sb, $, $$, esc, rupees, rupeesExact, rateFor, linePrice, todayIST, fmtTime, fmtDay, STATUS,
    toast, unlockAudio, audioReady, chime, askNotify, notify, flashTitle, stopFlash,
    signInWithGoogle, signOut, setupNeededHTML, loadScript, ocrImage, warmOcr, utrInText, amountInText,
  };
})();
