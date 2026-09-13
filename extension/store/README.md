# Chrome Web Store — Submission Kit (for post-hackathon publish)

This folder is where we assemble everything the Chrome Web Store review needs so the
final submit is one click. Submission itself is **deferred until after the hackathon**
(needs a $5 developer registration, 2-Step Verification, and a live backend option).

## Items to prepare

| Item | Spec | Owner |
|---|---|---|
| Screenshot 1 | 1280×800 (or 640×400) — full extension demo on a real checkout | user (Chrome screenshot) |
| Screenshot 2 | 1280×800 — "Is this payment page safe?" result on a fake page | user |
| Screenshot 3 | 640×400 — popup verdict card | user |
| Promo tile | **440×280** | user |
| Small promo tile | **440×280** (same as promo, store may reuse) | user |
| Privacy policy URL | hosted on a live site (e.g. zionia.me/legal) after deploy | user |
| Social media link | GitHub repo | done |

## Draft listing text

**Name:** TrustPay Guard — explainable checkout fraud risk

**Summary (132 chars max):**
Watch how a card is typed, then block risky checkouts with a code check — and scan any
payment page for fake-host tell-tales.

**Description (draft):**
Understand fraud instead of trusting a black box.

TrustPay Guard watches how you pay — typing cadence, paste-vs-type, mouse motion, form-fill
speed — and scores every checkout 0–100 with every point explained. Good shoppers glide
through. Risky ones get a quick code check before any card is charged.

· Guard: attach to any checkout page, auto-block critical submits, step-up code overlay
· Scan: "is this payment page safe?" — typosquat domains, cross-origin POSTs, sensitive
  overreach (ATM PIN/OTP/SSN beside a card), and embedded payment iframes (Stripe, PayPal,
  Braintree, Adyen, Razorpay…) are recognized with readable reasons
· Explainable: top-3 factors + a one-line reason shown for every verdict
· Offline: ships its own risk engine, works with no server
· Private: never collects card numbers, no trackers, signals leave the browser only when the
  TrustPay API is reachable

**Permission justification (review notes):**
- `activeTab` + `scripting` — run the page scanner / attach the guard when you click.
- `storage` — device id + last verdict, all local.
- Local host permissions only (dev demo storefront). No remote code, no analytics.

## Test instructions (for the reviewer)

1. Open chrome://extensions → Load unpacked → this folder.
2. Visit any page at http://localhost:5173 (or any site) and click the 🛡 icon → "Is this
   payment page safe?" → a verdict card appears.
3. On a checkout page, click "Attach guard", fill the form, submit → toast verdict; a
   high-risk submit is blocked with a code overlay (code shown in the overlay — demo mode).

## Timeline reminders

- Enable **2-Step Verification** on the publishing Google account.
- Pay the **one-time $5** developer registration fee at the Chrome Developer Dashboard.
- After review approval you have **30 days** to hit *Publish*.