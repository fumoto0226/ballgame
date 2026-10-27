// Published levels ship with the site; editor drafts never override them.
(() => {
  function all() { return { ...(window.BuiltinLevels || {}) }; }
  function editorLevels() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('ballz-editor-levels') || '{}') || {}; } catch {}
    return { ...all(), ...saved };
  }
  window.LevelCatalog = { all, get: name => all()[name], editorLevels };
})();
