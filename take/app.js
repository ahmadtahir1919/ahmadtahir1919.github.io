// ============================================================================
// Web quiz-taking — mirrors ui/preview/QuizPreviewViewModel.kt's flow: load,
// per-question timer, answer, (optional) instant feedback, advance, score,
// submit. Poll rendering lands in a later pass (see the plan); it currently
// shows a "not available on web yet" placeholder with Skip. Fill Blank mirrors
// the app's inline sentence design exactly (see FillBlankQuestionBody.kt).
// ============================================================================

// Same palette as ui/theme/QuizThemeColors.kt — keep in sync if it changes.
const QUIZ_THEME_COLORS = {
  Indigo: "#4F46E5", Forest: "#16A34A", Crimson: "#DC2626", Teal: "#0F766E",
  Amber: "#D97706", Rose: "#BE185D", Sky: "#0284C7", Violet: "#7C3AED",
  Orange: "#EA580C", Cyan: "#0891B2",
};
function themeColorFromName(name) {
  return QUIZ_THEME_COLORS[name] || QUIZ_THEME_COLORS.Indigo;
}

const app = document.getElementById("app");

// A missing global here (evaluator.js/supabase-client.js failed to load or
// threw during init — e.g. the Supabase CDN script was blocked/slow) used to
// throw right here and leave the whole page blank with nothing on screen and
// no clue why. Show it instead of silently dying.
// strings.js is included in this guard too: every user-facing word on the page comes
// from it, so a page that loaded without it would render blank labels everywhere. The
// two failure messages below stay inline literals on purpose — they are the LAST
// resort, shown precisely when the string table may be the thing that failed to load.
if (!window.Evaluator || !window.SupabaseClient || !window.FillBlank || !window.Poll || !window.S) {
  app.innerHTML =
    '<div style="padding:24px;font-family:sans-serif;color:#DC2626">' +
    "<b>Couldn't load this page.</b><br><br>" +
    "A required script failed to load (often a slow/blocked connection to the Supabase library CDN). " +
    "Please check your connection and reload the page." +
    "</div>";
  throw new Error("Quizoma web: required globals missing (Evaluator/SupabaseClient/FillBlank/Poll/S) — aborting boot.");
}
if (window.SupabaseClient.initError) {
  app.innerHTML =
    '<div style="padding:24px;font-family:sans-serif;color:#DC2626">' +
    "<b>Couldn't connect.</b><br><br>" +
    window.SupabaseClient.initError.message +
    "</div>";
  throw new Error("Quizoma web: Supabase client failed to initialize — aborting boot.");
}

const { evaluate, computeScore, defaultAnswerRule } = window.Evaluator;
const S = window.S;
const SC = window.SupabaseClient;
const FB = window.FillBlank;
const PL = window.Poll;

const params = new URLSearchParams(window.location.search);
const shareCode = (params.get("code") || "").toUpperCase();
// The home page's account menu links here as /take/?edit=name — it has no name editor
// of its own, so it delegates to this app's confirm-name screen. See boot().
const wantsNameEdit = params.get("edit") === "name";
// A state.nameEditReturn value that means "leave this app entirely and go back to the
// site root" rather than naming one of this app's own screens. Only the home page's
// deep link uses it; see finishNameEdit.
const HOME_RETURN = "__home__";

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  screen: "loading", // loading | landing | confirmName | quiz | finishing | result | error
  errorMessage: "",
  quiz: null,
  user: null,
  existingAttempt: null, // latest real attempt this user already has for this quiz, or null
  currentIndex: 0,
  selectedAnswers: new Set(), // index-strings, same convention as the Kotlin VM
  writtenAnswer: "",
  fillBlankDraft: [], // FILL_BLANK only — one entry per blank, in template order
  // POLL only — mirrors QuizPreviewUiState's poll* fields.
  pollState: null, // { status, opened_at, closes_at } | null
  pollDisplayOrder: [], // shuffled option indices, "Other" excluded (always last)
  pollSelected: new Set(), // numeric option indices, PL.POLL_OTHER_INDEX for "Other"
  pollOtherText: "",
  pollReasonText: "",
  pollHasVoted: false,
  pollDistribution: null, // set once closed OR once this voter has cast a vote
  pollConsensus: null,
  pollEditingVote: false, // true while a "Change vote" tap has reopened voting (allowVoteChange)
  secondsRemaining: 0,
  totalTimeSec: 0,
  timerHandle: null,
  autoFinishHandle: null, // setTimeout id — LAST question only, once it's been answered
  // Question preview (quiz.questionPreviewSec): the question shows on its own first, with
  // no choices and no clock — mirrors QuizPreviewUiState.revealingQuestion.
  // "Move on without answering?" — raised by the Next/Finish button only, and cleared by
  // advance(). Deliberately NOT window.confirm(): that blocks the main thread, which froze
  // the countdown behind it (free thinking time) and then let the queued interval tick and
  // the confirmed onNext() both call advance(). Mirrors QuizPreviewUiState.showSkipConfirm.
  skipConfirmOpen: false,
  // Mirrors QuizPreviewUiState.isFinishing (L-02) — see advance()'s guard.
  isFinishing: false,
  revealing: false,
  revealHandle: null, // setTimeout id ending the preview
  revealStartedAt: 0, // epoch ms — keeps the fill bar continuous across re-renders
  revealJustEnded: false, // one render: the card settles up and the choices animate in
  questionStartSec: 0,
  questionAnswers: {}, // questionId -> raw keys (index-strings / written text)
  questionTimings: {}, // questionId -> seconds
  instantFeedback: null,
  hintVisible: false, // current question's hint panel open/closed
  hintUsed: {}, // questionId -> true once its hint was opened (sticky, unlike hintVisible)
  result: null, // { score, total, answers }
  landingTickerHandle: null, // ticks the Scheduled-quiz countdown on the landing card
  hasJoined: false, // Join clicked (and joined_quizzes recorded) this session — gates Start Quiz
  // joined_quizzes.last_started_at for this account (epoch ms) or null. With no
  // existingAttempt it means "started, left without submitting" — see renderLanding.
  lastStartedAt: null,
  joinError: null,
  joining: false,
  // Admin maintenance switches (see SC.fetchFeatureFlags) — fetched once in boot() and
  // fails open, so an unreached/erroring flags call never blocks a genuine join.
  flags: { joinQuizEnabled: true },
  // Desktop layout toggle (the header's first button). false = wide, which is the
  // default; see readCompactView for why it starts out of localStorage.
  compactView: false,
  accountMenuOpen: false, // header avatar's dropdown — see buildAccountControl
  // Which screen to return to when the confirm-name screen is entered as an EDIT from
  // the account menu. null means the original first-login gate, whose only exit is
  // signing out — see cancelConfirmName.
  nameEditReturn: null,
};

// Fires window.Analytics.screen() once per genuine screen change, not once per
// re-render (render() is called far more often than state.screen actually changes —
// e.g. every keystroke while typing a written answer) — same "one event per
// destination change" granularity as AppNavHost.kt on the Android side.
let lastTrackedScreen = null;

function render() {
  if (state.screen !== lastTrackedScreen) {
    lastTrackedScreen = state.screen;
    window.Analytics.screen(state.screen);
  }
  // The landing countdown ticker only makes sense while its own card is on screen —
  // torn down the moment anything else renders, so it can never re-render (and wipe)
  // an unrelated screen the user has since navigated to (e.g. mid-typing in the quiz).
  if (state.screen !== "landing" && state.landingTickerHandle) {
    clearInterval(state.landingTickerHandle);
    state.landingTickerHandle = null;
  }
  app.innerHTML = "";
  // Re-asserted every render so the class can never drift from state.compactView.
  applyViewMode();
  // Every screen shares the same chrome: brand header (with a status chip) on top, the
  // screen's own content in the middle, version/legal footer at the bottom. Only the
  // chip's text changes per screen, so the header reads identically everywhere.
  app.appendChild(buildSiteHeader(headerStatusFor(state.screen)));
  main = el("main", { class: "site-main" }, []);
  app.appendChild(main);
  // The footer's Terms/Privacy links navigate away from the page entirely — skip it
  // while a quiz is actually in progress (or mid-submit) so a stray tap near the
  // bottom of a phone screen can't silently abandon an attempt. The X in the quiz's
  // own top bar (buildQuizTopBar) is still the one deliberate way out, and it
  // already confirms before leaving (see confirmLeave()).
  if (state.screen !== "quiz" && state.screen !== "finishing") {
    app.appendChild(buildSiteFooter());
  }
  // Appended to #app rather than <main>, after it, so it layers over whatever the switch
  // below draws and survives the per-second timer repaints (updateTimerDisplay only touches
  // the chip). advance() clears the flag, so any route off this question closes it.
  if (state.skipConfirmOpen && state.screen === "quiz") {
    app.appendChild(buildSkipConfirm());
  }
  switch (state.screen) {
    case "loading": return renderLoading();
    case "enterCode": return renderEnterCode();
    case "landing": return renderLanding();
    case "confirmName": return renderConfirmName();
    case "quiz": return renderQuiz();
    case "finishing": return renderLoading(S.SUBMITTING);
    case "result": return renderResult();
    case "closed": return renderClosed();
    case "error": return renderError();
  }
}

/** The screen's content mount — the <main> between the shared header and footer.
 *  Reassigned on every render(); the render* functions append into this, not #app. */
let main = app;

function headerStatusFor(screen) {
  switch (screen) {
    case "loading":
    case "finishing": return S.STATUS_LOADING;
    case "error": return S.STATUS_ERROR;
    case "quiz": return S.STATUS_IN_PROGRESS;
    // Only these two screens actually offer a join/start action for the chip to reflect —
    // everywhere else (confirmName, result, closed) a taker already got past joining, so
    // the maintenance switch has nothing left to say about their session.
    case "enterCode":
    case "landing": return state.flags.joinQuizEnabled ? S.STATUS_READY : S.STATUS_PAUSED;
    default: return S.STATUS_READY;
  }
}

// Same PNG as the page's own favicon (the app's launcher icon) — keeps the header
// brand mark and the browser tab icon identical.
const BRAND_ICON_DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAQAElEQVR4AdRYeXBcR5n/db83h0aSNTM6rdP3IduxLdvEjuzYju3E5E6WXQJsAgQCVVQBC9lNBUh2U9QWGxa2WDa4dgMstQGSFBXYJY4T31dk2fKZSLbjU5Ysy5J1zIw0mvsdvb8eOUDumIU/9k1/3T3vdX/f7zv6635P4v/59WdTYFLXE/4FXU8ENen+n8tOfxIFCgtvrQoG776/NHTXv4dD9xwoC/9Ff6KpY6S3qSNyaVFHJNHUPlIWvrc/HL7ngB4TDN5xv57zp1Dq/6BAozc04a5Plobv2VHg8/d4pPGMIcwvmtJYakBWSWn4DGlIU+RrnyFklUcYSyXHeKTnGT/nlAbv3hEK3f5JoNH7xyojr33iKjNccudDpaGZZ0zT+KUhjJtIHkNIIYTBWsKQEgGfiaqyACaWB1DIvhQGRRkwpCH0zxTSYxjGTabw/rI0NPNsuOT2h4BVJgddU5HXMjoYvHVBWSjUZpjm07T0JCkJg3CENCCkCcnWYDu5IYh7bm3EvMZqzG2ciDtvnY3pk8IwDAkhOJbECRDCEFRM+6hBGp6ny0LBNi3jWjDJDzs4HL77qx6j4IAUsknCEBQOtpCCwEmG8MIUPoQnFGLpwkl4eVsXPF4v/L4Atu3sxeKF9SjlM5PjpPSSgxcSJgTnSmHAAI0hzSaP4T8QDt75VXzIS37wuFVmWejupw3IH0gl/EIYQlCcxDjwcTA+SOGBYZhouq4GbUf6MX9eLbJZA8mUwp23N+LAwStYvKAexlXwWhHdl4KcNT+pWymkkn5DmD8Ih+76MbDIgw+45Ps/Z7yHS56HkA9JYQhIA5IhYkgPb5mQhheGtiDvmx4Dfr8PJcV+JFICRYECjI0ppNMSAwPZfFtc7IW/wAefzwtpmjDIy6RCmieEASEkhBQkKQwhP18arH7+g5SQeJ8rHApukMr4CwNSFHglptRMwILZFagIF8BremCAIGj1wgI/CjwBwPZhOOKgbmIYBX4/ursTOH8ujgICrq4qRiwm8mMMhpGek+dBJXweDxr4fNG8KtRUFsFvSkhQBWneGy6p2fA+EDnuPZ6WBu/6ihTyIYO2KA/7ce8dc9BQF4LtuFiyqBo3NddhQpEfhf4AHMsL5XhhSD/Onstg4bxKnDubwPKldbixuZ79OMOnBqfeSEEKH4Trg5P1wucpQGmoEHetn4GZ08qRStuYPb0Cd310Fj1oQithSOPz4eBtf4P3uOS73Q8Gb10gDOO7ElJ4vQLrVs/A3tYeFBUHUFNTijhDIzbqYs7scji2AVN6IQ0fDOmDbXmwuyWCpvkVmFDoRXGRFwvnT8SuPRFYeqwOO8MPgy3oweUfqUP/YBrS60FxSTH8hYW4MpzC6hVTOUZASMFiPhkMrF2Id7nkO++tMg14fyIUfEIIhEv8GBnJEUQddr/ah/aOKIqLC2A5JmqqgvCafmjgBsHQY5AMj3TSi9174mjZn0DLvjH2R5HKMOSooKmJYafbgLcAWhHNq3riBDRdV4tKhlAkmoOPCvl9BqAkBNUzvAU/ebf1IPG2K1wS/DSBLJKEAk6dUOjnYswwTICVy6dg7eqpOHosgsrSYggyN7kWwqECPPqNhXjmmRV4/Im5eODTU9B840RUV5cgRKtWlBejsqIQ5eWFkEwAUlBpKurz+WFZQDzqIJ1UyKRdSFcgnbKglKBnTRhCQgrWwmwKFZV+Fm+73qZAo1dK+S3BC0LoiRiO5VBbE0aC8RmJppjTL2LVigac7xyFlCaWfKQar+z8a9x73yLMvG4G1t+xEF/48lJ85/sr8YtfrcevN63HCxvX4zekF168GQ9+toHADAjDh5wtURjwo2piMcKlhQgFfQA88BcE4DEkHMcgDJMkwZ+QHt83gWl6EMeNFznejNehCdPuFQKTBPTPgBAGXS8RiWagbMH4Fli8sIYeGELzshr0DWbxjUfnwpAKyUQGqWQaynUQi8ahHId9C66TG29dm17M4FOfmY0NG2bh4Yfr8bF76qD4q6oowqGDMWzZ2oftuy5i7sxyGijOMB3HQA8AUrB46kOFUz6GP7j+UAEhpXxQYPwnhYQUBqQjcez1CAzDg5lTS1HChbl0SQ0FjiASyQCuRYAKu3aewIsbj+GFXx/AkcOd+J/fHsLLmzvw/PMHsemV49i4sYOZx4YwA5g1tw7LFgfwV/eWobk5iK7OJBqnlWD+vDBuXFqPzs4xdF9KQTJEpTAJ14CAJglpej4H8C/GLzneAIWFayqEECsFBIu+zQYGqAVcmGg/PoKdewawZ18EO3YOIToCjIxk82lVKRdFJT5UVRairjaMclp07pw6TGkIYw7PQ1MmlyIc9gGGRP+lLkSjCZgFhchR+eGhFC50W9ixN4pXW6PYsr0fF3oycAheCMqnIYkIApIEIaSnORBYOBFXL3m1hdcoWCsgPBCAyE8yIAT/SAGp/1MZ1zXgMhVCcRgtk05JZHMAVzPz/QwsvX46rv/IZFqyDjOmlmP2rCr2a9A4sxIrbpgKv9+LivLSfI4vKi5EoLAIvZfilGPCdT0MMYMBRbmUJbm+pCH4TAAgTI2FJKmB1wiv48184ZN8K/igWQgB/ZOsNRkGuFF5GM8KUhrEaZCVhBCSIkySH9FIGlCK66Ibu3Ydx7FjFzHQH8PW7cdJJ7F120ls207a8Qa2bz+F3XvP4cy5IXg0P3IbGnJY+yBYC1pcKDMvh0uGu7kHpgBkHhd4X0D/pPQ2A+wCkCRdhBByHjuCBCEU6moKcNu6Bty0og7r19WjpqoABkcLoSsJwVYykwxHsoCrYOUsxGJJLnSuCdrR5iJ2SDYXtSbHdpjNinHzmhmYx7BSDEwhXAwOMXVSGUkSNIkggnDIxNpV1ZRdi1vWNKCy3AetBPhMARxi/A6rxPgllZCT+ZxPBSZPKsbyZbU4cWYIew5cxsFjV9C0IIzaugJASugfhIRBN8diTOQEMm1KOUOmGjreKyuL8dGb52D9zY3jtK4Rt5Bmzaygs1xKtAFFYi8StRnvGfYIRQhUVPoYjlU4fDTCddGH1sN9uIG7dX1tESB0YQVMAgjjzQpfWOTl3BD/Q4fN/MZKHOsYQIAnyob6EipUitaDQ7RcGKYUHCbpTirAnD0ScwDXxa7dp/HUhl1oab0AosTIaBpnz17BsaPdOHToAg4dJh3U/S5cuDDMMUA27WDWAg82/HQpF74D02Canh/Cjt2X8cTjS7B2dR2CXCvbdndhEY8jHi2bG5yQsgRlZQUEAqmr2uoyP73uVVTRQw0sYiorL8IiLnaDkyQtzAa5rAODQSmEhBBURJiIxmwoKrBz9yksXFibV2T/gfNMp4cxuT6EoaExDA5qSsDjEZg5oxxVPC7ozLWXCi1b1YC2tiMoLSNvacC2FRODQHdPHKlUDj/ecAszpI/3FLycT8tp5b1FwaBfY5e6UkPcpdghJLhckMRHwWlcZIboG0zgXGcciaQN6dFzORAcyQIqYVmSurv426+t4UaWxde/shrLrp+Ez31mGUwKXLlyGtbdNJ3WnIq5cypRUmxycQqcPN2Hjtc6sGVTC9pe68HpNwzyUVC0VFNTGHffNhkPfKoRrW0XMWVSEHqzdBQ4BrwEuFHmseery6+354gnx+ewaIEMjw3lYS+Gab3igA+zZwaZ3wP0gMtFylH0COhKTZXl1AoKmYyVt24ymaHycbS2nkfr/gs4eqQbR5iZjr52EV1dQ3DprWgshS2b2zBwZQSnO/pw/mgFBLywidCyXOgw/f4P2/GbF7uwc9clmAblMhnoZ8QJCDeXjMWYPTAeQmgdJmwVAy/yx6v7L6E0HEB5KAAeSECpmDYliP1tw1xwCq5yCdmBUhZDUYIdjI6mCEIgm8nCsW2M0f3xsQziiSyBuVh4XTXqa0vYd/CrXxP8wCj6r6SQTTUyVU4gDweK2azt4DBCE7wYGkhR+V4azOLeUYQ9LRfBpEa5iuPcOEa4i+JNBUBMcC/yEW8ppHMOXtneiTMXIiir8OP8hTi27bqMjEXraxZUwIUNBxZ3WK2ATpETUMETZ1lZIcr4KWXlDZOwavkkrFzegOsX1cDvk9BrYBOPF8ODg+jti5NDMfxmOROqC1c4BEHZWRdbd/ejb2AM06YVYyiaxEtbziPJBc+zBfSlYF9kq9PZVQ/Qzsq1TwoQHZ/o2rIF+gfS6DgRweBQjpYjeKW09hyh51Kgm0FFmcnhCqlEjge6LLLcmrM8DvczPPr7R3ClbzQfUgIujp+4jPNnunGOWSjFd+Uvf/Z68lIEbpGvIh8XijIsBvOlvjTajg7hQncS+sgN+pcDQIjKdZ2T7Dik3yngOq51UN9QtC656HFQdGmWsW16NGMS49Bl/s4T+16/jaICKsNxOoT0LhwZTjKcknjj1BWcOj2AKC1ocxMb5lF8x652nDrbx/dm4OEv3YCJfLtz6UVFXop8lXIo02WY2jBNhVzGhiIeReXHseVrGjNxiD2X9HsFMrnOvUqoHISC4iJ1OEmRHLrWYaxLw0a4VKG6VsLrszjGRqhMQEqbyjr5sFm2tIEvLQEUM4bnzKrg4i/H9Olh1NeV4CWeSM+c70d8VOGOW6Zh6bLp4ES4PNA5woaQFherBS0H5OnyLOESvEsMigZyqRzYd1zHslI9uzn5LQrQ9Z1XXCe3nx5UVJt6KGgGenJRgcCtN1czJgMoK5VYvSKMmdN9qK5k+HDVKwqaUl+CG5bUM/cHEfCb/AAwAQ31E3hw88DK2riuwY/GUgfVE4N44JPXE6wJ6KhEjmMl1qwOYXlzCVavLMXi+SVwqJgGD/LO4yB4Pdx104ey6LuMq5e82uomYztjzytyVdTCpcaKrUcqrGiuxpnzA6itLuJrYgDtb0RQUW7AymUYImkC0aw5k8IUSQtVFAgqJ/j/1JkBvPDia6ibMRnf/ua6/A5PMSw2+Ukq4MXhYwPIZBVOkHcqncOSheXk65AVeZMXoUDztuzoswSrzx5s8LsQ0n+c0bEjL7mufVGHUJ6oRFWVFz29EW4+Bo529OLkqUGGiQ89XJzFxV48/p12fvu5jOHhIUSGI4gORRCJRNnGMDQY5f0RCsngvvsWY8WqRurkIhaJMUEME/QgPVmI46eH0bSoDK2HLmPlyhpMnxFEMOiFx3Tymc5lDSrhqOylROroiwSbX8BsyVvX40RVkyM5J/qUq6gv405xYhnT4sBAghuchZraAAoCwKoVVcjkspD038CAB5/54jY89W+78OSTW/B339yMh770Mj52/0u4/eObcNtfbsTXv9GKf/7RcTz5r4fx0/86go2vnMQjf9+Kn/28BxSDQKGBrdu7+fqaw7MvnMBr7QPIMHkYppu3eh4OHGVZgz8iVL1fESt7LITA+vclOza273nlpF9XZK0YAj09kXwsSy7u3kujuPGGOrQd6kWMWSXL2KYIvoiUYssuD/YdLuJZvwyRoWqm7HpUhqeiPDidL0H16O0pBgu0QAAABNNJREFU42uoH7/ZZPPwFqXX/DSAl1KYDEoMfOHBGVCM+8pSP0qDHlpfcRPj4qYtlR7lJDvGkkd0+GR/Dxdv8YC+rzWLZjLdj7rKyShG6WA0nc8qwZAXhUUeHq0JfiTBl/oKHDvRx5Rm0U8UZHrygATPMrX1XqxbU45584qxYGEA69aWMey8AA+KpumH6SkE6L6cncXA8BilWNiysxM3r61BZaUXFxmyOabeTM7VgcPnuWw6c+FRAoyQNEY24+XtHtB3s8ns6UM5a/CfXLotx0+Jm7efgUtfl2ol/IIL2I8WHrIGIyliInjDoiI8MrhZfvRy0TirCLtaehHnl4ooP4rtbbmMxYtD8HhzHJeD4+YILAfB1Hz81BAcpumpDROQSKQQovXnzCrFzlc7YTMBUAWVyVz5bjbb2UZwb7E+/7/DA/qepng8ceCnthX5Jbgg0hk3b6Et289jx54ubNrWib7+NEPDRiqbQc5KwzRzkGYWcxsLcYAh9r3vLMEPv7cUT/3LUjz6yHy8frwf06cEAEOPs2hVi3GeRZIZZ//Bfmzf3ckEcQV79nVh887zSPPo7rqOsnOR5xKpI08TVJz0jvJuHtCDXFbDI2Mt/8C0tdERjnLoiTRjPsXFlbNsuIxXh6cZ3drc61MZrUiGVlaQHoeekNjb2s2DYQ8aZ4eYjUZ5rvJS2QzS6TTP91nYmodj0ysWRlM6nNIYTeSgve7CVbYd2zSSaHmcWHTouGzfUd5LAT3QYtU3Mrbn4Vwu8qyrnKsOdaC47Ts8AriOBa2AwxCwuXPmchaSVCSTSec/hi3hIa5pfhV+/lxHfg30XI7ms5ker0nPdRlODvkppmxXE4OLKVzlcsPPjYzt/ZrGQMqR3rW8nwJ6go653vhYy2Npq/fbrpvNKF6OFkTASluQ5GqiMg7p0NFLaL6+Gt/9wT6s+ugzWHPbL/DfLx7HrJkhvMGzkR7rXB3vkodL8LpV+jzE1aAoI5Pu+cd4ouVbBNBL0hjYvHv5IAX0LM2gP5E48uOx1MmP2068ndZicnOZfegNHUb0gEtyCCY2kkFL2wXMmh7EulWT+CZWB/0tdauO60wOLo9bGrBDJRx60aExVJ6TrSw73h5Ptt+XSB39DwruJ2nZbN67yPd+9JYn2oVXstmulujo9k9kMl2P2U7yogtbufw5BKEtqQiI93Cpfwy/3Xwa2/ecxdY959g/hShfeGwqmB9LpR0e4AicYcm7TuJiKtP9eGx0xydyuUuvUvIVkpbJ5v3Lh1VAc3FZjZC6xlKv/yw6suX2VKrzYcsaaXXdXHZcEV27XCMuF6uDeNpCMmUz7h3a2M7fd5WTV1k5uayVG21Np84+HB3ZSl6v/6fmTdIytCx2P7hciwKam2Kl3TrAtjOZPv5sLL7zweHYnrWp7PlHrOzQc7YdP2i7qX7bzSS5yLOOa2VtlUnaTrqfzw5Z1vBzqUznIyOxfWv13GT6pN5dO8lP89S8tQz+/XDlWhV4k6sWkuafIVI3MNaeTHb8ginvMYbYA5HY5rWR2MvNw9kdKzRFoi83R3mPz+4fib/6mB5rI9Y+Pheah+alefLWtZU/VoE3pWihOt2O8cYgqYfUReLXLZzjh51TeQL7gL6nn+kxeqyeo+dqHpzyx5X/BQAA///g16AxAAAABklEQVQDAImWDkOu+2s5AAAAAElFTkSuQmCC";

