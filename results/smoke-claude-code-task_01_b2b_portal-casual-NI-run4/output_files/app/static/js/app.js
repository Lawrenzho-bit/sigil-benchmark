/* Sigil Portal — progressive enhancement only.
 *
 * The portal works without JavaScript; this file adds the cookie-consent
 * banner and a couple of confirmation prompts. It is served same-origin so
 * the strict Content-Security-Policy (script-src 'self') needs no exception.
 */
(function () {
  "use strict";

  // --- Cookie consent ------------------------------------------------------
  // The portal sets only strictly-necessary cookies, so consent is an
  // acknowledgement. The choice is stored in localStorage, not a cookie.
  var CONSENT_KEY = "sigil.cookie-consent";
  var banner = document.getElementById("cookie-banner");

  if (banner && !localStorage.getItem(CONSENT_KEY)) {
    banner.hidden = false;
  }

  if (banner) {
    banner.addEventListener("click", function (event) {
      var action = event.target.getAttribute("data-cookie-action");
      if (!action) return;
      localStorage.setItem(CONSENT_KEY, action);
      banner.hidden = true;
    });
  }

  // --- Confirm destructive actions ----------------------------------------
  // Any form with data-confirm asks before submitting.
  document.querySelectorAll("form[data-confirm]").forEach(function (form) {
    form.addEventListener("submit", function (event) {
      if (!window.confirm(form.getAttribute("data-confirm"))) {
        event.preventDefault();
      }
    });
  });
})();
