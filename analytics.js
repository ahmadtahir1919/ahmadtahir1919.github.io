// PostHog analytics (web) — same one-seam contract as deploy/take/analytics.js
// and the Android side's PostHogAnalytics.kt: everything else on this page calls
// window.Analytics.{identify,reset,track,screen}, never the PostHog SDK directly.
//
// Same project/key as deploy/take and deploy/join, so the home page's visits and
// CTA clicks show up in the same funnel as the rest of the product.
//
// Plain script (not type="module") on purpose — matches every other page.
(function () {
  var POSTHOG_API_KEY = "phc_uT6HjPYV4TLQ452NHGEuABxHuC6KUDfBQtHXHebhj2wm";
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
    // Screen view is sent explicitly via window.Analytics.screen() below.
    capture_pageview: false,
    // Only the explicit track()/screen() calls below — never autocaptured clicks,
    // input text, or session recordings. This is a public marketing page (no quiz
    // content or answers ever pass through it), but we keep the same conservative
    // defaults as every other page for consistency.
    autocapture: false,
    disable_session_recording: true,
    capture_pageleave: false
  });

  // Same super property as take/join and the Android app — keeps this page's
  // events distinguishable inside the one shared PostHog project.
  function registerPlatform() {
    try { posthog.register({ platform: "web" }); } catch (e) {}
  }
  registerPlatform();

  window.Analytics = {
    identify: function (userId, props) { try { posthog.identify(userId, props || {}); } catch (e) {} },
    reset: function () {
      try { posthog.reset(); } catch (e) {}
      registerPlatform();
    },
    track: function (event, props) { try { posthog.capture(event, props || {}); } catch (e) {} },
    screen: function (name, props) {
      try { posthog.capture("$pageview", Object.assign({ screen_name: name }, props || {})); } catch (e) {}
    }
  };
})();
