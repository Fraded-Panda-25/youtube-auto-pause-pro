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
  let isWindowFocused = document.hasFocus();
  let isTabActive = !document.hidden;

  /** Track videos programmatically paused by this extension */
  const extensionPausedSet = new WeakSet();

  /** Track videos explicitly paused by the user */
  const userPausedSet = new WeakSet();

  /** Handshake tracking for extension-initiated pauses */
  const programmaticPauseSet = new WeakSet();

  /** Handshake tracking for extension-initiated play calls */
  const programmaticPlaySet = new WeakSet();

  /** Track videos with event listeners attached */
  const trackedVideos = new WeakSet();

  /** Debounce timer for DOM mutations */
  let mutationDebounceTimer = null;

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Determines if the current YouTube tab viewing context is active.
   * A context is active if the tab is visible, tab is active, and the browser window is focused.
   */
  function isViewingContextActive() {
    return !document.hidden && isTabActive && isWindowFocused;
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

  /** Pause helper executing both HTMLMediaElement and YouTube Player API calls */
  function pauseVideoElement(video) {
    programmaticPauseSet.add(video);
    extensionPausedSet.add(video);
    try {
      video.pause();
    } catch (err) {
      programmaticPauseSet.delete(video);
      extensionPausedSet.delete(video);
      console.warn('YouTube Auto-Pause: pause error', err);
    }

    try {
      const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      if (player && typeof player.pauseVideo === 'function') {
        player.pauseVideo();
      }
    } catch {
      // Ignore player API errors
    }
  }

  /** Play helper executing both HTMLMediaElement and YouTube Player API calls */
  function playVideoElement(video) {
    programmaticPlaySet.add(video);
    extensionPausedSet.delete(video);

    try {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise.catch((err) => {
          extensionPausedSet.add(video);
          programmaticPlaySet.delete(video);
          console.warn('YouTube Auto-Pause: play promise rejected', err);
        });
      }
    } catch (err) {
      extensionPausedSet.add(video);
      programmaticPlaySet.delete(video);
      console.warn('YouTube Auto-Pause: play call error', err);
    }

    try {
      const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      if (player && typeof player.playVideo === 'function') {
        player.playVideo();
      }
    } catch {
      // Ignore player API errors
    }
  }

  /** Attach pause/play/PiP listeners to detect user actions & PiP events */
  function attachVideoListeners(video) {
    if (!video || trackedVideos.has(video)) return;
    trackedVideos.add(video);

    video.addEventListener('pause', () => {
      // If pause was initiated by extension, consume handshake flag
      if (programmaticPauseSet.has(video)) {
        programmaticPauseSet.delete(video);
        return;
      }

      // If paused while viewing context was active and not extension-driven, record manual user pause
      if (isViewingContextActive()) {
        userPausedSet.add(video);
        extensionPausedSet.delete(video);
      }
    });

    video.addEventListener('play', () => {
      // If play was initiated by extension, consume handshake flag
      if (programmaticPlaySet.has(video)) {
        programmaticPlaySet.delete(video);
      }
      // User manually played the video
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
    // Keep DOM states in sync
    if (document.hidden) {
      isTabActive = false;
    }

    const videos = getVideos();
    videos.forEach(attachVideoListeners);

    const active = isViewingContextActive();

    // ─── Picture-in-Picture Management ───
    if (blockPiP) {
      if (!active) {
        exitPiPIfActive();
        videos.forEach((video) => {
          try {
            if (!video.disablePictureInPicture) video.disablePictureInPicture = true;
          } catch {}
        });
      } else {
        videos.forEach((video) => {
          try {
            if (video.disablePictureInPicture) video.disablePictureInPicture = false;
          } catch {}
        });
      }
    } else {
      videos.forEach((video) => {
        try {
          if (video.disablePictureInPicture) video.disablePictureInPicture = false;
        } catch {}
      });
    }

    // ─── Auto-Pause / Resume Management ───
    if (!enabled) return;

    if (!active) {
      // Pause playing videos that were not manually paused by the user
      videos.forEach((video) => {
        if (!video.paused) {
          userPausedSet.delete(video);
        }

        if (!video.paused && !userPausedSet.has(video)) {
          pauseVideoElement(video);
        }
      });
    } else {
      // Resume videos previously paused by this extension
      videos.forEach((video) => {
        if (video.paused && extensionPausedSet.has(video) && !userPausedSet.has(video)) {
          playVideoElement(video);
        }
      });
    }
  }

  // ─── Synchronous Event Handlers ───────────────────────────────────────────

  // Document visibility change (tab switch within browser) - executed SYNCHRONOUSLY to prevent 4s background throttling
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      isTabActive = false;
      reconcilePlaybackState();
    } else {
      isTabActive = true;
      isWindowFocused = true;
      reconcilePlaybackState();
    }
  });

  // Window focus & blur
  window.addEventListener('focus', () => {
    isWindowFocused = true;
    isTabActive = !document.hidden;
    reconcilePlaybackState();
  });

  window.addEventListener('blur', () => {
    isWindowFocused = document.hasFocus();
    reconcilePlaybackState();
  });

  // YouTube SPA Navigation Events
  const handleSPANavigation = () => {
    reconcilePlaybackState();
    setTimeout(() => {
      reconcilePlaybackState();
    }, 200);
  };

  document.addEventListener('yt-navigate-finish', handleSPANavigation);
  document.addEventListener('spadated', handleSPANavigation);
  window.addEventListener('popstate', handleSPANavigation);

  // Dynamic Video Mutation Observer
  const observer = new MutationObserver(() => {
    if (mutationDebounceTimer) clearTimeout(mutationDebounceTimer);
    mutationDebounceTimer = setTimeout(() => {
      reconcilePlaybackState();
    }, 100);
  });

  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });

  // ─── Messaging ────────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'FOCUS_STATE_UPDATE') {
      if (typeof message.windowFocused === 'boolean') {
        isWindowFocused = message.windowFocused;
      }
      if (typeof message.tabActive === 'boolean') {
        isTabActive = message.tabActive;
      }
      // Execute reconciliation synchronously on background IPC dispatch
      reconcilePlaybackState();
      sendResponse({ ok: true });
    } else if (message.type === 'SET_ENABLED') {
      enabled = message.enabled;
      if (!enabled) {
        // If extension is disabled while videos are paused by extension, resume them
        const videos = getVideos();
        videos.forEach((video) => {
          if (extensionPausedSet.has(video)) {
            playVideoElement(video);
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
              playVideoElement(video);
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
