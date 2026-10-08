# TRUSTPAY

## Explainable Fraud-Risk Protection for Online Checkout

**Bharat Innovation Challenge 2.0 — Theme: Cybersecurity & Ethical Tech**

**Team:** ZamirDev (solo) · **Mentor:** Shailendra Bajpai, Podar International School
**File name:** ZamirDev_TrustPay_PodarInternationalSchool

---

# The Problem

**Card-not-present fraud is exploding, and good shoppers are caught in the crossfire.**

- Online payment fraud keeps rising year over year, and most of it happens at the **checkout moment** — the card never leaves the browser before a bad actor touches it.
- Merchants face an impossible trade-off:
  - **Too loose** → chargebacks eat the margin, losses get passed to every honest customer.
  - **Too strict** → friction (repeated 3DS-style prompts) makes real buyers abandon the cart.
- When a genuine order is declined, **no one can say why** — black-box fraud models give merchants a "no" and customers a mystery. Everyone loses trust.
- A second, dirtier problem: **fake checkout pages**. Typosquat domains ("paypal-verify.shop"), "verify your payment" clones, and pages that brazenly ask for your card *and* your ATM PIN or OTP.

> Fraud isn't just a transaction problem. It is a **trust problem at the moment you pay** — and neither shoppers nor merchants can currently audit the decision.

---

# The Opportunity

- **Every online purchase in India and worldwide** is a potential fraud target — and a potential false decline.
- There is a **huge, unserved gap**: explanations. Existing tools decide; almost none **explain**.
- The market that exists today is dominated by two extremes:
  - **Bank-level black-box consoles** (expensive, built for fraud teams, opaque to the buyer).
  - **User-side password managers / 2FA** (they check *your* accounts, not *the page and the act of paying*).
- Nobody sits in the middle: **guarding the actual checkout page, in the browser, with reasons a human can read.**

> We are building for the gap between "fraud team dashboard" and "password manager": protection at the point of payment, explained end to end.

---

# Existing Gaps (What's Missing Today)

| Gap | Today's tools | What TrustPay does |
|---|---|---|
| **No explanation** | Black-box models decline with a generic message | Shows top-3 factors + a one-line reason, live on the page |
| **No page-level trust check** | 2FA protects after you log in, not the fake page itself | Scans the page: cross-origin POSTs, typosquats, PIN/OTP overreach |
| **Fraud-only tools are merchant-side** | Shopper has zero visibility | Risk score shown to the **shopper** before they pay |
| **Heavy infrastructure** | Model servers, feature stores, big ML teams | Fully client-side, works offline, no external APIs |

---

# Our Solution

**TrustPay = trust you can see, at the moment you pay.**

Two complementary products, one philosophy — **explain everything**.

**Half 1 — Behavioral risk scoring at checkout.**
While a real human (or a script) fills the card form, we collect browser-side signals and turn them into a transparent **0–100 risk score**:

- How fast and how evenly you type (erratic bursts = bot-like)
- Whether the card number was **pasted** vs typed
- How long the form took vs how many fields it has
- Mouse-path smoothness (robotic low-jitter = scripted)
- Device identity (first purchase on this device?)
- Network context (VPN, IP-vs-card country mismatch)
- Order shape (amount vs typical spend, retry velocity)

**The verdict is shown before the customer pays:**

- **allow (< 35)** → nothing slowed down
- **review (35–64)** → we look closer, zero friction
- **challenge (≥ 65)** → submit is blocked; MFA required before a single rupee is charged

**Half 2 — the TrustPay Guard extension ("Is this payment page safe?")**
A Chrome extension that protects any checkout page it has never met:

- Attaches the behavioral guard to card forms anywhere
- Blocks the submit **before the card leaves the browser** when the score is critical
- Scans the page for trust: cross-origin POSTs, typosquat domains, sensitive overreach (ATM PIN / OTP / SSN beside a card), and real processor iframes (Stripe, PayPal, Razorpay…)
- Renders a banner + popup verdict; a red verdict auto-attaches the block

---

# Technology & Innovation

**The innovation is not "a score" — it is a score a human can audit.**

```
68  Likely risky — identity check needed
    +35  This page posts to evil.example.net, not its own domain
    +25  Form also asks for "ATM PIN" — never alongside a card
    +5   No privacy / terms / help links found
```

Not "transaction declined." Three readable reasons, reverified by the user, then a step-up MFA.

**Stack (fully self-contained, zero external APIs):**
- **Server:** Node + Express — stateless pure-function risk API, in-memory feed
- **Client:** Vite + vanilla JS — checkout storefront + dashboard (all local, offline-capable)
- **Extension:** Chrome MV3 — service-worker API bridge that bypasses page CORS (the page never learns what was sent), page scanner, auto-block guard

