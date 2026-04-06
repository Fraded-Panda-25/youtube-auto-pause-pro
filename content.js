/**
 * YouTube Auto-Pause — content.js
 *
 * Pauses all YouTube <video> elements when the tab loses visibility,
 * and resumes them when the tab becomes visible again.
 * Respects a user-controlled enabled/disabled toggle stored in chrome.storage.sync.
 */

(function () {
  'use strict';

  // ─── State ────────────────────────────────────────────────────────────────

  let enabled = true;

  /**
   * Videos that were paused BY US (not already paused by the user).
   * We only resume videos we paused ourselves.
   * @type {Set<HTMLVideoElement>}
   */
  const pausedByUs = new Set();

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Return every <video> present in the page (including inside iframes, best-effort). */
  function getVideos() {
    return Array.from(document.querySelectorAll('video'));
  }

  function pauseAll() {
    getVideos().forEach((video) => {
      if (!video.paused) {
        video.pause();
        pausedByUs.add(video);
      }
    });
  }

  function resumeAll() {
    getVideos().forEach((video) => {
      if (pausedByUs.has(video)) {
        video.play().catch(() => {
          // Autoplay policy may block; silently ignore
        });
        pausedByUs.delete(video);
      }
    });
    // Clean up stale references
    pausedByUs.forEach((video) => {
      if (!document.contains(video)) pausedByUs.delete(video);
    });
  }

  // ─── Visibility handler ───────────────────────────────────────────────────

  function handleVisibilityChange() {
    if (!enabled) return;

    if (document.visibilityState === 'hidden') {
      pauseAll();
    } else {
      resumeAll();
    }
  }

  document.addEventListener('visibilitychange', handleVisibilityChange);

  // ─── Message listener (from popup / background) ───────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'SET_ENABLED') {
      enabled = message.enabled;

      // If the extension was just disabled while tab is hidden, resume all.
      if (!enabled) {
        resumeAll();
      }

      sendResponse({ ok: true, enabled });
    }

    if (message.type === 'GET_STATUS') {
      sendResponse({ enabled, videoCount: getVideos().length });
    }

    return true; // keep message channel open for async sendResponse
  });

  // ─── Initialise from storage ──────────────────────────────────────────────

  chrome.storage.sync.get({ enabled: true }, (result) => {
    enabled = result.enabled;
  });
})();
