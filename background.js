/**
 * YouTube Auto-Pause — background.js (Service Worker)
 *
 * Tracks tab activation and browser window focus changes, and notifies YouTube content scripts
 * so playback can be reliably paused/resumed across windows and desktop app switches.
 */

'use strict';

// ─── Storage Initialization ──────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(['enabled', 'blockPiP']);
  const updates = {};
  if (data.enabled === undefined) updates.enabled = true;
  if (data.blockPiP === undefined) updates.blockPiP = false;

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
});

// ─── Messaging Helper ───────────────────────────────────────────────────────

/**
 * Safely send a message to a specific tab, ignoring errors if content script is unavailable.
 */
async function safeSendMessage(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // Content script not injected or tab closed; ignore safely
  }
}

/**
 * Broadcast tab/window focus state to YouTube tabs.
 */
async function broadcastFocusState() {
  const youtubeTabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
  if (youtubeTabs.length === 0) return;

  const lastFocusedWindow = await chrome.windows.getLastFocused();

  for (const tab of youtubeTabs) {
    const isWindowFocused = lastFocusedWindow && lastFocusedWindow.focused && lastFocusedWindow.id === tab.windowId;
    const isTabActive = tab.active;

    await safeSendMessage(tab.id, {
      type: 'FOCUS_STATE_UPDATE',
      windowFocused: isWindowFocused,
      tabActive: isTabActive
    });
  }
}

// ─── Event Listeners ────────────────────────────────────────────────────────

// Window focus changed (e.g. user Alt+Tabs to another application or window)
chrome.windows.onFocusChanged.addListener(async () => {
  await broadcastFocusState();
});

// Tab activation changed (e.g. user switches tabs within the browser)
chrome.tabs.onActivated.addListener(async () => {
  await broadcastFocusState();
});

// Tab URL update (e.g. tab finishes loading YouTube)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('youtube.com')) {
    await broadcastFocusState();
  }
});
