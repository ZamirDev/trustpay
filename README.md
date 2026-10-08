# TrustPay — explainable fraud-risk for online checkout

**Buy like a human. Get stopped like a pro.**

TrustPay is an end-to-end fraud-risk engine that watches **how** you shop — typing cadence,
paste-vs-type, mouse jitter, form-fill speed, device, network and order shape — and scores
every checkout 0–100 with a **human-readable explanation** for every point. Legit shoppers
glide through; risky ones are forced through an MFA identity check before a card is charged.
Merchants see live verdicts on a dashboard. A Chrome extension turns any browser into a
payment guard and page-trust scanner.

Built as a hackathon project (Visa Verify track). Demo-first, self-contained, no external
APIs required.

---

## The three surfaces

| Surface | What it does | Where |
|---|---|---|
| **Web app** | A tiny sneaker store ("The Kicks store") with TrustPay wired into checkout. Scripted personas make the demo deterministic. | `client/` |
| **Risk API** | Node + Express. Weighted explainable model, transaction store, simulated MFA. | `server/` |
| **Guard extension** | Chrome MV3. Watches checkout typing on any page, blocks risky submits with an MFA overlay, and scans any page — payment **or login** — for trust. | `extension/` |

```
        shopper's browser
   ┌───────────────────────────┐
   │  Kicks checkout (Vite SPA) │──collector──┐
   │  + TrustPay Guard ext      │──guardInPage│
   │  + pageScan (that page?    │             │
   │    safe to pay?)           │             │
   └───────────────────────────┘             ▼
                                    ┌─────────────────┐
                                    │  explainable risk │
                                    │  engine :4000     │
                                    │  (Node/Express)   │
                                    ├─────────────────┤
                                    │ /api/risk        │
                                    │ /api/transactions│
                                    │ /api/mfa/*       │
                                    └─────────────────┘
                                          │
                                          ▼
                                   merchant dashboard
```

## Repo layout

```
server/       Express API — risk model, tx store, MFA sim, seed data
client/       Vite SPA — Kicks store, checkout collector, dashboard, demo pages
extension/    Chrome MV3 TrustPay Guard — content script, bridge, popup, page scanner
REPORT.md     submission write-up
DEMO-SCRIPT.md  6-minute judged walkthrough
```

## The risk model

Weighted linear model, score 0–100. Every contributing signal ships a readable factor so the
"why" is never a black box.

| Threshold | Action |
|---|---|
| < 35 | **allow** — no friction |
| 35–64 | **review** — closer look, still smooth |
| ≥ 65 | **challenge** — MFA before any charge |

**Weights** (single source of truth: `server/src/riskModel.js`):

| Signal | Weight | Story |
|---|---|---|
| `base` | 4 | neutral starting score |
| `deviceUnseen` | 18 | first purchase on this device |
| `typingErratic` | 15 | hunting-and-pecking cadence |
| `cardPasted` | 16 | card number pasted, not typed |
| `vpn` | 14 | anonymizing network |
| `countryMismatch` | 12 | IP country ≠ card country |
| `amountScaleHigh` | 10 | order ≫ your typical amount |
| `retryCount` | 10 | repeated payment attempts |
| `mouseJitterHigh` | 8 | robotic low-jitter mouse path |
| `rushTyping` | 8 | impossibly fast typing |
| `autofillFast` | 7 | form filled faster than a human |

The page scanner has its own weights for site-trust (cross-origin post +35, brand spoof +40,
typosquat +45, sensitive overreach +30, no HTTPS +25, raw-IP host +20, odd port +15, no trust
links +5) and recognizes iframes from **Stripe / PayPal / Braintree / Adyen / Square / Razorpay
/ Checkout.com / 2Checkout / Cybersource / Worldline / Amazon Pay / Easebuzz / Cashfree / PayU /
CCAvenue / BillDesk / Instamojo** as legitimate hosted payment fields (a card form that posts
*to* one of those processors is a ✓ note, not a cross-origin factor). Card forms and
login/sign-up forms are both scored (thresholds unchanged: allow < 35 · review 35–64 ·
challenge ≥ 65). After any scan a **60-second watch** stays armed: a payment popup/overlay that
opens *later* (EaseCheckout style) re-scores the page live and updates the banner.

