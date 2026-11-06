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
    queued: "In print queue",
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
  async function prepForOcr(source) {
    try {
      const bmp = await createImageBitmap(source);
      const scale = Math.min(3, Math.max(1, 1400 / bmp.width));
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

  // Returns { text, lines:[{text, h}], mainDigits }
  //   h = height of each text line (the payment amount is the biggest)
  //   mainDigits = digits-only re-read of that biggest amount line
  async function ocrImage(source) {
    if (!window.Tesseract) await loadScript(TESSERACT_URL);
    if (!ocrWorkerPromise) ocrWorkerPromise = Tesseract.createWorker("eng");
    const worker = await ocrWorkerPromise;
    const img = source instanceof Blob ? await prepForOcr(source) : source;
    const { data } = await worker.recognize(img);
    const lines = (data.lines || []).map((l) => ({ text: (l.text || "").trim(), h: l.bbox ? l.bbox.y1 - l.bbox.y0 : 0, bbox: l.bbox }));
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
    return { text: data.text || "", lines: lines.map(({ text, h }) => ({ text, h })), mainDigits };
  }

  // Is this 12-digit UTR in the screenshot text? Allows 1 misread digit,
  // and handles digits printed in groups ("4312 9876 5432").
  function utrInText(text, utr) {
    if (!/^\d{12}$/.test(utr)) return false;
    // In number-like chunks (mostly digits), fix letters OCR often confuses
    // with digits; in normal words just keep any real digits.
    const LOOKALIKE = { O: "0", o: "0", D: "0", Q: "0", I: "1", l: "1", "|": "1", i: "1", Z: "2", z: "2", S: "5", s: "5", G: "6", b: "6", T: "7", B: "8", g: "9", q: "9" };
    const digits = text.split(/\s+/).map((tok) => {
      const d = (tok.match(/\d/g) || []).length;
      if (d >= 3 && d / tok.length >= 0.6) return tok.replace(/./g, (c) => (/\d/.test(c) ? c : LOOKALIKE[c] || ""));
      return tok.replace(/\D/g, "");
    }).join("");
    if (digits.includes(utr)) return true;
    for (let i = 0; i + 12 <= digits.length; i++) {
      let miss = 0;
      for (let j = 0; j < 12 && miss <= 1; j++) if (digits[i + j] !== utr[j]) miss++;
      if (miss <= 1) return true;
    }
    return false;
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
      && l.text.replace(/[^\d]/g, "").length <= 9);
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

  function mainAmount(lines, mainDigits) {
    const top = pickMainLine(lines);
    if (!top) return null;
    const values = [...new Set([...amountsInLine(top.text), ...amountsFromDigits(mainDigits)])];
    return values.length ? { text: top.text + (mainDigits ? ` / ${mainDigits}` : ""), values } : null;
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

  // Put it all together.
  //   hard = definite problems → the order is refused (student) / auto-rejected (owner)
  //   soft = couldn't confirm → student retries, then may send for manual check
  function judgeScreenshot(text, meta, ctx) {
    const r = {
      utr: utrInText(text, ctx.utr),
      amount: amountInText(text, ctx.total),
      payee: payeeSeen(text, ctx.settings),
      wrongAmounts: otherAmounts(text, ctx.total),
      demo: ((text.match(/\b(test|demo|sample|dummy|fake|mock|specimen)\b/i) || [])[0]) || null,
      failed: /\b(failed|declined|pending|processing|reversed)\b/i.test(text),
      success: /\b(success|successful|completed|paid)\b/i.test(text),
      ...timeCheck(text, ctx.when),
      ...meta,
    };
    // The big amount on the payment screen decides: it must be exactly this order's amount.
    const want = Math.round(Number(ctx.total) * 100);
    const main = mainAmount(ctx.lines, ctx.mainDigits);
    r.mainAmount = main ? main.text : null;
    const mainOk = main && main.values.some((v) => nearlySame(v, want));
    if (mainOk) r.amount = true;
    if (main && !mainOk && !r.amount) {
      // show the reading closest to the expected amount (e.g. "258" -> ₹2.58, not ₹258)
      const shown = main.values.slice().sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0];
      r.wrongAmounts = [shown / 100, ...r.wrongAmounts.filter((x) => Math.round(x * 100) !== shown)];
    }
    const amt = rupeesExact(ctx.total);
    const hard = [];
    if (r.ai) hard.push({ code: "ai", fake: true, msg: `This image is AI-generated or AI-edited (${r.ai}). Upload the real screenshot from your UPI app.` });
    if (r.software) hard.push({ code: "edited", fake: true, msg: `This image was saved by an editing app (${r.software}). Upload the original screenshot from your UPI app.` });
    if (r.demo) hard.push({ code: "demo", fake: true, msg: `The screenshot says "${r.demo.toUpperCase()}" — that's not a real payment.` });
    if (r.failed && !r.success) hard.push({ code: "failed", fake: false, msg: "The screenshot shows the payment as failed or pending. Wait until it says successful." });
    if (!r.amount && r.wrongAmounts.length) hard.push({ code: "amount", fake: false, msg: `The screenshot shows ${rupeesExact(r.wrongAmounts[0])}, but this order needs exactly ${amt}.` });
    if (r.dateOld) hard.push({ code: "date", fake: false, msg: `The screenshot is from ${r.dateSeen}. Upload the screenshot of today's payment.` });
    if (r.tooSmall) hard.push({ code: "small", fake: false, msg: `The image is too small (${r.w}×${r.h}) — it was resized or forwarded. Upload the original screenshot from your phone's gallery.` });
    if (r.timeOk === false) hard.push({ code: "time", fake: false, msg: `The time in the screenshot (${r.timeSeen.join(", ")}) doesn't match this order. Take a fresh screenshot right after paying.` });
    const soft = [];
    if (!r.utr) soft.push("utr");
    if (r.payee === false) soft.push("payee");
    if (!r.amount && !r.wrongAmounts.length) soft.push("amount");
    return { ...r, hard, soft };
  }

  window.KG = {
    payeeSeen, timeCheck, otherAmounts, inspectImage, judgeScreenshot, mainAmount, amountsInLine, nearlySame,
    configured, sb, $, $$, esc, rupees, rupeesExact, rateFor, linePrice, todayIST, fmtTime, fmtDay, STATUS,
    toast, unlockAudio, audioReady, chime, askNotify, notify, flashTitle, stopFlash,
    signInWithGoogle, signOut, setupNeededHTML, loadScript, ocrImage, utrInText, amountInText,
  };
})();