// ── Desktop view controls ───────────────────────────────────────────────────
// Two independent toggles, both surfaced in the shared header and both hidden under
// 900px by CSS (.header-btn) — on a phone the app is already edge-to-edge and the
// browser owns fullscreen, so neither has anything to offer there.
//
//   1. compactView — CSS only. Flips #app.compact-view, which pins --shell-max back
//      to the 480px phone column at any viewport (see style.css).
//   2. fullscreen  — the real Fullscreen API on <html>, so the browser's own chrome
//      goes away too.
//
// They compose: fullscreen + compact is a legal (if unusual) combination.

// Remembered per-browser the same way cookie-consent.js stores its choice — the
// try/catch matters, Safari in private mode throws on any localStorage access.
// Kebab-case rather than "quizoma.viewMode" on purpose: lint-strings.mjs classifies a
// dotted, capitalised literal as prose and reports it as untranslated UI text.
const VIEW_MODE_KEY = "quizoma-view-mode";
function readCompactView() {
  try { return window.localStorage.getItem(VIEW_MODE_KEY) === "compact"; } catch (e) { return false; }
}
function storeCompactView(compact) {
  try { window.localStorage.setItem(VIEW_MODE_KEY, compact ? "compact" : "wide"); } catch (e) {}
}

/** Pushes state.compactView onto #app. render() wipes #app's CHILDREN but never its
 *  class list, so the class survives a re-render — this just keeps the two in sync no
 *  matter how compactView was changed. Called from render() and from boot(). */
function applyViewMode() {
  app.classList.toggle("compact-view", state.compactView);
}

function toggleViewMode() {
  state.compactView = !state.compactView;
  storeCompactView(state.compactView);
  // Full re-render rather than just the class flip: it's the path every other state
  // change already takes, and it's what repaints this button's own icon and label.
  render();
}

// iOS Safari on iPhone has no Fullscreen API at all. Detect once — a button that
// silently does nothing is worse than no button, so we simply don't render it there.
const FULLSCREEN_SUPPORTED = !!(
  document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen
);
function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}
function toggleFullscreen() {
  if (isFullscreen()) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) Promise.resolve(exit.call(document)).catch(() => {});
    return;
  }
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  // Rejects when a permissions policy or an embedding iframe blocks it. Swallow it:
  // an unhandled rejection from a header button must not take the screen down.
  if (request) Promise.resolve(request.call(root)).catch(() => {});
}

/** Esc and F11 leave fullscreen without going through our button, so the icon has to
 *  follow the browser rather than our own last click. Registered ONCE from boot() —
 *  render() rebuilds the header constantly, so binding this per-render would stack up
 *  listeners for the life of the page. */
function watchFullscreenChanges() {
  if (!FULLSCREEN_SUPPORTED) return;
  const onChange = () => render();
  document.addEventListener("fullscreenchange", onChange);
  document.addEventListener("webkitfullscreenchange", onChange);
}

/** One header control: an icon button carrying its label as both tooltip and
 *  aria-label (the icon alone is the whole visible content). */
/** `on` marks the button's mode as currently engaged: it paints filled (style.css
 *  .header-btn.is-on) and reports aria-pressed, so "compact view is on" is legible
 *  without having to know which way the icon's arrows are supposed to point. */
function buildHeaderBtn(label, svg, onClick, on = false) {
  const btn = el("button", {
    class: "header-btn" + (on ? " is-on" : ""),
    type: "button",
    title: label,
    onclick: onClick,
  }, []);
  btn.setAttribute("aria-label", label);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.appendChild(html(svg));
  return btn;
}

/** Avatar + dropdown for the signed-in account, in the header's right-hand corner.
 *
 *  Deliberately NOT rendered on the quiz/finishing screens (see buildSiteHeader) — it
 *  carries Sign out, and nothing that can end an attempt belongs under the taker's
 *  thumb mid-quiz. Same reasoning as render()'s footer suppression.
 *
 *  Open/closed lives in state, not the DOM: render() wipes #app on every state change,
 *  so a menu toggled by mutating the DOM directly would vanish on the next render. */
function buildAccountControl(user) {
  const name = SC.resolveDisplayName(user);
  const avatar = el("button", {
    class: "account-avatar",
    type: "button",
    title: name,
    "aria-haspopup": "menu",
    "aria-expanded": String(!!state.accountMenuOpen),
    onclick: (e) => {
      // Without this the click bubbles to the document listener registered below,
      // which would close the menu in the same tick it opened.
      e.stopPropagation();
      state.accountMenuOpen = !state.accountMenuOpen;
      render();
    },
  }, [initialsOf(name)]);
  avatar.setAttribute("aria-label", S.ACCOUNT_MENU);

  const wrap = el("div", { class: "account-control" }, [avatar]);
  if (!state.accountMenuOpen) return wrap;

  wrap.appendChild(el("div", { class: "account-menu", role: "menu", onclick: (e) => e.stopPropagation() }, [
    el("div", { class: "account-menu-head" }, [
      el("span", { class: "account-menu-name" }, [name]),
      // Only worth a second line when it differs from the name — a taker whose Google
      // account has no full name set already reads their email as the name above.
      ...(user.email && user.email !== name ? [el("span", { class: "account-menu-email" }, [user.email])] : []),
    ]),
    el("button", { class: "account-menu-item", type: "button", role: "menuitem", onclick: openNameEditor }, [
      html(EDIT_PENCIL_SVG), S.EDIT_NAME,
    ]),
    el("button", { class: "account-menu-item danger", type: "button", role: "menuitem", onclick: () => {
      state.accountMenuOpen = false;
      signOutAction();
    } }, [html(SIGN_OUT_SVG), S.SIGN_OUT]),
  ]));
  return wrap;
}

/** Re-opens the confirm-name screen as an EDIT rather than the first-login gate, and
 *  remembers where to come back to — see state.nameEditReturn / cancelConfirmName. */
function openNameEditor() {
  state.accountMenuOpen = false;
  state.nameEditReturn = state.screen;
  state.confirmNameDraft = null;
  state.confirmNameError = null;
  state.screen = "confirmName";
  render();
}

/** Any click that isn't on the menu closes it. Registered ONCE at boot — render()
 *  rebuilds the header constantly, so binding per render would stack listeners. */
function watchAccountMenuDismiss() {
  document.addEventListener("click", () => {
    if (!state.accountMenuOpen) return;
    state.accountMenuOpen = false;
    render();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !state.accountMenuOpen) return;
    state.accountMenuOpen = false;
    render();
  });
}

function buildSiteHeader(status) {
  const actions = [
    // Filled while compact is the mode in force. Wide is the default, so it is compact
    // that needs announcing — a page can sit in it across sessions (readCompactView
    // reads localStorage) with nothing on screen saying so.
    buildHeaderBtn(
      state.compactView ? S.VIEW_WIDE : S.VIEW_COMPACT,
      state.compactView ? EXPAND_WIDE_SVG : COLLAPSE_NARROW_SVG,
      toggleViewMode,
      state.compactView
    ),
  ];
  if (FULLSCREEN_SUPPORTED) {
    const inFullscreen = isFullscreen();
    actions.push(buildHeaderBtn(
      inFullscreen ? S.FULLSCREEN_EXIT : S.FULLSCREEN_ENTER,
      inFullscreen ? FULLSCREEN_EXIT_SVG : FULLSCREEN_ENTER_SVG,
      toggleFullscreen,
      inFullscreen
    ));
  }
  actions.push(el("span", { class: "status-chip" }, [
    el("span", { class: "status-dot" }, []),
    status,
  ]));
  // Last, so the avatar sits in the far corner. Suppressed mid-attempt — see
  // buildAccountControl's doc.
  if (state.user && state.screen !== "quiz" && state.screen !== "finishing") {
    actions.push(buildAccountControl(state.user));
  }

  return el("header", { class: "site-header" }, [
    el("div", { class: "brand" }, [
      el("span", { class: "brand-tile" }, [
        el("img", { src: BRAND_ICON_DATA_URI, alt: "", class: "brand-icon" }, []),
      ]),
      el("span", { class: "brand-name" }, [S.BRAND]),
    ]),
    el("div", { class: "header-actions" }, actions),
  ]);
}

function buildSiteFooter() {
  return el("footer", { class: "site-footer" }, [
    el("span", { class: "footer-version" }, [S.footerVersion(WEB_VERSION)]),
    el("nav", { class: "footer-links" }, [
      el("a", { href: "/terms/" }, [S.FOOTER_TERMS]),
      el("a", { href: "/privacy/" }, [S.FOOTER_PRIVACY]),
    ]),
  ]);
}

/** Leaving the flow (Done, or the X mid-quiz) never navigates anywhere — there's
 *  no page at the site root, which is exactly what caused the 404. This just
 *  swaps to a plain "you're done" screen; the tab itself is meant to be closed
 *  by hand, or via renderClosed's Close button when the browser will actually
 *  honor window.close() (see that function's doc — most tabs reached via a
 *  regular link tap don't qualify, so the button just doesn't render there). */
function leaveQuiz(message) {
  clearInterval(state.timerHandle);
  clearTimeout(state.revealHandle);
  clearTimeout(state.feedbackHandle);
  state.feedbackHandle = null;
  state.revealing = false;
  cancelLastQuestionAutoFinish();
  state.closedMessage = message;
  state.screen = "closed";
  render();
}

/** The mid-quiz "are you sure" — mirrors QuizPreviewScreen exit ConfirmActionDialog (the
 *  browser confirm() is this page own dialog pattern; no modal primitive exists here, see
 *  renderQuiz). The wording spells out what leaving costs: nothing is submitted, and with
 *  retakes off there is no way back in. */
function confirmLeave() {
  const msg = state.quiz && state.quiz.allowRetake === false ? S.LEAVE_CONFIRM_NO_RETAKE : S.LEAVE_CONFIRM_RETAKE;
  return confirm(msg);
}

// Closing/reloading the tab mid-quiz is the same "left without submitting" as the X — the
// browser shows its own generic warning (the text cannot be customized), which still beats
// silently losing an in-progress attempt.
window.addEventListener("beforeunload", (e) => {
  if (state.screen !== "quiz") return;
  e.preventDefault();
  e.returnValue = "";
});

function renderClosed() {
  // window.close() only actually works when the browser considers this tab
  // "script-closable" — opened via window.open() (window.opener set) or with no
  // navigation history of its own (history.length <= 1, i.e. it never followed a
  // link to get here). The common case — tapping a regular share-code link — is
  // neither, so the button would silently no-op on click. A dead button is worse
  // than no button, so it's only rendered when the heuristic says it'll work.
  const canClose = window.opener != null || window.history.length <= 1;
  const children = [
    el("p", { style: "font-size:40px;margin:0" }, [S.CLOSED_WAVE]),
    el("h2", { class: "quiz-title" }, [state.closedMessage || S.CLOSED_DEFAULT_TITLE]),
    el("p", { class: "muted" }, [S.CLOSED_CAN_CLOSE]),
  ];
  if (canClose) {
    children.push(el("button", { class: "primary", style: "margin-top:8px", onclick: () => window.close() }, [S.CLOSED_CLOSE_TAB]));
  }
  main.appendChild(
    el("div", { class: "screen centered" }, [
      el("div", { class: "card", style: "width:100%" }, children),
    ])
  );
}

