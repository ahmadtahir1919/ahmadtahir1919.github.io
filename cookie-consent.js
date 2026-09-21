// Shared cookie-consent gate for every page on this site (home, /take/, /join/).
// Lives at the site ROOT and is always referenced by the absolute path
// "/cookie-consent.js" (not a relative one), so the same file works no matter
// which folder the page is in.
//
// Contract for analytics.js (and any other future non-essential script) to
// build on:
//   window.QuizomaConsent.getStatus()      -> "granted" | "denied" | null (undecided)
//   window.QuizomaConsent.onGrant(fn)      -> fn() runs once consent is granted
//                                              (immediately if already granted)
//   window.QuizomaConsent.onRevoke(fn)     -> fn() runs if the visitor later
//                                              switches to "decline" via the
//                                              "Cookie Settings" link
//   window.QuizomaConsent.openSettings()   -> re-opens the banner so the
//                                              visitor can change their choice
//
// Consent is stored in localStorage, which is per-origin — so a choice made
// on any one of home/take/join applies to the other two automatically, no
// banner shown twice.
(function () {
  var KEY = 'quizoma_cookie_consent';
  var grantListeners = [];
  var revokeListeners = [];

  function getStatus() {
    try { return window.localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function setStatus(v) {
    try { window.localStorage.setItem(KEY, v); } catch (e) {}
  }

  window.QuizomaConsent = {
    getStatus: getStatus,
    onGrant: function (fn) {
      if (getStatus() === 'granted') { fn(); } else { grantListeners.push(fn); }
    },
    onRevoke: function (fn) { revokeListeners.push(fn); },
    openSettings: function () { showBanner(true); }
  };

  var styleInjected = false;
  function injectStyle() {
    if (styleInjected) return;
    styleInjected = true;
    var style = document.createElement('style');
    style.textContent =
      '#quizoma-cookie-banner{position:fixed;left:16px;right:16px;bottom:16px;z-index:99999;' +
      'background:#fff;color:#111c2d;border:1px solid #e2e8f0;border-radius:16px;' +
      'box-shadow:0 20px 40px -12px rgba(0,0,0,.25);padding:18px 20px;' +
      'font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;' +
      'max-width:480px;margin:0 auto;display:flex;flex-direction:column;gap:12px;' +
      'box-sizing:border-box;}' +
      '#quizoma-cookie-banner p{margin:0;font-size:13px;line-height:1.5;color:#464555;}' +
      '#quizoma-cookie-banner a{color:#3525cd;font-weight:600;}' +
      '#quizoma-cookie-banner .qc-actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;}' +
      '#quizoma-cookie-banner button{border:none;cursor:pointer;font-weight:700;font-size:13px;' +
      'padding:9px 16px;border-radius:10px;font-family:inherit;}' +
      '#quizoma-cookie-banner .qc-decline{background:#f0f3ff;color:#464555;}' +
      '#quizoma-cookie-banner .qc-accept{background:#3525cd;color:#fff;}';
    document.head.appendChild(style);
  }

  function hideBanner() {
    var el = document.getElementById('quizoma-cookie-banner');
    if (el) el.remove();
  }

  function showBanner(forceReopen) {
    if (document.getElementById('quizoma-cookie-banner')) return;
    if (!forceReopen) {
      var status = getStatus();
      if (status === 'granted' || status === 'denied') return;
    }
    injectStyle();
    var el = document.createElement('div');
    el.id = 'quizoma-cookie-banner';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Cookie preferences');
    el.innerHTML =
      '<p>We use a privacy-friendly analytics cookie to see how Quizoma is used' +
      ' — no ads, no cross-site tracking, no name or email attached.' +
      ' <a href="/privacy/" target="_blank" rel="noopener">Privacy Policy</a></p>' +
      '<div class="qc-actions">' +
      '<button type="button" class="qc-decline">Decline</button>' +
      '<button type="button" class="qc-accept">Accept</button>' +
      '</div>';
    document.body.appendChild(el);
    el.querySelector('.qc-accept').addEventListener('click', function () {
      setStatus('granted');
      hideBanner();
      grantListeners.forEach(function (fn) { try { fn(); } catch (e) {} });
    });
    el.querySelector('.qc-decline').addEventListener('click', function () {
      var wasGranted = getStatus() === 'granted';
      setStatus('denied');
      hideBanner();
      if (wasGranted) revokeListeners.forEach(function (fn) { try { fn(); } catch (e) {} });
    });
  }

  document.addEventListener('DOMContentLoaded', function () { showBanner(false); });
})();
