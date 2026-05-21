// Acme Portal — small progressive-enhancement script (no dependencies).
(function () {
  "use strict";

  // --- GDPR cookie banner: show only until the visitor has chosen. ---
  function hasConsent() {
    return document.cookie.split(";").some(function (c) {
      return c.trim().indexOf("cookie_consent=") === 0;
    });
  }
  var banner = document.getElementById("cookie-banner");
  if (banner && !hasConsent()) {
    banner.hidden = false;
  }

  // --- Confirm destructive actions before submitting. ---
  document.querySelectorAll("form[data-confirm]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      if (!window.confirm(form.getAttribute("data-confirm"))) {
        e.preventDefault();
      }
    });
  });

  // --- Auto-submit selects (CSP-safe alternative to inline onchange). ---
  document.querySelectorAll("select[data-autosubmit]").forEach(function (select) {
    select.addEventListener("change", function () {
      if (select.form) {
        select.form.submit();
      }
    });
  });
})();
