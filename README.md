# KG Print & Xerox — online print orders (₹0 setup)

Students upload files → pay the shop's UPI → enter UTR + screenshot → get a daily token (KG-1, KG-2 …).
The owner gets a sound + popup on phone/laptop, verifies the payment in his own UPI app, prints, and marks it ready.

| Page | Who | URL |
|---|---|---|
| `index.html` | Students | `https://your-site/` |
| `owner.html` | Shop owner only | `https://your-site/owner.html` |

**Everything is free:** Supabase free plan (database, Google login, file storage, live updates) + Netlify / Vercel / GitHub Pages for hosting + UPI (no gateway fee).

---

## Setup (about 30–40 minutes, one time)

### Step 1 — Create the Supabase project
1. Go to <https://supabase.com> → sign up with GitHub/Google (no card needed).
2. **New project** → name `kg-print` → set a database password (save it) → Region **South Asia (Mumbai)** → Create.
3. Wait ~2 minutes until it's ready.

### Step 2 — Create the database
1. Open `supabase/schema.sql` and change the **last line** to the shop owner's Gmail:
   `insert into public.owners (email) values ('realowner@gmail.com')`
   (Add your own Gmail as a second row too, so you can test the owner page.)
2. Supabase → **SQL Editor** → **New query** → paste the whole file → **Run**. You should see "Success".

### Step 3 — Turn on Google login
**A. In Google Cloud (free):**
1. Go to <https://console.cloud.google.com> → create a project `KG Print`.
2. **APIs & Services → OAuth consent screen** (may be called "Google Auth Platform"): User type **External**, app name `KG Print`, your email as support + developer contact. Save.
3. **IMPORTANT:** on the consent screen / Audience page click **Publish app** (move it to "In production"). If it stays in "Testing", only test users you add by hand can log in.
4. **Credentials → Create credentials → OAuth client ID** → type **Web application**.
   - Authorised redirect URI: `https://YOUR-PROJECT-ID.supabase.co/auth/v1/callback`
     (copy the exact one from Supabase → Authentication → Sign In / Providers → Google).
5. Copy the **Client ID** and **Client secret**.

**B. In Supabase:**
1. **Authentication → Sign In / Providers → Google** → enable → paste Client ID + Client secret → Save.
2. **Authentication → URL Configuration**:
   - Site URL: your website address (e.g. `https://kgprint.netlify.app`)
   - Redirect URLs: add `https://kgprint.netlify.app/**` and `http://localhost:5500/**` (for testing on your laptop).

### Step 4 — Connect the website to Supabase
Supabase → **Project Settings → API Keys** (or "API"). Copy:
- **Project URL** → `https://xxxx.supabase.co`
- **anon public** key (or the **publishable** key `sb_publishable_…`)

Paste both into `config.js`. ⚠ Never use the `service_role` / secret key in the website.

### Step 5 — Put it online (free)
Easiest: **Netlify Drop** → <https://app.netlify.com/drop> → drag the whole `kg-print` folder in → you get a link. Rename the site to something like `kgprint` in Site settings.

Better long-term (auto-updates when you change code): push the folder to a GitHub repo, then import it in Netlify / Vercel / Cloudflare Pages. No build command, publish directory = root.

After you know the final URL, go back to **Step 3-B.2** and make sure it's in Site URL + Redirect URLs.

### Step 6 — Keep it awake (optional but recommended)
Free Supabase projects pause after 7 days without activity (e.g. semester holidays). If the code is on GitHub, the included workflow `.github/workflows/keep-alive.yml` pings it every 3 days.
GitHub repo → Settings → Secrets and variables → Actions → add `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
If it ever pauses, just open the Supabase dashboard and click **Restore** — no data is lost.

### Step 7 — Owner's first login
1. Owner opens `https://your-site/owner.html` → Continue with Google (with the Gmail from Step 2).
2. **⚙ Settings** → set the UPI ID, name on the UPI account, and per-page rates → Save.
3. Tap **Turn on alerts** every time the dashboard is opened (browsers only allow sound after a tap).
4. On the phone: Chrome menu → **Add to Home screen**, so it opens like an app.

---

## How it works

**Student:** Google login → details (name, phone, flat) → upload files → choose B/W or colour, 1-side or 2-side, copies → pays with the UPI button / QR → enters the 12-digit UTR + screenshot → gets token **KG-n** → watches status: *Checking payment → In print queue → Ready → Collected*.

**Owner:** "Payment received" asks him to confirm the exact amount, then opens a **print job window** that downloads all the student's files (named `KG-7_1_file.pdf`…), shows colour/sides/copies for each, and has an "All printed — mark ready" button. New order = sound + popup + phone notification. The card shows the amount, UTR and screenshot. Owner checks his own UPI app / bank SMS → **✓ Payment received** → prints (Open each file) → **Printed — mark ready** (student gets a sound/notification; a WhatsApp button is also there) → **Collected** when they pick it up.

### Payment safety — what is checked
| Check | How |
|---|---|
| **Unique amount per order** | Every order gets random 1–99 paise added (₹62 → ₹62.37). The owner looks for that exact amount in his UPI app — a fake UTR can't create a real ₹62.37 credit. |
| **Screenshot must show the UTR** | The student's phone reads the screenshot before submitting. If the typed UTR isn't in it, the order is blocked. After 2 tries the student can send it for manual check, which shows in red to the owner. |
| Same UTR used twice | Blocked by the database |
| Same screenshot uploaded twice | Blocked by the database (file fingerprint) |
| Student changes the price in the browser | Ignored — the server recalculates every price |
| Repeat cheaters | Owner ticks "Mark as FAKE" when rejecting. 2 fakes = that Google account is blocked (unblock in ⚙ Settings) |
| Screenshot clues (owner card) | Payee name / UPI ID, payment time & date vs order, editing-app tag (Photoshop, Snapseed…), AI image label (C2PA), PNG vs JPEG, phone-screen shape. Red ones add up into a "⚠ N red flags" banner. These raise suspicion — they can't prove an image is real. |
| **Final proof** | The owner taps "Payment received" only after seeing the exact amount in **his own** UPI app / bank SMS. |

### Free plan limits & how this stays inside them
- **1 GB file storage:** print files are deleted when an order is marked Collected, and everything older than 3 days is cleaned up automatically.
- **500 MB database:** orders are tiny text rows — years of use.
- Files up to 25 MB each, 20 files per order.

### Known limits (v1)
- Word page counts come from the file's saved info and can be wrong → the student can correct them, and the owner sees a ⚠ warning to check.
- Alerts work while the owner dashboard is open (phone screen can be on — the page keeps it awake). True background push notifications would need extra setup.
- `.doc` (old Word) pages can't be counted — the student types the number.

### Ideas for v2
Owner can edit page count / amount on an order · spiral binding & stapling prices · daily sales report export · multiple shops.

## Updating an existing setup
1. Supabase → SQL Editor → paste the **whole new `supabase/schema.sql`** → Run. It is safe to re-run: it keeps your orders, settings and owners.
2. Replace the website files with the new ones, **but keep your own `config.js`** (it has your keys).

## Test on your laptop
Open the folder in VS Code → install the **Live Server** extension → right-click `index.html` → *Open with Live Server* (runs at `http://localhost:5500`). Google login needs `http://localhost:5500/**` in Supabase Redirect URLs.
