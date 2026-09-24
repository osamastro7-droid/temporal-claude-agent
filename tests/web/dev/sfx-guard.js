'use strict';
// Loaded before any docs/map script: counts live AudioContexts (OfflineAudioContext is not counted).
(() => {
  window.__acCount = 0;
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const AC = window[name]; if (!AC) continue;
    window[name] = class extends AC { constructor(...a) { super(...a); window.__acCount++; } };
  }
})();
