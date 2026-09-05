// PostHog analytics (web) — mirrors the same one-seam contract as
// data/analytics/PostHogAnalytics.kt on the Android side: everything else on this page
// calls window.Analytics.{identify,reset,track,screen}, never the PostHog SDK directly.
//
// POSTHOG_API_KEY is left blank on purpose until a PostHog project exists — every method
// below silently no-ops while it's blank (no snippet loaded, no failed network calls), so
// this file is safe to ship ahead of that, same "safe before the credential exists"
// reasoning as the Android side's `enabled` guard.
//
// Plain script (not type="module") on purpose — app.js and friends already reach
// supabase-js the same way, via a plain global (see index.html's own comment on why).
(function () {
  var POSTHOG_API_KEY = ""; // fill in once a PostHog project exists
  var POSTHOG_HOST = "https://us.i.posthog.com";

  function noop() {}
  window.Analytics = { identify: noop, reset: noop, track: noop, screen: noop };
  if (!POSTHOG_API_KEY) return;

  // Official posthog-js HTML snippet (posthog.com/docs/libraries/js) — loads the real
  // SDK asynchronously and queues any calls made before it's ready.
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+".people (stub)"}}),o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

  posthog.init(POSTHOG_API_KEY, {
    api_host: POSTHOG_HOST,
    defaults: "2026-05-30",
    // Screen views are sent explicitly via window.Analytics.screen() below — same
    // reasoning as the Android side disabling captureScreenViews.
    capture_pageview: false
  });

  // A super property — attaches to every capture() from here on, so every existing
  // track()/screen() call site gets it for free, and so these pages' events are never
  // confused with the Android app's inside one shared PostHog project (see
  // PostHogAnalytics.kt's registerPlatform(), which registers "android" the same way).
  function registerPlatform() {
    try { posthog.register({ platform: "web" }); } catch (e) {}
  }
  registerPlatform();

  window.Analytics = {
    identify: function (userId, props) { try { posthog.identify(userId, props || {}); } catch (e) {} },
    reset: function () {
      // reset() clears every super property along with the distinct id, so "platform"
      // would silently stop being sent on whatever this tab captures next unless it's
      // re-registered right after — same reasoning as the Android side's reset().
      try { posthog.reset(); } catch (e) {}
      registerPlatform();
    },
    track: function (event, props) { try { posthog.capture(event, props || {}); } catch (e) {} },
    screen: function (name, props) {
      try { posthog.capture("$pageview", Object.assign({ screen_name: name }, props || {})); } catch (e) {}
    }
  };
})();
