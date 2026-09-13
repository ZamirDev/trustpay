# TrustPay — Server

Explainable fraud-risk API for online checkout. Node + Express.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness probe |
| GET | `/api/weights` | Model weights + thresholds (drives the docs/demo) |
| POST | `/api/risk` | Body: `{ signals }` → `{ score, level, action, factors[], txnId }` |
| GET | `/api/transactions` | Dashboard feed (seed + live) |
| POST | `/api/mfa/send` | Creates a demo OTP (returns `code` — demo only) |
| POST | `/api/mfa/verify` | `{ txnId, code }` → verifies + marks txn approved |

## Risk model

Score 0–100, explainable factors returned with every verdict.

- `allow` < 35 — no friction
- `review` 35–64 — low-friction check
- `challenge` >= 65 — MFA forced

Signals: device seen?, typing cadence, paste-vs-type, form-fill time, mouse jitter, VPN, IP↔card country mismatch, amount scale, retry velocity. Weights live in `src/riskModel.js` (`WEIGHTS`).

## Local run

```bash
cd server
npm install
npm run start        # listens on :4000 by default
```

```bash
curl http://localhost:4000/api/health
```

## Deploy

Railway-free tier. `npm run start`, port from `process.env.PORT`. No native deps, no DB (in-memory, reseeds on boot).