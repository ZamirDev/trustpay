// background.js — TrustPay Guard bridge + embedded offline engine.
// All API calls go through here so a service worker with host_permissions
// bypasses page CORS entirely.
//
// API base: dev = localhost:4000. At submission, swap in the live Railway URL
// (it stays paused until then to respect our free-tier budget):
//   const API = 'http://localhost:4000';
//
// Every API-backed message first tries the server (900ms timeout). If it is
// unreachable, the embedded riskModel.js scores/verifies in place so the
// extension is fully self-contained (offline mode). Verdicts are identical in
// both modes — the model is a mirror of server/src/riskModel.js.

import { scoreRisk, explain } from './riskModel.js';

const API = 'https://trustpay-api-production-b717.up.railway.app';
const LAST_KEY = 'tpLastVerdict';
const API_TIMEOUT_MS = 900;
const OFFLINE_TTL_MS = 5 * 60 * 1000;

// offline MFA store: txnId -> { code, expiresAt }
const mfaCodes = new Map();

function offlineTxnId(seed) {
  return seed && seed !== 'undefined' ? seed : 'offline-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function apiFetch(path, body) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), API_TIMEOUT_MS);
  try {
    return await fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

async function api(path, body) {
  const res = await apiFetch(path, body);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

async function setBadge(score) {
  const text = score != null ? String(Math.max(0, Math.min(100, Math.round(score)))) : '🛡';
  await chrome.action.setBadgeText({ text });
  const color = score >= 65 ? '#ffffff' : score >= 35 ? '#ba6a36' : '#03955b';
  await chrome.action.setBadgeBackgroundColor({ color });
  if (score >= 65 && chrome.action.setBadgeTextColor) {
    await chrome.action.setBadgeTextColor({ color: '#000000' });
  } else if (chrome.action.setBadgeTextColor) {
    await chrome.action.setBadgeTextColor({ color: '#ffffff' });
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'risk') {
        let verdict, source;
        try {
          verdict = await api('/api/risk', { signals: msg.signals });
          source = 'server';
        } catch {
          const txnId = offlineTxnId(msg.signals && msg.signals.meta && msg.signals.meta.uid);
          const v = scoreRisk(msg.signals);
          verdict = { txnId, ...v, explain: explain(v) };
          source = 'offline';
        }
        await setBadge(verdict.score);
        await chrome.storage.local.set({
          [LAST_KEY]: {
            score: verdict.score,
            level: verdict.action,
            factors: verdict.factors || [],
            page: _sender.tab ? _sender.tab.url : 'unknown',
            ts: Date.now(),
            source,
          },
        });
        sendResponse({ ...verdict, source });
      } else if (msg.type === 'mfaSend') {
        let res, source;
        try {
          res = await api('/api/mfa/send', { txnId: msg.txnId });
          source = 'server';
        } catch {
          const txnId = offlineTxnId(msg.txnId);
          const code = String(Math.floor(100000 + Math.random() * 900000));
          mfaCodes.set(txnId, { code, expiresAt: Date.now() + OFFLINE_TTL_MS });
          res = { ok: true, status: 'sent', code, expiresInSec: OFFLINE_TTL_MS / 1000 };
          source = 'offline';
        }
        sendResponse({ ...res, source });
      } else if (msg.type === 'mfaVerify') {
        let res, source;
        try {
          res = await api('/api/mfa/verify', { txnId: msg.txnId, code: msg.code });
          source = 'server';
        } catch {
          const rec = mfaCodes.get(msg.txnId);
          if (!rec) res = { ok: false, error: 'no challenge active' };
          else if (Date.now() > rec.expiresAt) {
            mfaCodes.delete(msg.txnId);
            res = { ok: false, error: 'code expired' };
          } else if (String(rec.code) !== String(msg.code)) res = { ok: false, error: 'invalid code' };
          else {
            mfaCodes.delete(msg.txnId);
            res = { ok: true, verified: true };
          }
          source = 'offline';
        }
        sendResponse({ ...res, source });
      } else if (msg.type === 'scanpage') {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return sendResponse({ ok: false, error: 'no active tab' });
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['guardInPage.js'],
        });
        sendResponse({ ok: true });
      } else if (msg.type === 'pagescan') {
        // "Is this page safe?" — inject the trust scanner, collect its
        // synchronous report, and auto-attach the block-guard on a red verdict
        // (payment OR login/signup page).
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return sendResponse({ ok: false, error: 'no active tab' });
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['pageScan.js'],
          });
          let scan = null;
          for (let i = 0; i < 12; i++) {
            const [out] = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => globalThis.__tpPageScanResult || null,
            });
            scan = out && out.result;
            if (scan) break;
            await new Promise((r) => setTimeout(r, 250));
          }
          if (!scan) return sendResponse({ ok: false, error: 'scan did not return a report' });
          await chrome.storage.local.set({ tpLastPageScan: { ...scan, tabId: tab.id, ts: Date.now() } });
          const scoredKind = scan.pageKind === 'payment' || scan.pageKind === 'login' || scan.pageKind === 'signup';
          if (scoredKind && scan.action === 'challenge') {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['guardInPage.js'],
            }).catch(() => {});
          }
          sendResponse({ ok: true, scan });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      } else if (msg.type === 'tpScanUpdate') {
        // live watch-mode update from pageScan.js (a payment/login modal that
        // opened AFTER the user's scan): refresh the stored page scan and
        // auto-attach the guard if the late verdict is red.
        const rep = msg.report || {};
        const tabId = _sender.tab ? _sender.tab.id : null;
        await chrome.storage.local.set({ tpLastPageScan: { ...rep, tabId, ts: Date.now() } });
        const lateKind = rep.pageKind === 'payment' || rep.pageKind === 'login' || rep.pageKind === 'signup';
        if (lateKind && rep.action === 'challenge' && tabId != null) {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['guardInPage.js'],
          }).catch(() => {});
        }
        sendResponse({ ok: true });
      } else if (msg.type === 'clearBadge') {
        await setBadge(null);
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: 'unknown message' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true; // keep the message channel open for async response
});