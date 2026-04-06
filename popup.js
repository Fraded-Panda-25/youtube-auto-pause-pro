/**
 * popup.js — Handles the extension popup UI logic.
 *
 * - Reads the current enabled state from chrome.storage.sync
 * - Queries the active YouTube tab for live video count
 * - Updates the toggle and stats displays
 * - Persists toggle changes to storage and messages the content script
 */

const toggle     = document.getElementById('toggle');
const statusText = document.getElementById('status-text');
const videoCount = document.getElementById('video-count');
const statState  = document.getElementById('stat-state');

// ─── Helpers ──────────────────────────────────────────────────────────────

function setUI(enabled) {
  toggle.checked = enabled;

  if (enabled) {
    statusText.textContent = 'Active — pauses on tab switch';
    statusText.className   = 'toggle-desc state-active';
    statState.textContent  = 'ON';
    statState.className    = 'stat-value state-active';
  } else {
    statusText.textContent = 'Disabled — videos play normally';
    statusText.className   = 'toggle-desc state-inactive';
    statState.textContent  = 'OFF';
    statState.className    = 'stat-value state-disabled';
  }
}

/** Send a message to the content script in the active YouTube tab. */
async function sendToYouTubeTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url?.includes('youtube.com')) return null;

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    // Content script not injected yet (e.g. page just opened)
    return null;
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────

async function init() {
  // Load persisted preference
  const { enabled = true } = await chrome.storage.sync.get('enabled');
  setUI(enabled);

  // Query live status from content script
  const status = await sendToYouTubeTab({ type: 'GET_STATUS' });
  if (status) {
    videoCount.textContent = status.videoCount;
    setUI(status.enabled);
  } else {
    videoCount.textContent = '—';
  }
}

// ─── Toggle handler ───────────────────────────────────────────────────────

toggle.addEventListener('change', async () => {
  const enabled = toggle.checked;
  setUI(enabled);

  // Persist
  await chrome.storage.sync.set({ enabled });

  // Inform content script
  await sendToYouTubeTab({ type: 'SET_ENABLED', enabled });
});

// ─── Boot ─────────────────────────────────────────────────────────────────
init();