function el(tag, props, children) {
  const node = document.createElement(tag);
  Object.entries(props || {}).forEach(([k, v]) => {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  });
  (children || []).forEach((c) => node.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
  return node;
}

/** Fragment from an HTML string — used for the small inline SVG icons below. */
function html(markup) {
  const t = document.createElement("template");
  t.innerHTML = markup.trim();
  return t.content.firstChild;
}

// ── Markdown (mirrors MarkdownParser.kt) — question text supports bold/italic/
// underline/strikethrough/code inline spans plus #/##/- block prefixes on Android
// (QuestionText's parseMarkdown), but this page just printed the raw "**text**"
// asterisks verbatim since none of that existed here at all. ─────────────────────

const MD_INLINE_MARKERS = [
  { marker: "**", tag: "strong" },
  { marker: "~~", tag: "s" },
  { marker: "__", tag: "u" },
  { marker: "*",  tag: "em" },
  { marker: "`",  tag: "code" },
];

/** Same left-to-right scan as appendInlineSpans() in MarkdownParser.kt: a dangling
 *  (unclosed) marker is silently dropped rather than shown literally, and a lone "*"
 *  that's actually the start of "**" is treated as a plain character so bold doesn't
 *  get misread as two nested italics. */
function appendInlineMarkdown(container, text, depth) {
  depth = depth || 0;
  if (depth > 6 || !text) {
    if (text) container.appendChild(document.createTextNode(text));
    return;
  }
  let i = 0;
  let plain = "";
  const flushPlain = () => {
    if (plain) { container.appendChild(document.createTextNode(plain)); plain = ""; }
  };
  while (i < text.length) {
    const def = MD_INLINE_MARKERS.find((d) => text.startsWith(d.marker, i));
    if (!def) { plain += text[i]; i++; continue; }
    if (def.marker === "*" && text.startsWith("**", i)) { plain += text[i]; i++; continue; }
    const openEnd = i + def.marker.length;
    const closeIdx = text.indexOf(def.marker, openEnd);
    if (closeIdx < 0) { i += def.marker.length; continue; }
    flushPlain();
    const span = document.createElement(def.tag);
    appendInlineMarkdown(span, text.slice(openEnd, closeIdx), depth + 1);
    container.appendChild(span);
    i = closeIdx + def.marker.length;
  }
  flushPlain();
}

/** Mirrors parseMarkdown() in MarkdownParser.kt. Returns a DOM fragment (not a string —
 *  building real <strong>/<em> nodes is the only way to get real formatting; this file
 *  has no innerHTML-from-markdown pipeline) ready to drop straight into el()'s children. */
function renderMarkdown(md) {
  const frag = document.createDocumentFragment();
  (md || "").split("\n").forEach((rawLine, idx) => {
    if (idx > 0) frag.appendChild(document.createElement("br"));
    let line = rawLine;
    let prefixText = "";
    let big = false;
    if (line.startsWith("## ")) { big = "sub"; line = line.slice(3); }
    else if (line.startsWith("# ")) { big = "main"; line = line.slice(2); }
    else if (line.startsWith("- ")) { prefixText = "• "; line = line.slice(2); }
    else {
      const numMatch = line.match(/^\d+\. /);
      if (numMatch) { prefixText = numMatch[0]; line = line.slice(numMatch[0].length); }
    }
    const lineSpan = document.createElement("span");
    if (big) { lineSpan.style.fontWeight = "700"; lineSpan.style.fontSize = big === "main" ? "1.25em" : "1.1em"; }
    if (prefixText) lineSpan.appendChild(document.createTextNode(prefixText));
    appendInlineMarkdown(lineSpan, line);
    frag.appendChild(lineSpan);
  });
  return frag;
}

/** Plain-text equivalent — mirrors stripMarkdown() in MarkdownParser.kt, used where a
 *  full render isn't wanted (short previews, list headers). */
function stripMarkdownText(md) {
  let s = (md || "")
    .replace(/^#{1,2} /gm, "")
    .replace(/^- /gm, "")
    .replace(/^\d+\. /gm, "");
  const inlinePatterns = [/\*\*(.*?)\*\*/g, /~~(.*?)~~/g, /__(.*?)__/g, /\*(.*?)\*/g, /`(.*?)`/g];
  for (let pass = 0; pass < 3; pass++) {
    inlinePatterns.forEach((p) => { s = s.replace(p, "$1"); });
  }
  return s;
}

// Official 4-color Google "G" — same colors as LoginScreen.kt's GoogleGLogo
// (#EA4335 red, #FBBC05 yellow, #34A853 green, #4285F4 blue).
const GOOGLE_G_SVG = `
<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
  <path fill="#4285F4" d="M19.6 10.23c0-.68-.06-1.36-.18-2.02H10v3.83h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.23c1.9-1.75 2.99-4.33 2.99-7.33z"/>
  <path fill="#34A853" d="M10 20c2.7 0 4.96-.89 6.62-2.42l-3.23-2.5c-.9.6-2.05.95-3.39.95-2.6 0-4.8-1.76-5.59-4.12H1.06v2.59A10 10 0 0 0 10 20z"/>
  <path fill="#FBBC05" d="M4.41 11.9a5.99 5.99 0 0 1 0-3.8V5.51H1.06a10 10 0 0 0 0 8.98l3.35-2.6z"/>
  <path fill="#EA4335" d="M10 3.98c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 10 0 10 10 0 0 0 1.06 5.51l3.35 2.59C5.2 5.74 7.4 3.98 10 3.98z"/>
</svg>`;

const CHECK_SVG = `<svg viewBox="0 0 20 20" fill="none"><path d="M4 10.5l4 4 8-9" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CLOSE_X_SVG = `<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
// Header controls (see buildSiteHeader). Arrows pointing OUT = "make it bigger",
// pointing IN = "make it smaller" — the same convention a video player uses.
const EXPAND_WIDE_SVG = `<svg viewBox="0 0 24 24" fill="none"><path d="M9 12H3M3 12l3-3M3 12l3 3M15 12h6M21 12l-3-3M21 12l-3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const COLLAPSE_NARROW_SVG = `<svg viewBox="0 0 24 24" fill="none"><path d="M3 12h6M9 12L6 9M9 12l-3 3M21 12h-6M15 12l3-3M15 12l3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const FULLSCREEN_ENTER_SVG = `<svg viewBox="0 0 24 24" fill="none"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const FULLSCREEN_EXIT_SVG = `<svg viewBox="0 0 24 24" fill="none"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SIGN_OUT_SVG = `<svg viewBox="0 0 24 24" fill="none" width="16" height="16"><path d="M15 17l5-5-5-5M20 12H9M12 4H6a1 1 0 00-1 1v14a1 1 0 001 1h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CLOCK_SVG = `<svg viewBox="0 0 20 20" fill="none" width="13" height="13"><circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.6"/><path d="M10 6v4l2.6 2.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const CHEVRON_RIGHT_SVG = `<svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M6 3l5 5-5 5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
// Quiz-taking screen icons (Material Rounded/Outlined equivalents used on Android).
const BULB_SVG = `<svg viewBox="0 0 24 24" fill="none" width="15" height="15"><path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0012 3z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const LOCK_SVG = `<svg viewBox="0 0 24 24" fill="none" width="13" height="13"><rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V8a4 4 0 018 0v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const PENCIL_SVG = `<svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M4 20h4L19 9l-4-4L4 16v4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
const TEXT_FIELDS_SVG = `<svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M4 7V5h11v2M9.5 5v14M7.5 19h4M14 12v-1.5h6V12M17 10.5V19M15.5 19h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const BAR_CHART_SVG = `<svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M6 20V11M12 20V4M18 20v-6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;
const CHECK_CIRCLE_SVG = `<svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7.5 12.5l3 3 6-6.5" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHECKBOX_OUTLINE_SVG = `<svg viewBox="0 0 24 24" fill="none" width="13" height="13"><rect x="3.5" y="3.5" width="17" height="17" rx="4" stroke="currentColor" stroke-width="2"/><path d="M8 12.5l2.8 2.8L16.5 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const TF_CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" width="22" height="22"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const TF_X_SVG = `<svg viewBox="0 0 24 24" fill="none" width="22" height="22"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;
const COMMENT_SVG = `<svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M5 5h14a1 1 0 011 1v9a1 1 0 01-1 1H10l-4 3.5V16H5a1 1 0 01-1-1V6a1 1 0 011-1z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
const CHEVRON_DOWN_SVG = `<svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M4 6l4 4 4-4" stroke="#BBBACC" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const TROPHY_SVG = `<svg viewBox="0 0 24 24" fill="none" width="20" height="20"><path d="M7 4h10v4a5 5 0 01-10 0V4z" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 6H4a3 3 0 003 3M17 6h3a3 3 0 01-3 3" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><path d="M12 13v3M9 20h6M9.5 20c0-2 .8-3 2.5-3s2.5 1 2.5 3" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function renderLoading(label) {
  main.appendChild(
    el("div", { class: "screen centered" }, [
      el("div", { class: "spinner" }),
      el("p", { class: "muted" }, [label || S.LOADING]),
    ])
  );
}

function renderError() {
  main.appendChild(
    el("div", { class: "screen centered" }, [
      el("p", { class: "quiz-title" }, [S.ERR_GENERIC_TITLE]),
      el("p", { class: "muted" }, [state.errorMessage]),
    ])
  );
}

// ── Enter code ─────────────────────────────────────────────────────────────
// Shown when /take/ is opened without a ?code= (or with one nobody recognises): six
// one-character boxes, then Join reloads the page with ?code=XXXXXX so boot() takes
// the exact same path a shared link does — no second way of loading a quiz.
const CODE_LENGTH = 6;
const CODE_CHARS = /[^A-Z0-9]/g;

/** Pulls a share code out of whatever was pasted: a bare code, or a full share link. */
function extractCode(text) {
  const raw = String(text || "");
  try {
    const url = new URL(raw.trim());
    const fromParam = url.searchParams.get("code");
    if (fromParam) return fromParam.toUpperCase().replace(CODE_CHARS, "").slice(0, CODE_LENGTH);
  } catch (e) { /* not a URL — fall through */ }
  return raw.toUpperCase().replace(CODE_CHARS, "").slice(0, CODE_LENGTH);
}

function renderEnterCode() {
  const draft = (state.enterCodeDraft || "").padEnd(CODE_LENGTH, " ").slice(0, CODE_LENGTH).split("");
  const boxes = [];
  // Admin maintenance switch — visibly disables the whole join flow instead of letting
  // someone fill in a code that will just fail server-side a moment later.
  const paused = !state.flags.joinQuizEnabled;

  const currentCode = () => boxes.map((b) => b.value).join("");
  const sync = () => {
    state.enterCodeDraft = currentCode();
    boxes.forEach((b) => b.classList.toggle("filled", b.value !== ""));
    joinBtn.disabled = paused || state.enterCodeDraft.length !== CODE_LENGTH;
  };
  const focusBox = (i) => { const b = boxes[Math.max(0, Math.min(CODE_LENGTH - 1, i))]; b.focus(); b.select(); };
  const fill = (text) => {
    const code = extractCode(text);
    if (!code) return false;
    boxes.forEach((b, i) => { b.value = code[i] || ""; });
    sync();
    focusBox(Math.min(code.length, CODE_LENGTH - 1));
    return true;
  };
  const submit = () => {
    if (paused) return;
    const code = currentCode();
    if (code.length !== CODE_LENGTH) return;
    window.location.search = `?code=${code}`;
  };

  for (let i = 0; i < CODE_LENGTH; i++) {
    const box = el("input", {
      class: "code-box",
      type: "text",
      maxlength: "1",
      inputmode: "latin",
      autocapitalize: "characters",
      autocomplete: "off",
      spellcheck: "false",
      placeholder: "•",
      "aria-label": S.ENTER_CODE_LABEL,
      value: draft[i].trim(),
      ...(paused ? { disabled: "true" } : {}),
      oninput: (e) => {
        const v = e.target.value.toUpperCase().replace(CODE_CHARS, "");
        if (v.length > 1) { fill(v); return; } // some keyboards insert whole words
        e.target.value = v;
        sync();
        if (v && i < CODE_LENGTH - 1) focusBox(i + 1);
      },
      onkeydown: (e) => {
        if (e.key === "Backspace" && !e.target.value && i > 0) { e.preventDefault(); boxes[i - 1].value = ""; sync(); focusBox(i - 1); }
        else if (e.key === "ArrowLeft" && i > 0) { e.preventDefault(); focusBox(i - 1); }
        else if (e.key === "ArrowRight" && i < CODE_LENGTH - 1) { e.preventDefault(); focusBox(i + 1); }
        else if (e.key === "Enter") submit();
      },
      onpaste: (e) => {
        e.preventDefault();
        fill((e.clipboardData || window.clipboardData).getData("text"));
      },
      onfocus: (e) => e.target.select(),
    });
    boxes.push(box);
  }

  const joinBtn = el("button", { class: "primary", onclick: submit }, [S.ENTER_CODE_JOIN, html(ARROW_RIGHT_SVG)]);
  const errorLine = el("p", { class: "field-error" }, [state.enterCodeError || ""]);
  errorLine.style.display = state.enterCodeError ? "" : "none";

  const body = [
    el("span", { class: "pill centered" }, [S.ENTER_CODE_KICKER]),
    el("h1", { class: "quiz-title centered" }, [S.ENTER_CODE_TITLE]),
    el("p", { class: "quiz-meta centered" }, [S.ENTER_CODE_BLURB]),
    el("span", { class: "field-label centered" }, [S.ENTER_CODE_LABEL]),
    el("div", { class: "code-boxes" }, boxes),
    errorLine,
  ];
  // Maintenance notice replaces the ordinary hint line entirely — a taker paused mid-flow
  // needs to know joining isn't the problem here, the timing is, not a smaller hint about
  // letter case underneath a button they can still press.
  if (paused) {
    body.push(el("p", { class: "field-error centered" }, [S.JOIN_PAUSED]));
  } else {
    body.push(el("p", { class: "field-hint centered" }, [S.ENTER_CODE_HINT]));
  }
  body.push(joinBtn);
  // Only offered where the browser can actually hand the clipboard over (secure
  // context + API present) — a button that silently does nothing is worse than none.
  // Hidden entirely while paused: pasting a code nobody can submit right now is pointless.
  if (!paused && navigator.clipboard && navigator.clipboard.readText) {
    body.push(el("button", { class: "paste-btn", onclick: async () => {
      let text = "";
      try { text = await navigator.clipboard.readText(); } catch (e) { /* denied */ }
      if (!fill(text)) {
        state.enterCodeError = S.ENTER_CODE_CLIPBOARD_EMPTY;
        errorLine.textContent = state.enterCodeError;
        errorLine.style.display = "";
      }
    } }, [html(CLIPBOARD_SVG), S.ENTER_CODE_PASTE]));
  }
  body.push(el("p", { class: "card-footnote" }, [S.ENTER_CODE_NOTE]));

  main.appendChild(el("div", { class: "screen card-screen" }, [el("div", { class: "card enter-code-card" }, body)]));
  sync();
  // Land the cursor on the first empty box so a taker can start typing straight away.
  const firstEmpty = boxes.findIndex((b) => !b.value);
  focusBox(firstEmpty === -1 ? CODE_LENGTH - 1 : firstEmpty);
}

/** The signed-out call to action.
 *
 *  Google's rendered button when Google Identity Services is available — its markup, because
 *  the credential flow cannot be driven from a custom button — and our own button calling the
 *  old redirect when it isn't. The fallback matters: a blocked script would otherwise leave a
 *  taker with no way to sign in at all, and the redirect still works, it just shows the
 *  Supabase project URL on Google's consent screen.
 *
 *  Note this returns a container that fills in later. renderButton() measures the element, so
 *  it can only run once render() has attached it to the document. */
function buildGoogleSignIn() {
  const wrap = el("div", { class: "google-signin" }, []);

  const useRedirect = () => {
    if (!wrap.isConnected) return;
    wrap.textContent = "";
    const btn = el(
      "button",
      {
        class: "google",
        onclick: async () => {
          const redirectTo = `${window.location.origin}${window.location.pathname}?code=${shareCode}`;
          await SC.signInWithGoogle(redirectTo);
        },
      },
      [S.SIGN_IN_GOOGLE]
    );
    btn.prepend(html(GOOGLE_G_SVG));
    wrap.appendChild(btn);
  };

  const GSI = window.QuizomaGoogleSignIn;
  if (!GSI) {
    // The script tag is missing entirely (older cached index.html, or a test stubbing it out).
    queueMicrotask(useRedirect);
    return wrap;
  }

  requestAnimationFrame(() => {
    if (!wrap.isConnected) return; // navigated away while the script was loading
    GSI.renderButton(wrap, {
      onCredential: async (credential, rawNonce) => {
        try {
          state.joinError = null;
          await SC.signInWithIdToken(credential, rawNonce);
          // No page reload on this path, so the work boot() would have done on the way back
          // from the redirect has to happen here instead — including the name gate.
          await loadUserQuizState();
          await routeSignedInTaker(false);
        } catch (e) {
          state.joinError = S.ERR_SIGN_IN;
          render();
        }
      },
      onUnavailable: useRedirect,
    });
  });

  return wrap;
}

function renderLanding() {
  const quiz = state.quiz;
  const accent = themeColorFromName(quiz.themeColorName);
  document.documentElement.style.setProperty("--accent", accent);

  const status = SC.effectiveStatus(quiz);
  const n = quiz.questions.length;
  // Admin maintenance switch — only replaces the actual join/start/retake actions below;
  // signing in and viewing an already-graded result (goToExistingResult) are unaffected,
  // since neither one records a new join.
  const joinPaused = !state.flags.joinQuizEnabled;
  // Two card headers, one per sign-in state — same card frame underneath. Signed-out
  // leads with the sign-in ask; signed-in leads with a "session ready" strip and the
  // account box, so the taker can see at a glance who they're about to join as.
  const body = state.user
    ? [
        el("div", { class: "session-strip" }, [
          el("span", { class: "session-kicker" }, [S.LANDING_KICKER]),
          el("span", { class: "status-chip small" }, [el("span", { class: "status-dot" }, []), S.STATUS_SESSION_READY]),
        ]),
        el("h1", { class: "quiz-title" }, [quiz.title, el("span", { class: "title-count" }, [S.questionCountSuffix(n)])]),
        el("div", { class: "meta-chips" }, [
          el("span", { class: "meta-chip" }, [html(QUESTION_MARK_SVG), S.questionCount(n)]),
        ]),
      ]
    : [
        el("div", { class: "kicker-row" }, [
          el("span", { class: "pill dotted" }, [S.LANDING_KICKER]),
          el("span", { class: "meta-chip plain" }, [S.questionCount(n)]),
        ]),
        el("h1", { class: "quiz-title" }, [quiz.title]),
      ];

  // Archived overrides schedule-based status entirely, same rule as the Android app's
  // ArchivedQuizStatusAction — the creator deliberately took this quiz out of
  // circulation, distinct from it simply having expired on its own schedule.
  if (quiz.isArchived) {
    body.push(el("p", { class: "muted" }, [S.LANDING_ARCHIVED]));
    appendLandingScreen(body);
    return;
  }

  if (status === "SCHEDULED") {
    // Ticks every second so a Scheduled quiz flips to Active on its own the moment the
    // start time arrives — same as JoinViewModel.startStatusTicker on Android — instead
    // of leaving the visitor stuck on a stale "hasn't started yet" until they reload.
    if (!state.landingTickerHandle) {
      state.landingTickerHandle = setInterval(render, 1000);
    }
    body.push(el("p", { class: "muted" }, [SC.countdownUntil(quiz.startAt)]));
    appendLandingScreen(body);
    return;
  }

  if (status !== "ACTIVE") {
    body.push(el("p", { class: "muted" }, [S.LANDING_ENDED]));
    appendLandingScreen(body);
    return;
  }

  if (!state.user) {
    // Google's own button, not ours: the credential flow cannot be driven from a custom
    // button, so renderButton() owns this markup. buildGoogleSignIn swaps in the old
    // custom button if Google's script can't load — see google-signin.js.
    body.push(
      el("div", { class: "info-box" }, [html(INFO_SVG), el("span", {}, [S.SIGN_IN_BLURB])]),
      buildGoogleSignIn()
    );
    // Same inline treatment the join failures below use — a rejected token is not worth
    // throwing the whole page over to the error screen for.
    if (state.joinError) {
      body.push(el("p", { class: "muted", style: "color:var(--error)" }, [state.joinError]));
    }
    body.push(
      el("div", { class: "card-meta-row" }, [
        el("span", {}, [S.sessionLine(n)]),
        el("span", {}, [S.version(WEB_VERSION, BUILD_NUMBER)]),
      ])
    );
  } else if (state.existingAttempt && !quiz.allowRetake) {
    // Same rule as JoinScreen.kt's alreadyDoneAndLocked — a completed attempt
    // already exists and this quiz doesn't allow retakes, so don't offer Start.
    body.push(
      signedInLine(state.user),
      el("p", { class: "muted" }, [S.LANDING_ALREADY_DONE]),
      el("p", { class: "quiz-meta" }, [S.yourScore(state.existingAttempt.score, state.existingAttempt.total)]),
      signOutRow()
    );
  } else if (state.existingAttempt && quiz.allowRetake) {
    // Retake is allowed AND this account already has a result — offer both instead of
    // forcing straight into a fresh attempt. Mirrors JoinScreen.kt's "Your Quizzes" row:
    // the default action there is opening the past RESULT (onOpenJoinedQuiz), with
    // Retake as its own separate, explicit action — not the other way around.
    body.push(
      signedInLine(state.user),
      el("p", { class: "quiz-meta" }, [S.yourScore(state.existingAttempt.score, state.existingAttempt.total)]),
      el("button", { class: "primary", onclick: goToExistingResult }, [S.LANDING_SEE_RESULT])
    );
    if (joinPaused) {
      body.push(pausedNotice());
    } else {
      body.push(el("button", { class: "secondary", onclick: retakeQuizAction }, [state.joining ? S.JOINING : S.LANDING_RETAKE]));
      if (state.joinError) {
        body.push(el("p", { class: "muted", style: "color:var(--error)" }, [state.joinError]));
      }
    }
    body.push(signOutRow());
  } else if (state.lastStartedAt && quiz.allowRetake === false) {
    // Started earlier (here or in the app) and left without submitting, retakes off — that
    // one try is used up. Mirrors JoinedQuizItem.isLockedAfterAbandon on Android.
    body.push(
      signedInLine(state.user),
      el("p", { class: "muted" }, [S.LANDING_LEFT_LOCKED]),
      signOutRow()
    );
  } else if (state.lastStartedAt) {
    // Started earlier and left without submitting — nothing counted, so this is a fresh
    // attempt, labelled as a retake like the app's Joined card.
    body.push(
      signedInLine(state.user),
      el("p", { class: "muted" }, [S.LANDING_LEFT_WITHOUT_SUBMITTING])
    );
    if (joinPaused) {
      body.push(pausedNotice());
    } else {
      body.push(el("button", { class: "primary", onclick: retakeQuizAction }, [state.joining ? S.JOINING : S.LANDING_RETAKE]));
      if (state.joinError) {
        body.push(el("p", { class: "muted", style: "color:var(--error)" }, [state.joinError]));
      }
    }
    body.push(signOutRow());
  } else if (!state.hasJoined) {
    // Join is its own step, separate from Start — records membership (joined_quizzes)
    // right away so the owner's Participants tab sees this person the moment they join,
    // same as joining by code in the app, rather than only once they actually finish
    // answering something.
    body.push(signedInLine(state.user));
    if (joinPaused) {
      body.push(pausedNotice());
    } else {
      body.push(primaryButton(state.joining ? S.JOINING : S.LANDING_JOIN, joinQuizAction));
      if (state.joinError) {
        body.push(el("p", { class: "muted", style: "color:var(--error)" }, [state.joinError]));
      }
    }
    body.push(signOutRow());
  } else {
    body.push(signedInLine(state.user));
    // Reaching here means hasJoined is already true (the membership row exists), so this
    // is resuming/starting an already-joined quiz, not creating a new join — left
    // unblocked on purpose, same as Home's Joined-tab retake/continue on Android.
    body.push(primaryButton(S.LANDING_START, startQuiz));
    body.push(signOutRow());
  }

  appendLandingScreen(body);
}

/** Small, clean version label under the Join card — mirrors the Android app's own
 *  drawer version text (BuildConfig.VERSION_NAME), just visible without digging into a
 *  menu since this page has no drawer. Bump WEB_VERSION by hand alongside meaningful
 *  releases. BUILD_NUMBER is read straight off this very file's own `?v=N` cache-buster
 *  (index.html's <script src="app.js?v=N">) via import.meta.url — no separate constant
 *  to remember to bump, it just always matches whatever was last deployed, so seeing it
 *  change on screen is a real, unfakeable confirmation that a fresh deploy actually
 *  landed (as opposed to the browser still running a cached copy of this file). */
// Character caps for everything a participant types here. Mirrors AppLimits.DEFAULT's
// maxResponseChars in the Android app.
//
// Hardcoded rather than fetched: this page never calls my_limits(), and it does not need
// to. The REAL enforcement is the server's own RLS check (see attempt_answers_insert_own
// and poll_votes_write_own in supabase/schema.sql) — this number only stops the browser
// before a rejection. Do NOT turn this into a fetched value and a second source of truth;
// if an admin lowers the cap, the server still refuses, which is the behaviour that matters.
const RESPONSE_MAX_CHARS = 500;

// Mirrors FixedTextLimits.DISPLAY_NAME, and the literal in profiles_update_own's check —
// without it this page could write a name the server would simply refuse.
const DISPLAY_NAME_MAX_CHARS = 32;

const WEB_VERSION = "1.0";
const BUILD_NUMBER = new URL(import.meta.url).searchParams.get("v") || "?";

function appendLandingScreen(body) {
  main.appendChild(
    el("div", { class: "screen card-screen" }, [el("div", { class: "card landing-card" }, body)])
  );
}

/** Filled CTA with the trailing chevron every primary action on these cards carries. */
function primaryButton(label, onclick) {
  return el("button", { class: "primary", onclick }, [label, html(BTN_CHEVRON_SVG)]);
}

/** Replaces a Join/Start/Retake button while an admin has joining paused for maintenance —
 *  same info-box treatment as the sign-in blurb, so it reads as a status, not an error. */
function pausedNotice() {
  return el("div", { class: "info-box" }, [html(INFO_SVG), el("span", {}, [S.JOIN_PAUSED])]);
}

const BTN_CHEVRON_SVG = `<svg class="btn-chevron" viewBox="0 0 16 16" fill="none" width="16" height="16"><path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ARROW_RIGHT_SVG = `<svg class="btn-chevron" viewBox="0 0 16 16" fill="none" width="16" height="16"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const INFO_SVG = `<svg viewBox="0 0 20 20" fill="none" width="18" height="18"><circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.6"/><path d="M10 9v4.5M10 6.5v.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const QUESTION_MARK_SVG = `<svg viewBox="0 0 20 20" fill="none" width="14" height="14"><circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.6"/><path d="M7.8 8a2.2 2.2 0 114.1 1.1c-.6.9-1.9 1.2-1.9 2.4M10 14h.01" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const USER_SVG = `<svg viewBox="0 0 24 24" fill="none" width="20" height="20"><circle cx="12" cy="8.5" r="3.5" stroke="#fff" stroke-width="1.8"/><path d="M5.5 19c.8-3.2 3.3-4.8 6.5-4.8s5.7 1.6 6.5 4.8" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const EDIT_PENCIL_SVG = `<svg viewBox="0 0 20 20" fill="none" width="16" height="16"><path d="M4 13.5V16h2.5l7.4-7.4-2.5-2.5L4 13.5zM12.6 4.9l2.5 2.5 1.2-1.2a1 1 0 000-1.4l-1.1-1.1a1 1 0 00-1.4 0l-1.2 1.2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
const CLEAR_X_SVG = `<svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const TICK_SVG = `<svg viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CLIPBOARD_SVG = `<svg viewBox="0 0 20 20" fill="none" width="15" height="15"><rect x="5" y="4" width="10" height="13" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 4V3h4v1M8 9h4M8 12h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

/** One-time gate right after a brand-new signup (profiles.name_confirmed = false) —
 *  mirrors the Android app's ConfirmNameScreen. Blocking, no skip: some Google
 *  accounts have the wrong/nickname-y name attached, and this is what the quiz
 *  creator and other participants will see this person as everywhere else. */
function renderConfirmName() {
  if (state.confirmNameDraft == null) {
    state.confirmNameDraft = SC.resolveDisplayName(state.user);
  }
  const trimmed = (state.confirmNameDraft || "").trim();
  const googleName = SC.resolveDisplayName(state.user);

  const counter = el("span", { class: "field-counter" }, [S.charCount((state.confirmNameDraft || "").length, DISPLAY_NAME_MAX_CHARS)]);
  // "Synced from Google" only holds while the field still says what Google said.
  const synced = el("p", { class: "field-helper synced" }, [html(TICK_SVG), S.CONFIRM_NAME_SYNCED]);
  const refresh = (value) => {
    saveBtn.disabled = state.confirmNameSaving || value.trim().length === 0;
    counter.textContent = S.charCount(value.length, DISPLAY_NAME_MAX_CHARS);
    synced.style.display = value === googleName ? "" : "none";
  };

  const input = el("input", {
    type: "text",
    value: state.confirmNameDraft || "",
    maxlength: String(DISPLAY_NAME_MAX_CHARS),
    placeholder: S.CONFIRM_NAME_PLACEHOLDER,
    autocomplete: "name",
    oninput: (e) => {
      state.confirmNameDraft = e.target.value;
      refresh(e.target.value);
    },
    onkeydown: (e) => { if (e.key === "Enter") submitConfirmedName(); },
  });
  const clearBtn = el("button", { class: "field-clear", type: "button", onclick: () => {
    state.confirmNameDraft = "";
    input.value = "";
    refresh("");
    input.focus();
  } }, [html(CLEAR_X_SVG)]);

  const saveBtn = primaryButton(state.confirmNameSaving ? S.SAVING : S.CONFIRM_NAME_SUBMIT, () => submitConfirmedName());
  saveBtn.disabled = state.confirmNameSaving || trimmed.length === 0;
  synced.style.display = (state.confirmNameDraft || "") === googleName ? "" : "none";

  const body = [
    el("span", { class: "pill dotted" }, [S.CONFIRM_NAME_KICKER]),
    el("div", { class: "title-row" }, [
      el("h1", { class: "quiz-title" }, [state.nameEditReturn ? S.EDIT_NAME_TITLE : S.CONFIRM_NAME_TITLE]),
      el("span", { class: "title-badge" }, [html(USER_SVG)]),
    ]),
    el("p", { class: "quiz-meta" }, [S.CONFIRM_NAME_BLURB]),
    el("div", { class: "field-head" }, [
      el("span", { class: "field-label" }, [S.CONFIRM_NAME_LABEL]),
      counter,
    ]),
    el("div", { class: "name-field" }, [html(EDIT_PENCIL_SVG), input, clearBtn]),
    synced,
  ];
  if (state.confirmNameError) {
    body.push(el("p", { class: "muted", style: "color:var(--error)" }, [state.confirmNameError]));
  }
  body.push(
    saveBtn,
    el("button", { class: "text-link", onclick: () => cancelConfirmName() }, [
      state.nameEditReturn ? S.CONFIRM_NAME_CANCEL_EDIT : S.CONFIRM_NAME_CANCEL,
    ])
  );

  main.appendChild(el("div", { class: "screen card-screen" }, [el("div", { class: "card confirm-card" }, body)]));
}

/** Cancel has two meanings on this one screen.
 *
 *  As the first-login GATE (nameEditReturn == null) it is "Cancel & Sign out" — wrong
 *  account picked. Back to the signed-out landing card (signOutAction already
 *  re-renders); the draft is dropped so the next account's Google name is picked up
 *  fresh instead of this one's leftover edit.
 *
 *  Reached as an EDIT from the account menu, signing out would be a trap: changing your
 *  mind about your name must not cost you your session. Then it just goes back. */
async function cancelConfirmName() {
  const returnTo = state.nameEditReturn;
  state.confirmNameDraft = null;
  state.confirmNameError = null;
  state.nameEditReturn = null;
  if (returnTo) {
    finishNameEdit(returnTo);
    return;
  }
  state.screen = "landing";
  await signOutAction();
}

/** Where an EDIT (as opposed to the first-login gate) goes when it is done.
 *  HOME_RETURN leaves this app for the site root — replace(), not assign(), so the
 *  ?edit=name URL doesn't sit in history waiting to re-open the editor the moment the
 *  visitor presses Back from the home page. */
function finishNameEdit(returnTo) {
  if (returnTo === HOME_RETURN) {
    window.location.replace("/");
    return;
  }
  state.screen = returnTo;
  render();
}

async function submitConfirmedName() {
  const name = (state.confirmNameDraft || "").trim();
  if (!name || state.confirmNameSaving) return;
  state.confirmNameSaving = true;
  state.confirmNameError = null;
  render();
  try {
    await SC.confirmDisplayName(state.user.id, name);
    // Keep the in-memory user in sync so the "Signed in as ..." line on the landing
    // screen right after this reflects the corrected name without a re-fetch.
    state.user.user_metadata = { ...(state.user.user_metadata || {}), full_name: name, name };
    state.confirmNameSaving = false;
    // Back where the edit was opened from — "landing" is only right for the first-login
    // gate, which is the sole caller that leaves nameEditReturn null.
    const returnTo = state.nameEditReturn;
    state.nameEditReturn = null;
    state.confirmNameDraft = null;
    if (returnTo) {
      finishNameEdit(returnTo);
      return;
    }
    state.screen = "landing";
    render();
  } catch (e) {
    state.confirmNameSaving = false;
    state.confirmNameError = S.SAVE_NAME_FAILED;
    render();
  }
}

function currentQuestion() {
  return state.quiz.questions[state.currentIndex];
}

/** "SIGNED IN AS" account box — initials avatar (with an online dot) + the display name. */
function signedInLine(user) {
  const name = SC.resolveDisplayName(user);
  return el("div", { class: "signed-in-box" }, [
    el("div", { class: "avatar" }, [initialsOf(name), el("span", { class: "avatar-dot" }, [])]),
    el("div", { class: "signed-in-text" }, [
      el("span", { class: "overline" }, [S.SIGNED_IN_AS_LABEL]),
      el("span", { class: "signed-in-name" }, [name]),
    ]),
  ]);
}

/** "Muhammad Ahmed Tahir" -> "MT" (first + last word), "Ahmad" -> "A", "" -> "?". */
function initialsOf(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/** "Sign out" escape hatch — wrong Google account picked, or just wants to switch,
 *  shouldn't mean reloading the tab and hunting for a way out. Deliberately its own
 *  full-width row below the primary action (Join/Start), separated by a divider line —
 *  sitting right next to that button risked a mis-tap signing someone out by accident. */
function signOutRow() {
  return el("div", { class: "sign-out-row" }, [
    el("span", { class: "sign-out-prefix" }, [S.SIGN_OUT_PREFIX]),
    el("button", { class: "skip-link sign-out-link", onclick: signOutAction }, [S.SIGN_OUT]),
  ]);
}

async function signOutAction() {
  // Tracked (and reset) before signOut actually clears the session — reset() rotates
  // the distinct id, so this must still land under the outgoing account, same ordering
  // as SupabaseAuthRepository.signOut() on the Android side.
  window.Analytics.track("signed_out");
  window.Analytics.reset();
  await SC.signOut();
  // Back to square one on this same landing card — sign-in button reappears, and any
  // in-progress Join/Start state for the account that just signed out no longer applies.
  state.user = null;
  state.hasJoined = false;
  state.joinError = null;
  state.existingAttempt = null;
  state.lastStartedAt = null;
  render();
}

async function joinQuizAction() {
  if (state.joining) return;
  // The landing card was rendered once when the quiz was still Active and doesn't
  // re-render on its own while sitting open (only a Scheduled countdown ticks) — so a
  // tab left open past the deadline could still fire this write. Re-check live, right
  // before the write, instead of trusting whatever status the button was drawn under.
  if (SC.effectiveStatus(state.quiz) !== "ACTIVE") {
    render();
    return;
  }
  // Defense in depth: the Join button is already hidden while paused (renderLanding), but
  // an admin could flip the switch after this tab loaded and before this tap landed. The
  // real backstop is the server's own joined_quizzes_insert_own check either way.
  if (!state.flags.joinQuizEnabled) {
    state.joinError = S.JOIN_PAUSED;
    render();
    return;
  }
  state.joining = true;
  state.joinError = null;
  render();
  try {
    await SC.joinQuiz(state.user.id, state.quiz.id);
    state.hasJoined = true;
    window.Analytics.track("quiz_joined", { quiz_id: state.quiz.id });
  } catch (e) {
    state.joinError = S.JOIN_FAILED;
  }
  state.joining = false;
  render();
}

/** Fetches the existing attempt's full answers and switches straight to the result
 *  screen — shared by boot()'s no-retake auto-redirect and the "See Result" button
 *  offered alongside "Retake Exam" when retake is allowed (see renderLanding). */
async function goToExistingResult() {
  const answers = await SC.fetchAttemptAnswers(state.existingAttempt.id);
  // A poll this account skipped that has since closed is hidden from them here too — but one
  // they voted on stays. Same rule as while taking (pruneHiddenPolls / QuizPreviewViewModel).
  await pruneHiddenPolls();
  const pollItems = await buildResultPollItems(state.quiz, state.user);
  state.result = { score: state.existingAttempt.score, total: state.existingAttempt.total, answers, pollItems };
  openResultScreen();
}

/** Every review card starts expanded and the filter on "All" — the review is the point
 *  of this screen, so nothing should need a tap to be seen. */
function openResultScreen() {
  state.resultFilter = "all";
  state.resultAnimated = false; // the score counts up once per result
  // On a phone the details start folded away — there is no room to show them and the
  // score is what the taker came for. On a desktop the width is already there and the
  // review cards flow into columns, so folding them costs two clicks and buys nothing.
  // Read once here rather than watched: a later resize must not re-fold a section the
  // taker has since opened by hand.
  const wideResult = !state.compactView && window.matchMedia("(min-width: 900px)").matches;
  state.resultSummaryOpen = wideResult;
  state.resultReviewOpen = wideResult;
  state.resultJustToggled = null;
  expandedReviews.clear();
  expandedPollReviews.clear();
  state.quiz.questions.forEach((q) => { expandedReviews.add(q.id); expandedPollReviews.add(q.id); });
  state.screen = "result";
  render();
}

/** "Retake Exam" when retake is allowed and this account already has a result — joins
 *  first if this session somehow doesn't already show as joined (e.g. a fresh browser/
 *  device that never loaded the join state for this quiz before), same as a first-time
 *  Join would, then starts a fresh attempt exactly like the ordinary Start Quiz button. */
async function retakeQuizAction() {
  if (!state.hasJoined) {
    await joinQuizAction();
    if (!state.hasJoined) return; // join failed — joinQuizAction already surfaced why
  }
  startQuiz();
}

async function startQuiz() {
  // Same re-check as joinQuizAction, for the same reason — a tab left open past the
  // deadline must not be able to start (and then submit) a quiz that's since ended,
  // just because the button was drawn while it was still Active.
  if (SC.effectiveStatus(state.quiz) !== "ACTIVE") {
    render();
    return;
  }
  // Drop any poll that's already closed and this person never voted on — nothing for them
  // to do with it, and it shouldn't count in "Question X of N" / the progress bar. Mirrors
  // QuizPreviewViewModel.loadQuiz's pre-filter. Spinner while its reads round-trip.
  state.screen = "loading";
  render();
  await pruneHiddenPolls();
  if (state.quiz.questions.length === 0) {
    // Poll-only quiz whose every poll has already closed for this person — nothing to answer.
    leaveQuiz(S.POLL_ALL_CLOSED);
    return;
  }
  // Re-read the stamp rather than trusting the one boot() loaded: this quiz may have been
  // started (and left) in the Android app, or another tab, since this card was drawn.
  // Retakes off + started before + nothing submitted = that one try is used up.
  if (state.quiz.allowRetake === false && !state.existingAttempt) {
    const startedBefore = await SC.fetchLastStartedAt(state.quiz.id, state.user.id);
    if (startedBefore) {
      state.lastStartedAt = startedBefore;
      state.screen = "landing";
      render();
      return;
    }
  }
  // Stamps joined_quizzes.last_started_at — mirrors QuizPreviewViewModel.loadQuiz calling
  // markQuizStarted, so leaving without submitting is remembered here too (and the owner
  // gets the same "X started your quiz" notification). Never blocks the attempt: a failed
  // stamp is no reason to refuse someone the quiz they are entitled to take.
  try {
    await SC.markQuizStarted(state.user.id, state.quiz.id);
    state.lastStartedAt = Date.now();
  } catch (e) {
    /* offline / transient — carry on */
  }
  state.currentIndex = 0;
  // Reset alongside currentIndex, because this is a single-page app and `state` outlives an
  // attempt: a retake in the same tab starts with whatever the last one left behind. A stale
  // isFinishing would make every advance() return early and freeze the Next button, and a
  // stale skipConfirmOpen would draw the dialog over question 1. (The app has neither problem
  // — a retake there gets a brand-new ViewModel.)
  state.isFinishing = false;
  state.skipConfirmOpen = false;
  state.screen = "quiz";
  render();
  prepareCurrentQuestion();
}

/** Removes from state.quiz.questions every POLL that's already CLOSED and this user never
 *  voted on — mirrors QuizPreviewViewModel.loadQuiz's pre-filter and the result screen's
 *  own filter (a pruned poll never reaches buildResultPollItems either). Read-only; no-op
 *  without a signed-in user. Fail-safe: a poll whose state we couldn't read counts as OPEN
 *  and stays. */
async function pruneHiddenPolls() {
  if (!state.user) return;
  const pollIds = state.quiz.questions.filter((q) => q.type === "POLL").map((q) => q.id);
  if (pollIds.length === 0) return;
  const [states, ...voteLists] = await Promise.all([
    SC.fetchPollStates(pollIds).catch(() => ({})),
    ...pollIds.map((id) => SC.fetchPollVotes(id).catch(() => [])),
  ]);
  const votedByMe = new Set();
  pollIds.forEach((id, i) => {
    if ((voteLists[i] || []).some((v) => v.voterKey === state.user.id)) votedByMe.add(id);
  });
  state.quiz.questions = state.quiz.questions.filter((q) => {
    if (q.type !== "POLL") return true;
    const status = (states[q.id] && states[q.id].status) || "OPEN";
    return !PL.pollHiddenForNonVoter(status, votedByMe.has(q.id));
  });
}

function prepareCurrentQuestion() {
  const q = currentQuestion();
  state.selectedAnswers = new Set();
  state.writtenAnswer = "";
  state.fillBlankDraft = q.type === "FILL_BLANK" && q.fillBlankContent
    ? new Array(FB.orderedBlanks(q.fillBlankContent).length).fill("")
    : [];
  state.instantFeedback = null;
  state.hintVisible = false;
  state.questionStartSec = Math.floor(Date.now() / 1000);
  if (q.type === "POLL") {
    // Polls are never previewed — and a preview left over from an earlier question (its
    // timeout bails once the question changes) must not keep this one hidden forever.
    clearTimeout(state.revealHandle);
    state.revealHandle = null;
    state.revealing = false;
    state.pollState = null;
    state.pollDisplayOrder = [];
    state.pollSelected = new Set();
    state.pollOtherText = "";
    state.pollReasonText = "";
    state.pollHasVoted = false;
    state.pollDistribution = null;
    state.pollConsensus = null;
    state.pollEditingVote = false;
    state.totalTimeSec = 0; // reset; loadPollForCurrentQuestion starts this taker's own
    state.secondsRemaining = 0; // countdown once the poll is known to be open
    render(); // loading state while ensurePollOpen/fetchPollVotes round-trip
    loadPollForCurrentQuestion(q);
    return;
  }
  const previewSec = state.quiz.questionPreviewSec || 0;
  // Mirrors revealsBeforeAnswering: a preview stage that ends by starting a timer makes
  // no sense to show when this question has no timer to start (quiz-wide "Show Timer"
  // off, or this question's own timeSec is 0) — same as it's skipped when the quiz's
  // preview setting itself is off.
  const questionHasTimer = state.quiz.showTimers && (q.timeSec || 0) > 0;
  if (previewSec > 0 && questionHasTimer) {
    startQuestionReveal(q, previewSec);
    return;
  }
  startTimer();
  render();
}

/** Mirrors QuizPreviewViewModel.prepareCurrentQuestion's preview branch: the question
 *  shows alone for [sec] seconds, then its choices and timer appear. questionStartSec is
 *  reset at that moment so the reading time never counts as answer time (time taken and
 *  time weightage both read it). */
function startQuestionReveal(q, sec) {
  if (state.screen !== "quiz") return;
  clearInterval(state.timerHandle);
  clearTimeout(state.revealHandle);
  state.totalTimeSec = 0;
  state.secondsRemaining = 0;
  state.revealing = true;
  state.revealStartedAt = Date.now();
  render();
  state.revealHandle = setTimeout(() => {
    state.revealHandle = null;
    if (!state.revealing || currentQuestion()?.id !== q.id) return;
    state.revealing = false;
    state.questionStartSec = Math.floor(Date.now() / 1000);
    state.revealJustEnded = true;
    startTimer();
    render();
    state.revealJustEnded = false;
  }, sec * 1000);
}

/** False once the taker has moved past [q] or left the quiz — async work started for a
 *  question must not act on whatever replaced it. */
function isStillOnQuestion(q) {
  return state.screen === "quiz" && currentQuestion()?.id === q.id;
}

/** Opens the poll on first visit (lazy — mirrors PollRepository.ensureOpen:
 *  the poll's clock starts the first time ANYONE, on any device, reaches this
 *  question), pre-fills this voter's own existing vote if they've been here
 *  before, and computes the static distribution once closed. Mirrors
 *  QuizPreviewViewModel.loadPollForCurrentQuestion() exactly. */
async function loadPollForCurrentQuestion(q) {
  const settings = PL.pollSettingsOrDefaults(q.pollSettings);
  let opened;
  try {
    opened = await SC.ensurePollOpen(q.id);
  } catch (e) {
    // RLS rejects a non-owner's very first open (poll_states writes are
    // owner-only — same latent gap the Android app has today, see schema.sql).
    // Falls back to a local-only "just opened now" state so voting still works
    // for this visitor even though it never reaches other devices.
    opened = { status: "OPEN", opened_at: Date.now(), closes_at: null };
  }
  // Stale question guard — the user may have already swiped past this question
  // (Next/Skip/timer) or left the quiz by the time this round-trip resolves. Re-checked
  // after EVERY await below: resuming onto a question they've left used to skip the next
  // question outright and could strand a question preview on screen.
  if (!isStillOnQuestion(q)) return;

  // Only an explicit close counts. A passed closes_at used to close the poll for everyone,
  // which meant the first person to reach the question locked out everyone who arrived
  // later — see PollState.closesAt in PollModels.kt.
  const effectiveClosed = opened.status === "CLOSED";

  const votes = (await SC.fetchPollVotes(q.id).catch(() => [])) || [];
  if (!isStillOnQuestion(q)) return;
  state.pollState = opened;
  const myVote = votes.find((v) => v.voterKey === state.user.id) || null;

  if (PL.pollHiddenForNonVoter(effectiveClosed ? "CLOSED" : "OPEN", myVote != null)) {
    // Closed while this taker was mid-quiz and they never voted — pruneHiddenPolls at Start
    // couldn't have known. Move on like a normal Next (proceedPastQuestion finishes the quiz
    // if this was the last, and re-runs prepareCurrentQuestion so a run of closed polls chains).
    proceedPastQuestion();
    return;
  }

  state.pollHasVoted = myVote != null;
  state.pollEditingVote = false;
  if (myVote) {
    state.pollSelected = new Set(myVote.selectedOptionIndices || []);
    state.pollOtherText = myVote.otherText || "";
    state.pollReasonText = myVote.reason || "";
  }

  // Not just CLOSED — re-entering a poll already voted on (e.g. resuming mid-quiz)
  // reveals results immediately too, same as a fresh vote does (see advance()).
  // Unless the owner kept the results to themselves: leaving pollDistribution null makes
  // render() fall through to the voting body, which already shows "✓ You voted".
  if ((effectiveClosed || myVote) && PL.pollResultsVisibleToVoters(settings)) {
    const distribution = PL.computePollDistribution(q.options || [], votes);
    state.pollDistribution = distribution;
    state.pollConsensus = PL.computePollConsensus(distribution);
  }
  if (!effectiveClosed) {
    const optionCount = (q.options || []).length;
    state.pollDisplayOrder = settings.shuffleOptions
      ? PL.pollShuffledOrder(state.user.id, q.id, optionCount)
      : Array.from({ length: optionCount }, (_, i) => i);
    // This taker's own countdown, starting now — the same per-question timer every other
    // question type gets. When it runs out it just advances them; it never closes the poll.
    // Same quiz-wide "Show Timer" gate as startTimer() — was missing here too.
    const pollTimeSec = (!state.quiz.showTimers || settings.noTimeLimit) ? 0 : (q.timeSec || 0);
    if (pollTimeSec > 0) {
      state.totalTimeSec = pollTimeSec;
      state.secondsRemaining = pollTimeSec;
      state.timerHandle = setInterval(() => {
        state.secondsRemaining -= 1;
        if (state.secondsRemaining <= 0) {
          clearInterval(state.timerHandle);
          advance(true);
          return;
        }
        updateTimerDisplay();
      }, 1000);
    } else {
      state.totalTimeSec = 0;
      state.secondsRemaining = 0;
    }
  }
  render();
}

function startTimer() {
  clearInterval(state.timerHandle);
  if (state.screen !== "quiz") return;
  const q = currentQuestion();
  // Mirrors QuizPreviewViewModel.prepareCurrentQuestion: `if (s0.quizShowTimers && ...)
  // question.timeSec else 0` — quiz-wide, no per-question override. This was never
  // checked here at all before, so turning "Show Timer" off on the quiz had no effect
  // on web: every question still ran its own timeSec countdown regardless.
  const timeSec = state.quiz.showTimers ? q.timeSec : 0;
  if (!timeSec || timeSec <= 0) {
    state.totalTimeSec = 0;
    state.secondsRemaining = 0;
    return;
  }
  state.totalTimeSec = timeSec;
  state.secondsRemaining = timeSec;
  state.timerHandle = setInterval(() => {
    state.secondsRemaining -= 1;
    if (state.secondsRemaining <= 0) {
      clearInterval(state.timerHandle);
      advance(true);
      return;
    }
    updateTimerDisplay();
  }, 1000);
}

