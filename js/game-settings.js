// Saved preset 001 is the shared default for every level.
(() => {
  const defaultName = '001';
  function saved() {
    try { return JSON.parse(localStorage.getItem('ballz-editor-settings') || '{}')[defaultName] || null; }
    catch { return null; }
  }
  function apply(settings) {
    if (!settings) return;
    if (Array.isArray(settings.palette) && settings.palette.length)
      BallzPalette.anchors.splice(0, BallzPalette.anchors.length, ...structuredClone(settings.palette));
    if (settings.tiers) Object.assign(BlockGeometry.tiers, structuredClone(settings.tiers));
  }
  window.GameSettings = { defaultName, saved, apply };
})();
