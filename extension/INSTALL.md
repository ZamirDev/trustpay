# TrustPay Guard — Install Guide

TrustPay Guard is a Chrome **Manifest V3** extension. Two ways to run it:

## 1. Quick install (less than a minute)

1. Download `trustpay-guard-v0.2.0.zip` from the release page and unzip it to a folder.
2. Open **chrome://extensions** in Chrome.
3. Toggle **Developer mode** (top right).
4. Click **Load unpacked** → select the unzipped folder.
5. Pin the 🛡 icon if you like.

## 2. From source (if you clone the repo)

Same steps, but point "Load unpacked" at the **`extension/`** folder of the repo.

---

## How it works

Two features:

| Feature | What it does | Needs API? |
|---|---|---|
| **🛡 Guard** | Watches a checkout form's typing/paste/mouse, scores the submit, blocks high-risk ones with a code-check overlay | No — scores offline in the extension |
| **🔍 Is this payment page safe?** | Scans the current page for trust signals (typosquat, cross-origin POST, sensitive overreach, payment iframes) | No — pure page analysis |

**Offline vs server mode.** The extension ships its own copy of the risk model and works
completely standalone. If the TrustPay API is reachable (http://localhost:4000, or the live
Railway URL at submission time), the extension uses the server and the merchant dashboard
learns about your checkouts too. Reachability is tried with a 900 ms timeout, so a missing
server never slows you down — verdicts are identical either way (an "offline engine" tag on
the popup shows which mode you're in).

## Demo storefront

To see it protect a realistic checkout:

```bash
cd server && npm install && npm run start   # optional — dashboard parity only
cd client && npm install && npm run dev     # http://localhost:5173
```

Then visit **http://localhost:5173/demo-checkout.html** (a legit store) and
**http://localhost:5173/demo-phish.html** (a simulated phishing page — nothing is captured).
Or hand the guard any checkout page on `http://localhost`.

## Troubleshooting

- **Changes not showing?** On chrome://extensions click the **reload** (⟳) icon on the card
  after editing files.
- **Badge shows 🛡?** No checkout form is present on that tab, or the extension was just
  loaded.
- **"engine unreachable"?** That resolves itself offline now; if the server IS running, check
  it with `curl http://localhost:4000/api/health`.

## PRIVACY / DISCLOSURE

- The extension never collects card **numbers** — it only watches *how* they're typed
  (keystroke timing, paste events, mouse motion) and reads order metadata from the page.
- Signals leave the browser **only if** the TrustPay API is reachable; signals are not sent
  anywhere else. No trackers, no analytics, no remote code.
- In offline mode nothing is transmitted at all.