function formatSeconds(total) {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** Mirrors QuizPreviewScreen's TimerChip (top bar) + TimerProgressBar (above the
 *  bottom bar) — both update every tick without a full re-render. */
function updateTimerDisplay() {
  if (state.totalTimeSec <= 0) return;
  const urgent = state.secondsRemaining <= 10;
  const chip = document.getElementById("timer-chip");
  if (chip) {
    chip.textContent = "";
    chip.appendChild(html(chip.classList.contains("poll-chip") ? BAR_CHART_SVG : CLOCK_SVG));
    chip.appendChild(document.createTextNode(formatSeconds(state.secondsRemaining)));
    chip.classList.toggle("urgent", urgent);
  }
  const fill = document.getElementById("timer-fill");
  if (fill) {
    fill.style.width = `${(state.secondsRemaining / state.totalTimeSec) * 100}%`;
    fill.classList.toggle("urgent", urgent);
  }
  // Same element-mutation-in-place trick as #timer-fill above (not a full re-render) —
  // this is what lets the CSS transition below actually animate every tick instead of
  // snapping, since the element persists across ticks instead of being torn down.
  const segFill = document.getElementById("current-progress-fill");
  if (segFill) {
    segFill.style.width = `${((state.totalTimeSec - state.secondsRemaining) / state.totalTimeSec) * 100}%`;
  }
  // Same in-place mutation for the skip dialog's "time left" line. It has to be updated from
  // here rather than by re-rendering: render() rebuilds the dialog from scratch, which would
  // throw away focus and restart its transition every second.
  const skipLeft = document.getElementById("skip-confirm-time");
  if (skipLeft) skipLeft.textContent = S.skipConfirmTimeLeft(formatSeconds(state.secondsRemaining));
}

function toggleAnswer(optionIndex) {
  const q = currentQuestion();
  const key = String(optionIndex);
  if (q.type === "MULTIPLE_CORRECT") {
    if (state.selectedAnswers.has(key)) {
      state.selectedAnswers.delete(key);
    } else {
      // Always capped at the number of correct options, regardless of
      // splitPointsAcrossChoices (mirrors QuizPreviewViewModel.onToggleAnswer) —
      // selecting more than that is guaranteed wrong under all-or-nothing scoring
      // too, so this is a pure UX guard with no scoring effect either way. A tap
      // past the cap is a no-op, blocked rather than evicting an earlier pick, so
      // the taker never loses a choice they didn't ask to lose. Skipped when
      // correctAnswers is empty — a manual-marking question genuinely has none
      // marked, and a cap of 0 would block every selection outright.
      const correctCount = (q.correctAnswers || []).length;
      const cap = correctCount > 0 ? correctCount : Infinity;
      if (state.selectedAnswers.size < cap) state.selectedAnswers.add(key);
    }
  } else {
    if (state.selectedAnswers.has(key)) state.selectedAnswers.clear();
    else { state.selectedAnswers.clear(); state.selectedAnswers.add(key); }
  }
  scheduleLastQuestionAutoFinish();
  render();
}

/** Poll's own toggle — separate from toggleAnswer() since options are already
 *  cast, and this respects allowMultiple + the "Other" sentinel index (-1)
 *  instead of the plain single/multi rule every other question type uses. */
function togglePollOption(optionIndex) {
  const q = currentQuestion();
  const settings = PL.pollSettingsOrDefaults(q.pollSettings);
  const locked = state.pollHasVoted && !settings.allowVoteChange;
  if (locked) return;
  if (settings.allowMultiple) {
    if (state.pollSelected.has(optionIndex)) state.pollSelected.delete(optionIndex);
    else state.pollSelected.add(optionIndex);
  } else {
    state.pollSelected = state.pollSelected.has(optionIndex) ? new Set() : new Set([optionIndex]);
  }
  render();
}

// Skip and Next both advance, but Skip throws away whatever is filled in first
// (see onSkip), so the question records as unanswered. Next, the countdown
// expiring, the poll auto-advance and the last-question auto-finish all keep
// what is there. Mirrors QuizPreviewViewModel's onSkip()/onNext() split.
/** What the Next/Finish button calls. Asks first when nothing is filled in, so a mistaken
 *  tap can't quietly cost the question. Mirrors QuizPreviewViewModel.onNextTapped.
 *
 *  The countdown keeps running behind the dialog; if it expires, its advance(true) closes
 *  the dialog and records the skip — the same outcome, reached without the taker. */
function onNext() {
  if (shouldConfirmSkip()) {
    state.skipConfirmOpen = true;
    render();
    return;
  }
  advance(true);
}
/** Skip means skip: advance(false) throws away anything already selected or typed before
 *  it can be recorded, so the question comes back as unanswered no matter what was on
 *  screen — a poll included, as it always has been.
 *
 *  Only this deliberate tap discards. The countdown running out, the poll auto-advance
 *  and the last-question auto-finish all call advance(true) and keep what is filled in,
 *  exactly as pressing Next would. Mirrors QuizPreviewViewModel.onSkip. */
function onSkip() { advance(false); }

/** The in-progress answer for the current question, back to how prepareCurrentQuestion
 *  leaves it — the fill-blank draft keeps one blank entry per blank so grading still
 *  lines up with the template. Clearing the live state (rather than just recording an
 *  empty answer) is also what keeps the instant-feedback card honest: it renders these
 *  fields, not the recorded answer. */
function clearCurrentAnswerDraft() {
  const q = currentQuestion();
  if (!q) return;
  state.selectedAnswers = new Set();
  state.writtenAnswer = "";
  state.fillBlankDraft = q.type === "FILL_BLANK" && q.fillBlankContent
    ? new Array(FB.orderedBlanks(q.fillBlankContent).length).fill("")
    : [];
  state.pollSelected = new Set();
  state.pollOtherText = "";
  state.pollReasonText = "";
}

function onSkipConfirmed() {
  state.skipConfirmOpen = false;
  advance(true);
}

function onSkipConfirmDismissed() {
  state.skipConfirmOpen = false;
  render();
}

/** The "Move on without answering?" dialog — the one modal on this page, and deliberately
 *  in-page rather than window.confirm() so the countdown behind it keeps running (see
 *  state.skipConfirmOpen). Mirrors the ConfirmActionDialog QuizPreviewScreen raises: title,
 *  body, a filled confirm and an outlined dismiss. */
function buildSkipConfirm() {
  const onLast = state.currentIndex === state.quiz.questions.length - 1;
  const children = [
    el("h2", { class: "skip-confirm-title" }, [S.SKIP_CONFIRM_TITLE]),
    el("p", { class: "skip-confirm-body" }, [onLast ? S.SKIP_CONFIRM_BODY_LAST : S.SKIP_CONFIRM_BODY]),
  ];
  // The clock is still running behind this dialog, so show it ticking rather than leaving the
  // taker to wonder. Only on a timed question — updateTimerDisplay keeps it current by id.
  if (state.totalTimeSec > 0) {
    children.push(el("p", { class: "skip-confirm-time", id: "skip-confirm-time" }, [
      S.skipConfirmTimeLeft(formatSeconds(state.secondsRemaining)),
    ]));
  }
  const card = el("div", { class: "skip-confirm-card", role: "alertdialog", "aria-modal": "true" }, [
    ...children,
    el("div", { class: "skip-confirm-actions" }, [
      el("button", { class: "secondary", type: "button", onclick: onSkipConfirmDismissed }, [S.SKIP_CONFIRM_NO]),
      el("button", { class: "primary", type: "button", onclick: onSkipConfirmed }, [S.SKIP_CONFIRM_YES]),
    ]),
  ]);
  // Backdrop taps read as "go back" — the safe half, same as dismissing the Android dialog.
  return el("div", {
    class: "skip-confirm-backdrop",
    onclick: (e) => { if (e.target.classList.contains("skip-confirm-backdrop")) onSkipConfirmDismissed(); },
  }, [card]);
}

/** A Next/Finish tap here would record a skip. Polls are exempt for the same reasons as on
 *  Android: outside scoring, Next *casts* the vote, and Skip Poll already covers passing. */
function shouldConfirmSkip() {
  const q = currentQuestion();
  return !!q && q.type !== "POLL" && !hasAnsweredCurrent();
}

/** Has the taker actually given an answer to the question they're on right now? For a poll
 *  that means a cast vote whose reveal is showing (not one reopened for editing). Mirrors
 *  QuizPreviewUiState.hasAnsweredCurrent. */
