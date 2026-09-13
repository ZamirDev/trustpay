// background.js — TrustPay Guard bridge. All API calls go through here so a
// service worker with host_permissions bypasses page CORS entirely.
//
// API base: dev = localhost:4000. At submission, swap in the live Railway URL
// (it stays paused until then to respect our free-tier budget):
//   const API = 'https://devoted-caring-production-534f.up.railway.app';

const API = 'http://localhost:4000';
const LAST_KEY = 'tpLastVerdict';

async function http(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

async function setBadge(score) {
  const text = score != null ? String(Math.max(0, Math.min(100, Math.round(score)))) : '🛡';
  await chrome.action.setBadgeText({ text });
  const color = score >= 65 ? '#b3261e' : score >= 35 ? '#e0a32e' : '#2e7d32';
  await chrome.action.setBadgeBackgroundColor({ color });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'risk') {
        const verdict = await http('/api/risk', { signals: msg.signals });
        await setBadge(verdict.score);
        await chrome.storage.local.set({
          [LAST_KEY]: {
            score: verdict.score,
            level: verdict.action,
            factors: verdict.factors || [],
            page: _sender.tab ? _sender.tab.url : 'unknown',
            ts: Date.now(),
          },
        });
        sendResponse(verdict);
      } else if (msg.type === 'mfaSend') {
        sendResponse(await http('/api/mfa/send', { txnId: msg.txnId }));
      } else if (msg.type === 'mfaVerify') {
        sendResponse(await http('/api/mfa/verify', { txnId: msg.txnId, code: msg.code }));
      } else if (msg.type === 'scanpage') {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return sendResponse({ ok: false, error: 'no active tab' });
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['guardInPage.js'],
        });
        sendResponse({ ok: true });
      } else if (msg.type === 'pagescan') {
        // "Is this payment page safe?" — inject the trust scanner, collect its
        // synchronous report, and auto-attach the block-guard on a red verdict.
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
          await chrome.storage.local.set({ tpLastPageScan: { ...scan, tabId: tab.id } });
          if (scan.isPaymentPage && scan.action === 'challenge') {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['guardInPage.js'],
            }).catch(() => {});
          }
          sendResponse({ ok: true, scan });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
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