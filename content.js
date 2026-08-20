/**
 * YouTube Auto-Pause — content.js
 *
 * Automatically pauses YouTube videos when the user leaves the viewing context
 * (tab switch, window switch, or window blur) and resumes playback upon return.
 * Protects manual user pauses, handles YouTube SPA dynamic video elements,
 * and manages Picture-in-Picture (PiP) behavior based on user toggle settings.
 */

(function () {
  'use strict';

  // ─── State ────────────────────────────────────────────────────────────────

  let enabled = true;
  let blockPiP = false;
  let windowFocused = document.hasFocus();
  let tabActive = !document.hidden;

  /** Track videos programmatically paused by this extension */
  const extensionPausedSet = new WeakSet();

  /** Track videos explicitly paused by the user */
  const userPausedSet = new WeakSet();

  /** Track videos with event listeners attached */
  const trackedVideos = new WeakSet();

  /** Guard flag to distinguish extension pause/play from manual user actions */
  let isProcessingAction = false;

  /** Debounce timer for DOM mutations */
  let mutationDebounceTimer = null;

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Determines if the current YouTube tab viewing context is active & focused */
  function isViewingContextActive() {
    return !document.hidden && windowFocused && tabActive;
  }

  /** Get all <video> elements present in the DOM */
  function getVideos() {
    return Array.from(document.querySelectorAll('video'));
  }

  /** Count currently playing videos */
  function getPlayingVideoCount() {
    return getVideos().filter((v) => !v.paused && !v.ended && v.readyState > 2).length;
  }

  /** Safely exit Picture-in-Picture if active */
  function exitPiPIfActive() {
    if (typeof document.exitPictureInPicture === 'function' && document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {
        // Silently catch browser PiP rejection
      });
    }
  }

  /** Attach pause/play/PiP listeners to detect user actions & PiP events */
  function attachVideoListeners(video) {
    if (!video || trackedVideos.has(video)) return;
    trackedVideos.add(video);

    video.addEventListener('pause', () => {
      if (isProcessingAction) return;
      // If paused while context was active, record as explicit user pause
      if (isViewingContextActive()) {
        userPausedSet.add(video);
        extensionPausedSet.delete(video);
      }
    });

    video.addEventListener('play', () => {
      if (isProcessingAction) return;
      // User manually played the video; clear pause records
      userPausedSet.delete(video);
      extensionPausedSet.delete(video);
    });

    // Guard against entering PiP while context is inactive and blockPiP is enabled
    video.addEventListener('enterpictureinpicture', () => {
      if (blockPiP && !isViewingContextActive()) {
        exitPiPIfActive();
      }
    });
  }

  // ─── Core Playback & PiP Reconciliation ────────────────────────────────────

  function reconcilePlaybackState() {
    const videos = getVideos();
    videos.forEach(attachVideoListeners);

    const active = isViewingContextActive();

    // ─── Picture-in-Picture Management ───
    if (blockPiP) {
      if (!active) {
        // Exit active PiP and set disablePictureInPicture attribute on inactive context
        exitPiPIfActive();
        videos.forEach((video) => {
          try { video.disablePictureInPicture = true; } catch {}
        });
      } else {
        // Restore PiP permission when context is active
        videos.forEach((video) => {
          try { video.disablePictureInPicture = false; } catch {}
        });
      }
    } else {
      // Toggle OFF: Do not interfere with PiP functionality
      videos.forEach((video) => {
        try { video.disablePictureInPicture = false; } catch {}
      });
    }

    // ─── Auto-Pause / Resume Management ───
    if (!enabled) return;

    if (!active) {
      // Pause playing videos that were not manually paused by the user
      videos.forEach((video) => {
        if (!video.paused && !userPausedSet.has(video)) {
          isProcessingAction = true;
          try {
            video.pause();
            extensionPausedSet.add(video);
          } catch (err) {
            console.warn('YouTube Auto-Pause: pause error', err);
          } finally {
            isProcessingAction = false;
          }
        }
      });
    } else {
      // Resume videos previously paused by this extension
      videos.forEach((video) => {
        if (video.paused && extensionPausedSet.has(video) && !userPausedSet.has(video)) {
          isProcessingAction = true;
          extensionPausedSet.delete(video);

          try {
            const playPromise = video.play();
            if (playPromise && typeof playPromise.then === 'function') {
              playPromise
                .catch((err) => {
                  console.warn('YouTube Auto-Pause: play promise rejected', err);
                })
                .finally(() => {
                  isProcessingAction = false;
                });
            } else {
              isProcessingAction = false;
            }
          } catch (err) {
            console.warn('YouTube Auto-Pause: play call error', err);
            isProcessingAction = false;
          }
        }
      });
    }
  }

  // ─── Event Handlers ───────────────────────────────────────────────────────

  // Document visibility change (tab switch within browser)
  document.addEventListener('visibilitychange', () => {
    tabActive = !document.hidden;
    reconcilePlaybackState();
  });

  // Window focus & blur fallback
  window.addEventListener('focus', () => {
    windowFocused = true;
    reconcilePlaybackState();
  });

  window.addEventListener('blur', () => {
    windowFocused = false;
    reconcilePlaybackState();
  });

  // YouTube SPA Navigation Events
  const handleSPANavigation = () => {
    setTimeout(() => {
      reconcilePlaybackState();
    }, 300);
  };

  document.addEventListener('yt-navigate-finish', handleSPANavigation);
  document.addEventListener('spadated', handleSPANavigation);
  window.addEventListener('popstate', handleSPANavigation);

  // Dynamic Video Mutation Observer
  const observer = new MutationObserver(() => {
    if (mutationDebounceTimer) clearTimeout(mutationDebounceTimer);
    mutationDebounceTimer = setTimeout(() => {
      reconcilePlaybackState();
    }, 250);
  });

  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });

  // ─── Messaging ────────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'FOCUS_STATE_UPDATE') {
      if (typeof message.windowFocused === 'boolean') windowFocused = message.windowFocused;
      if (typeof message.tabActive === 'boolean') tabActive = message.tabActive;
      reconcilePlaybackState();
      sendResponse({ ok: true });
    } else if (message.type === 'SET_ENABLED') {
      enabled = message.enabled;
      if (!enabled) {
        // If extension is disabled while videos are paused by extension, resume them
        const videos = getVideos();
        videos.forEach((video) => {
          if (extensionPausedSet.has(video)) {
            extensionPausedSet.delete(video);
            video.play().catch(() => {});
          }
        });
      } else {
        reconcilePlaybackState();
      }
      sendResponse({ ok: true, enabled });
    } else if (message.type === 'SET_BLOCK_PIP') {
      blockPiP = message.blockPiP;
      reconcilePlaybackState();
      sendResponse({ ok: true, blockPiP });
    } else if (message.type === 'GET_STATUS') {
      const videos = getVideos();
      sendResponse({
        enabled,
        blockPiP,
        totalVideos: videos.length,
        playingVideos: getPlayingVideoCount(),
        isContextActive: isViewingContextActive()
      });
    }

    return true; // keep async channel open
  });

  // ─── Storage Change Listener ──────────────────────────────────────────────

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      if (changes.enabled) {
        enabled = changes.enabled.newValue;
        if (!enabled) {
          getVideos().forEach((video) => {
            if (extensionPausedSet.has(video)) {
              extensionPausedSet.delete(video);
              video.play().catch(() => {});
            }
          });
        } else {
          reconcilePlaybackState();
        }
      }
      if (changes.blockPiP) {
        blockPiP = changes.blockPiP.newValue;
        reconcilePlaybackState();
      }
    }
  });

  // ─── Initialization ───────────────────────────────────────────────────────

  chrome.storage.local.get({ enabled: true, blockPiP: false }, (result) => {
    enabled = result.enabled;
    blockPiP = result.blockPiP;
    reconcilePlaybackState();
  });
})();
