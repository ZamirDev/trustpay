// personas.js — the scripted demo. Each persona carries (a) the signal
// profile the collector should report and (b) a "typing style" for the
// auto-type animation so the judge SEES the difference on screen.

export const PERSONAS = {
  alex: {
    id: 'alex',
    label: 'Alex',
    emoji: '😊',
    blurb: 'known device · gentle typing · normal order',
    device: { seen: true, name: 'Chrome on Windows' },
    typing: { isErratic: false, charsPerMin: 88 },
    form: { pastedCard: false, fillTimeMs: 34000, fieldCount: 6 },
    mouse: { jitterHigh: false },
    net: { vpn: false, countryMismatch: false, ipCountry: 'IN', cardCountry: 'IN' },
    typeStyle: 'gentle',
  },
  shady: {
    id: 'shady',
    label: 'Shady',
    emoji: '😈',
    blurb: 'new device · pasted card · rush + VPN · big order',
    device: { seen: false, name: 'Chrome on Linux' },
    typing: { isErratic: true, charsPerMin: 310 },
    form: { pastedCard: true, fillTimeMs: 2100, fieldCount: 6 },
    mouse: { jitterHigh: true },
    net: { vpn: true, countryMismatch: true, ipCountry: 'DE', cardCountry: 'US' },
    typeStyle: 'rush',
  },
  review: {
    id: 'review',
    label: 'Review',
    emoji: '🟡',
    blurb: 'known device · VPN abroad · rushed form',
    device: { seen: true, name: 'Chrome on Windows' },
    typing: { isErratic: false, charsPerMin: 280 },
    form: { pastedCard: false, fillTimeMs: 12000, fieldCount: 6 },
    mouse: { jitterHigh: false },
    net: { vpn: true, countryMismatch: true, ipCountry: 'SG', cardCountry: 'IN' },
    typeStyle: 'neutral',
  },
};

// Scripted auto-type: fills the given fields in order with persona pacing.
// Returns a Promise resolving when typing finishes.
export async function scriptType(formEl, persona) {
  const fields = ['name', 'card', 'exp', 'cvc'];
  // Force runtime typing facts to match the persona on-screen.
  if (persona.typeStyle === 'gentle') {
    await typeSequence(formEl, fields, { baseGap: 140, jitter: 70, pasteCard: false });
  } else if (persona.typeStyle === 'rush') {
    await typeSequence(formEl, fields, { baseGap: 28, jitter: 14, pasteCard: true });
  } else {
    await typeSequence(formEl, fields, { baseGap: 70, jitter: 40, pasteCard: false });
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function typeSequence(formEl, fieldNames, { baseGap, jitter, pasteCard }) {
  for (const name of fieldNames) {
    const input = formEl.querySelector(`[data-field="${name}"]`);
    if (!input) continue;

    const text =
      name === 'name' ? 'John Alston' :
      name === 'card' ? '4242 4242 4242 4242' :
      name === 'exp' ? '12 / 28' :
      name === 'cvc' ? '737' : '';
    if (!text) continue;

    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    if (name === 'card' && pasteCard) {
      // Shady pastes the card number instead of typing it.
      await sleep(baseGap * 4);
      input.value = text;
      input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: new DataTransfer() }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(baseGap);
      continue;
    }

    for (const ch of text) {
      input.value += ch;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(baseGap + Math.random() * (jitter * 2) - jitter);
    }
  }
}