/** Did the taker actually put something down for [q], judged on what was RECORDED into
 *  state.questionAnswers — not on the live draft that hasAnsweredCurrent() reads. Skip
 *  deliberately throws the draft away before recording (see onSkip), and a timeout records
 *  whatever was there, so the recorded value is the one signal that covers skipped, timed
 *  out and never-touched alike. FILL_BLANK needs the per-blank check: its recorded array is
 *  a fixed-length draft that is still all-empty-strings when nothing was typed. */
function hasRecordedAnswer(q) {
  const recorded = state.questionAnswers[q.id] || [];
  if (q.type === "FILL_BLANK") return recorded.some((v) => (v || "").trim().length > 0);
  return recorded.length > 0;
}

function hasAnsweredCurrent() {
  const q = currentQuestion();
  if (!q) return false;
  if (q.type === "POLL") return state.pollHasVoted && !state.pollEditingVote;
  if (q.type === "WRITTEN") return state.writtenAnswer.trim().length > 0;
  if (q.type === "FILL_BLANK") return state.fillBlankDraft.some((v) => (v || "").trim().length > 0);
  return state.selectedAnswers.size > 0;
}

/** LAST question only: once it's actually answered, submit the quiz after a short grace
 *  period so the taker never has to hunt for "Finish" — the tail end of an answered mid-quiz
 *  question rolling on when its timer ends. Re-armed on every answer change; cancelled by a
 *  manual Finish/Skip, reopening a vote, or leaving. Never armed while the last question is
 *  still unanswered (its own countdown + the Finish button stay as-is). Mirrors
 *  QuizPreviewViewModel.scheduleLastQuestionAutoFinish. */
function scheduleLastQuestionAutoFinish() {
  clearTimeout(state.autoFinishHandle);
  state.autoFinishHandle = null;
  const isLast = state.currentIndex === state.quiz.questions.length - 1;
  if (!isLast || state.instantFeedback || !hasAnsweredCurrent()) return;
  // advance(), not onNext(): no automatic path may raise the skip dialog, since nobody is
  // there to answer it. (It only arms once hasAnsweredCurrent(), so this is belt-and-braces —
  // it also matches Android, where the auto-finish calls the raw onNext.)
  state.autoFinishHandle = setTimeout(() => { advance(true); }, 3000);
}

function cancelLastQuestionAutoFinish() {
  clearTimeout(state.autoFinishHandle);
  state.autoFinishHandle = null;
}

/** @param keepAnswer true for Next/Finish and for every automatic advance (the countdown
 *  expiring, the poll auto-advance, the last-question auto-finish): whatever is filled in
 *  is recorded and a poll vote is cast. False only for the Skip button, which discards it
 *  all first. Mirrors QuizPreviewViewModel.advance. */
async function advance(keepAnswer) {
  if (state.instantFeedback) return; // already mid-feedback — ignore stray taps
  if (state.revealing) return; // question still previewing on its own — nothing to answer yet
  // L-02, mirroring shouldSkipAdvanceTap: this function is async and awaits a poll cast and
  // the submit, so without this a second call can enter while the first is suspended and
  // submit the attempt twice. Reachable from the leave confirm racing a timer tick.
  if (state.isFinishing) return;
  // A real Finish/Skip tap (or the auto-finish firing) takes over from here.
  cancelLastQuestionAutoFinish();
  // However we got here — a tap, the countdown expiring, the poll auto-advance — this
  // question is settled, so the "move on without answering?" dialog has nothing left to ask
  // about. Clearing it here (rather than in the button handlers) is what makes the timer
  // case work: the dialog closes by itself and the question records as skipped.
  state.skipConfirmOpen = false;
  // Skip discards before anything reads the draft below, so the answer recorded is empty
  // and isAnswerSkipped() reports the question as skipped however much was filled in.
  if (!keepAnswer) clearCurrentAnswerDraft();
  const q = currentQuestion();
  clearInterval(state.timerHandle);

  if (q.type === "POLL") {
    const settings = PL.pollSettingsOrDefaults(q.pollSettings);
    const locked = state.pollHasVoted && !settings.allowVoteChange;
    // Only actually cast on a fresh vote or a deliberate re-vote (pollEditingVote) — an
    // ordinary "Next" tap after the reveal below already has nothing new to cast.
    if (keepAnswer && !locked && (!state.pollHasVoted || state.pollEditingVote) &&
        state.pollSelected.size > 0 && state.pollState) {
      const vote = {
        questionId: q.id,
        voterKey: state.user.id,
        selectedOptionIndices: Array.from(state.pollSelected),
        otherText: state.pollSelected.has(PL.POLL_OTHER_INDEX) ? state.pollOtherText : null,
        reason: state.pollReasonText || null,
        participantId: settings.anonymous ? null : state.user.id,
      };
      // Awaited now (was fire-and-forget) — the results reveal right below needs the
      // fresh vote list to actually include this vote.
      await SC.castPollVote(vote).catch(() => {});
      window.Analytics.track("poll_voted", { question_id: q.id });
      if (PL.pollResultsVisibleToVoters(settings)) {
        const votes = (await SC.fetchPollVotes(q.id).catch(() => [])) || [];
        const distribution = PL.computePollDistribution(q.options || [], votes);
        state.pollDistribution = distribution;
        state.pollConsensus = PL.computePollConsensus(distribution);
      }
      state.pollHasVoted = true;
      state.pollEditingVote = false;
      // Reveal the just-cast results in place instead of snapping straight past them —
      // same as a normal consumer poll. A second tap (button now reads Next/Finish, not
      // Vote) actually advances.
      render();
      // Last question: the vote's in and its results are showing — start the grace period
      // so the taker doesn't have to tap Finish.
      scheduleLastQuestionAutoFinish();
      return;
    }
    proceedPastQuestion();
    return;
  }

  const elapsed = Math.max(1, Math.floor(Date.now() / 1000) - state.questionStartSec);
  state.questionTimings[q.id] = elapsed;
  if (q.type === "WRITTEN") {
    state.questionAnswers[q.id] = state.writtenAnswer.trim() ? [state.writtenAnswer] : [];
  } else if (q.type === "FILL_BLANK") {
    state.questionAnswers[q.id] = [...state.fillBlankDraft];
  } else {
    state.questionAnswers[q.id] = Array.from(state.selectedAnswers);
  }

  const quiz = state.quiz;
  // Never flash right/wrong on a question the owner marks by hand — nobody has decided
  // yet, so any verdict shown here would be a guess we'd have to take back. And never on a
  // question they left empty (skipped, or the timer ran out): showing the answer to someone
  // who never attempted it just hands it over, and there is no verdict of theirs to confirm.
  if (quiz.showCorrectnessInstantly && !requiresManualMarking(q, quiz) && hasRecordedAnswer(q)) {
    const feedback = buildInstantFeedback(q, state.questionAnswers[q.id] || []);
    state.instantFeedback = feedback;
    render();
    // Tracked so leaving mid-pause (the X) can cancel it — otherwise the quiz kept going
    // behind the "closed" screen and could still submit an attempt the taker abandoned.
    state.feedbackHandle = setTimeout(() => {
      state.feedbackHandle = null;
      proceedPastQuestion();
    }, feedback.isCorrect ? 1100 : 1900);
    return;
  }
  proceedPastQuestion();
}

function buildInstantFeedback(q, rawKeys) {
  if (q.type === "SINGLE_CHOICE" || q.type === "MULTIPLE_CORRECT" || q.type === "TRUE_FALSE") {
    const selectedIndices = new Set(rawKeys.map(Number).filter((n) => !Number.isNaN(n)));
    const options = q.options || [];
    const correctTexts = new Set(q.correctAnswers || []);
    const correctIndices = new Set(options.map((_, i) => i).filter((i) => correctTexts.has(options[i])));
    // MULTIPLE_CORRECT goes through the shared rule (mirrors Android's buildInstantFeedback)
    // so an any-one-is-enough question can't flash red here and then score as correct.
    const eq = q.type === "MULTIPLE_CORRECT"
      ? window.Evaluator.isMultipleCorrectAnswer(correctIndices, selectedIndices, !!q.acceptAnyCorrect)
      : selectedIndices.size === correctIndices.size && [...selectedIndices].every((i) => correctIndices.has(i));
    return { isCorrect: eq, correctOptionIndices: correctIndices, wrongSelectedIndices: new Set([...selectedIndices].filter((i) => !correctIndices.has(i))) };
  }
  if (q.type === "WRITTEN") {
    const userInput = rawKeys[0] || "";
    const expected = q.writtenAnswer || "";
    let correct = false;
    if (userInput.trim()) {
      // No expected answer was ever set — nothing to grade against, so any attempt
      // at all counts as correct rather than being auto-failed.
      if (!expected.trim()) {
        correct = true;
      } else {
        const rule = q.answerRule || defaultAnswerRule();
        // Math.max(points, 1): see finishQuiz — a no-marks question would otherwise
        // multiply every verdict down to zero and always read as wrong.
        correct = computeScore(evaluate(userInput, expected, rule), Math.max(q.points, 1), rule) > 0;
      }
    }
    return { isCorrect: correct, correctWrittenAnswer: !correct && expected.trim() ? expected : null };
  }
  if (q.type === "FILL_BLANK" && q.fillBlankContent) {
    const blankCorrectness = FB.fillBlankCorrectness(q.fillBlankContent, rawKeys);
    return { isCorrect: blankCorrectness.length > 0 && blankCorrectness.every(Boolean), blankCorrectness };
  }
  return { isCorrect: true };
}

function proceedPastQuestion() {
  // Anything still scheduled after the taker left (or the quiz finished) is a no-op.
  if (state.screen !== "quiz") return;
  cancelLastQuestionAutoFinish();
  if (state.currentIndex === state.quiz.questions.length - 1) {
    finishQuiz();
    return;
  }
  state.currentIndex += 1;
  prepareCurrentQuestion();
}

/** Mirrors Grading.kt's requiresManualMarking: all-or-nothing at the quiz level, no
 *  per-question override. Polls are never hand-marked — nothing to be right about. */
function requiresManualMarking(q, quiz) {
  return q.type !== "POLL" && quiz.manualMarkingDefault === true;
}

async function finishQuiz() {
  // L-02: set before the first await below, so a second advance() landing mid-submit sees it
  // already flipped. Cleared only where this function bails out and leaves the taker on the
  // quiz; a successful submit navigates away and the flag goes with the attempt.
  state.isFinishing = true;
  state.screen = "finishing";
  render();

  // Mirrors QuizPreviewViewModel.finishPreview on Android — the landing/Start-Quiz status
  // check only ever ran once, when this taker opened the quiz; it has no way to know the
  // owner ended it (manually, or its own schedule ran out) sometime after that, while this
  // taker was still mid-quiz answering. Re-fetch fresh here, right before the submission
  // would otherwise land, instead of trusting the possibly-stale state.quiz already in memory.
  const liveStatus = await SC.fetchQuizStatus(state.quiz.id);
  if (liveStatus && (liveStatus.isArchived || SC.effectiveStatus(liveStatus) !== "ACTIVE")) {
    state.errorMessage = S.SUBMIT_QUIZ_CLOSED;
    state.screen = "error";
    render();
    return;
  }
  // Same staleness concern as the status check above: state.quiz was only ever fetched once,
  // at page load (boot()), and never refreshed — an owner flipping manual marking, split-points,
  // time-weightage, or show-timers mid-quiz would otherwise silently score this submission
  // under whatever was current when the tab first loaded. fetchQuizStatus's select() already
  // carries these too, so this reuses that same round-trip rather than firing a second one.
  if (liveStatus) {
    state.quiz.manualMarkingDefault = liveStatus.manualMarkingDefault;
    state.quiz.splitPointsAcrossChoices = liveStatus.splitPointsAcrossChoices;
    state.quiz.timeWeightageEnabled = liveStatus.timeWeightageEnabled;
    state.quiz.showTimers = liveStatus.showTimers;
  }

  // Mirrors QuizPreviewViewModel.finishPreview on Android — an owner's remove-participant
  // action deletes this taker's joined_quizzes row remotely at any point during the quiz,
  // and nothing earlier in this flow would know. `=== false` specifically (not `!== true`):
  // null means the check itself failed (offline/error), which must never itself block a
  // legitimate submission — only a confirmed "no" does.
  if ((await SC.isJoined(state.quiz.id, state.user.id)) === false) {
    state.errorMessage = S.SUBMIT_REMOVED;
    state.screen = "error";
    render();
    return;
  }

  const evaluator = window.Evaluator;
  const scored = state.quiz.questions.filter((q) => q.type !== "POLL");
  const answers = scored.map((q) => {
    const rawKeys = state.questionAnswers[q.id] || [];
    let given;
    if (q.type === "WRITTEN" || q.type === "FILL_BLANK") given = rawKeys;
    else given = rawKeys.map((k) => (q.options || [])[Number(k)]).filter((v) => v !== undefined);

    // Hand-marked questions skip evaluation entirely and submit as pending, exactly as
    // QuizPreviewViewModel.finishPreview does. Grading them here would hand the taker a
    // verdict the owner never gave — and one the owner's marking would then overwrite.
    const isManual = requiresManualMarking(q, state.quiz);

    let isCorrect = false;
    // rawPoints mirrors exactly what awardedPoints was before split-points/time-weightage
    // existed for every type except a split-points-enabled MULTIPLE_CORRECT — see
    // QuizPreviewViewModel.finishPreview's identical comment on the Android side.
    let rawPoints = 0;
    // Populated only for an auto-graded WRITTEN answer with something on both sides to
    // actually compare — mirrors Android's evalResult, which is likewise null for the
    // trivial blank-input/blank-expected-answer cases. Used by the review card to show
    // the same status label/points/word-by-word detail Android's WrittenEvalRow does,
    // instead of a flat correct/wrong line with no explanation of *why*.
    let evaluationResult = null;
    if (!isManual) {
      if (q.type === "WRITTEN") {
        const userInput = given[0] || "";
        const expected = q.writtenAnswer || "";
        if (!userInput.trim()) {
          isCorrect = false;
          rawPoints = 0;
        } else if (!expected.trim()) {
          // No expected answer was ever set — any attempt counts as correct, for full marks.
          isCorrect = true;
          rawPoints = q.points;
        } else {
          const rule = q.answerRule || defaultAnswerRule();
          evaluationResult = evaluator.evaluate(userInput, expected, rule);
          // Math.max(points, 1): for a 0-points (correctness-track) question, computeScore
          // against the real points (0) would always read as 0 regardless of verdict — score
          // against a nominal 1 purely to read off correctness.
          const nominalPoints = Math.max(q.points, 1);
          const earned = evaluator.computeScore(evaluationResult, nominalPoints, rule);
          isCorrect = earned > 0;
          // G-01: the marks track's award IS whatever computeScore returned, not a flat
          // "correct means full marks" — mirrors QuizPreviewViewModel.finishPreview's
          // identical fix on the Android side. A 0-points question earns 0 either way.
          rawPoints = q.points > 0 ? Math.round(earned) : 0;
        }
      } else if (q.type === "FILL_BLANK") {
        isCorrect = q.fillBlankContent ? FB.fillBlankIsQuestionCorrect(q.fillBlankContent, given) : false;
        rawPoints = isCorrect ? q.points : 0;
      } else if (q.type === "MULTIPLE_CORRECT") {
        // By option position, same as buildInstantFeedback — both verdicts come from
        // evaluator.isMultipleCorrectAnswer (mirrors Android's finishPreview).
        const options = q.options || [];
        const correctIdx = options.map((_, i) => i).filter((i) => (q.correctAnswers || []).includes(options[i]));
        const pickedIdx = new Set(rawKeys.map(Number).filter((n) => !Number.isNaN(n)));
        const acceptAny = !!q.acceptAnyCorrect;
        if (state.quiz.splitPointsAcrossChoices) {
          // Correctness is a set comparison inside scoreSplitMultipleCorrect, not
          // "rawPoints === q.points" as it used to be — see that function's doc in
          // evaluator.js for the two ways that comparison marked wrong answers correct.
          const scored = evaluator.scoreSplitMultipleCorrect(correctIdx, pickedIdx, q.points, acceptAny);
          rawPoints = scored.rawPoints;
          isCorrect = scored.isCorrect;
        } else {
          isCorrect = evaluator.isMultipleCorrectAnswer(new Set(correctIdx), pickedIdx, acceptAny);
          rawPoints = isCorrect ? q.points : 0;
        }
      } else {
        const a = new Set(given), b = new Set(q.correctAnswers || []);
        isCorrect = a.size === b.size && [...a].every((x) => b.has(x));
        rawPoints = isCorrect ? q.points : 0;
      }
    }

    // Uniform across every scored type — no-op when the toggle is off or this question
    // has no active timer (see applyTimeWeightage's doc in evaluator.js).
    const elapsedSec = state.questionTimings[q.id] || 0;
    const effectiveTimeLimitSec = state.quiz.showTimers ? q.timeSec : 0;
    const finalPoints = evaluator.applyTimeWeightage(rawPoints, elapsedSec, effectiveTimeLimitSec, state.quiz.timeWeightageEnabled);

    return {
      questionId: q.id,
      isCorrect,
      givenAnswers: given,
      timeTakenSec: elapsedSec,
      needsManualMarking: isManual,
      // null on a manual answer is what marks it pending — a blank answer included, so the
      // owner's queue counts every question. Mirrors QuizPreviewViewModel.finishPreview.
      awardedPoints: isManual ? null : finalPoints,
      maxPoints: q.points,
      usedHint: state.hintUsed[q.id] === true,
      // In-memory only for this same-session review — attempt_answers has no column for
      // it (mirrors what's actually persisted), same as Android's evalResult isn't
      // re-derivable after the fact either without re-running the evaluator.
      evaluationResult,
    };
  });

  // Pending answers can't count yet — the owner's marking recomputes this server-side.
  const score = answers.filter((a) => a.isCorrect && !a.needsManualMarking).length;

  SC.submitAttempt(state.quiz.id, state.user.id, score, scored.length, answers)
    .then(async () => {
      window.Analytics.track("attempt_submitted", {
        quiz_id: state.quiz.id,
        score: score,
        total: scored.length
      });
      const pollItems = await buildResultPollItems(state.quiz, state.user);
      state.result = { score, total: scored.length, answers, pollItems };
      openResultScreen();
    })
    .catch((err) => {
      // Backstop for a race (e.g. two tabs submitting at once) — the landing-page
      // check above normally catches this first, but the server is the real guard.
      state.errorMessage = err.message === "RETAKE_NOT_ALLOWED"
        ? S.SUBMIT_NO_RETAKE
        : S.SUBMIT_SAVE_FAILED_PREFIX + (err.message || err);
      state.screen = "error";
      render();
    });
}

/** Top bar: X close, title + "(Nq)", timer chip (poll chip on a poll) — mirrors
 *  QuizScreenComponents.kt's QuizTopBar. */
function buildQuizTopBar(quiz, q) {
  const closeBtn = el("button", { class: "icon-btn", onclick: () => { if (confirmLeave()) leaveQuiz(S.QUIZ_CLOSED); } }, []);
  closeBtn.appendChild(html(CLOSE_X_SVG));

  // Reserved-width slot either way, so the title stays centered whether or not
  // this question has a timer. Gated on quiz.showTimers too, not just q.timeSec — an
  // empty timer-chip pill was rendering (and reserving layout space) even with the
  // quiz-wide "Show Timer" setting off, since this check ignored it entirely.
  let right;
  if (q.type === "POLL") {
    // A timed poll's countdown is filled in by updateTimerDisplay (same #timer-chip id);
    // an untimed one just says "Poll".
    right = state.totalTimeSec > 0
      ? el("div", { id: "timer-chip", class: "timer-chip poll-chip" }, [])
      : el("div", { class: "timer-chip poll-chip" }, [html(BAR_CHART_SVG), S.POLL_CHIP]);
  } else if (quiz.showTimers && q.timeSec > 0 && !state.revealing) {
    right = el("div", { id: "timer-chip", class: "timer-chip" }, []);
  } else {
    right = el("div", { class: "topbar-spacer" }, []);
  }

  const title = el("span", { class: "title" }, [
    quiz.title,
    el("span", { class: "title-count" }, [S.questionCountSuffix(quiz.questions.length)]),
  ]);
  return el("div", { class: "quiz-topbar" }, [closeBtn, title, right]);
}

/** One segment per question (Stories-style) rather than a single continuous bar —
 *  answered questions read as fully filled, the current one mid-fill, upcoming
 *  ones empty, so progress through the quiz is legible at a glance. */
// Tracks which question index last actually played its no-timer fill animation —
// renderQuiz() re-runs (and so re-calls this) on EVERY state change while a question is
// on screen (picking an option, typing, revealing a hint), not just on advancing to a
// new one. Without this guard, every full-DOM rebuild (see this file's render() doc)
// would recreate the current segment's fill element from scratch and replay its
// animation on every incidental click, instead of playing once when the question is
// actually reached.
let lastAnimatedProgressIndex = -1;

/** Current segment's fill tracks elapsed time within the question (Stories-style — the
 *  bar drains AS time passes, not "instantly filled the moment you arrive"), when the
 *  question actually has a timer running. Gets a stable id so updateTimerDisplay can
 *  keep nudging its width every tick the same way it already does #timer-fill, instead
 *  of a one-shot animation — that's what makes it track the countdown continuously
 *  rather than jumping once. Untimed questions (no timer to track) fall back to the
 *  one-shot "just arrived" fill instead, since there's nothing to animate against.
 */
function buildQuestionProgressBar(quiz) {
  const total = quiz.questions.length;
  // While the question previews on its own the current segment stays empty (nothing is
  // timed yet), and its one-shot fill is saved for when the choices actually arrive.
  const isNewQuestion = !state.revealing && lastAnimatedProgressIndex !== state.currentIndex;
  if (!state.revealing) lastAnimatedProgressIndex = state.currentIndex;
  const timed = state.totalTimeSec > 0;
  const segments = [];
  for (let i = 0; i < total; i++) {
    let fillPct = 0;
    let animate = false;
    let segId = null;
    if (i < state.currentIndex) {
      fillPct = 100;
    } else if (i === state.currentIndex) {
      if (state.revealing) {
        fillPct = 0;
      } else if (timed) {
        fillPct = ((state.totalTimeSec - state.secondsRemaining) / state.totalTimeSec) * 100;
        segId = "current-progress-fill";
      } else {
        // No timer on this question — nothing to track, so it just reads as "reached"
        // the same way completed segments do, via a one-shot @keyframes fill (CSS
        // `transition` can't animate this — a fresh element every render has nothing to
        // transition FROM, see the hint-box/instant-correctness fix earlier this session).
        fillPct = 100;
        animate = isNewQuestion;
      }
    }
    const props = { class: "progress-segment-fill" + (animate ? " filling" : ""), style: `width:${fillPct}%` };
    if (segId) props.id = segId;
    segments.push(el("div", { class: "progress-segment" + (i === state.currentIndex ? " current" : "") }, [el("div", props)]));
  }
  return el("div", { class: "progress-track segmented" }, segments);
}

/** Bottom action bar: timer progress bar pinned above it, Skip + the tactile Next —
 *  mirrors QuizScreenComponents.kt's QuizBottomBar. */
function buildBottomBar(q, isLastQuestion, onSkipFn, onNextFn) {
  const rows = [];
  // state.totalTimeSec, not q.timeSec — it's already the single source of truth computed
  // at question-load time (startTimer/loadPollForCurrentQuestion), correctly folding in
  // quiz.showTimers and a poll's own noTimeLimit; q.timeSec alone ignores both.
  if (state.totalTimeSec > 0) {
    rows.push(
      el("div", { class: "progress-track timer-track" }, [
        el("div", { id: "timer-fill", class: "progress-fill", style: `width:${(state.secondsRemaining / state.totalTimeSec) * 100}%` }),
      ])
    );
  }
  const disabled = !!state.instantFeedback;
  // "Vote" instead of Next/Finish while a poll still needs its vote-cast tap — even as
  // the last question, since this tap casts and reveals in place rather than moving on
  // (see advance()). Matches PreviewBottomBar's isPollQuestion label on Android.
  const showVoteLabel = q.type === "POLL" && (!state.pollHasVoted || state.pollEditingVote);
  const nextBtn = el("button", { class: "tactile-btn" + (showVoteLabel ? " wide" : ""), onclick: onNextFn }, []);
  if (disabled) nextBtn.disabled = true;
  nextBtn.appendChild(document.createTextNode(
    showVoteLabel ? S.NAV_VOTE : (isLastQuestion ? S.NAV_FINISH : S.NAV_NEXT)
  ));
  nextBtn.appendChild(html(CHEVRON_RIGHT_SVG));

  const skipBtn = el("button", { class: "quiz-skip", onclick: onSkipFn }, [showVoteLabel ? S.SKIP_POLL : S.SKIP]);
  if (disabled) skipBtn.disabled = true;

  rows.push(el("div", { class: "bar-row" }, [skipBtn, nextBtn]));
  // Slides up with the choices on the render right after a question preview ends.
  return el("div", { class: "quiz-bottombar" + (state.revealJustEnded ? " bar-in" : "") }, rows);
}

