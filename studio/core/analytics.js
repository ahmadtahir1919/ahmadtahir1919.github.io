// PostHog for the Studio — the same project, key and consent gate as the public site
// (deploy/take/analytics.js, deploy/home/analytics.js), so a creator's path from the home page
// into the Studio and on to a published quiz is one funnel.
//
// Every event carries platform: "web" (as the take page's do) and surface: "studio", so Studio
// activity can be told apart from quiz takers on the web and from the Android app. Event names
// follow the app's AnalyticsEvent.kt where the action is the same (quiz_created,
// quiz_published, …).
//
// Privacy, the same promises as the take page:
//   - nothing loads, let alone captures, until the visitor accepts the cookie banner
//     (/cookie-consent.js, shared with the rest of the site; a choice made there applies here);
//   - no autocapture, no session recording: only the explicit events below;
//   - identify() sends the account id only, never a name or email;
//   - URLs lose their #fragment and token-like query parameters before they leave (Google
//     sign-in's redirect lands with #access_token=… in the address bar).
//
// Off everywhere but the live /studio/: the local dev server and the fake-backend test pages
// never load PostHog, so testing never pollutes the funnel.

import { BASE } from "./paths.js";

const POSTHOG_API_KEY = "phc_uT6HjPYV4TLQ452NHGEuABxHuC6KUDfBQtHXHebhj2wm";
const POSTHOG_HOST = "https://us.i.posthog.com";
const SUPER_PROPS = { platform: "web", surface: "studio" };

const LIVE = typeof window !== "undefined" && BASE === "/studio/";

// Calls made before consent wait here and go out once it's granted; dropped if it never is.
const pending = [];
const PENDING_MAX = 30;
let posthog = null;

function send(fn) {
  if (!LIVE) return;
  if (posthog) {
    try { fn(posthog); } catch (e) { /* analytics never breaks the page */ }
  } else if (pending.length < PENDING_MAX) {
    pending.push(fn);
  }
}

/** The signed-in creator (account id only). */
export function identify(userId) {
  if (userId) send((ph) => ph.identify(userId));
}

/** Signing out: a fresh anonymous id, super properties put back. */
export function reset() {
  send((ph) => {
    ph.reset();
    ph.register(SUPER_PROPS);
  });
}

export function track(event, props = {}) {
  send((ph) => ph.capture(event, props));
}

/** A Studio page view, named like the app's screens ("studio_dashboard", …). */
export function screen(name, props = {}) {
  send((ph) => ph.capture("$pageview", { screen_name: name, ...props }));
}

/** Which Studio page this is, from the path under BASE: "" → dashboard, "create/" → create. */
export function currentPageName() {
  if (typeof window === "undefined") return "unknown";
  const rest = window.location.pathname.slice(BASE.length).split("/")[0];
  return `studio_${rest || "dashboard"}`;
}

const TOKEN_PARAMS = /^(access_token|refresh_token|provider_token|provider_refresh_token|id_token|token|code_verifier)$/i;

function cleanUrl(url) {
  if (typeof url !== "string" || !url.includes("://")) return url;
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (TOKEN_PARAMS.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url.split("#")[0];
  }
}

function scrub(event) {
  for (const bag of [event?.properties, event?.$set, event?.$set_once]) {
    if (!bag) continue;
    for (const k of Object.keys(bag)) if (/url|referrer/i.test(k)) bag[k] = cleanUrl(bag[k]);
  }
  return event;
}

function loadPostHog() {
  if (posthog) return;
  // Official posthog-js HTML snippet (posthog.com/docs/libraries/js), unchanged.
  /* eslint-disable */
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+".people (stub)"}}),o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
  /* eslint-enable */
  window.posthog.init(POSTHOG_API_KEY, {
    api_host: POSTHOG_HOST,
    defaults: "2026-05-30",
    capture_pageview: false,
    capture_pageleave: false,
    autocapture: false,
    disable_session_recording: true,
    before_send: scrub,
  });
  window.posthog.register(SUPER_PROPS);
  posthog = window.posthog;
  for (const fn of pending.splice(0)) send(fn);
}

function onRevoke() {
  try { posthog?.opt_out_capturing(); } catch (e) { /* nothing to stop */ }
  posthog = null;
  pending.length = 0;
}

function wireConsent() {
  window.QuizomaConsent.onGrant(loadPostHog);
  window.QuizomaConsent.onRevoke(onRevoke);
}

// The consent gate lives at the site root on the live site (/cookie-consent.js). Loaded here
// rather than from each Studio page's HTML, so the local dev server, which has no such file,
// never asks.
if (LIVE) {
  if (window.QuizomaConsent) {
    wireConsent();
  } else {
    const s = document.createElement("script");
    s.src = "/cookie-consent.js";
    s.onload = () => window.QuizomaConsent && wireConsent();
    document.head.appendChild(s);
  }
}
