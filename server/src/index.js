import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { scoreRisk, explain, WEIGHTS } from './riskModel.js';
import * as store from './store.js';

const app = express();
app.use(express.json());

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://trustpay.vercel.app',
  'https://trustpay-zamirdevs-projects.vercel.app',
];
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  })
);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'trustpay-api', time: Date.now() });
});

app.get('/api/weights', (req, res) => {
  res.json({ weights: WEIGHTS, thresholds: { allow: [0, 35], review: [35, 65], challenge: [65, 100] } });
});

app.post('/api/risk', (req, res) => {
  const signals = req.body && req.body.signals ? req.body.signals : req.body || {};

  const verdict = scoreRisk(signals);
  const txnId = `tp-${crypto.randomBytes(4).toString('hex')}`;

  store.saveTransaction({
    id: txnId,
    ts: Date.now(),
    merchant: signals.txn?.merchant || 'Kicks Store',
    userId: (signals.meta && signals.meta.uid) || 'anonymous',
    item: (signals.txn && signals.txn.item) || 'Order',
    amount: signals.txn?.amount ?? 0,
    score: verdict.score,
    level: verdict.level,
    action: verdict.action,
    status: verdict.action === 'allow' ? 'approved' : verdict.action === 'review' ? 'review' : 'challenged',
    factors: verdict.factors,
    explain: explain(verdict),
    txnId,
  });

  res.json({ txnId, ...verdict });
});

app.get('/api/transactions', (req, res) => {
  res.json({ transactions: store.listTransactions() });
});

app.post('/api/mfa/send', (req, res) => {
  const txnId = (req.body && req.body.txnId) || null;
  if (!txnId) return res.status(400).json({ ok: false, error: 'txnId required' });

  const txn = store.getTransaction(txnId);
  if (!txn) return res.status(404).json({ ok: false, error: 'transaction not found' });

  const mfa = store.createMfa(txnId);
  // Demo-only: return the code so the client renders the "simulated bank SMS".
  // A real integration would SMS/email it and never expose it to the page.
  res.json({ ok: true, status: 'sent', code: mfa.code, expiresInSec: 300 });
});

app.post('/api/mfa/verify', (req, res) => {
  const { txnId, code } = req.body || {};
  if (!txnId || !code) return res.status(400).json({ ok: false, error: 'txnId + code required' });

  const mfa = store.getMfa(txnId);
  if (!mfa) return res.status(404).json({ ok: false, error: 'no challenge active' });
  if (Date.now() > mfa.expiresAt) return res.status(410).json({ ok: false, error: 'code expired' });
  if (String(mfa.code) !== String(code)) return res.status(401).json({ ok: false, error: 'invalid code' });

  store.markMfaVerified(txnId);
  const txn = store.getTransaction(txnId);
  if (txn) txn.status = 'approved';
  res.json({ ok: true, verified: true, txn });
});

store.seed();

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`trustpay-api listening on :${PORT}`);
});