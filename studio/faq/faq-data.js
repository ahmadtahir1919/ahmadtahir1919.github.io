// The Studio's Help & FAQs — the same idea as the app's FaqData.kt (categories, plain answers, an
// Example under the ones that need it), but written for the browser and checked against what
// Studio really does. Data only: core/faq.js searches and formats it, faq-page.js draws it.
//
// Item: { id, category, question, answer, example?, keywords?, link?: { label, to } }
//   answer markup (see core/faq.js): blank line = new paragraph, "- " bullets, "1. " steps,
//   **bold**, {{Ctrl}} for a key. link.to is a Studio path for route() ("bank/", "feedback/"…).
// Numbers that an admin can change (quiz / question / bank caps) are given as "usually" or
// "by default"; the page you are on always shows your own limit.

export const FAQ_CATEGORIES = [
  { id: "start", label: "Getting started", icon: "sparkles", blurb: "What Studio is and how it fits with the app" },
  { id: "dashboard", label: "Dashboard & quizzes", icon: "grid", blurb: "Your quizzes, their status and the card menu" },
  { id: "build", label: "Building a quiz", icon: "pencil", blurb: "The editor, saving, preview and publishing" },
  { id: "types", label: "Question types", icon: "layers", blurb: "The six types, points, time, hints" },
  { id: "checking", label: "Written & fill-in answers", icon: "written", blurb: "How typed answers are checked" },
  { id: "rules", label: "Quiz settings", icon: "settings", blurb: "Retakes, scores, timers and presets" },
  { id: "bank", label: "Import & Question Bank", icon: "book", blurb: "Reuse questions, bring in files" },
  { id: "share", label: "Sharing & joining", icon: "link", blurb: "Codes, links and the take page" },
  { id: "results", label: "Results & announcing", icon: "chart", blurb: "Scores, charts, exports, who sees what" },
  { id: "marking", label: "Marking & Rapid Grade", icon: "marking", blurb: "Hand-marking fast, with the keyboard" },
  { id: "polls", label: "Polls", icon: "poll", blurb: "Questions with no right answer" },
  { id: "account", label: "Account & data", icon: "user", blurb: "Sign-in, sync, deleting" },
  { id: "help", label: "Help & feedback", icon: "help", blurb: "Shortcuts, support and telling us what you think" },
];