/** Mirrors QuizPreviewViewModel.onShowHint — marks this question's hint as used the
 *  moment it's opened (not only if the taker reads all the way through), and reveals it
 *  inline (see renderQuiz's hint-box, right below the question) rather than a popup, to
 *  keep this file's plain-DOM approach — no modal/bottom-sheet primitive exists here. */
function showHintAction() {
  if (state.instantFeedback || state.revealing) return;
  const q = currentQuestion();
  state.hintVisible = true;
  state.hintUsed[q.id] = true;
  render();
}

/** Inline hint reveal — mirrors HintSheetContent's "Got it" dismiss, just inline instead
 *  of a bottom sheet (see showHintAction's doc for why). */
function buildHintBox(hint) {
  return el("div", { class: "hint-box" }, [
    el("div", { class: "hint-box-header" }, [
      el("span", { class: "hint-box-title" }, [S.HINT]),
      el("button", { class: "skip-link", onclick: () => { state.hintVisible = false; render(); } }, [S.GOT_IT]),
    ]),
    el("p", { class: "hint-box-text" }, [hint]),
  ]);
}

/** "QUESTION X OF N" + Hint (and Anonymous on a poll) — mirrors the badge row in
 *  QuizPreviewScreen.kt. The number is gated by quiz.showQuestionNumbers. */
function buildBadgeRow(quiz, q) {
  // Defaults via pollSettingsOrDefaults, like every other settings read — this was `!== false`,
  // so a poll with no settings showed the lock and the "Anonymous" chip while castPollVote
  // stored the voter's id for that very same poll. QuizPreviewScreen.kt:469 is the twin.
  const anonymous = q.type === "POLL" && PL.pollSettingsOrDefaults(q.pollSettings).anonymous;
  const end = [];
  if (anonymous) end.push(el("span", { class: "anon-chip" }, [html(LOCK_SVG), S.ANONYMOUS]));
  if (q.hint) {
    const hintBtn = el("button", { class: "hint-link", onclick: showHintAction }, [html(BULB_SVG), S.HINT_BUTTON]);
    // Disabled during instant feedback: the question is settled, nothing left to hint at.
    if (state.instantFeedback) hintBtn.disabled = true;
    end.push(hintBtn);
  }
  if (!quiz.showQuestionNumbers && end.length === 0) return null;
  return el("div", { class: "badge-row" }, [
    quiz.showQuestionNumbers
      ? el("span", { class: "q-badge" }, [S.questionXofN(state.currentIndex + 1, quiz.questions.length)])
      : el("span", {}, []),
    el("div", { class: "badge-row-end" }, end),
  ]);
}

/** Question card with the accent bar — mirrors QuizScreenComponents.kt's QuestionCard.
 *  Fill Blank has an optional heading instead of a mandatory question text: the card
 *  shows just its helper line when the creator left it blank (the sentence itself is
 *  shown, interactively, below). */
function buildQuestionCard(q) {
  const title = q.type === "FILL_BLANK" ? (q.fillBlankContent?.title || "").trim() : q.text;
  const body = [];
  if (q.type === "POLL") body.push(el("div", { class: "q-overline" }, [S.POLL_OVERLINE]));
  if (title) {
    body.push(el("div", { class: "q-title" + (q.type === "TRUE_FALSE" ? " statement" : "") }, [renderMarkdown(title)]));
  }
  body.push(buildQuestionHelper(q));
  return el("div", { class: "q-card" }, [el("div", { class: "q-card-accent" }, []), el("div", { class: "q-card-body" }, body)]);
}

function buildQuestionHelper(q) {
  switch (q.type) {
    case "SINGLE_CHOICE":
      return el("div", { class: "q-helper" }, [S.HELPER_SINGLE_CHOICE]);
    case "MULTIPLE_CORRECT":
      // "Select all that apply" would tell an any-one-is-enough taker to keep ticking.
      return el("span", { class: "select-all-chip" }, [
        html(CHECKBOX_OUTLINE_SVG),
        q.acceptAnyCorrect ? S.SELECT_ANY_CORRECT : S.SELECT_ALL_THAT_APPLY,
      ]);
    case "TRUE_FALSE":
      return el("div", { class: "q-helper dot" }, [el("span", { class: "q-helper-dot" }, []), S.HELPER_TRUE_FALSE]);
    case "WRITTEN":
      return el("div", { class: "q-helper" }, [html(PENCIL_SVG), S.HELPER_WRITTEN]);
    case "FILL_BLANK":
      return el("div", { class: "q-helper" }, [html(TEXT_FIELDS_SVG), S.HELPER_FILL_BLANK]);
    default: {
      const settings = PL.pollSettingsOrDefaults(q.pollSettings);
      return el("div", { class: "q-helper" }, [
        S.pollHelper(
          settings.allowMultiple ? S.SELECT_ALL_THAT_APPLY : S.POLL_HELPER_SINGLE,
          // Truthy, like buildBadgeRow's chip — see the note there.
          settings.anonymous ? S.POLL_HELPER_ANONYMOUS : S.POLL_HELPER_NAMED
        ),
      ]);
    }
  }
}

/** The question-preview stage — mirrors QuestionRevealStage.kt: number pill top-left, the
 *  question alone in large type (sized down as it gets longer), and a bar that *fills* (no
 *  digits, so it never reads as the answer timer). Entrance animations only play on the
 *  first paint, and a negative animation-delay keeps the bar continuous if anything
 *  re-renders mid-preview. */
function buildRevealStage(quiz, q) {
  const elapsedMs = Math.max(0, Date.now() - state.revealStartedAt);
  // Fill in the Blanks: the heading (if any) is the big text, and the sentence itself sits
  // under it read-only, blanks drawn as gaps — filling starts after the preview.
  const blanks = q.type === "FILL_BLANK" ? q.fillBlankContent : null;
  const text = blanks ? (blanks.title || "").trim() : q.text || "";
  const size = text.length <= 80 ? "lg" : text.length <= 160 ? "md" : "sm";
  // The block follows the part laid out word by word — for Fill in the Blanks that's the
  // sentence, never the heading (an English heading over an Urdu sentence must still flow
  // right to left). The heading resolves its own direction via dir="auto".
  const rtl = FB.isRtlText(blanks ? blanks.template : text);

  const center = [];
  if (text) center.push(el("div", { class: "reveal-question " + size, dir: "auto" }, [renderMarkdown(text)]));
  if (blanks) center.push(buildRevealSentence(blanks, !text));
  center.push(el("div", { class: "reveal-bar", "aria-hidden": "true" }, [
    el("div", { class: "reveal-bar-fill", style: `animation-duration:${quiz.questionPreviewSec}s;animation-delay:-${elapsedMs}ms` }, []),
  ]));

  const children = [];
  if (quiz.showQuestionNumbers) {
    children.push(el("span", { class: "q-badge reveal-pill" }, [S.questionXofN(state.currentIndex + 1, quiz.questions.length)]));
  }
  // dir on the text block only — the number pill stays top-left either way.
  children.push(el("div", { class: "reveal-center", dir: rtl ? "rtl" : "ltr" }, center));
  return el("div", { class: "reveal-stage" + (elapsedMs < 120 ? " entering" : "") }, children);
}

/** The fill-blank sentence on the preview stage — same word tokens as buildFillBlankSentence,
 *  with each blank an empty gap instead of an input. */
function buildRevealSentence(content, large) {
  const lines = splitFillBlankIntoTokenLines(FB.parseFillBlankTemplate(content.template, content.blanks));
  return el("div", { class: "reveal-sentence" + (large ? " large" : "") }, lines.map((line) =>
    el("div", { class: "reveal-sentence-line" }, line.map((token) =>
      token.type === "word"
        ? el("span", {}, [token.text])
        : el("span", { class: "reveal-gap", "aria-label": S.BLANK_PLACEHOLDER }, [])
    ))
  ));
}

function buildFeedbackBanner(fb) {
  return el("div", { class: "feedback-banner " + (fb.isCorrect ? "correct" : "wrong") }, [fb.isCorrect ? S.FEEDBACK_CORRECT : S.FEEDBACK_WRONG]);
}

function renderQuiz() {
  const q = currentQuestion();
  const quiz = state.quiz;
  const accent = themeColorFromName(quiz.themeColorName);
  document.documentElement.style.setProperty("--accent", accent);
  const isLastQuestion = state.currentIndex === quiz.questions.length - 1;
  const fb = state.instantFeedback;

  // Question preview: the question alone, big, with its number pill and a fill bar — no
  // card, helper text, choices or bottom bar (mirrors QuestionRevealStage.kt).
  if (state.revealing) {
    main.appendChild(el("div", { class: "quiz-screen" }, [
      buildQuizTopBar(quiz, q),
      buildQuestionProgressBar(quiz),
      buildRevealStage(quiz, q),
    ]));
    return;
  }

  const questionArea = el("div", { class: "quiz-body" + (state.revealJustEnded ? " answers-in" : "") }, []);
  const badgeRow = buildBadgeRow(quiz, q);
  if (badgeRow) questionArea.appendChild(badgeRow);
  questionArea.appendChild(buildQuestionCard(q));
  if (q.hint && state.hintVisible) {
    questionArea.appendChild(buildHintBox(q.hint));
  }

  if (q.type === "POLL") {
    if (!state.pollState) {
      questionArea.appendChild(el("p", { class: "muted" }, [S.LOADING]));
    } else if (state.pollDistribution && !state.pollEditingVote) {
      questionArea.appendChild(buildPollResults(q));
    } else {
      questionArea.appendChild(buildPollVoting(q));
    }
  } else if (q.type === "FILL_BLANK") {
    // The sentence always stays on screen, even during feedback — it's just as much
    // the answer *display* as it is the input, so it renders its own correct/wrong
    // coloring inline.
    if (q.fillBlankContent) {
      questionArea.appendChild(buildFillBlankSentence(q));
    }
    if (fb) {
      questionArea.appendChild(buildFeedbackBanner(fb));
      const ordered = q.fillBlankContent ? FB.orderedBlanks(q.fillBlankContent) : [];
      ordered.forEach((blank, i) => {
        if (fb.blankCorrectness && fb.blankCorrectness[i] === false) {
          const correctAnswer = (blank.acceptedAnswers || [])[0];
          if (correctAnswer) {
            questionArea.appendChild(
              el("p", { class: "fb-answer-reveal" }, [S.blankCorrectAnswer(i + 1, correctAnswer)])
            );
          }
        }
      });
    }
  } else if (q.type === "WRITTEN") {
    questionArea.appendChild(buildWrittenAnswer());
    if (fb) {
      questionArea.appendChild(buildFeedbackBanner(fb));
      if (!fb.isCorrect && fb.correctWrittenAnswer) {
        questionArea.appendChild(el("p", { class: "muted" }, [S.correctAnswerIs(fb.correctWrittenAnswer)]));
      }
    }
  } else {
    questionArea.appendChild(buildChoiceList(q));
    if (fb) questionArea.appendChild(buildFeedbackBanner(fb));
  }

  main.appendChild(el("div", { class: "quiz-screen" }, [
    buildQuizTopBar(quiz, q),
    buildQuestionProgressBar(quiz),
    questionArea,
    buildBottomBar(q, isLastQuestion, onSkip, onNext),
  ]));
  updateTimerDisplay();
}

// ── Answer cards (mirrors QuizScreenComponents.kt: ChoiceOptionCard / TrueFalseCard /
// AnswerInputCard) ───────────────────────────────────────────────────────────

