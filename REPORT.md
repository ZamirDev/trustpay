# TrustPay — Project Report

**Track:** Visa Verify (fraud / payment security) · **Theme:** explainable fraud-risk for
online checkout
**Stack:** Node + Express · Vite + vanilla JS · Chrome MV3 extension (no ML dependencies,
no external APIs, fully self-contained)

---

## 1. Problem

Card-not-present (CNP) fraud keeps rising. Merchants between a rock and a hard place:

- **Too loose** → chargebacks eat the margin, customers lose trust in checkout.
- **Too strict** → 3DS-style prompts on every order push good shoppers away and kill
  conversion.
- **Black-box models** → when a good order is declined, no one can tell the merchant (or the
  customer) *why* — so they just leave.

Add to that a second, dirtier problem: **fake checkout pages**. Typosquat domains, "verify
your payment" clones, pages that ask for your card *and* your ATM PIN. Trust is a page-level
problem as much as a transaction-level one.

## 2. Our answer

TrustPay solves both halves with a single philosophy: **explain everything**.

**Half 1 — behavioral risk scoring at checkout.** We collect browser-side signals while a
real human (or not) fills a card form:

- how fast and how even they type (`typing.isErratic`, `charsPerMin`),
- whether the card number was **pasted** vs typed,
- how long the form took to fill vs how many fields it has,
- mouse-path smoothness (robotic low-jitter = scripted),
- device identity (first purchase on this device?),
- network context (VPN, IP-vs-card country mismatch),
- order shape (amount vs the customer's typical spend, retry velocity).

A transparent, weighted model turns those into one **0–100 score** with **top-3 factors** and a
one-line plain-English explanation — shown to the customer on the page *before* they pay.

- **allow** (< 35) → nothing slows down.
- **review** (35–64) → we look closer, no friction for the buyer.
- **challenge** (≥ 65) → the submit is blocked and MFA is required before a charge.

**Half 2 — the Guard extension ("is this page safe?").** A Chrome MV3 extension that
protects *any* checkout **or sign-in page**, even one it's never met:

- attaches a behavioral guard to checkout forms on any site,
- blocks the submit **before the card leaves the browser** when the score is critical,
- and, on demand, scans the current page for trust: does the form POST cross-origin? Is the
  domain a typosquat of a known brand, or does the page claim to be Google while hosted
  somewhere else? Is the page collecting sensitive extras (ATM PIN, OTP, SSN) next to a card,
  or a date of birth next to a password? Does it embed a real payment processor
  (Stripe/PayPal/...) iframe? Verdict renders as an on-page banner + popup card, and a red
  verdict auto-attaches the block-guard — payments get an MFA step-up, phishing logins get a
  *Leave this page / Continue anyway* warning (the site itself is the suspect, not the user).

## 3. How explainability is the product

The risk widget shows live:

```
70  Likely risky — identity check needed
    +35 Card form submits to evil.example.net, not its own domain
    +30 Form also asks for "ATM PIN" — never ask alongside a card
    +5  No privacy / terms / help links found
```

Not "transaction declined". Three readable reasons, reverified by the user, then a step-up
MFA. That is the shipping principal innovation here: risk signals that a shopper or a
merchant can **audit**, not a black box.

## 4. The demo (see DEMO-SCRIPT.md)

Deterministic, scripted personas on the Kicks storefront so judges *see* the difference:

| Persona | Signals | Verdict |
|---|---|---|
| **Alex 😊** known device, gentle typing, normal order | clean | **4 / allow** — instant green, no friction |
| **Review 🟡** known device, VPN + geo mismatch, rushed form | 3 mild signals | **38 / review** — amber, still seamless |
| **Shady 😈** new device, pasted card, rush typing, VPN, big order | everything wrong | **100 / challenge** — blocked + MFA |

Extension demo: a standalone store checkout (legit → green) and a phishing clone (red
70/challenge → auto-block), plus a real Stripe-iframe checkout correctly recognized as a
hosted payment page.

**Late-opening payment popups.** Real gateways (Easebuzz EaseCheckout, Razorpay, etc.) don't
put the card inline — they open a dark-overlay modal *after* the page loads. A one-shot scan
would see nothing. So every scan arms a **60-second page watch**: a MutationObserver
(300 ms debounce, iframe-load events armed separately, re-armable, never doubled) re-runs the
scanner, and if the verdict changes the banner re-renders live *and* the background worker is
notified (`tpScanUpdate`). A card form that posts to a known processor
(Easebuzz/Cashfree/PayU/CCAvenue/BillDesk/Instamojo/…) is a ✓ **note**, not a cross-origin
factor, and same-origin iframe card fields are readable via `frameDocs()`. A red late verdict
auto-attaches the block-guard with no further interaction. Worth noting: the scanner also
recognizes the *src* of stored processor scripts, so even a iframe you can't read (cross-origin)
is still acknowledged as the real processor.

## 5. Architecture & security posture

- **Thin client, stateless API.** The API is a pure function over signals; no external
  storage or ML infra to knock over in a demo room. Transaction feed is in-memory and reseeds.
- **CORS allowlist**, service-worker API bridge in the extension (host_permissions bypass
  page CORS — the page never learns what the extension sent).
- The demo app ships **demo pages under `client/public/`** explicitly labeled, and the
  phishing page is *visibly* simulated (no credentials are harvested by it).
- The MFA "code" is returned to the page **only for the demo** (documented in code); a real
  integration SMSes it.

## 6. Trade-offs & honest scope

- Network signals (VPN, IP country) are **hooked but simulated** in the demo — no geo-IP
  dependency, so it runs offline. Wiring real IP data is a drop-in.
- The model is deliberately linear and auditable, not a gradient-boosted monster; accuracy
  tuning is ongoing, and the whole point is that it can be tuned **by humans**.
- Extension auto-attaches on `http://localhost/*` (dev); for the judged walkthrough we demo on
  local pages and the built-in demo storefront.

## 7. Future work

- Real geo-IP + proxy detection server-side.
- Per-merchant model calibration and a merchant rule editor on the dashboard.
- Extension auto-run on payment pages across the open web (scanner already supports
  processor iframes).
- Chargeback-informed retraining loop feeding the transparent weights back to merchants.

## 8. Run it

```bash
cd server  && npm install && npm run start   # :4000
cd client  && npm install && npm run dev     # :5173
# load extension/ in chrome://extensions → Load unpacked
```