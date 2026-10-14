/* Applies saved appearance choices before the first paint, so a chosen
   theme or reading size never flashes the default first. Mirrors
   applyPrefs in src/lib/preferences.js. */
(function () {
  try {
    var prefs = JSON.parse(localStorage.getItem("vaelo-preferences") || "null") || {};
    var root = document.documentElement;
    if (prefs.theme === "light" || prefs.theme === "dark") {
      root.dataset.theme = prefs.theme;
      var bar = prefs.theme === "dark" ? "#16110f" : "#f7f2ea";
      var metas = document.querySelectorAll('meta[name="theme-color"]');
      for (var i = 0; i < metas.length; i++) metas[i].content = bar;
    }
    if (prefs.text === "large") root.dataset.text = "large";
    if (prefs.motion === "reduce") root.dataset.motion = "reduce";
    if (prefs.presentation === "minimal") root.dataset.presentation = "minimal";
  } catch (error) {
    /* defaults it is */
  }
})();
