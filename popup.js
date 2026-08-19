/**
 * popup.js — Extension Popup UI Manager
 *
 * Interacts with chrome.storage.local and current YouTube tab to display:
 * - Active / Disabled toggle state
 * - Count of currently playing videos
 * - Total videos detected on current YouTube page
 * Safe to open on any web page (YouTube or non-YouTube).
 */

'use strict';

const toggle       = document.getElementById('toggle');
const statusText   = document.getElementById('status-text');
const playingCount = document.getElementById('playing-count');
const totalCount   = document.getElementById('total-count');
const statState    = document.getElementById('stat-state');

// ─── UI Helper ────────────────────────────────────────────────────────────

function setUI(enabled) {
  toggle.checked = enabled;

  if (enabled) {
    statusText.textContent = 'Active — pauses on tab/window leave';
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

/** Safely query active tab and fetch status from content script if on YouTube */
async function queryActiveYouTubeTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.includes('youtube.com')) {
      return null;
    }

    return await chrome.tabs.sendMessage(tab.id, { type: 'GET_STATUS' });
  } catch {
    // Content script not ready or non-YouTube tab
    return null;
  }
}

// ─── Initialization ───────────────────────────────────────────────────────

async function init() {
  // Load persisted toggle preference
  const { enabled = true } = await chrome.storage.local.get('enabled');
  setUI(enabled);

  // Fetch status from active tab
  const status = await queryActiveYouTubeTab();
  if (status) {
    playingCount.textContent = status.playingVideos !== undefined ? status.playingVideos : '0';
    totalCount.textContent   = status.totalVideos !== undefined ? status.totalVideos : '0';
    setUI(status.enabled);
  } else {
    playingCount.textContent = '—';
    totalCount.textContent   = '—';
  }
}

// ─── Event Listeners ───────────────────────────────────────────────────────

toggle.addEventListener('change', async () => {
  const enabled = toggle.checked;
  setUI(enabled);

  // Persist preference to storage (broadcasts to content scripts automatically)
  await chrome.storage.local.set({ enabled });

  // Explicitly inform current tab if available
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && tab.url?.includes('youtube.com')) {
      await chrome.tabs.sendMessage(tab.id, { type: 'SET_ENABLED', enabled });
    }
  } catch {
    // Tab messaging failure handled silently
  }
});

// Boot popup
init();
