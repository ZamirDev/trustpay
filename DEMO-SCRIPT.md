# TrustPay — Demo Script (6-minute judged walkthrough)

Goal: show **who it protects, how it scores, and that every point is explainable**. All
numbers below are deterministic given the demo setup.

## Pre-flight (already running)

- `server/` on **:4000**, `client/` on **:5173**.
- TrustPay Guard loaded unpacked in Chrome (reloaded).
- Dashboard feed is live (seeded + any runs so far).

---

## 0:40 — The pitch

> "Card fraud is a trust problem. Block everyone and you kill checkout. Block no one and you
> eat chargebacks. TrustPay's answer: watch *how* someone pays, score it 0–100, and **explain
> every point** — so good shoppers glide and risky ones prove who they are first."

Point at the landing page: *typing dynamics · mouse velocity · paste detection · VPN/geo ·
amount vs your norm · step-up MFA.*

---

## 1:30 — Alex: the good customer (allow, green, zero friction)

Checkout → **Alex 😊** persona.
- Watch the scripted typing: slow, steady, human.
- Pay → risk widget: **small green score, "No concerning signals — checkout continues
  seamlessly."** The order approves instantly. No popups, no friction.

> "A real customer on their own laptop, typing at 88 chars/min with human jitter. Four points.
  We don't annoy them."

---

## 3:00 — Review: the rushed traveler (amber, still smooth)

Switch to **Review 🟡**.
- VPN link on, order filled fast, geo visible from Singapore.
- Pay → **38 / review**.

> "Known device, but a VPN plus a card from a different country plus a rushed form. Amber —
  we take a closer look but we do NOT slow this customer down."

---

## 4:30 — Shady: the risky one (red, blocked, MFA)

Switch to **Shady 😈**.
- Card **gets pasted**, typing is impossibly fast and erratic, VPN + country mismatch, big
  ticket item.
- Pay → **100 / challenge** — red, factors listed on screen (device unseen, pasted card, rush
  typing, VPN, geo mismatch).
- Submit is blocked; an **MFA overlay** appears ("demo OTP" shown like a bank SMS). Enter it →
  approved.

> "Every signal against, every one explained, and the charge could not go out until the person
  proved they own the account."

---

## 5:30 — The Guard extension: protecting a checkout it never met

Open **`/demo-checkout.html`** (a standalone store with no TrustPay code).
1. Type/paste a card, pay → TrustPay Guard (extension) gives the same allow/challenge
   behavior with a **badge score in the toolbar**.
2. Popup → **"Is this payment page safe?"** → green verdict + reasons.
3. Open **`/demo-phish.html`** (label it explicitly: *simulated phishing page, nothing is
   captured*) → scan → **70 / challenge**, *"Form also asks for ATM PIN"*, and the guard
   **auto-attaches** to block it.

> "Same engine, but now protecting any page in the browser — we caught a fake checkout that
> ships your card AND your PIN to a sketchy domain, and we show you exactly why."

---

## 6:00 — Close (15 sec)

> "Merchant dashboard live on the left — every verdict, score, and its reasons. Explainable,
> tunable, and it demos in six minutes." → `#/dashboard`.

---

## Quick reference (expected verdicts)

| Surface | Expect |
|---|---|
| Alex 😊 → Pay | **4 / allow** (green, instant) |
| Review 🟡 → Pay | **38 / review** (amber, no friction) |
| Shady 😈 → Pay | **100 / challenge** → MFA → approved |
| demo-checkout → scan | **0 / allow** |
| demo-phish → scan | **70 / challenge** + auto guard |
| real Stripe-iframe checkout → scan | **allow**, "hosted by Stripe" note |