## Quickstart

### 1. API

```bash
cd server
npm install
npm run start        # :4000
```

### 2. Web app

```bash
cd client
npm install
npm run dev          # :5173  (proxies /api → :4000)
```

Open `http://localhost:5173` → landing → Try the checkout demo → pick a persona **or** type
your own card details. Dashboard at `#/dashboard` shows the live feed.

### 3. Extension (Chrome)

1. **Zip install (recommended):** grab `trustpay-guard-v0.2.0.zip` from the release page,
   unzip → `chrome://extensions` → Developer mode → **Load unpacked** → select the folder.
   Full guide: `extension/INSTALL.md`.
2. Checkout on any `http://localhost` page — the guard attaches automatically.
3. Use the popup **"Is this page safe?"** to scan a page before paying **or signing in** —
   works on any site (activeTab). The scan also arms a short **watch**: if a payment popup
   opens after the scan, the banner updates itself.

**Offline-first.** The extension ships its own copy of the risk model (`extension/riskModel.js`,
a mirror of `server/src/riskModel.js`), so guard + scan + MFA work with **no server running**.
If the API is reachable it's used instead (and the merchant dashboard learns about the
checkout); a small "offline engine" tag on the popup tells you which mode you're in. Verdicts
are identical in both modes.

---

## Demo pages (built-in)

- `http://localhost:5173/demo-checkout.html` — a realistic standalone store checkout that
  the extension knows nothing about, and still protects.
- `http://localhost:5173/demo-phish.html` — a fake "verify your payment" clone that posts to
  a sketchy domain and asks for your ATM PIN. The scanner flags it **70/challenge** (red) and
  auto-attaches the block-guard.
- `http://localhost:5173/demo-login.html` — a simulated fake Google sign-in that POSTs your
  password to a foreign host. The scanner flags it **75/challenge** (brand spoof + cross-origin)
  and the guard **blocks the submit before the password leaves the browser**, offering
  *Leave this page / Continue anyway*.
- `http://localhost:5173/demo-popup.html` — a simulated subscription page whose payment popup
  (EaseCheckout style, fake Easebuzz checkout in an iframe) opens **after** the page loads.
  Scan first (*nothing to scan* + watching line), click **Subscribe with Easebuzz**, and the
  banner flips live to **0/allow · hosted by Easebuzz**.

## Deploy (at submission)

Backend stays on **Railway** (free tier), frontend on **Vercel** — both paused until
submission to respect the free-tier budget.

```bash
# server → Railway
railway up            # previously: railway link devoted-caring-production-534f

# client → Vercel, pointing at the live API
cd client
$env:VITE_API_URL = "https://devoted-caring-production-534f.up.railway.app"
vercel --prod

# extension → swap the API base in extension/background.js to the live Railway URL,
# then reload the unpacked extension for the live demo.
```

CORS on the API already allows `trustpay.vercel.app` and `trustpay-zamirdevs-projects.vercel.app`.

## Testing

Server: `curl http://localhost:4000/api/health` · `POST /api/risk` with the documented signal
shape. The page scanner has a regression suite in `tests/` (jsdom, runs `extension/pageScan.js`
against the real demo pages):

```bash
cd tests && npm install && npm test   # 24 cases: demo verdicts, typosquat matrix,
                                      # brand spoof, login/signup kinds, fatal path,
                                      # Easebuzz/gateway recognition, live popup watch
```

Expected: legit page **0/allow**, phishing clone **70/challenge**, fake Google sign-in
**75/challenge**, exact-brand login (accounts.google.com) **0/allow**, chatgpt.com login
**clean**, Stripe-iframe page **allow + hostedBy: Stripe**, stray form fields outside a form
**no crash**, broken DOM **readable error report**, popup closed → **nothing to scan**,
popup opened late → **live flip to payment/allow, hostedBy Easebuzz**.