function optionLetter(index) {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

/** Options for SINGLE_CHOICE / MULTIPLE_CORRECT / TRUE_FALSE. While instant feedback is
 *  showing, the correct option(s) turn green and a picked-but-wrong one red, and nothing
 *  is clickable. */
function buildChoiceList(q) {
  const fb = state.instantFeedback;
  const isMulti = q.type === "MULTIPLE_CORRECT";
  const isTrueFalse = q.type === "TRUE_FALSE";
  const list = el("div", { class: "choice-list" + (isMulti ? " tight" : "") }, []);
  (q.options || []).forEach((optText, i) => {
    const selected = state.selectedAnswers.has(String(i));
    let feedback = "";
    if (fb && fb.correctOptionIndices) {
      if (fb.correctOptionIndices.has(i)) feedback = "correct";
      else if (selected) feedback = "wrong";
    }
    const onClick = fb ? null : () => toggleAnswer(i);
    list.appendChild(isTrueFalse
      ? buildTrueFalseCard(optText, i, selected, feedback, onClick)
      : buildChoiceCard({ index: i, text: optText, selected, multi: isMulti, feedback, onClick }));
  });
  const wrap = el("div", { class: "choice-wrap" }, [list]);
  const count = state.selectedAnswers.size;
  if (isMulti && !fb && count > 0) {
    wrap.appendChild(el("div", { class: "selected-count-row" }, [
      el("span", { class: "selected-count-chip" }, [html(CHECK_CIRCLE_SVG), S.optionsSelected(count)]),
    ]));
  }
  return wrap;
}

function buildChoiceIndicator(selected, multi, feedback) {
  if (feedback) {
    return el("span", { class: "fb-badge " + feedback }, [html(feedback === "correct" ? CHECK_SVG : CLOSE_X_SVG)]);
  }
  return el("span", { class: multi ? "ind-check" : "ind-radio" }, selected ? [html(CHECK_SVG)] : []);
}

function buildChoiceCard({ index, text, selected, multi, feedback, onClick, poll, locked }) {
  const classes = ["choice-card"];
  if (selected && !feedback) classes.push("selected");
  if (feedback) classes.push(feedback);
  if (poll) classes.push("poll");
  if (locked) classes.push("locked");
  if (!onClick) classes.push("inert");
  const props = { class: classes.join(" "), role: multi ? "checkbox" : "radio", "aria-checked": selected ? "true" : "false" };
  if (onClick) props.onclick = onClick;
  const textCol = el("div", { class: "choice-text" }, [el("span", { class: "choice-label" }, [text])]);
  if (poll && selected) textCol.appendChild(el("span", { class: "choice-sub" }, [S.YOUR_SELECTION]));
  return el("div", props, [
    el("span", { class: "letter-box" }, [optionLetter(index)]),
    textCol,
    buildChoiceIndicator(selected, multi, feedback),
  ]);
}

function buildTrueFalseCard(text, index, selected, feedback, onClick) {
  const classes = ["choice-card", "tf-card"];
  if (selected && !feedback) classes.push("selected");
  if (feedback) classes.push(feedback);
  if (!onClick) classes.push("inert");
  const props = { class: classes.join(" "), role: "radio", "aria-checked": selected ? "true" : "false" };
  if (onClick) props.onclick = onClick;
  return el("div", props, [
    el("span", { class: "tf-icon" }, [html(index === 0 ? TF_CHECK_SVG : TF_X_SVG)]),
    el("div", { class: "choice-text" }, [
      el("span", { class: "tf-title" }, [text]),
      el("span", { class: "tf-sub" }, [selected ? S.TF_SELECTED : S.TF_ALTERNATIVE]),
    ]),
    buildChoiceIndicator(selected, false, feedback),
  ]);
}

/** Written answer — the same single <textarea> (maxlength, placeholder, oninput) inside
 *  the "YOUR ANSWER" card. Its value comes from state, so a re-render (opening the hint,
 *  Clear) never wipes what was typed. */
function buildWrittenAnswer() {
  const fb = state.instantFeedback;
  const countNum = el("b", {}, [String(state.writtenAnswer.length)]);
  const counter = el("span", { class: "char-chip" }, [countNum, S.charCountSuffix(RESPONSE_MAX_CHARS)]);
  const textareaProps = {
    rows: "4",
    maxlength: String(RESPONSE_MAX_CHARS),
    placeholder: S.ANSWER_PLACEHOLDER,
    oninput: (e) => {
      state.writtenAnswer = e.target.value;
      countNum.textContent = String(e.target.value.length);
      scheduleLastQuestionAutoFinish();
    },
  };
  if (fb) textareaProps.disabled = "true";
  const textarea = el("textarea", textareaProps, []);
  textarea.value = state.writtenAnswer;

  const clearBtn = el("button", {
    class: "answer-clear",
    onclick: () => { state.writtenAnswer = ""; cancelLastQuestionAutoFinish(); render(); },
  }, [S.CLEAR]);
  if (fb) clearBtn.disabled = true;

  return el("div", { class: "answer-card" + (fb ? (fb.isCorrect ? " correct" : " wrong") : "") }, [
    el("div", { class: "answer-head" }, [el("span", { class: "answer-label" }, [S.YOUR_ANSWER_LABEL]), counter]),
    el("div", { class: "answer-divider" }, []),
    textarea,
    el("div", { class: "answer-divider" }, []),
    el("div", { class: "answer-foot" }, [clearBtn]),
  ]);
}

// ── Poll — voting + results (mirrors PollComponents.kt's PollVotingBody /
// PollDistributionBody: options in the per-voter shuffled order, "Other" and
// "Why?" fields, then a static percent-bar distribution once closed). ───────

function buildPollVoting(q) {
  const settings = PL.pollSettingsOrDefaults(q.pollSettings);
  const locked = state.pollHasVoted && !settings.allowVoteChange;
  const container = el("div", { class: "choice-list" }, []);

  // "Select all that apply" lives in the question card's helper line now.
  const optionRow = (idx, label, position) => buildChoiceCard({
    index: position,
    text: label,
    selected: state.pollSelected.has(idx),
    multi: !!settings.allowMultiple,
    poll: true,
    locked,
    onClick: locked ? null : () => togglePollOption(idx),
  });

  state.pollDisplayOrder.forEach((idx, position) => {
    container.appendChild(optionRow(idx, (q.options || [])[idx], position));
  });

  if (settings.allowOther) {
    const otherSelected = state.pollSelected.has(PL.POLL_OTHER_INDEX);
    container.appendChild(optionRow(PL.POLL_OTHER_INDEX, S.POLL_OTHER, state.pollDisplayOrder.length));
    if (otherSelected) {
      const otherProps = {
        type: "text",
        maxlength: String(RESPONSE_MAX_CHARS),
        placeholder: S.ANSWER_PLACEHOLDER,
        value: state.pollOtherText,
        oninput: (e) => { state.pollOtherText = e.target.value; },
      };
      if (locked) otherProps.disabled = "true";
      container.appendChild(el("input", otherProps));
    }
  }

  if (settings.askReason && state.pollSelected.size > 0) {
    const counter = el("span", { class: "reason-count" }, [S.charCount(state.pollReasonText.length, RESPONSE_MAX_CHARS)]);
    const reasonProps = {
      rows: "2",
      maxlength: String(RESPONSE_MAX_CHARS),
      placeholder: S.POLL_REASON_PLACEHOLDER,
      oninput: (e) => {
        state.pollReasonText = e.target.value;
        counter.textContent = S.charCount(e.target.value.length, RESPONSE_MAX_CHARS);
      },
    };
    if (locked) reasonProps.disabled = "true";
    const reasonInput = el("textarea", reasonProps, []);
    reasonInput.value = state.pollReasonText;
    container.appendChild(el("div", { class: "reason-box" }, [
      el("div", { class: "reason-head" }, [html(COMMENT_SVG), el("span", { class: "reason-label" }, [S.REASON_LABEL]), counter]),
      reasonInput,
    ]));
  }

  if (state.pollHasVoted) {
    container.appendChild(el("p", { class: "poll-voted-check" }, [S.POLL_VOTED]));
    // Don't promise results on close when the owner never shares them at all.
    if (!PL.pollResultsVisibleToVoters(settings)) {
      container.appendChild(el("p", { class: "poll-note" }, [S.POLL_RESULTS_NOT_SHARED]));
    } else if (locked) {
      container.appendChild(el("p", { class: "poll-note" }, [S.POLL_RESULTS_AFTER_CLOSE]));
    }
  } else if (state.pollSelected.size > 0) {
    container.appendChild(el("p", { class: "poll-note" }, [S.POLL_TAP_NEXT]));
  }

  return container;
}

function buildPollResults(q) {
  const dist = state.pollDistribution;
  const container = el("div", { style: "display:flex;flex-direction:column;gap:10px" }, [
    el("p", { class: "poll-note" }, [S.participantCount(dist.voterCount)]),
  ]);

  if (state.pollConsensus) {
    container.appendChild(el("div", { class: "poll-consensus" }, [consensusText(state.pollConsensus)]));
  }

  dist.options.forEach((opt) => {
    container.appendChild(buildPollResultRow(opt, state.pollSelected.has(opt.optionIndex)));
  });
  if (dist.other.count > 0) {
    container.appendChild(buildPollResultRow(dist.other, state.pollSelected.has(PL.POLL_OTHER_INDEX), dist.otherEntries));
  }

  const settings = PL.pollSettingsOrDefaults(q.pollSettings);
  if (state.pollState?.status !== "CLOSED" && settings.allowVoteChange) {
    container.appendChild(
      el("p", { class: "poll-change-vote", onclick: () => { state.pollEditingVote = true; cancelLastQuestionAutoFinish(); render(); } }, [S.POLL_CHANGE_VOTE])
    );
  }

  return container;
}

/** Fetches every Poll question's votes for the finished/already-taken quiz and builds
 *  the result-screen item for each — mirrors ResultViewModel.kt's loadFromAttempt poll
 *  block: live tally regardless of open/closed status (no more "wait for the poll to
 *  close" gate on this screen), and "my vote" matched by voterKey (this account's own
 *  id, always known to itself) rather than participantId (which is nulled out for an
 *  anonymous poll to hide it from OTHER voters/the owner) — so a voter's own choice is
 *  always visible to them even on an anonymous poll. */
async function buildResultPollItems(quiz, user) {
  const pollQuestions = quiz.questions.filter((q) => q.type === "POLL");
  if (pollQuestions.length === 0) return [];
  const [results, states] = await Promise.all([
    Promise.all(pollQuestions.map((q) => SC.fetchPollVotes(q.id).catch(() => []))),
    // Open/closed is only a label on the review card ("Poll Closed" / "Poll Open") — a
    // failed fetch just leaves it as a plain "Poll", never blocks the result.
    SC.fetchPollStates(pollQuestions.map((q) => q.id)).catch(() => ({})),
  ]);
  return pollQuestions.map((q, i) => {
    const votes = results[i] || [];
    const myVote = user ? votes.find((v) => v.voterKey === user.id) || null : null;
    // Null when the owner didn't share results — buildPollReviewCard shows a note instead.
    const distribution = PL.pollResultsVisibleToVoters(q.pollSettings)
      ? PL.computePollDistribution(q.options || [], votes)
      : null;
    const status = states && states[q.id] ? states[q.id].status : null;
    return { question: q, distribution, myVote, status };
  });
}

const expandedPollReviews = new Set();

/** Mirrors ResultScreen.kt's PollReviewCard — same review-card shell buildReviewCard
 *  uses (accent bar, Q# pill, expand/collapse), swapping the body for the live vote
 *  distribution instead of correct/incorrect. */
function buildPollReviewCard(item, index) {
  const q = item.question;
  const expanded = expandedPollReviews.has(q.id);
  const typeLabel = item.status === "CLOSED" ? S.TYPE_POLL_CLOSED : item.status === "OPEN" ? S.TYPE_POLL_OPEN : S.TYPE_POLL;

  const header = buildReviewHeader({
    stateClass: "poll",
    index,
    typeLabel,
    timeSec: null,
    text: q.text,
    right: [],
    expanded,
    onToggle: () => { expandedPollReviews.has(q.id) ? expandedPollReviews.delete(q.id) : expandedPollReviews.add(q.id); render(); },
  });
  const card = el("div", { class: "review-card poll" + (expanded ? " open" : "") }, [header]);

  if (expanded) {
    const dist = item.distribution;
    // Owner kept the results private — this page is only ever a voter's view, so there's
    // nothing to show but a note (matches ResultScreen.kt's PollReviewCard).
    if (!dist) {
      card.appendChild(el("div", { class: "review-body" }, [
        el("p", { class: "poll-note" }, [S.POLL_RESULTS_NOT_SHARED]),
      ]));
      return card;
    }
    const consensus = PL.computePollConsensus(dist);
    const myVoteIndices = new Set(item.myVote?.selectedOptionIndices || []);
    const bodyEl = el("div", { class: "review-body" }, []);
    if (consensus) bodyEl.appendChild(el("div", { class: "poll-consensus" }, [consensusText(consensus)]));
    dist.options.forEach((opt) => {
      bodyEl.appendChild(buildPollResultRow(opt, myVoteIndices.has(opt.optionIndex)));
    });
    if (dist.other.count > 0) {
      bodyEl.appendChild(buildPollResultRow(dist.other, myVoteIndices.has(PL.POLL_OTHER_INDEX), dist.otherEntries));
    }
    bodyEl.appendChild(el("div", { class: "poll-footer" }, [
      el("span", {}, [S.pollRespondents(dist.voterCount)]),
      el("span", { class: "poll-unscored" }, [S.POLL_UNSCORED]),
    ]));
    card.appendChild(bodyEl);
  }
  return card;
}

function buildPollResultRow(opt, mine, otherEntries) {
  // poll.js labels the Other bucket with an internal English placeholder — it has no
  // access to the string table — and documents that the UI must substitute its own
  // text by keying off POLL_OTHER_INDEX rather than rendering that literal.
  const label = opt.optionIndex === PL.POLL_OTHER_INDEX ? S.POLL_OTHER : opt.label;
  const labelChildren = [el("span", { class: "label" }, [label])];
  if (mine) labelChildren.push(el("span", { class: "your-vote-tag" }, [S.RESULT_YOUR_VOTE]));
  const children = [
    el("div", { class: "top" }, [
      el("span", { class: "label-wrap" }, labelChildren),
      el("span", { class: "pct" }, [S.pollPctVotes(opt.percent, opt.count)]),
    ]),
    el("div", { class: "poll-result-bar" }, [el("div", { class: "poll-result-bar-fill", style: `width:${opt.percent}%` })]),
  ];
  // "Other" free-text entries — what people actually typed, grouped and counted by
  // computePollDistribution's otherEntries (only ever present when the owner allowed
  // "Other" on this poll).
  if (otherEntries && otherEntries.length > 0) {
    children.push(
      el("ul", { class: "poll-other-entries" }, otherEntries.map((entry) =>
        el("li", {}, [S.otherEntry(entry.text, entry.count)])
      ))
    );
  }
  // Per-voter "why" text — only collected when the owner turned on Ask Reason.
  if (opt.reasons && opt.reasons.length > 0) {
    children.push(
      el("ul", { class: "poll-reasons" }, opt.reasons.map((reason) => el("li", {}, [S.quotedReason(reason)])))
    );
  }
  return el("div", { class: "poll-result-row" + (mine ? " mine" : "") }, children);
}

function consensusText(c) {
  if (c.type === "strong") return S.consensusStrong(c.percent, c.option);
  if (c.type === "divided") return S.consensusDivided(c.optionA, c.optionB);
  return S.consensusLeading(c.option, c.percent);
}

/** Shared review-card header — left accent bar, Q# pill, type badge, time, question
 *  text, right-side badges (marks etc.) and the expand chevron. */
function buildReviewHeader({ stateClass, index, typeLabel, timeSec, text, right, expanded, onToggle }) {
  const meta = el("div", { class: "review-meta" }, [
    el("span", { class: "q-pill " + stateClass }, [S.questionPill(index + 1)]),
    el("span", { class: "type-badge " + stateClass }, [typeLabel]),
  ]);
  if (timeSec != null) {
    meta.appendChild(el("span", { class: "review-time" }, [html(CLOCK_SMALL_SVG), S.timeTaken(timeSec)]));
  }
  const rightEl = el("div", { class: "review-right" }, right || []);
  rightEl.appendChild(html(expanded ? CHEVRON_UP_SVG : CHEVRON_DOWN_SVG));
  return el("div", { class: "review-header", onclick: onToggle }, [
    el("div", { class: "review-accent " + stateClass }, []),
    el("div", { class: "review-main" }, [meta, el("div", { class: "review-question" }, [stripMarkdownText(text)])]),
    rightEl,
  ]);
}

const CLOCK_SMALL_SVG = `<svg viewBox="0 0 16 16" fill="none" width="12" height="12"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v3l2 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHEVRON_UP_SVG = `<svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M4 10l4-4 4 4" stroke="#BBBACC" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// ── Fill Blank — inline sentence (mirrors QuizPreviewScreen.kt's
// FillBlankQuestionBody/InlineBlankField exactly: the blank is a real input
// embedded directly in the flowing sentence, not a separate field list). ─────

/** Groups parsed template segments into lines on the creator's manual line
 *  breaks, splitting each line's text into individual words so within-line
 *  wrapping is word-by-word — mirrors splitFillBlankSegmentsIntoLines() in
 *  QuizPreviewScreen.kt exactly (same reasoning: a flex-wrap row needs each
 *  word as its own child to wrap word-by-word instead of as one ragged block). */
function splitFillBlankIntoTokenLines(segments) {
  const lines = [[]];
  segments.forEach((seg) => {
    if (seg.type === "text") {
      seg.text.split("\n").forEach((textLine, i) => {
        if (i > 0) lines.push([]);
        textLine.split(/\s+/).filter((w) => w.length > 0).forEach((word) => {
          lines[lines.length - 1].push({ type: "word", text: word });
        });
      });
    } else {
      lines[lines.length - 1].push({ type: "blank", orderIndex: seg.orderIndex, blank: seg.blank });
    }
  });
  return lines;
}

function buildFillBlankSentence(q) {
  const content = q.fillBlankContent;
  const segments = FB.parseFillBlankTemplate(content.template, content.blanks);
  const lines = splitFillBlankIntoTokenLines(segments);
  const ordered = FB.orderedBlanks(content);
  const fb = state.instantFeedback;

  // Populated as inputs are built below, in template order — each input's Enter
  // handler closes over this to hop to the next blank (or blur, on the last).
  const inputRefs = [];

  const lineEls = lines.map((line) =>
    el(
      "div",
      { class: "fb-sentence" },
      line.map((token) => {
        if (token.type === "word") return el("span", { class: "fb-word" }, [token.text]);

        if (fb) {
          const correct = fb.blankCorrectness ? fb.blankCorrectness[token.orderIndex] : null;
          const value = state.fillBlankDraft[token.orderIndex] || "";
          return el(
            "span",
            { class: "fb-blank-chip " + (correct ? "correct" : "wrong") },
            [value || "—"]
          );
        }
        const isLast = token.orderIndex === ordered.length - 1;
        return buildFillBlankInput(token.orderIndex, isLast, inputRefs);
      })
    )
  );

  return el("div", { class: "sentence-card", dir: FB.isRtlText(content.template) ? "rtl" : "ltr" }, [
    el("div", { style: "display:flex;flex-direction:column;gap:10px" }, lineEls),
  ]);
}

/** One blank, embedded directly in the sentence as just another flowing child —
 *  a hidden mirror span measures the typed text so the visible input can grow
 *  to fit it (plain <input> has no native "size to content" everywhere), capped
 *  via CSS max-width so one very long answer scrolls internally instead of
 *  blowing out the sentence's layout — same behavior as the Android app's
 *  capped InlineBlankField. */
function buildFillBlankInput(orderIndex, isLast, inputRefs) {
  const value = state.fillBlankDraft[orderIndex] || "";
  const placeholder = S.BLANK_PLACEHOLDER;

  const mirror = el("span", { class: "fb-blank-mirror" }, [value || placeholder]);
  const input = el("input", {
    type: "text",
    class: "fb-blank-input" + (value.trim() ? " filled" : ""),
    value,
    maxlength: String(RESPONSE_MAX_CHARS),
    placeholder,
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
    // Its own direction from what's typed (or the placeholder), not the sentence's — an
    // English answer or placeholder inside an Urdu sentence would otherwise read backwards.
    dir: "auto",
    enterkeyhint: isLast ? "done" : "next",
    oninput: (e) => {
      const v = e.target.value;
      state.fillBlankDraft[orderIndex] = v;
      scheduleLastQuestionAutoFinish();
      mirror.textContent = v || placeholder;
      input.classList.toggle("filled", v.trim().length > 0);
      // mirror.offsetWidth forces a synchronous reflow of the (out-of-flow,
      // absolutely-positioned) mirror — cheap for a single short span, and
      // avoids a one-frame lag where the input hasn't grown yet.
      input.style.width = Math.min(220, Math.max(92, mirror.offsetWidth + 20)) + "px";
    },
    onkeydown: (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (isLast) { input.blur(); return; }
      inputRefs[orderIndex + 1]?.focus();
    },
  });

  inputRefs[orderIndex] = input;
  return el("span", { class: "fb-blank-wrap" }, [mirror, input]);
}

const expandedReviews = new Set();

/** Mirrors Grading.kt's List&lt;AnswerResult&gt;.scoreBreakdown() — splits answers into two
 *  tracks that never get blended into one number: questions carrying points (maxPoints
 *  &gt; 0) are scored as marksAwarded/marksTotal, everything else as plain
 *  correctCount/total right-or-wrong. Was entirely missing on web before — the result
 *  screen only ever showed the correctness-track count (via buildScoreCard), so a quiz
 *  where questions carry real points (e.g. "20/40") never showed that anywhere. */
/** True while an answer is still waiting on the owner's manual mark — shared by
 *  computeScoreBreakdown, the headline score recompute in renderResult, and the review
 *  card's own pending styling, so all three always agree on what "not graded yet" means. */
function isPendingAnswer(a) {
  return a.needsManualMarking === true && a.awardedPoints == null;
}

function computeScoreBreakdown(answers) {
  const marksTrack = answers.filter((a) => a.maxPoints > 0);
  const correctnessTrack = answers.filter((a) => !(a.maxPoints > 0));

  const marksAwarded = marksTrack.reduce((sum, a) => sum + (a.awardedPoints ?? 0), 0);
  const marksTotal = marksTrack.reduce((sum, a) => sum + a.maxPoints, 0);
  const marksPending = marksTrack.filter(isPendingAnswer).length;

  const correctCount = correctnessTrack.filter((a) => !isPendingAnswer(a) && a.isCorrect).length;
  const correctnessTotal = correctnessTrack.length;
  const correctnessPending = correctnessTrack.filter(isPendingAnswer).length;

  return {
    hasMarks: marksTrack.length > 0,
    hasCorrectness: correctnessTrack.length > 0,
    marksAwarded,
    marksTotal,
    marksPending,
    marksPercent: marksTotal > 0 ? Math.floor((marksAwarded * 100) / marksTotal) : null,
    correctCount,
    correctnessTotal,
    correctnessPending,
    correctnessPercent: correctnessTotal > 0 ? Math.floor((correctCount * 100) / correctnessTotal) : null,
  };
}

/** Mirrors ResultScreen.kt's ScoreSectionCard — title/subtitle on the left, "N / Total"
 *  and percent (suppressed while anything in this track is still pending marking, same
 *  as Android) on the right. */
function buildScoreSectionCard(title, subtitle, value, percent, pending) {
  const right = [el("div", { class: "score-section-value" }, [value])];
  if (percent != null && pending === 0) {
    right.push(el("div", { class: "score-section-percent" }, [S.percent(percent)]));
  }
  return el("div", { class: "score-section-card" }, [
    el("div", { class: "score-section-left" }, [
      el("div", { class: "score-section-title" }, [title]),
      el("div", { class: "score-section-subtitle" }, [subtitle]),
    ]),
    el("div", { class: "score-section-right" }, right),
  ]);
}

/** Mirrors ResultScreen.kt's ScoreCard — same gradient, trophy badge, big score +
 *  accuracy%, and progress track. No "Passed"/"Not passed" status label anymore (a 60%-
 *  threshold pass/fail read as needlessly harsh on an otherwise-decent score) — only a
 *  genuine zero-correct result gets called out as "Failed", same as Android. */
/**
 * The score, big, on one solid block of the quiz's color — mirrors ResultScreen.kt's
 * ScoreHero. No gradient, disc or badge: the number carries the card. It counts up while
 * the bar fills, then the one-line summary settles in — once per result
 * (state.resultAnimated), since render() rebuilds the DOM on every tap.
 *
 * @param missed Answered wrong — never counting answers still waiting to be marked.
 * @param marks Optional { awarded, total } — only when a marks track is fully graded.
 */
function buildScoreHero(score, total, missed, marks, pollCount) {
  const fraction = total > 0 ? score / total : 0;
  const percent = Math.round(fraction * 100);
  const animate = !state.resultAnimated && !prefersReducedMotion();

  // Banded on the unrounded fraction, same as Android — 159/200 shows "80%" on both but
  // is still the "mid" sentence on both.
  const band = score === 0 ? S.RESULT_BAND_ZERO
    : fraction >= 0.8 ? S.RESULT_BAND_HIGH
    : fraction >= 0.5 ? S.RESULT_BAND_MID
    : S.RESULT_BAND_LOW;
  const sentence = [band];
  if (missed > 0 && score > 0) sentence.push(S.resultMissed(missed));
  if (pollCount > 0) sentence.push(S.resultPolls(pollCount));

  const footer = [el("div", { class: "hero-sentence" }, [sentence.join("  ·  ")])];
  if (marks) footer.push(el("div", { class: "hero-marks" }, [S.marksLine(marks.awarded, marks.total)]));

  return el("div", {
    class: "score-hero" + (animate ? " animate" : ""),
    style: `--pct:${percent}%`,
    "data-score": String(score),
    "data-percent": String(percent),
  }, [
    el("div", { class: "hero-label" }, [S.RESULT_SCORE_LABEL]),
    el("div", { class: "hero-numbers" }, [
      el("span", { class: "hero-score" }, [animate ? "0" : String(score)]),
      el("span", { class: "hero-total" }, [S.outOf(total)]),
    ]),
    el("div", { class: "hero-bar-row" }, [
      el("div", { class: "hero-bar" }, [el("div", { class: "hero-bar-fill" }, [])]),
      el("span", { class: "hero-percent" }, [S.percent(animate ? 0 : percent)]),
    ]),
    el("div", { class: "hero-footer" }, footer),
  ]);
}

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia(`(prefers-reduced-motion: reduce)`).matches;
}

/** Counts the hero's number and percent up in step with its CSS bar fill (same duration
 *  and easing), then marks the result as animated so later re-renders show it settled. */