**Design principles:**
- **Transparent weighted model** — deliberately linear and auditable; humans can tune the weights. Not a gradient-boosted black box.
- **Privacy-first** — risk signals are computed locally; no PII leaks to analytics.
- **Works offline** — no geo-IP dependency in the demo; real IP detection is a drop-in.

---

# Prototype / MVP (Working Demo)

A **live, working prototype** — not a mockup.

**The Kicks storefront** — a demo web shop where the risk engine runs in real time:

| Persona | What the user sees | Verdict |
|---|---|---|
| **Alex 😊** known device, calm typing, normal order | instant green, zero friction | **4 / allow** |
| **Review 🟡** VPN + geo mismatch, rushed form | amber, still seamless | **38 / review** |
| **Shady 😈** new device, pasted card, erratic typing, big order | blocked → MFA required | **100 / challenge** |

**Guard extension demo (on two real local pages):**
- A legitimate standalone store checkout → **green / allow**
- A phishing clone (posts to a fake domain, asks for ATM PIN) → **red 70 / challenge + auto-block**
- A real Stripe-iframe checkout → correctly recognized as a **hosted payment page (allow)**

**Everything shown in the pitch is running code**, with an MFA force-overlay and a live transaction dashboard.

---

# Target Users

1. **Shoppers** — anyone paying online who wants to know *before* they submit whether the page and the purchase look safe, and *why* their order got challenged.
2. **Small & mid-size merchants** — no fraud team, no ML budget; they get professional-grade scrutiny with zero setup, and explanations they can actually act on.
3. **Fintechs & banks** — as a shopper-facing trust layer and a merchant-side explainable signal to complement their own black-box systems.
4. **Schools & first-time digital buyers** — India's newest internet users (UPI-era) are the most vulnerable to typosquats and PIN-overreach scams; TrustPay literally teaches safe checkout.

---

# Impact

- **Stops leaks of card data** at the source — the submit is blocked inside the browser *before* the card leaves the device.
- **Reduces both fraud losses and false declines** — precise scoring means fewer honest customers are pushed away, and fewer fraudsters slip through.
- **Kills the phishing page as a category** — typosquat + overreach detection turns "help me detect phishing sites" into "my browser refuses the impostor page."
- **Builds digital trust literacy** — every verdict teaches the user one concrete signal of fraud, creating safer internet behavior beyond any single transaction.

> Measurable promise: fewer chargebacks for the merchant, fewer abandoned carts, and — critically — **users who can now explain why they were protected.**

---

# Implementation Plan

**Phase 0 (done) — Working prototype:** risk engine, checkout store, dashboard, Chrome extension, full demo. Everything in this deck is already built and running.

**Phase 1 (months 1–3):** Real geo-IP/proxy detection server-side; per-merchant model calibration; merchant rule editor on the dashboard.

**Phase 2 (months 4–9):** Extension auto-runs on payment pages across the open web (scanner already understands processor iframes); packaged for the Chrome Web Store.

**Phase 3:** Chargeback-informed retraining loop that feeds real outcomes back into the transparent weights — turning merchant results into better, still-auditable decisions.

---

# Scalability & Competitive Advantage

**Scalability:**
- **Client-side first** — the core engine ships per-user; the server is a stateless function that scales horizontally. No heavy ML infrastructure.
- **Distribution flywheel** — works as (a) a merchant widget, (b) an extension protecting every page, and (c) an embeddable API. One engine, three surfaces.
- **Local-first = global** — runs offline and in low-bandwidth classrooms/labs, important for the Indian market.

**Competitive advantage:**
- **Explainability is the product**, not a feature — no major player shows the customer the reasons.
- **Page-level trust + transaction risk in one tool** — none of the incumbents cover both the fake *page* and the risky *payment*.
- **Privacy + no black box** = ethical tech by construction, which aligns with the values of banks, schools, and regulators alike.

---

# Team Vision

- **Founder:** Zamir Memon, Grade 11, Podar International School — self-taught builder of browser-based software, already shipping.
- **Mentor:** Shailendra Bajpai — guiding product direction and school outreach.

**Why this matters to us:** Millions of people are coming online and to payments for the first time. They deserve a checkout that protects them **and explains itself** — never a silent "declined." We want TrustPay to be the reason the next generation of digital buyers can *see* when something is wrong, instead of trusting a black box.

**Ask:** a finalist slot to bring the live prototype to the Grand Finale and show the jury a checkout that talks back in plain language.

---

# Thank You

**TrustPay — Buy like a human. Get stopped like a pro.**

- **Live demo:** the Kicks storefront + TrustPay Guard extension
- **Source (open, public):** github.com/ZamirDev/trustpay
- **Contact:** zamirmemon01@gmail.com

**Theme:** Cybersecurity & Ethical Tech

---

_Note: The demo phishing page is visibly simulated — no real credentials are collected anywhere in the prototype._