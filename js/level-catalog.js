// Built-in challenges are available without a browser save. User edits take precedence.
(() => {
  function all() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('ballz-editor-levels') || '{}') || {}; } catch {}
    return { ...(window.BuiltinLevels || {}), ...saved };
  }
  window.LevelCatalog = { all, get: name => all()[name] };
})();