export const FAQ_ITEMS = [
  // ── Getting started ────────────────────────────────────────────────────────
  {
    id: "what-is-studio",
    category: "start",
    question: "What is Quizoma Studio?",
    answer:
      "Studio is the browser version of the creator side of Quizoma. You build quizzes, share them with a short code or link, watch results arrive, and mark written answers — all from a computer, with a bigger screen and a real keyboard.\n\nQuizzes made here are the same quizzes you see in the Quizoma app, and the other way round.",
    example: "Type a 20-question test on your laptop in the staff room, then check who has finished from your phone.",
    keywords: ["browser", "web", "website", "creator"],
  },
  {
    id: "beta",
    category: "start",
    question: "Why does it say Beta?",
    answer:
      "Studio is still being finished. Everything you save is real — your quizzes and results are stored exactly like those made in the app — but some things may still change or look rough. If something is wrong or missing, please tell us.",
    link: { label: "Send feedback", to: "feedback/" },
    keywords: ["test mode", "early", "bugs"],
  },
  {
    id: "signin",
    category: "start",
    question: "Do I need to sign in, and why with Google?",
    answer:
      "Yes. Studio opens with Google sign-in, because that is how Quizoma knows which quizzes are yours — there is no separate password to invent or forget. The name on your Google account is the name people see next to your quizzes.",
    keywords: ["login", "log in", "account", "password"],
  },
  {
    id: "same-account",
    category: "start",
    question: "Is it the same account and data as the Android app?",
    answer:
      "Yes. Sign in with the same Google account and your quizzes, results and Question Bank are the same in both places. Make a change in Studio and the app shows it after its next sync; make one in the app and Studio shows it the next time you open or refresh the page.",
    keywords: ["sync", "android", "phone", "app", "same"],
  },
  {
    id: "free",
    category: "start",
    question: "Is Studio free?",
    answer: "Yes. Building, sharing and marking quizzes are free, and there are no ads.",
    keywords: ["price", "cost", "pay", "ads"],
  },
  {
    id: "can-students-take",
    category: "start",
    question: "Can students take the quiz inside Studio?",
    answer:
      "No — Studio is for the person who makes and marks the quiz. Students take it in the Quizoma app, or in any browser at quizoma.com/take. Use **Preview** in the editor to see it exactly as they will.",
    keywords: ["participants", "take", "join", "students"],
  },
  {
    id: "limits",
    category: "start",
    question: "Is there a limit on quizzes and questions?",
    answer:
      "Yes. By default an account can own 10 quizzes, a quiz can hold 20 questions, and the Question Bank holds 100. Drafts and archived quizzes count towards the quiz limit. Your own numbers are always on screen: the **quizzes used** card at the bottom of the sidebar, and the \"3 / 20\" count above the question list in the editor.",
    example: "At the limit? Archive or delete an old quiz to make room.",
    keywords: ["maximum", "cap", "quota", "how many"],
  },
  {
    id: "devices",
    category: "start",
    question: "Does Studio work on a phone or tablet?",
    answer:
      "Yes — on a narrow screen the sidebar turns into a menu (the ☰ button at the top left) and every page stacks into one column. Building a long quiz is still much easier on a computer.",
    keywords: ["mobile", "responsive", "tablet", "small screen"],
  },
  {
    id: "dark-mode",
    category: "start",
    question: "Can I switch to dark mode?",
    answer: "Yes. At the bottom of the sidebar choose **Light**, **Dark** or **System** (follow your device). Studio remembers it. You can also collapse the sidebar to a slim icon bar with the button beside the Quizoma logo; that is remembered too.",
    keywords: ["theme", "night", "light", "sidebar", "collapse"],
  },

  // ── Dashboard & quizzes ────────────────────────────────────────────────────
  {
    id: "dashboard-tour",
    category: "dashboard",
    question: "What is on the Dashboard?",
    answer:
      "- A **Next step** card that points at the most useful thing to do now — marking that is waiting, an open poll to close, a quiz about to start, or a draft you can finish or publish.\n- Overview tiles with your totals.\n- A card for every quiz, with its status, share code and the main action.\n\nWith no quizzes yet you get a short welcome instead, with buttons to create one or import questions.",
    keywords: ["home", "overview", "next step", "cards"],
    link: { label: "Open the Dashboard", to: "" },
  },
  {
    id: "statuses",
    category: "dashboard",
    question: "What do Draft, Scheduled, Live and Ended mean?",
    answer:
      "- **Draft** — only you can see it. It has no working join code yet.\n- **Scheduled** — published, with a start time that has not come yet.\n- **Live** — published and accepting answers right now.\n- **Ended** — its end time has passed, or you ended it.\n- **Archived** — put away by you; see below.",
    keywords: ["status", "published", "active", "state"],
  },
  {
    id: "filters-sort",
    category: "dashboard",
    question: "How do I find a quiz in a long list?",
    answer: "Use the filter pills — **All, Live, Drafts, Scheduled, Ended, Archived** — and the **Sort by** menu: Newest first, Oldest first, Highest score, Lowest score or Name A–Z.",
    keywords: ["search", "sort", "filter", "find"],
  },
  {
    id: "card-menu",
    category: "dashboard",
    question: "What can I do from a quiz card's ⋮ menu?",
    answer:
      "- **Edit** the quiz (or open it read-only if people have already taken it).\n- **View results**.\n- **Copy join link** to send to students.\n- **Close poll** on a live poll-only quiz.\n- **Duplicate** it into a new draft.\n- **Save questions to bank** to reuse them later.\n- **Archive** or **Unarchive**.\n- **Delete**.\n\nThe card's main button changes with the quiz: Publish for a draft, Grade when answers are waiting, Results once it is over.",
    keywords: ["menu", "three dots", "actions", "more"],
  },
  {
    id: "duplicate",
    category: "dashboard",
    question: "How do I make a copy of a quiz?",
    answer: "Choose **Duplicate** in the card's menu. You get a new **draft** called \"… (Copy)\" with its own share code, the same questions and settings, and no schedule. It counts towards your quiz limit. Duplicating is also how you change a quiz that people have already taken — see Building a quiz.",
    example: "Run last term's test again: duplicate it, change the dates, publish.",
    keywords: ["copy", "clone", "reuse"],
  },
  {
    id: "archive",
    category: "dashboard",
    question: "What does archiving do?",
    answer:
      "Archiving puts a finished quiz away without deleting it. It leaves your main list (find it under the **Archived** filter), anyone opening its join link is told it is archived and not accepting responses, and its results stay readable. **Unarchive** brings it back as a published quiz — it never goes back to being a draft.",
    keywords: ["hide", "put away", "old"],
  },
  {
    id: "delete-quiz",
    category: "dashboard",
    question: "What happens when I delete a quiz?",
    answer: "The quiz, its questions and **every attempt on it** are removed for everyone, and this cannot be undone — so Studio asks you to confirm first. If you only want it out of the way, archive it instead.",
    keywords: ["remove", "erase", "trash"],
  },
  {
    id: "save-to-bank",
    category: "dashboard",
    question: "How do I save a quiz's questions to the Question Bank?",
    answer:
      "Open the card's ⋮ menu and choose **Save questions to bank**. A \"Saving…\" message shows while it works, then \"Saved N questions\" with a **View bank** button. The questions are copied, so changing or deleting them later never touches the quiz. If that would push the bank past its limit, nothing is saved and you are told.",
    keywords: ["bank", "copy questions", "reuse"],
    link: { label: "Open the Question Bank", to: "bank/" },
  },

  // ── Building a quiz ────────────────────────────────────────────────────────
  {
    id: "create-quiz",
    category: "build",
    question: "How do I create a quiz?",
    answer:
      "Click **New quiz** at the top of the sidebar. You land in the editor with a first question ready:\n\n1. Write the question and its options.\n2. Add more with **Add question** (or {{Ctrl}} {{Enter}}).\n3. Name the quiz — now, or at the end.\n4. Press **Publish** when the counter says Ready.",
    example: "Title: \"Biology — Chapter 4\", 12 questions, published in about ten minutes.",
    link: { label: "Create a quiz", to: "create/" },
    keywords: ["new", "make", "start", "first quiz"],
  },
  {
    id: "autosave",
    category: "build",
    question: "Do I have to save? Will I lose my work?",
    answer:
      "A **draft saves itself** — look for \"Saving…\" and then \"All changes saved\" next to the quiz name — and Studio also saves when you leave the page. {{Ctrl}} {{S}} saves straight away. Once a quiz is **published**, changes wait until you press **Save changes**, so a half-finished edit never reaches people mid-quiz.",
    keywords: ["autosave", "saved", "lose", "draft", "ctrl s"],
  },
  {
    id: "publish-checklist",
    category: "build",
    question: "What does the Publish button's counter mean?",
    answer:
      "It counts what is still missing before the quiz can go out — a question with no text, no correct answer marked, fewer than two options, or no quiz name. Click the button anyway and Studio jumps to the first unfinished question and marks the incomplete ones in the question list. When everything is done it reads **Ready**.",
    keywords: ["publish", "ready", "left", "missing", "incomplete"],
  },
  {
    id: "setup-review",
    category: "build",
    question: "What is the \"Before your quiz goes out\" check?",
    answer:
      "A last look when you publish or save. It compares your settings with the questions you wrote and points out things that would not work as you expect — a question with no correct answer when scores are shown, timers switched off while questions have time limits, or rapid scoring when no question is timed. Each point comes with a one-click fix, or you can go back and change things yourself.",
    keywords: ["review", "warning", "check", "before publishing"],
  },
  {
    id: "draft-vs-published",
    category: "build",
    question: "What is the difference between a draft and a published quiz?",
    answer: "A draft is private while you build it. **Publishing** gives it a working join code, and people can take it from that moment (or from its start time, if you set one). A published quiz cannot go back to being a draft — archive it instead.",
    keywords: ["draft", "published", "go live"],
  },
  {
    id: "preview",
    category: "build",
    question: "Can I try the quiz before students do?",
    answer: "Yes — **Preview** in the top bar plays your quiz the way a student sees it. Only you see it and nothing is saved or counted in results. It unlocks once at least one question is finished.",
    keywords: ["test", "try", "see as student"],
  },
  {
    id: "reorder",
    category: "build",
    question: "How do I reorder, duplicate or delete questions?",
    answer:
      "- **Reorder:** drag a question in the left-hand list, or press {{Alt}} {{↑}} / {{↓}}.\n- **Duplicate:** the copy icon on the open question.\n- **Delete:** the trash icon on the open question, or hover a question in the left-hand list and click its trash icon — that one asks you to confirm first.\n\nEvery delete shows an **Undo** message afterwards, and {{Ctrl}} {{Z}} / {{Ctrl}} {{Shift}} {{Z}} undo and redo any change.",
    keywords: ["move", "drag", "remove", "undo", "redo", "rail"],
  },
  {
    id: "last-question",
    category: "build",
    question: "Why can't I delete my only question?",
    answer: "A quiz always keeps at least one question, so deleting the last one simply resets it to a fresh blank question. That is also why the trash icon only appears in the question list when there are two or more questions.",
    keywords: ["last", "only", "single"],
  },
  {
    id: "schedule",
    category: "build",
    question: "Can I schedule when a quiz opens and closes?",
    answer: "Yes. In **Quiz settings** choose **Set start & end time**. Before the start time people cannot begin; after the end time nobody can submit. Leave it on **Always open** and the quiz stays open until you end it from the Results page or the dashboard card.",
    example: "Start 9:00, end 9:30 — a 30-minute exam window.",
    keywords: ["start time", "end time", "window", "open", "close", "always open"],
  },
  {
    id: "locked",
    category: "build",
    question: "Why can't I edit my quiz any more?",
    answer:
      "Once **anyone has joined or taken** a published quiz, its questions and rules are locked, so everyone's results stay fair — nobody is marked against questions that changed underneath them. You can still change the **title** and **colour** and save those.\n\nTo change anything else, **Duplicate** the quiz: the copy is an editable draft with a new code.",
    keywords: ["locked", "read-only", "cannot edit", "joined", "can't change"],
  },
  {
    id: "quiz-name-colour",
    category: "build",
    question: "How do I name my quiz and pick a colour?",
    answer: "Type the name in the big field at the top of the editor — the Ideas chips under it offer a few starting points — and choose a colour in the settings panel. The colour is the accent for that quiz's card and pages. You can leave the name until last, but a quiz needs one to publish.",
    keywords: ["title", "theme", "color", "colour"],
  },
  {
    id: "group",
    category: "build",
    question: "How long will my quiz take?",
    answer: "The summary line under the quiz name adds up the questions' time limits (\"about 2 min to take\"), and the progress card shows questions, minutes and total points as you build.",
    keywords: ["duration", "minutes", "total points"],
  },

  // ── Question types ─────────────────────────────────────────────────────────
  {
    id: "six-types",
    category: "types",
    question: "Which question types are there?",
    answer:
      "Six: **Single choice**, **Multiple correct**, **True / False**, **Written** (typed answer), **Poll** (no right answer) and **Fill in the blank**. You can mix all of them in one quiz. Change a question's type from the type button on its card, or press {{/}} and then {{1}}–{{6}}.",
    keywords: ["types", "formats", "multiple choice", "mcq"],
  },
  {
    id: "single-vs-multi",
    category: "types",
    question: "Single choice vs. Multiple correct?",
    answer:
      "Single choice has exactly one right option; you tap the circle beside it. Multiple correct can have several, and you tick each right one. Takers have to pick all of them for full marks — unless **Partial Credit for Multiple Answers** is on (see Quiz settings), which pays for each right option picked.",
    example: "\"Which planet is closest to the Sun?\" — single. \"Which of these are prime?\" — multiple.",
    keywords: ["one answer", "several answers", "tick"],
  },
  {
    id: "options",
    category: "types",
    question: "How many options can a question have?",
    answer: "At least 2, and by default up to 30. Press {{Enter}} in an option to add the next one. Paste a list (one option per line) into an option and Studio splits it into separate options for you.",
    keywords: ["choices", "add option", "paste", "list"],
  },
  {
    id: "points-time",
    category: "types",
    question: "How do I set points and time for a question?",
    answer:
      "Under **Question settings** on each question: **Time limit** (15 s, 30 s, 1 min, Custom or No limit — from 5 seconds up to 60 minutes) and **Points** (5, 10, 20 or Custom). A new question is worth 10 points and takes the quiz's default time. Points of **0** make it a plain right-or-wrong question that adds no marks.",
    keywords: ["marks", "seconds", "timer", "weight", "score"],
  },
  {
    id: "hint-reason",
    category: "types",
    question: "What are Hint and Reason?",
    answer:
      "**Hint** (optional) is a nudge a student can reveal while answering. **Reason** (optional) is your explanation of why the answer is right; it is only shown **after** they finish, on their result, so they learn instead of just seeing a cross. Each can be up to 250 characters.",
    example: "Hint: \"You breathe it out.\"  Reason: \"Plants absorb carbon dioxide for photosynthesis.\"",
    keywords: ["explanation", "help", "after"],
  },
  {
    id: "true-false",
    category: "types",
    question: "How do I make a True / False question?",
    answer: "Choose the **True / False** type, write the statement and pick True or False as the right answer. The two options are filled in for you.",
    keywords: ["tf", "boolean"],
  },

  // ── Written & fill-in answers ──────────────────────────────────────────────
  {
    id: "written-default",
    category: "checking",
    question: "How is a Written answer checked?",
    answer: "By default with **Smart match**: small spelling slips are forgiven, so \"fotosynthesis\" still earns the marks for \"photosynthesis\". Very short answers are compared exactly, because one letter's difference there usually means a different answer. Open **Answer Checking** on the question to change how it is judged.",
    example: "Expected \"photosynthesis\" — a student types \"fotosynthesis\" and still gets it right.",
    keywords: ["typo", "spelling", "smart", "written", "typed"],
  },
  {
    id: "match-modes",
    category: "checking",
    question: "What are the answer-checking modes?",
    answer:
      "- **Exact** — letters must match, capitals ignored.\n- **Case sensitive** — capitals count too.\n- **Smart match** — small mistakes forgiven; slide **Strictness** to decide how forgiving.\n- **Keywords** — the answer only has to contain the words you pick, in any order.\n- **Number** — 7, seven and 7.0 all count as the same.\n\nExact and Case sensitive work alone; Smart match, Keywords and Number can be combined.",
    keywords: ["exact", "case", "keywords", "number", "strictness", "modes"],
  },
  {
    id: "keywords",
    category: "checking",
    question: "How do Keywords work?",
    answer: "Instead of comparing a whole sentence, Studio checks that the student's answer contains the words you chose from your expected answer. You decide whether all of them, most of them or about half are needed.",
    example: "Expected \"Water is made of hydrogen and oxygen\" with keywords hydrogen and oxygen — \"It has oxygen and hydrogen\" gets full marks.",
    keywords: ["words", "contains", "coverage"],
  },
  {
    id: "equal-words",
    category: "checking",
    question: "What are Equal words?",
    answer: "Pairs of words you want treated as the same for one question: a word from your expected answer, and another word that is also accepted for it.",
    example: "Expected \"Ahmad\", equal word \"Ali\" — a student who writes \"Ali\" is marked as if they wrote \"Ahmad\".",
    keywords: ["alias", "synonym", "same word"],
  },
  {
    id: "fill-blank",
    category: "checking",
    question: "How do I make a Fill-in-the-blank question?",
    answer:
      "Choose the **Fill in the blank** type and write the whole sentence. Then either:\n\n- select a word and click **Make blank**, or\n- put each answer in [square brackets] as you type.\n\nThe preview below shows the sentence with each blank as a gap. An optional heading can sit above the sentence.",
    example: "\"Plants make food in their [leaves] using sunlight.\"",
    keywords: ["blank", "gap", "cloze", "brackets"],
  },
  {
    id: "fill-blank-more",
    category: "checking",
    question: "Can a blank accept more than one answer?",
    answer: "Yes — type another wording in **Also accept…** and press {{Enter}}. By default a question can have up to 20 blanks and each blank up to 10 accepted answers. **Flexible** checking ignores capitals, punctuation and extra spaces; **Strict** needs an exact match.",
    example: "Blank \"Islamabad\" — also accept \"Isb\".",
    keywords: ["alternate", "accept", "flexible", "strict"],
  },
  {
    id: "fill-blank-points",
    category: "checking",
    question: "How are points shared across blanks?",
    answer: "The question's points are shared across its blanks, and you can give each blank its own value. A fill-in question counts as right only when **every** blank is right.",
    keywords: ["points per blank", "split"],
  },
  {
    id: "manual-answers-optional",
    category: "checking",
    question: "Do I still need to enter correct answers if I mark by hand?",
    answer: "No. When **Manual Review & Marking** is on, expected answers are optional — whatever you enter is shown to you as the key while you mark.",
    keywords: ["manual", "expected", "optional"],
  },

  // ── Quiz settings ──────────────────────────────────────────────────────────
  {
    id: "where-settings",
    category: "rules",
    question: "Where are the quiz settings?",
    answer: "In the panel on the right of the editor: **Quiz settings** (for the whole quiz) and, for the open question, **Question settings**. On a small screen the panel is under the question. The small panel icon hides it when you want more room to write.",
    keywords: ["panel", "options", "rules", "where"],
  },
  {
    id: "presets",
    category: "rules",
    question: "What are Class test, Practice and Speed drill?",
    answer:
      "Quick starting points under **What kind of quiz is this?**:\n\n- **Class test** — students only see that their paper was submitted; no score or answers.\n- **Practice** — students see their score, the right answers and your explanations straight after, and can retry.\n- **Speed drill** — timed, each answer flashes right or wrong, faster answers earn more.\n\nTune the individual switches afterwards and the label changes to your own settings.",
    keywords: ["preset", "kind of quiz", "template", "exam", "practice"],
  },
  {
    id: "show-score",
    category: "rules",
    question: "What does Show Score & Result control?",
    answer: "Whether students see their score and the right answers on their result as soon as they finish. Leave it off for an exam where only you should see the outcome. How and when results appear is set separately — see **Results & announcing**.",
    keywords: ["score", "result", "see answers"],
  },
  {
    id: "retake",
    category: "rules",
    question: "What does Retake Allowed do?",
    answer: "On, a student can attempt the quiz again — good for practice. Off, everyone gets one attempt.",
    keywords: ["attempt", "again", "once"],
  },
  {
    id: "manual-marking",
    category: "rules",
    question: "What is Manual Review & Marking?",
    answer: "It switches the **whole quiz** to hand-marking: nothing is checked automatically and each student waits for your marks. Some switches then turn off, because they need an automatic result: the instant flash, partial credit and the rapid response bonus. You can switch back any time; the correct answers and points you entered are kept.",
    example: "An essay paper where you read and award every mark yourself.",
    keywords: ["hand marking", "mark myself", "manual", "essay"],
  },
  {
    id: "flash-back",
    category: "rules",
    question: "What are Instant Correctness Flash and Allow going back?",
    answer: "**Instant Correctness Flash** glows green or red right after each answer, so students learn as they go — Studio asks you to confirm, because takers then see the right answers while others are still answering. **Allow going back** lets takers return to earlier questions. With both on, a taker could see the right answer, go back and change theirs, so Studio warns you about that combination.",
    keywords: ["instant", "glow", "go back", "previous"],
  },
  {
    id: "partial-credit",
    category: "rules",
    question: "What is Partial Credit for Multiple Answers?",
    answer: "On \"select all that apply\" questions it pays for each right option picked instead of all-or-nothing, and stops a student picking more options than there are right ones.",
    example: "A 10-point question with 2 right options: one right pick earns 5, both earn 10.",
    keywords: ["partial", "split points"],
  },
  {
    id: "rapid-bonus",
    category: "rules",
    question: "What is the Rapid Response Bonus?",
    answer: "Faster correct answers earn more points on **timed** questions. You can switch it on for the whole quiz and then override it per question (**Quiz default / On / Off**). It does nothing on questions without a time limit, and it is not available with manual marking.",
    keywords: ["speed", "time weightage", "fast", "bonus"],
  },
  {
    id: "timer-preview",
    category: "rules",
    question: "What do Numbered Sequence, Question Timer and Question preview do?",
    answer: "**Numbered Sequence** shows \"Question 1 of 15\" while taking. **Question Timer** shows the countdown — turn it off and the quiz is effectively untimed. **Question preview** shows each question on its own for a few seconds (you pick the reading time) before the options appear; it only plays before timed questions.",
    keywords: ["numbers", "countdown", "reading time"],
  },
  {
    id: "greyed-out",
    category: "rules",
    question: "Why is a setting greyed out?",
    answer: "Because another setting it depends on is off — most often **Manual Review & Marking** (no automatic result to flash, split or scale) or **Question Timer** (nothing to preview or reward). Click the greyed switch and it says exactly why.",
    keywords: ["disabled", "locked", "unavailable"],
  },

  // ── Import & Question Bank ─────────────────────────────────────────────────
  {
    id: "import-file",
    category: "bank",
    question: "Can I import questions instead of typing them?",
    answer: "Yes. Choose **Import** in the sidebar (or the editor's top bar) to turn a **.txt** or **.csv** file — or text you paste in — into a new quiz. In an open quiz, **Import** adds the file's questions to the end of it. Files can be up to 2 MB.",
    link: { label: "Open Import", to: "import/" },
    keywords: ["upload", "csv", "txt", "excel", "paste"],
  },
  {
    id: "import-format",
    category: "bank",
    question: "How should the file be formatted?",
    answer:
      "**Text (.txt):** a blank line between questions; the first line is the question, every line after it an option; put a * on each correct option.\n\n**Spreadsheet (.csv):** one row per question — the question, one option per column, and the correct answer's number last (use 1|3 for several).\n\nExcel or Google Sheets: save as CSV first. The import page has a cheat sheet, copy-able samples and a downloadable starter template.",
    example: "1. What is the capital of Pakistan?\nIslamabad *\nLahore\nKarachi",
    keywords: ["format", "template", "sample", "cheat sheet", "xlsx"],
  },
  {
    id: "import-types",
    category: "bank",
    question: "Which question types can be imported?",
    answer: "Single choice, Multiple correct and True / False — the type is worked out from the options and which are marked correct. Written, Fill in the blank and Poll questions can't come from a file; add those in the editor.",
    keywords: ["types", "supported", "written"],
  },
  {
    id: "import-review",
    category: "bank",
    question: "Can I check the questions before they are saved?",
    answer: "Yes. After you pick a file, a **Preview & Reorder** step lets you move questions, edit them, change the correct option or remove any. Lines that couldn't be read are listed with the reason, so you can fix the file and try again. Imported questions start with 10 points and the default time.",
    keywords: ["preview", "review", "skipped", "errors"],
  },
  {
    id: "bank-what",
    category: "bank",
    question: "What is the Question Bank?",
    answer: "A personal library of questions that belong to no quiz — write or collect them once, reuse them in any quiz. It is the same bank as in the app. By default it holds 100 questions.",
    link: { label: "Open the Question Bank", to: "bank/" },
    keywords: ["library", "reuse", "saved questions"],
  },
  {
    id: "bank-add",
    category: "bank",
    question: "How do I put bank questions into a quiz?",
    answer: "Two ways. In the bank, click cards to select them and press **Add to Quiz** — pick the quiz and whether they go first or last. Or, in the editor, click **From Question Bank** under the question list, tick questions and add them. Questions are **copied**, so editing one later never changes the other.",
    keywords: ["use in quiz", "insert", "add from bank"],
  },
  {
    id: "bank-import-export",
    category: "bank",
    question: "Can I import into, or export, the bank?",
    answer: "Yes. **Import** takes a .txt/.csv file or copies questions from your existing quizzes (ones already in your bank are skipped and listed). **Export** downloads the bank as .txt or .csv, and either can be imported straight back. Only single, multiple and true/false questions fit those formats; others are left out and you are told which.",
    keywords: ["download", "backup", "export", "import"],
  },
  {
    id: "bank-full",
    category: "bank",
    question: "The bank says it is full. What now?",
    answer: "Delete a few entries to make room. Adding or importing is all-or-nothing against the limit: if the whole batch doesn't fit, none of it is saved and you are told how big the bank can be. Editing an existing entry is never blocked.",
    keywords: ["limit", "cap", "full", "100"],
  },

  // ── Sharing & joining ──────────────────────────────────────────────────────
  {
    id: "share-code",
    category: "share",
    question: "How do students join my quiz?",
    answer: "A published quiz has a **6-character share code** (shown on its card). Students enter it in the Quizoma app, or open the quiz's join link in a browser. Use **Copy join link** on the card, or **Share** to open your device's share sheet.",
    example: "Code \"X7K9P2\" on the board, or the link pasted into WhatsApp or your class chat.",
    keywords: ["code", "link", "invite", "share", "whatsapp"],
  },
  {
    id: "take-in-browser",
    category: "share",
    question: "Can students take it in a browser?",
    answer: "Yes — at quizoma.com/take on any phone, tablet or computer, no install needed. Students sign in with Google and enter the code. In Grading each submission shows whether it came from the **Web** or **Android**.",
    keywords: ["browser", "web", "no app", "install"],
  },
  {
    id: "code-before-publish",
    category: "share",
    question: "Why doesn't my draft's code work?",
    answer: "A draft's code only starts working once the quiz is **published**. Until then nobody can join it — the card says \"Works once the quiz is published.\"",
    keywords: ["draft", "not working", "invalid"],
  },
  {
    id: "reset-code",
    category: "share",
    question: "Can I change a quiz's share code?",
    answer: "Not from Studio yet. **Reset code** is in the Quizoma app (the old code stops working for anyone who hasn't joined; people who already joined keep access). In Studio, **Duplicate** the quiz: the copy is a new draft with its own fresh code.",
    example: "The code leaked to another class: reset it in the app, or duplicate the quiz here and share the new code.",
    keywords: ["new code", "reset", "leaked", "change code"],
  },
  {
    id: "not-started-ended",
    category: "share",
    question: "What do students see if the quiz hasn't started, has ended or is archived?",
    answer: "Before the start time they see when it opens and can't begin. After the end time they can't submit a new attempt. If you archived it, the join link says it is no longer accepting responses.",
    keywords: ["closed", "scheduled", "too late", "expired"],
  },

  // ── Results & announcing ───────────────────────────────────────────────────
  {
    id: "results-page",
    category: "results",
    question: "What is on the Results page?",
    answer:
      "Open it from a quiz card (**View results**). It has:\n\n- a summary of who joined and submitted, and the average score;\n- charts: **Score distribution** and **Accuracy by question**, so you can see which questions tripped people up;\n- poll tallies for any poll questions;\n- a **Participants** list with each person's status (submitted or not yet), score, correct answers and — when timers are on — time taken, where you can also remove someone;\n- **Export CSV**, and quiz actions such as copy link, Grade and end now.",
    keywords: ["summary", "charts", "stats", "participants", "scores"],
  },
  {
    id: "export-results",
    category: "results",
    question: "How do I download results?",
    answer:
      "- **Results page → Export CSV** — a spreadsheet of scores.\n- **Grading → Download reports** — richer reports as **PDF, Excel or CSV** for the whole class, a few picked students, or one student, with a live preview. You choose whether to include answers, your notes and the chart.\n\nFiles are made in your browser and go straight to your device; nothing is uploaded. Poll-only quizzes have no scores to export.",
    keywords: ["csv", "pdf", "excel", "report", "download", "export"],
  },
  {
    id: "when-students-see",
    category: "results",
    question: "When do students see their results?",
    answer: "You choose, under **Show results**: **When the quiz ends** or **When I announce them**. With the first, results appear at the end time (or when you end the quiz, if there is no end time). With the second, nobody sees anything until you announce. The Show Score & Result setting must also allow it.",
    keywords: ["release", "announce", "visible", "show results"],
  },
  {
    id: "announce",
    category: "results",
    question: "How do I announce or hide results?",
    answer: "Open the quiz's ⋮ menu and choose **Announce results** (or **End quiz / Announce**). If some papers are not marked yet you are told how many and can **Mark first** or **Announce anyway** — students with unmarked answers see their result after you mark them. You can **Hide results** again later, though students who already looked will have seen them.",
    keywords: ["announce", "hide", "release results", "end quiz"],
  },
  {
    id: "end-quiz",
    category: "results",
    question: "Can I close a quiz early?",
    answer: "Yes. **End quiz now** (on the Results page or the card's menu) closes it immediately, and a start time still in the future is cleared so it doesn't stay Scheduled. Studio can also end the quiz and announce results in one step.",
    keywords: ["stop", "close", "finish", "end now"],
  },
  {
    id: "remove-participant",
    category: "results",
    question: "Can I remove a participant?",
    answer: "Yes — on their row in the Participants list. It deletes their join, attempt and answers for that quiz, as if they never took it. They can join again with the code, but the removal itself can't be undone, so Studio asks first.",
    example: "Someone joined the wrong class's quiz: remove them so they don't skew the average.",
    keywords: ["delete attempt", "kick", "remove student"],
  },
  {
    id: "pending-result",
    category: "results",
    question: "A student's result says it is waiting. Why?",
    answer: "Their quiz has questions you mark by hand and they aren't all marked yet. What they see so far is incomplete, not wrong — it fills in as you submit marks.",
    keywords: ["pending", "unmarked", "waiting"],
  },

  // ── Marking & Rapid Grade ──────────────────────────────────────────────────
  {
    id: "grading-hub",
    category: "marking",
    question: "Where do I mark answers?",
    answer: "**Grading** in the sidebar (its badge shows how many answers are waiting). It lists the quizzes that have submissions — those needing marks first — and each opens in one of three modes: **Rapid Grade**, **By question** or **By student**.",
    link: { label: "Open Grading", to: "grading/" },
    keywords: ["grade", "queue", "to mark", "badge"],
  },
  {
    id: "which-mode",
    category: "marking",
    question: "Rapid Grade, By question or By student — which one?",
    answer:
      "- **Rapid Grade** — one card at a time, one key per mark. Best for lots of short answers.\n- **By question** — mark one question for the whole class; students who gave the same answer are grouped.\n- **By student** — read one student's whole paper and leave an overall note.\n\nSwitch any time with {{Alt}} {{1}} / {{2}} / {{3}}.",
    keywords: ["modes", "rapid", "by question", "by student", "which"],
  },
  {
    id: "rapid-keys",
    category: "marking",
    question: "How does Rapid Grade work with the keyboard?",
    answer:
      "You see one answer card at a time. Mark it and it floats away to the left or right; the next one is already underneath.\n\n- {{→}} full marks\n- {{←}} zero\n- {{↓}} or {{Space}} half marks\n- {{0}}–{{9}} an exact mark (type the number in the box if the question is worth more than 10)\n- {{C}} add a comment\n- {{Z}} undo the last mark\n\nPress {{?}} for the list. You can also click the buttons under the card.",
    example: "Q2 is worth 3 and 20 students answered it: tap → fourteen times, ← a few times, done in a minute.",
    keywords: ["keyboard", "arrow", "shortcut", "swipe", "full marks", "half"],
  },
  {
    id: "grouped-answers",
    category: "marking",
    question: "Why do some cards say \"5 students\"?",
    answer: "Students who gave the **same answer** share one card, so one mark goes to all of them. If you want to mark someone separately, open the group menu and **Split** it, or **Exclude** one person — they get their own card straight after.",
    keywords: ["group", "same answer", "split", "exclude", "common"],
  },
  {
    id: "submit-marks",
    category: "marking",
    question: "Do students see my marks straight away?",
    answer: "No. Marks stay a **draft** until you press **Submit marks**, which asks you to confirm and then notifies the students. If you leave with unsent marks Studio asks whether to **Submit now**, **Keep as draft** or **Discard**.",
    keywords: ["draft", "submit", "notify", "send marks"],
  },
  {
    id: "comments",
    category: "marking",
    question: "Can I leave feedback for students?",
    answer: "Yes, two kinds, both optional: a **comment on one answer** ({{C}} in Rapid Grade), and an **overall note** on the whole paper in By student. Students see them with their result. Quick chips — Well explained, Partly correct, Incomplete, Check spelling, Off topic — fill one in with a click.",
    keywords: ["comment", "note", "feedback", "remark"],
  },
  {
    id: "change-marks",
    category: "marking",
    question: "Can I change a mark after giving it?",
    answer: "Yes. {{Z}} undoes the last mark, and you can re-mark anything later — **Mark again** replaces the old marks. You can also override an automatically marked answer if you disagree with it.",
    keywords: ["undo", "re-mark", "override", "correct a mark"],
  },
  {
    id: "auto-marked",
    category: "marking",
    question: "Do I have to mark everything?",
    answer: "Only what needs you. Choice, true/false, and — with their answer rules — written and fill-in answers are marked automatically. **To mark** counts only the answers waiting for a human, for example every answer on a Manual Review quiz. Auto-marked answers still show in the grading screens with their verdict (\"auto-marked, you can override\"), and you can change any of them.",
    keywords: ["automatic", "auto", "to mark", "pending"],
  },
  {
    id: "reports",
    category: "marking",
    question: "How do I get a report for a student or the class?",
    answer: "In Grading choose **Download reports** (or the report button beside a student). Pick **Whole class**, **Pick students** or **One student**, then PDF, Excel or CSV, and what to include. A preview of the first page updates as you choose.",
    keywords: ["report card", "pdf", "student report", "download"],
  },
  {
    id: "retook",
    category: "marking",
    question: "A student retook the quiz while I was marking. What happens?",
    answer: "Studio shows a message that their answers were reloaded, so what you see and mark is always their latest attempt. Check that student's paper again before you submit their marks.",
    keywords: ["retake", "reloaded", "new attempt"],
  },

  // ── Polls ──────────────────────────────────────────────────────────────────
  {
    id: "polls-basics",
    category: "polls",
    question: "How do polls work?",
    answer: "Add a **Poll** question to a quiz. Takers vote, and you see a percentage breakdown per option. Polls aren't scored — they carry no points and are left out of every total. A quiz can be polls only; then there is nothing to grade, just votes.",
    keywords: ["poll", "vote", "survey", "opinion"],
  },
  {
    id: "poll-settings",
    category: "polls",
    question: "What can I change in Poll settings?",
    answer:
      "- **Let people pick more than one**\n- **Hide who voted for what**\n- **Let people change their vote**\n- **Allow an \"Other\" answer** (shown as its own group)\n- **Ask why they chose it** (an optional reason box)\n- **Show results to voters**\n- **Shuffle the choices**\n- **No time limit for this poll**\n\nQuick fill adds ready-made choices such as Yes / No / Maybe, Agree–Disagree, a Likert scale, days of the week, or a 1–5 or 1–10 rating.",
    keywords: ["multiple", "anonymous", "other", "reason", "shuffle", "likert", "quick fill"],
  },
  {
    id: "poll-anonymous",
    category: "polls",
    question: "Is an anonymous poll really anonymous?",
    answer: "\"Hide who voted for what\" means the results show totals instead of names, which helps people answer honestly. Treat it as \"not shown\" rather than a privacy guarantee — a vote record still carries an account identifier — so don't use a poll for anything sensitive.",
    keywords: ["anonymous", "privacy", "secret"],
  },
  {
    id: "close-poll",
    category: "polls",
    question: "How do I close a poll?",
    answer: "On a live poll-only quiz choose **Close poll** from its card. A poll stays open until you close it; each voter's own timer only limits how long they get to answer, and never closes it for others. Once closed, no more votes are accepted.",
    keywords: ["end poll", "stop voting"],
  },

  // ── Account & data ─────────────────────────────────────────────────────────
  {
    id: "sign-out",
    category: "account",
    question: "How do I sign out?",
    answer: "Click your name at the bottom of the sidebar and choose **Sign out**. Nothing is deleted — sign in again with the same Google account and everything is where you left it.",
    keywords: ["log out", "logout", "switch account"],
  },
  {
    id: "other-account",
    category: "account",
    question: "What if I sign in with a different Google account?",
    answer: "Each account only ever sees its own quizzes, results and bank. Switching accounts never mixes one person's data into another's.",
    keywords: ["two accounts", "different", "switch"],
  },
  {
    id: "delete-account",
    category: "account",
    question: "How do I delete my account?",
    answer: "Click your name in the sidebar and choose **Delete account**. It opens the account-deletion page, which explains what is removed. This can't be undone.",
    keywords: ["remove account", "close account", "erase data"],
  },
  {
    id: "privacy",
    category: "account",
    question: "Where is my data stored, and is it sold?",
    answer: "Your quizzes and results are stored in your Quizoma account so they can sync between Studio and the app. Quizoma does not sell personal data; the privacy policy has the full detail.",
    keywords: ["privacy", "data", "safe", "sell", "gdpr"],
  },
  {
    id: "other-people-see",
    category: "account",
    question: "Who can see my quizzes and results?",
    answer: "Quizzes are private to you until you publish and share the code. Results and answers are visible to you as the owner; a participant sees only their own result, and only when the release setting allows it.",
    keywords: ["visibility", "private", "owner"],
  },

  // ── Help & feedback ────────────────────────────────────────────────────────
  {
    id: "builder-shortcuts",
    category: "help",
    question: "What keyboard shortcuts does the editor have?",
    answer:
      "- {{Enter}} in an option: new option\n- {{Ctrl}} {{Enter}}: next question\n- {{/}}: change the question type, then {{1}}–{{6}} to pick\n- {{Ctrl}} {{V}} into an option: paste a list as options\n- {{Alt}} {{↑}} / {{↓}}: move the question up or down\n- {{Ctrl}} {{Z}} / {{Ctrl}} {{Shift}} {{Z}}: undo / redo\n- {{Ctrl}} {{S}}: save\n- {{?}}: show this list in the editor\n- {{Esc}}: close a menu or panel",
    keywords: ["keyboard", "shortcuts", "keys", "hotkeys"],
  },
  {
    id: "other-help",
    category: "help",
    question: "Where else can I get help?",
    answer: "The Help section of the sidebar links to the **User guide** (a walk-through), the public **FAQs**, and **Support**. The editor and Grading screens each have a keyboard-shortcuts button, and the Question Bank has a \"How this page works\" button.",
    keywords: ["guide", "support", "contact", "email"],
  },
  {
    id: "send-feedback",
    category: "help",
    question: "How do I report a bug or ask for a feature?",
    answer: "Use **Send feedback** in the sidebar. Pick a rating if you like, choose a category — Bug, Crash, Sync / Login, Design, Performance, Feature request, Report content or Other — and describe it. It goes straight to the team, and any reply shows up on the same page. Quizoma is free, and honest feedback is what keeps us improving it.",
    example: "Category: Feature request — \"Let me reorder questions by dragging them in the bank.\"",
    link: { label: "Send feedback", to: "feedback/" },
    keywords: ["bug", "suggest", "idea", "problem", "report"],
  },
  {
    id: "feedback-limit",
    category: "help",
    question: "Why can't I send feedback again straight away?",
    answer: "To keep the feedback inbox useful, each account can send one message every 24 hours. The page shows how long is left, and your earlier messages and our replies stay visible below.",
    keywords: ["cooldown", "24 hours", "wait"],
  },
];
