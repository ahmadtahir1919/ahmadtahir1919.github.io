// Account control for the static site pages (home, and any other page that drops in a
// #account-slot). Plain non-module script attached to window, same shape as its
// neighbour cookie-consent.js — every page loads both by absolute path from the root.
//
// ── Why this file does not just load supabase-js ────────────────────────────
// The home page was deliberately tuned for first paint (self-hosted woff2 instead of a
// render-blocking Google Fonts stylesheet, icons shrunk from 66 KB to 3 KB). Pulling in
// the ~60 KB supabase UMD bundle on every visit, purely to decide whether to draw an
// avatar, would hand a chunk of that back for a decoration in the corner.
//
// So the FIRST PAINT reads the session straight out of localStorage — no network, no
// bundle — and the bundle is injected only when the visitor actually clicks Sign in or
// Sign out. That storage key is a supabase-js internal, so every read here fails CLOSED:
// anything unexpected renders the plain "Sign in" button, which is both harmless and
// self-correcting the moment they click it.
//
// ── Why the session is shared with /take/ ───────────────────────────────────
// None of this synchronises anything. supabase-js persists its session in localStorage
// under a key derived from the project ref, and localStorage is per-origin — so the
// session written by /take/ (deploy/take/supabase-client.js) and the one written here
// are the same entry. Signing in on either page signs you in on both. That is the whole
// mechanism; it only works as long as both files point at the same project below.
(function () {
  "use strict";

  // MUST match deploy/take/supabase-client.js — a publishable anon key, already visible
  // in the shipped bundle, but the duplication is a real drift risk: change one, change
  // both, or the two pages quietly stop sharing a session.
  var SUPABASE_URL = "https://zorkzqyazigqucskseyp.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_wD6qD3zEVnyYV1-TROtMgQ_XlQK9uT9";
  var SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
  // supabase-js derives this from the project ref in the URL above.
  var STORAGE_KEY = "sb-zorkzqyazigqucskseyp-auth-token";

  var TEXT = {
    signIn: "Sign in",
    signingIn: "Signing in…",
    menu: "Account menu",
    editName: "Edit name",
    signOut: "Sign out",
  };

  var slots = [];
  var client = null;

  // ── Session, read without the library ─────────────────────────────────────

  /** The persisted user, or null. Never throws: a shape this doesn't recognise is
   *  treated as signed out rather than breaking the page it's mounted on. */
  function storedUser() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      // v2 stores the session object directly; older//wrapped shapes nest it under
      // currentSession. Accept either, reject anything without a user.
      var session = parsed && parsed.currentSession ? parsed.currentSession : parsed;
      var user = session && session.user;
      return user && user.id ? user : null;
    } catch (e) {
      return null;
    }
  }

  /** Same precedence as resolveDisplayName in deploy/take/supabase-client.js — the two
   *  must agree, or the name in this menu differs from the one on the quiz screen. */
  function displayName(user) {
    var meta = (user && user.user_metadata) || {};
    return meta.full_name || meta.name || (user && user.email) || "";
  }

  /** "Muhammad Ahmed Tahir" -> "MT", "Ahmad" -> "A", "" -> "?".
   *  Mirrors initialsOf() in deploy/take/app.js. */
  function initialsOf(name) {
    var words = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "?";
    var last = words.length > 1 ? words[words.length - 1][0] : "";
    return (words[0][0] + last).toUpperCase();
  }

  // ── The library, loaded only when an action needs it ──────────────────────

  function loadSupabase() {
    if (window.supabase) return Promise.resolve(window.supabase);
    return new Promise(function (resolve, reject) {
      var tag = document.createElement("script");
      tag.src = SUPABASE_CDN;
      tag.onload = function () {
        window.supabase ? resolve(window.supabase) : reject(new Error("supabase absent after load"));
      };
      tag.onerror = function () { reject(new Error("supabase failed to load")); };
      document.head.appendChild(tag);
    });
  }

  function getClient() {
    if (client) return Promise.resolve(client);
    return loadSupabase().then(function (lib) {
      client = lib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      return client;
    });
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  function signIn(button) {
    button.disabled = true;
    button.textContent = TEXT.signingIn;
    if (window.Analytics) window.Analytics.track("sign_in_started", { location: "site_header" });
    getClient().then(function (c) {
      return c.auth.signInWithOAuth({
        provider: "google",
        // The site root, NOT window.location.pathname.
        //
        // The project's Redirect URL allow list is currently "https://quizoma.com/take/*"
        // only. Supabase sends anything outside that list to the configured Site URL
        // instead — which is exactly https://quizoma.com — so asking for the root is the
        // one request that is honoured rather than silently rewritten. Asking for
        // /features/ would bounce the visitor to the home page with no explanation.
        //
        // That tight allow list is a deliberate security control (it is what stops a
        // crafted redirectTo from delivering someone's token to another domain), so it
        // is left alone here. To return people to the page they signed in FROM, add
        // "https://quizoma.com/**" to the allow list in the Supabase dashboard — still
        // same-origin, still safe — and then this can use window.location.pathname.
        options: { redirectTo: window.location.origin + "/" },
      });
    }).catch(function () {
      // CDN blocked, offline, OAuth refused — put the button back rather than leaving a
      // dead "Signing in…" that never resolves.
      button.disabled = false;
      button.textContent = TEXT.signIn;
    });
  }

  function signOut() {
    // Ordering mirrors signOutAction() in deploy/take/app.js: the event must still land
    // under the outgoing identity, because reset() rotates the distinct id.
    if (window.Analytics) {
      window.Analytics.track("signed_out", { location: "site_header" });
      window.Analytics.reset();
    }
    getClient()
      .then(function (c) { return c.auth.signOut(); })
      .catch(function () {
        // Even if the network call fails, drop the local session so the UI is honest.
        try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      })
      .then(renderAll);
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  var openSlot = null; // at most one menu open across all mounted slots

  function renderSlot(slot) {
    var user = storedUser();
    slot.innerHTML = "";
    slot.classList.toggle("is-signed-in", !!user);

    if (!user) {
      var signInBtn = document.createElement("button");
      signInBtn.type = "button";
      signInBtn.className = "account-signin";
      signInBtn.textContent = TEXT.signIn;
      signInBtn.addEventListener("click", function () { signIn(signInBtn); });
      slot.appendChild(signInBtn);
      return;
    }

    var name = displayName(user);
    var avatar = document.createElement("button");
    avatar.type = "button";
    avatar.className = "account-avatar";
    avatar.title = name;
    avatar.setAttribute("aria-label", TEXT.menu);
    avatar.setAttribute("aria-haspopup", "menu");
    avatar.setAttribute("aria-expanded", String(openSlot === slot));
    avatar.textContent = initialsOf(name);
    avatar.addEventListener("click", function (e) {
      // Without this the click reaches the document listener below and closes the menu
      // in the same tick it opened.
      e.stopPropagation();
      openSlot = openSlot === slot ? null : slot;
      renderAll();
    });
    slot.appendChild(avatar);

    if (openSlot !== slot) return;

    var menu = document.createElement("div");
    menu.className = "account-menu";
    menu.setAttribute("role", "menu");
    menu.addEventListener("click", function (e) { e.stopPropagation(); });

    var head = document.createElement("div");
    head.className = "account-menu-head";
    var nameEl = document.createElement("span");
    nameEl.className = "account-menu-name";
    nameEl.textContent = name;
    head.appendChild(nameEl);
    // A second line only when it says something the first doesn't — an account with no
    // full name set already shows its email as the name.
    if (user.email && user.email !== name) {
      var emailEl = document.createElement("span");
      emailEl.className = "account-menu-email";
      emailEl.textContent = user.email;
      head.appendChild(emailEl);
    }
    menu.appendChild(head);

    // This page has no name editor; /take/ does, and honours ?edit=name (see the
    // wantsNameEdit branch in deploy/take/app.js boot()).
    var edit = document.createElement("a");
    edit.className = "account-menu-item";
    edit.setAttribute("role", "menuitem");
    edit.href = "/take/?edit=name";
    edit.textContent = TEXT.editName;
    menu.appendChild(edit);

    var out = document.createElement("button");
    out.type = "button";
    out.className = "account-menu-item danger";
    out.setAttribute("role", "menuitem");
    out.textContent = TEXT.signOut;
    out.addEventListener("click", function () { openSlot = null; signOut(); });
    menu.appendChild(out);

    slot.appendChild(menu);
  }

  function renderAll() {
    slots.forEach(renderSlot);
  }

  // ── Mount ─────────────────────────────────────────────────────────────────

  function mount(slot) {
    if (!slot || slots.indexOf(slot) !== -1) return;
    slots.push(slot);
    renderSlot(slot);
  }

  function init() {
    // The OAuth redirect comes back with #access_token=... in the address bar. Nothing
    // here reads it — supabase-js already wrote the session to localStorage on the /take/
    // side, and on this page detectSessionInUrl runs whenever getClient() first fires.
    // Strip it so the token stops sitting visibly in the URL and Back doesn't re-enter
    // the OAuth hop, the same cleanup deploy/take/app.js does after boot.
    if (window.location.hash && window.location.hash.indexOf("access_token") !== -1) {
      // The session is in the fragment, not storage, until the library parses it — so
      // load it once here before wiping the only copy.
      getClient()
        .then(function (c) { return c.auth.getSession(); })
        .catch(function () {})
        .then(function () {
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
          renderAll();
        });
    }

    Array.prototype.forEach.call(document.querySelectorAll("[data-account-slot]"), mount);

    document.addEventListener("click", function () {
      if (!openSlot) return;
      openSlot = null;
      renderAll();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || !openSlot) return;
      openSlot = null;
      renderAll();
    });
    // Signing out in another tab writes the same storage key — follow it rather than
    // showing a stale avatar until reload.
    window.addEventListener("storage", function (e) {
      if (e.key === STORAGE_KEY) renderAll();
    });
  }

  window.QuizomaAccount = { mount: mount, refresh: renderAll };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