function runScoreHeroCountUp() {
  const hero = document.querySelector(`.score-hero.animate`);
  state.resultAnimated = true;
  if (!hero) return;
  const score = Number(hero.dataset.score);
  const percent = Number(hero.dataset.percent);
  const scoreEl = hero.querySelector(`.hero-score`);
  const percentEl = hero.querySelector(`.hero-percent`);
  const DELAY = 200, DURATION = 1100;
  const start = performance.now() + DELAY;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const tick = (now) => {
    if (!hero.isConnected) return;
    const t = Math.min(1, Math.max(0, (now - start) / DURATION));
    const e = ease(t);
    scoreEl.textContent = String(Math.round(score * e));
    percentEl.textContent = S.percent(Math.round(percent * e));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** A plain collapsible section under the hero — mirrors ResultScreen.kt's ResultExpander.
 *  The body is always in the DOM (hidden when closed) so Print → PDF can show it. */
function buildResultExpander(key, title, subtitle, open, body) {
  const justToggled = state.resultJustToggled === key;
  const head = el("button", {
    class: "expander-head",
    "aria-expanded": open ? "true" : "false",
    onclick: () => {
      if (key === "summary") state.resultSummaryOpen = !state.resultSummaryOpen;
      else state.resultReviewOpen = !state.resultReviewOpen;
      state.resultJustToggled = key;
      render();
      state.resultJustToggled = null;
    },
  }, [
    el("span", { class: "expander-text" }, [
      el("span", { class: "expander-title" }, [title]),
      el("span", { class: "expander-sub" }, [subtitle]),
    ]),
    // A labelled chip rather than a bare chevron. On a 1440px row the glyph sits a
    // long way from the title it belongs to, with nothing around it to say the row is
    // a control at all — "Hide ^" names both the target and what clicking does.
    el("span", { class: "expander-toggle" }, [
      el("span", { class: "expander-toggle-label" }, [open ? S.EXPANDER_HIDE : S.EXPANDER_SHOW]),
      html(EXPANDER_CHEVRON_SVG),
    ]),
  ]);
  const bodyEl = el("div", { class: "expander-body" + (justToggled && open ? " opening" : "") }, body);
  return el("div", { class: "result-expander" + (open ? " open" : "") }, [head, bodyEl]);
}

const EXPANDER_CHEVRON_SVG = `<svg class="expander-chevron" viewBox="0 0 20 20" fill="none" width="20" height="20"><path d="M5 7.5l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;


/**
 * "Waiting to be marked" — mirrors ResultScreen.kt's PendingReviewCard.
 *
 * Doubles as the partial-marking banner: when some questions WERE app-checked
 * ([gradedCount] > 0) it renders under the score card and reports that part too, since
 * withholding it entirely would mean the taker learns nothing from this screen.
 */
function buildPendingCard(pending, score, gradedCount) {
  const body = gradedCount > 0 ? S.pendingPartial(score, gradedCount, pending) : S.RESULT_PENDING_BODY;

  return el("div", { class: "pending-card" }, [
    el("div", { class: "pending-title" }, [S.RESULT_PENDING_TITLE]),
    el("div", { class: "pending-body" }, [body]),
  ]);
}

/** Mirrors ResultScreen.kt's ReviewCard: colored left accent, Q# pill, question
 *  text, expands to show the options (or written comparison) with correct/wrong
 *  highlighting. */
function buildReviewCard(answer, index) {
  const q = state.quiz.questions.find((qq) => qq.id === answer.questionId);
  if (!q) return null;
  const isCorrect = answer.isCorrect;
  // An unmarked answer isn't wrong, it's undecided — red here would tell the taker they
  // got something wrong that nobody has actually looked at yet.
  const isPending = answer.needsManualMarking === true && answer.awardedPoints == null;
  // Same reasoning one step further: a question the taker never attempted isn't wrong
  // either. Read after isPending, like ResultScreen.kt's ReviewCard does.
  const isSkipped = !isPending && window.Evaluator.isAnswerSkipped(answer.givenAnswers);
  const stateClass = isPending ? "pending" : isSkipped ? "skipped" : isCorrect ? "correct" : "wrong";
  const expanded = expandedReviews.has(answer.questionId);

  const right = [];
  // Per-row marks badge ("X/Y") for a points-carrying question (ResultScreen.kt's badge).
  if (answer.maxPoints > 0) {
    right.push(el("span", { class: "marks-badge " + stateClass }, [S.marksFraction(answer.awardedPoints ?? 0, answer.maxPoints)]));
  }
  if (isPending) right.push(el("span", { class: "pending-tag" }, [S.RESULT_AWAITING_MARKING]));
  // A marks question says it with its 0/N badge; a correctness-track one needs the word.
  else if (isSkipped && answer.maxPoints === 0) right.push(el("span", { class: "skipped-tag" }, [S.RESULT_VERDICT_SKIPPED]));
  if (answer.usedHint) right.push(el("span", { class: "hint-used-tag" }, [S.HINT]));

  const header = buildReviewHeader({
    stateClass,
    index,
    typeLabel: questionTypeLabel(q),
    timeSec: answer.timeTakenSec,
    text: q.text,
    right,
    expanded,
    onToggle: () => { expandedReviews.has(q.id) ? expandedReviews.delete(q.id) : expandedReviews.add(q.id); render(); },
  });

  const card = el("div", { class: "review-card " + stateClass + (expanded ? " open" : "") }, [header]);

  if (expanded) {
    const bodyEl = el("div", { class: "review-body" }, []);
    if (q.type === "WRITTEN") {
      bodyEl.appendChild(buildWrittenReview(q, answer, isPending, isCorrect));
    } else if (q.type === "FILL_BLANK") {
      bodyEl.appendChild(buildFillBlankReview(q, answer, isPending, isCorrect));
    } else if (q.type === "TRUE_FALSE") {
      bodyEl.appendChild(buildTrueFalseReview(q, answer, isPending));
    } else {
      bodyEl.appendChild(buildChoiceReview(q, answer, isPending));
    }
    // Creator-written explanation — only when one exists, and never while the answer is
    // still waiting to be marked (it would reveal the reference before the judgment).
    if (!isPending && q.reason && q.reason.trim()) {
      bodyEl.appendChild(el("div", { class: "reason-box" }, [
        el("strong", {}, [S.RESULT_EXPLANATION]),
        " " + q.reason.trim(),
      ]));
    }
    card.appendChild(bodyEl);
  }
  return card;
}

function questionTypeLabel(q) {
  switch (q.type) {
    case "WRITTEN": return S.TYPE_WRITTEN;
    case "MULTIPLE_CORRECT": return S.TYPE_MULTI;
    case "FILL_BLANK": return S.TYPE_FILL;
    case "TRUE_FALSE": return S.TYPE_TF;
    case "POLL": return S.TYPE_POLL;
    default: return S.TYPE_SINGLE;
  }
}

/** "Your Typed Answer" box (red/green/amber) + "Accepted Answers" box (hidden while
 *  pending — it's the owner's marking reference). The verdict chip comes from the
 *  evaluator's status when this result was just graded in this tab; a result reloaded
 *  later only has isCorrect, so it degrades to Match / Mismatch. */
function buildWrittenReview(q, answer, isPending, isCorrect) {
  const given = (answer.givenAnswers || [])[0] || "";
  const evalResult = answer.evaluationResult;
  // "Mismatch" would be a lie about an empty box — nothing was ever compared.
  const isSkipped = !isPending && window.Evaluator.isAnswerSkipped(answer.givenAnswers);
  const mineChip = isPending
    ? S.RESULT_AWAITING_MARKING
    : isSkipped
      ? S.RESULT_VERDICT_SKIPPED
      : evalResult && WRITTEN_STATUS_LABELS[evalResult.status] && evalResult.status !== "EXACT_MATCH" && evalResult.status !== "INCORRECT"
        ? WRITTEN_STATUS_LABELS[evalResult.status]
        : isCorrect ? S.RESULT_MATCH : S.RESULT_MISMATCH;
  const mineState = isPending ? "pending" : isSkipped ? "skipped" : isCorrect ? "correct" : "wrong";
  const wrap = el("div", { class: "written-review" }, [
    el("div", { class: "answer-box " + mineState }, [
      el("div", { class: "answer-box-head" }, [
        el("span", { class: "answer-box-label" }, [html(mineState === "wrong" ? BAR_SVG : TICK_SVG), S.RESULT_YOUR_TYPED]),
        el("span", { class: "answer-chip " + mineState }, [mineChip]),
      ]),
      el("div", { class: "answer-box-text mono" }, [given || S.RESULT_NO_ANSWER]),
    ]),
  ]);
  if (!isPending) {
    const acceptedHead = [el("span", { class: "answer-box-label" }, [html(TICK_SVG), S.RESULT_ACCEPTED])];
    if (evalResult && WRITTEN_STATUS_LABELS[evalResult.status]) {
      acceptedHead.push(el("span", { class: "answer-chip correct" }, [WRITTEN_STATUS_LABELS[evalResult.status]]));
    }
    const acceptedChildren = [
      el("div", { class: "answer-box-head" }, acceptedHead),
      el("div", { class: "answer-box-text mono strong" }, [q.writtenAnswer || ""]),
    ];
    if (evalResult) {
      acceptedChildren.push(buildWrittenEvalDetail(evalResult, answer.awardedPoints, answer.maxPoints));
    }
    wrap.appendChild(el("div", { class: "answer-box correct" }, acceptedChildren));
  }
  return wrap;
}

/** The sentence with each blank rendered as the taker's own text — green when it
 *  matched, red (with the accepted answer chip right after it) when it didn't; amber
 *  and unrevealed for manual marking. */
function buildFillBlankReview(q, answer, isPending, isCorrect) {
  const content = q.fillBlankContent;
  if (!content) return el("div", {}, []);
  const segments = FB.parseFillBlankTemplate(content.template, content.blanks);
  const given = answer.givenAnswers || [];
  const children = segments.map((seg) => {
    if (seg.type === "text") return el("span", { class: "fb-word" }, [seg.text]);
    const givenText = given[seg.orderIndex] || "";
    if (answer.needsManualMarking) {
      const cls = isPending ? "pending" : isCorrect ? "correct" : "wrong";
      return el("span", { class: "fb-review-chip " + cls }, [givenText || S.RESULT_NO_ANSWER]);
    }
    const ok = FB.fillBlankIsCorrect(seg.blank, givenText, content.checking);
    const frag = document.createDocumentFragment();
    // An empty blank was never answered, so it reads grey like the card header rather than a
    // red strike-through — there is nothing to cross out. Mirrors ResultComponents.kt.
    const chipCls = ok ? "correct" : givenText.trim() ? "wrong" : "skipped";
    frag.appendChild(el("span", { class: "fb-review-chip " + chipCls }, [givenText || S.RESULT_NO_ANSWER]));
    if (!ok) {
      const correctText = (seg.blank.acceptedAnswers || []).find((a) => a && a.trim()) || "";
      if (correctText) frag.appendChild(el("span", { class: "fb-review-chip correct answer" }, [correctText]));
    }
    return frag;
  });
  return el("div", { class: "fb-review-sentence" }, children);
}

/** TRUE / FALSE as two tiles — the picked one carries the verdict, the other reads
 *  "Not Selected" (or "Correct Answer" when it was the right one). */
function buildTrueFalseReview(q, answer, isPending) {
  const given = answer.givenAnswers || [];
  const correct = q.correctAnswers || [];
  const tiles = (q.options || []).map((opt) => {
    const wasGiven = given.includes(opt);
    const isCorrectOpt = correct.includes(opt);
    let cls = "";
    let sub = S.RESULT_TAG_NOT_SELECTED;
    if (wasGiven) {
      cls = isPending ? "pending" : isCorrectOpt ? "correct" : "wrong";
      sub = isPending ? S.RESULT_TF_YOUR_PENDING : isCorrectOpt ? S.RESULT_TF_YOUR_CORRECT : S.RESULT_TF_YOUR_WRONG;
    } else if (!isPending && isCorrectOpt) {
      cls = "answer";
      sub = S.RESULT_TAG_CORRECT_ANSWER;
    }
    return el("div", { class: "tf-tile " + cls }, [
      el("div", { class: "tf-tile-label" }, [opt.toUpperCase()]),
      el("div", { class: "tf-tile-sub" }, [sub]),
    ]);
  });
  return el("div", { class: "tf-tiles" }, tiles);
}

/** Single / multiple choice — every option as a row with a radio/checkbox marker and a
 *  right-aligned tag saying what it was to this taker. Pending: only what they picked. */
function buildChoiceReview(q, answer, isPending) {
  const given = answer.givenAnswers || [];
  const correct = q.correctAnswers || [];
  const multi = q.type === "MULTIPLE_CORRECT";
  const rows = (q.options || []).map((opt) => {
    const wasGiven = given.includes(opt);
    const isCorrectOpt = correct.includes(opt);
    let cls = "";
    let tag = "";
    if (isPending) {
      if (wasGiven) { cls = "pending"; tag = S.RESULT_TAG_YOUR_CHOICE; }
    } else if (wasGiven && isCorrectOpt) { cls = "correct"; tag = S.RESULT_TAG_YOUR_CORRECT; }
    else if (wasGiven) { cls = "wrong"; tag = S.RESULT_TAG_YOUR_CHOICE; }
    else if (isCorrectOpt) { cls = "answer"; tag = S.RESULT_TAG_CORRECT_ANSWER; }
    const children = [
      el("span", { class: "choice-marker" + (multi ? " square" : "") }, wasGiven ? [html(TICK_SVG)] : []),
      el("span", { class: "choice-text" }, [opt]),
    ];
    if (tag) children.push(el("span", { class: "choice-tag" }, [tag]));
    return el("div", { class: "choice-row " + cls }, children);
  });
  return el("div", { class: "choice-rows" }, rows);
}

const BAR_SVG = `<svg viewBox="0 0 16 16" fill="none" width="12" height="12"><rect x="6" y="2" width="4" height="12" rx="1.5" fill="currentColor"/></svg>`;

const WRITTEN_STATUS_LABELS = {
  EXACT_MATCH: S.RESULT_CORRECT,
  ACCEPTED_WITH_TYPO: S.EVAL_LABEL_TYPO,
  PARTIAL_MATCH: S.EVAL_LABEL_PARTIAL,
  INCORRECT: S.EVAL_LABEL_INCORRECT,
};

/** Mirrors ResultScreen.kt's WrittenEvalRow: a status chip, a points-earned badge, and
 *  a word-by-word matched/unmatched breakdown from the evaluator's wordDetails. */
function buildWrittenEvalDetail(evalResult, awardedPoints, maxPoints) {
  const statusColor = evalResult.status === "EXACT_MATCH" || evalResult.status === "ACCEPTED_WITH_TYPO"
    ? "#22C55E"
    : evalResult.status === "PARTIAL_MATCH" ? "#B08900" : "#EF4444";
  const children = [
    el("div", { class: "written-eval-top" }, [
      el("span", { class: "written-eval-status", style: `color:${statusColor}` }, [
        WRITTEN_STATUS_LABELS[evalResult.status] || evalResult.status,
      ]),
      el("span", { class: "written-eval-points" }, [S.pointsFraction(awardedPoints ?? 0, maxPoints)]),
    ]),
  ];
  if (evalResult.wordDetails && evalResult.wordDetails.length > 0) {
    children.push(
      el("div", { class: "written-eval-words" }, evalResult.wordDetails.map((w) =>
        el("span", { class: "written-eval-word" + (w.matched ? " matched" : " unmatched") }, [w.expectedWord])
      ))
    );
  }
  return el("div", { class: "written-eval-detail" }, children);
}

function renderResult() {
  const quiz = state.quiz;
  const accent = themeColorFromName(quiz.themeColorName);
  document.documentElement.style.setProperty("--accent", accent);
  const { answers } = state.result;
  const total = answers.length;

  // Recomputed fresh from the current answers, NOT state.result.score — that field can
  // come straight from the attempts.score column (goToExistingResult, viewing a result
  // some time after it was graded), which pushGrades() DOES update, but only when
  // grading actually recomputed AnswerResult.isCorrect correctly, and every write here
  // is best-effort with no guaranteed consistency check. Answers, by contrast, are
  // fetched fresh every time and are what the Marks/Correctness sections below are
  // already computed from — deriving the headline from the same source they use keeps
  // the top of the screen from ever contradicting its own breakdown (e.g. showing
  // "Failed, 0/2" while Marks says "11/20"). Mirrors ResultViewModel.kt's own
  // score = gradedReviews.count { it.answer.isCorrect } — recomputed from re-evaluated
  // answers, not trusted from a stored field, for exactly this reason.
  const score = answers.filter((a) => !isPendingAnswer(a) && a.isCorrect).length;

  const pending = answers.filter(isPendingAnswer).length;
  const gradedCount = answers.length - pending;

  // Marks vs plain correctness — two different currencies (see computeScoreBreakdown's
  // doc). Computed before the score card so a fully-graded marks track can be folded
  // straight into it below instead of only ever living in its own separate card.
  const breakdown = computeScoreBreakdown(answers);
  // Only once nothing in that track is still pending — a percentage that could still
  // move (or a 0/40 line while everything's unmarked) belongs in the plain white
  // section below, same as before, not baked into the headline card.
  const marksForScoreCard = breakdown.hasMarks && breakdown.marksPending === 0
    ? { awarded: breakdown.marksAwarded, total: breakdown.marksTotal, percent: breakdown.marksPercent }
    : null;

  const pollItems = state.result.pollItems || [];
  const pollCount = pollItems.length;

  const content = el("div", { class: "screen result-screen" }, [
    el("h1", { class: "quiz-title centered" }, [quiz.title]),
    el("div", { class: "candidate-line" }, [
      html(USER_OUTLINE_SVG),
      S.RESULT_CANDIDATE,
      el("strong", {}, [SC.resolveDisplayName(state.user)]),
    ]),
  ]);

  // Same order as ResultScreen.kt's scoreHeaderCard: "not marked yet" is a status, shown even
  // when results are hidden; hidden results show only that the attempt was recorded (never
  // the score, the stats, the review or a PDF of them); a poll-only quiz has no score at all.
  const incorrect = answers.filter((a) => !isPendingAnswer(a) && !a.isCorrect).length;
  const nothingMarked = pending > 0 && gradedCount === 0;
  const hidden = !quiz.showResult;
  const pollOnly = total === 0;
  if (nothingMarked) {
    content.appendChild(buildPendingCard(pending, 0, 0));
  } else if (hidden) {
    content.appendChild(buildResultInfoCard(S.RESULT_HIDDEN_LABEL, S.RESULT_HIDDEN));
  } else if (pollOnly) {
    content.appendChild(buildResultInfoCard(S.RESULT_POLL_RESULTS, S.RESULT_YOU_VOTED));
  } else {
    content.appendChild(buildScoreHero(score, total, incorrect, marksForScoreCard, pollCount));
  }
  if (hidden) {
    appendResultActions(content, quiz, false);
    main.appendChild(content);
    state.resultAnimated = true;
    return;
  }

  if (pending > 0 && gradedCount > 0) {
    // Some questions were app-checked and some weren't: the score above is real but not
    // final, and saying so is the difference between trusting it and being surprised.
    content.appendChild(buildPendingCard(pending, score, gradedCount));
  }

  // Everything below the score is detail — folded into two expanders so the first thing
  // on screen is just how the taker did (mirrors ResultScreen.kt's ResultExpander).
  // Correct / Incorrect / Total Time / Hints Used — pending answers count under neither
  // verdict (the pending banner above already accounts for them).
  const totalTime = answers.reduce((sum, a) => sum + (a.timeTakenSec || 0), 0);
  const hints = answers.filter((a) => a.usedHint).length;
  const summary = [];
  summary.push(el("div", { class: "stat-grid" }, [
    buildStatTile("correct", CHECK_STAT_SVG, S.RESULT_STAT_CORRECT, S.qsCount(score)),
    buildStatTile("wrong", BAR_SVG, S.RESULT_STAT_INCORRECT, S.qsCount(incorrect)),
    buildStatTile("time", CLOCK_SMALL_SVG, S.RESULT_STAT_TIME, S.secondsShort(totalTime)),
    buildStatTile("hint", BULB_SVG, S.RESULT_STAT_HINTS, S.hintsUsed(hints)),
  ]));

  // Shown separately only when it wasn't already folded into the score card above
  // (still pending, or the score card itself was replaced by the pending card).
  if (breakdown.hasMarks && !marksForScoreCard) {
    summary.push(buildScoreSectionCard(
      S.RESULT_MARKS,
      S.RESULT_MARKS_BLURB,
      `${breakdown.marksAwarded} / ${breakdown.marksTotal}`,
      breakdown.marksPercent,
      breakdown.marksPending
    ));
  }
  if (breakdown.hasCorrectness) {
    summary.push(buildScoreSectionCard(
      S.RESULT_CORRECT_ANSWERS,
      S.RESULT_CORRECTNESS_BLURB,
      `${breakdown.correctCount} / ${breakdown.correctnessTotal}`,
      breakdown.correctnessPercent,
      breakdown.correctnessPending
    ));
  }

  // A poll-only quiz has nothing to summarize — its polls ARE the review below.
  if (!pollOnly) {
    content.appendChild(buildResultExpander(
      "summary", S.RESULT_SUMMARY_TITLE, S.RESULT_SUMMARY_SUBTITLE, !!state.resultSummaryOpen, summary
    ));
  }

  {
    const review = [];
    // Filter tabs — All / Incorrect / Correct / Poll (Poll only when there is one).
    const filter = state.resultFilter || "all";
    const tabs = [
      ["all", S.tabAll(total + pollCount)],
      ["incorrect", S.tabIncorrect(incorrect)],
      ["correct", S.tabCorrect(score)],
    ];
    if (pollCount > 0) tabs.push(["poll", S.tabPoll(pollCount)]);
    review.push(el("div", { class: "filter-tabs" }, tabs.map(([key, label]) =>
      el("button", {
        class: "filter-tab " + key + (filter === key ? " active" : ""),
        onclick: () => { state.resultFilter = key; render(); },
      }, [label])
    )));

    // Poll questions interleaved at their original position in the quiz, same as
    // ResultScreen.kt's resultItems (Scored + PollItem, sortedBy index) — a poll
    // sitting between two scored questions shows up between them here too, not
    // dumped at the end.
    const answerByQid = new Map(answers.map((a) => [a.questionId, a]));
    const pollByQid = new Map(pollItems.map((p) => [p.question.id, p]));
    const list = el("div", { class: "review-list" }, []);
    quiz.questions.forEach((q, idx) => {
      if (q.type === "POLL") {
        if (filter !== "all" && filter !== "poll") return;
        const item = pollByQid.get(q.id);
        if (item) list.appendChild(buildPollReviewCard(item, idx));
      } else {
        const a = answerByQid.get(q.id);
        if (!a) return;
        const pendingA = isPendingAnswer(a);
        if (filter === "poll") return;
        if (filter === "correct" && (pendingA || !a.isCorrect)) return;
        if (filter === "incorrect" && (pendingA || a.isCorrect)) return;
        const card = buildReviewCard(a, idx);
        if (card) list.appendChild(card);
      }
    });
    review.push(list);
    content.appendChild(buildResultExpander(
      "review", S.RESULT_REVIEW_TITLE, S.RESULT_REVIEW_EXPANDER_SUBTITLE, !!state.resultReviewOpen, review
    ));
  }

  appendResultActions(content, quiz, true);

  main.appendChild(content);
  if (!state.resultAnimated) runScoreHeroCountUp();
}

/** Retake only when the creator allows it and the quiz is still open; PDF is the browser's
 *  own print → Save as PDF (see the @media print rules in style.css) — never offered when
 *  results are hidden, since it would print them. */
function appendResultActions(content, quiz, showPdf) {
  const actions = el("div", { class: "result-actions" }, []);
  if (quiz.allowRetake && SC.effectiveStatus(quiz) === "ACTIVE") {
    actions.appendChild(el("button", { class: "primary", onclick: retakeQuizAction }, [
      html(REFRESH_SVG), state.joining ? S.JOINING : S.RESULT_RETAKE,
    ]));
    if (state.joinError) actions.appendChild(el("p", { class: "muted", style: "color:var(--error);text-align:center" }, [state.joinError]));
  }
  if (showPdf) actions.appendChild(el("button", { class: "outline-btn", onclick: printResult }, [html(PDF_SVG), S.RESULT_PDF]));
  actions.appendChild(el("button", { class: "text-link", onclick: () => leaveQuiz(S.CLOSED_THANKS) }, [S.DONE]));
  content.appendChild(actions);
}

/** The solid card that stands in for the score when there isn't one to show — results
 *  hidden, or a poll-only quiz. Mirrors ResultScreen.kt's SubmittedCard / PollOnlyScoreCard. */
function buildResultInfoCard(label, message) {
  return el("div", { class: "score-hero info" }, [
    el("div", { class: "hero-label" }, [label]),
    el("div", { class: "hero-info-message" }, [message]),
  ]);
}

function buildStatTile(kind, iconSvg, label, value) {
  return el("div", { class: "stat-tile" }, [
    el("span", { class: "stat-icon " + kind }, [html(iconSvg)]),
    el("div", { class: "stat-text" }, [
      el("span", { class: "stat-label" }, [label]),
      el("span", { class: "stat-value" }, [value]),
    ]),
  ]);
}

/** Print → Save as PDF. While printing, every card is expanded and the filter ignored
 *  (the `printing` class on <body> drives that in CSS), then restored afterwards. */
function printResult() {
  const savedFilter = state.resultFilter;
  const savedReviews = new Set(expandedReviews);
  const savedPolls = new Set(expandedPollReviews);
  const savedSummaryOpen = state.resultSummaryOpen;
  const savedReviewOpen = state.resultReviewOpen;
  state.resultFilter = "all";
  state.resultSummaryOpen = true;
  state.resultReviewOpen = true;
  state.quiz.questions.forEach((q) => { expandedReviews.add(q.id); expandedPollReviews.add(q.id); });
  document.body.classList.add("printing");
  render();
  const restore = () => {
    document.body.classList.remove("printing");
    state.resultFilter = savedFilter;
    state.resultSummaryOpen = savedSummaryOpen;
    state.resultReviewOpen = savedReviewOpen;
    expandedReviews.clear(); savedReviews.forEach((id) => expandedReviews.add(id));
    expandedPollReviews.clear(); savedPolls.forEach((id) => expandedPollReviews.add(id));
    window.removeEventListener("afterprint", restore);
    render();
  };
  window.addEventListener("afterprint", restore);
  // Deferred a frame so the expanded DOM is painted before the print dialog snapshots it.
  requestAnimationFrame(() => setTimeout(() => window.print(), 50));
}

const USER_OUTLINE_SVG = `<svg viewBox="0 0 24 24" fill="none" width="15" height="15"><circle cx="12" cy="8.5" r="3.5" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 19c.8-3.2 3.3-4.8 6.5-4.8s5.7 1.6 6.5 4.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const CHECK_STAT_SVG = `<svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const REFRESH_SVG = `<svg viewBox="0 0 20 20" fill="none" width="16" height="16"><path d="M16 10a6 6 0 01-10.5 4M4 10a6 6 0 0110.5-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M14.5 3v3.5H11M5.5 17v-3.5H9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const PDF_SVG = `<svg viewBox="0 0 20 20" fill="none" width="16" height="16"><path d="M5 3h7l4 4v10H5V3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 3v4h4M7.5 11h5M7.5 14h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

// ── Session → screen ───────────────────────────────────────────────────────
// Shared by boot() and the in-page Google sign-in. They used to be the same code path
// because signing in meant a redirect and a fresh page load; with the ID-token flow the
// page never reloads, so everything boot() did after login has to run in the callback
// too. Keeping it in one place is what stops the two drifting — the name-confirmation
// gate in particular, which is silent when it is missed.

/** Loads everything about this quiz that depends on who is signed in. Safe to call with no
 *  session: it just leaves state.user null. Requires state.quiz to already be set. */
async function loadUserQuizState() {
  state.user = await SC.getCurrentUser();
  if (!state.user) return;
  // Pseudonymous id only, same as the Android app (AuthRepository.identifyIfNeeded):
  // the privacy policy promises analytics never receives email or name.
  window.Analytics.identify(state.user.id);
  state.existingAttempt = await SC.fetchExistingAttempt(state.quiz.id, state.user.id);
  // With no existingAttempt, a non-null stamp means this account started the quiz
  // (here or in the app) and left without submitting — Retake, or locked when the
  // creator does not allow retakes. Mirrors JoinedQuizItem.hasAbandonedStart.
  state.lastStartedAt = await SC.fetchLastStartedAt(state.quiz.id, state.user.id);
  // Started before means membership already exists — no separate Join step needed.
  if (state.lastStartedAt) state.hasJoined = true;
}

/** Sends a taker to wherever they belong now that the session is known, and renders.
 *
 *  [isBoot] guards the two steps that only make sense on a fresh page load: stripping the
 *  OAuth fragment, and the ?edit=name deep link. The fragment strip sits between the two
 *  routing branches deliberately — it has to happen before the name gate can return, or the
 *  access token stays visible in the address bar for exactly the people seeing that gate. */
async function routeSignedInTaker(isBoot) {
  // No retake and already completed: land straight on the real result screen (score
  // breakdown, review cards) instead of a one-line "you've already completed this"
  // blurb with no way to actually see it — mirrors what re-opening a finished attempt
  // in the Android app shows. Only auto-redirects when there's genuinely nothing left
  // to do here (retake off); when retake IS allowed, the landing screen offers both
  // "See Result" and "Retake Exam" instead (see renderLanding).
  if (state.user && state.existingAttempt && state.quiz.allowRetake === false) {
    await goToExistingResult();
    return;
  }

  // The redirect fallback leaves an extra "in transit" history entry (this page -> Google
  // -> back here) and a #access_token=... fragment in the address bar. Now that the
  // session has definitely been read out of it, collapse it into a clean current URL —
  // pressing Back later goes to wherever the user actually came from (WhatsApp's browser,
  // the join page, …), not back into that OAuth hop, and the token stops sitting visibly
  // in the address bar. The ID-token path never produces a fragment at all.
  if (isBoot && window.location.hash) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }

  // Some Google accounts have a wrong/nickname-y name attached — a brand-new
  // signup (mirrors the same one-time gate the Android app now has) is asked
  // to confirm/correct it once before taking the quiz, since that name is
  // what the quiz creator and other participants will see them as.
  if (state.user && !(await SC.fetchNameConfirmed(state.user.id))) {
    state.screen = "confirmName";
    render();
    return;
  }

  // ?edit=name is the deep link the home page's account menu uses — that page has no
  // name editor of its own, so it hands the job here. nameEditReturn makes it an edit
  // (cancellable, returns to the landing screen) rather than the gate above.
  if (isBoot && state.user && wantsNameEdit) {
    state.nameEditReturn = "landing";
    state.screen = "confirmName";
    render();
    return;
  }

  state.screen = "landing";
  render();
}

// ── Boot ───────────────────────────────────────────────────────────────────
async function boot() {
  // Before the first render, so the very first paint is already in the right layout
  // (no flash from wide to compact for someone who chose compact last visit).
  state.compactView = readCompactView();
  applyViewMode();
  watchFullscreenChanges();
  watchAccountMenuDismiss();
  try {
    if (!shareCode) {
      // Normally the code boxes paint immediately. But arriving on the home page's
      // "Edit name" deep link, enterCode is scaffolding the visitor never asked for —
      // they'd watch a "Enter Quiz Code" screen flash past on the way to a name field.
      // Hold on the spinner instead until we know who they are.
      state.screen = wantsNameEdit ? "loading" : "enterCode";
      render();
      // Both fetched after the first paint so a slow/offline call never delays showing
      // the code-entry boxes — the screen just re-renders once they land (fail-open
      // default in the meantime, same as everywhere else this is read).
      //
      // The user is read here purely for the header avatar: this branch has no quiz to
      // join, but someone arriving from the home page signed in should still see their
      // account in the corner rather than an anonymous header.
      const [flags, user] = await Promise.all([SC.fetchFeatureFlags(), SC.getCurrentUser()]);
      state.flags = flags;
      state.user = user;
      // ...and to service the home page's "Edit name" deep link, which lands here with
      // no code at all. HOME_RETURN, not "enterCode": someone who came from the home
      // page to rename themselves wants to end up back on the home page, not stranded
      // on a code-entry screen for a quiz they were never trying to take.
      if (state.user && wantsNameEdit) {
        state.nameEditReturn = HOME_RETURN;
        state.screen = "confirmName";
      } else if (wantsNameEdit) {
        // Signed out (or the session expired in transit) — nothing to edit, so fall
        // through to the normal screen rather than leaving the spinner up forever.
        state.screen = "enterCode";
      }
      render();
      return;
    }

    render(); // loading

    // Runs alongside the quiz fetch rather than after it — a paused join should be known
    // by the time the enter-code/landing screen first paints, not flicker in a beat later.
    const [quiz, flags] = await Promise.all([
      SC.fetchQuizByShareCode(shareCode),
      SC.fetchFeatureFlags(),
    ]);
    state.flags = flags;
    if (!quiz) {
      // Same entry screen as "no code", with the bad code left in the boxes to fix.
      state.enterCodeDraft = extractCode(shareCode);
      state.enterCodeError = S.ERR_QUIZ_NOT_FOUND;
      state.screen = "enterCode";
      render();
      return;
    }
    state.quiz = quiz;
    await loadUserQuizState();
    await routeSignedInTaker(true);
  } catch (e) {
    // Any unexpected failure (network drop, a Supabase error, …) now shows a
    // message instead of leaving the loading spinner stuck forever.
    state.errorMessage = e?.message || String(e);
    state.screen = "error";
    render();
  }
}

boot();
