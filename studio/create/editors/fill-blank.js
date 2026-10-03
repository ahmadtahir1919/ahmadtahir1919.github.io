// Fill in the blanks. The creator types the sentence with each answer in square brackets —
// "The capital of Pakistan is [Islamabad]." — or selects a word and presses Make blank.
// Each blank can take extra accepted answers. Stored as the app's FillBlankContent on save.

import { FILL_BLANK_CHECKING } from "../../core/models.js";
import { S, t } from "../../core/strings.js";
import { button, counter, el, field, segmented, updateCounter } from "../../ui/components.js";
import { icon } from "../../ui/icons.js";
import { sentenceBlanks } from "../form.js";

export function fillBlankEditor(ctx) {
  const form = ctx.get();
  const { maxQuestionTextChars, maxFillBlanks, maxFillBlankAnswers, maxAnswerTextChars } = ctx.limits;
  const manual = ctx.quiz.manualMarkingDefault;

  // Heading (optional) — fill_blank.title.
  const titleCount = counter(form.fb.title.length, maxQuestionTextChars);
  const title = el("input", {
    class: "input",
    type: "text",
    dir: "auto",
    value: form.fb.title,
    placeholder: S.FILL_TITLE_PLACEHOLDER,
    "data-fk": "fb-title",
  });
  title.addEventListener("input", () => {
    updateCounter(titleCount, title.value.length, maxQuestionTextChars);
    ctx.update("fb-title", (f) => (f.fb.title = title.value));
  });

  // Sentence. Only the visible text counts against the cap (the server measures the template
  // without its blank markers).
  const visibleLength = (s) => s.replace(/\[[^[\]]*\]/g, "").length;
  const sentenceCount = counter(visibleLength(form.fb.sentence), maxQuestionTextChars);
  const sentence = el("textarea", {
    class: "textarea sentence-input",
    rows: "4",
    dir: "auto",
    value: form.fb.sentence,
    placeholder: S.FILL_SENTENCE_PLACEHOLDER,
    "data-fk": "fb-sentence",
  });

  const blanksRegion = el("div", { class: "stack-sm" });
  const previewRegion = el("div", { class: "fb-preview", dir: "auto", "aria-live": "polite" });

  const refreshBlanks = () => {
    renderPreview(previewRegion, ctx.get().fb.sentence);
    renderBlankList(blanksRegion, ctx, { maxFillBlankAnswers, maxAnswerTextChars, maxFillBlanks, manual });
  };

  let lastBlankCount = sentenceBlanks(form.fb.sentence).length;
  sentence.addEventListener("input", () => {
    updateCounter(sentenceCount, visibleLength(sentence.value), maxQuestionTextChars);
    ctx.update("fb-sentence", (f) => (f.fb.sentence = sentence.value));
    const blanks = sentenceBlanks(sentence.value).length;
    renderPreview(previewRegion, sentence.value);
    if (blanks !== lastBlankCount) {
      lastBlankCount = blanks;
      renderBlankList(blanksRegion, ctx, { maxFillBlankAnswers, maxAnswerTextChars, maxFillBlanks, manual });
    } else {
      updateCanonicalLabels(blanksRegion, sentence.value);
    }
  });

  const wrapSelection = () => {
    const { selectionStart: start, selectionEnd: end, value } = sentence;
    if (sentenceBlanks(value).length >= maxFillBlanks) return;
    const picked = value.slice(start, end);
    const inside = /[[\]]/.test(picked);
    if (inside) return;
    const next = `${value.slice(0, start)}[${picked.trim()}]${value.slice(end)}`;
    sentence.value = next;
    sentence.dispatchEvent(new Event("input"));
    sentence.focus();
    const caret = start + picked.trim().length + 2;
    sentence.setSelectionRange(caret, caret);
  };

  const atCap = sentenceBlanks(form.fb.sentence).length >= maxFillBlanks;
  const makeBlankBtn = button({
    label: S.MAKE_BLANK,
    icon: "blank",
    variant: "soft",
    size: "sm",
    disabled: atCap,
    title: S.MAKE_BLANK_TITLE,
    onClick: wrapSelection,
  });
  // Keep the sentence's text selection when the button is pressed.
  makeBlankBtn.addEventListener("mousedown", (e) => e.preventDefault());
  refreshBlanks();

  return el("div", { class: "stack" }, [
    field({ label: S.FILL_TITLE_LABEL, control: title, counterNode: titleCount, hint: S.FILL_TITLE_HINT }),
    field({
      label: S.FILL_SENTENCE_LABEL,
      control: el("div", { class: "stack-sm" }, [
        sentence,
        el("div", { class: "row row-wrap" }, [
          makeBlankBtn,
          el("span", { class: "small faint", text: S.FILL_SENTENCE_HINT }),
        ]),
      ]),
      counterNode: sentenceCount,
    }),
    el("div", { class: "stack-sm" }, [el("span", { class: "label", text: S.FILL_PREVIEW_LABEL }), previewRegion]),
    blanksRegion,
    el("div", { class: "stack-sm" }, [
      el("span", { class: "label", text: S.CHECKING_LABEL }),
      segmented({
        label: "fb-checking",
        value: form.fb.checking,
        options: [
          { value: FILL_BLANK_CHECKING.FLEXIBLE, label: S.CHECKING_FLEXIBLE_SHORT },
          { value: FILL_BLANK_CHECKING.STRICT, label: S.CHECKING_STRICT_SHORT },
        ],
        onChange: (value) => ctx.update("fb-checking", (f) => (f.fb.checking = value), { structural: true }),
      }),
      el("p", {
        class: "hint-text",
        text: form.fb.checking === FILL_BLANK_CHECKING.STRICT ? S.CHECKING_STRICT : S.CHECKING_FLEXIBLE,
      }),
    ]),
  ]);
}

function renderPreview(region, sentence) {
  const parts = [];
  const re = /\[([^[\]]*)\]/g;
  let last = 0;
  let match;
  let n = 0;
  while ((match = re.exec(sentence)) !== null) {
    if (match.index > last) parts.push(document.createTextNode(sentence.slice(last, match.index)));
    n++;
    parts.push(el("span", { class: `fb-slot ${match[1].trim() ? "" : "is-empty"}`, title: match[1] }, [el("span", { class: "fb-slot-n", text: String(n) })]));
    last = match.index + match[0].length;
  }
  if (last < sentence.length) parts.push(document.createTextNode(sentence.slice(last)));
  if (!parts.length) parts.push(el("span", { class: "faint", text: S.FILL_PREVIEW_EMPTY }));
  region.replaceChildren(...parts);
}

function updateCanonicalLabels(region, sentence) {
  const answers = sentenceBlanks(sentence);
  region.querySelectorAll("[data-canonical]").forEach((node) => {
    const value = answers[Number(node.dataset.canonical)] ?? "";
    node.textContent = value.trim() || S.BLANK_NO_ANSWER;
    node.classList.toggle("faint", !value.trim());
  });
}

function renderBlankList(region, ctx, { maxFillBlankAnswers, maxAnswerTextChars, maxFillBlanks, manual }) {
  const form = ctx.get();
  const answers = sentenceBlanks(form.fb.sentence);
  if (!answers.length) {
    region.replaceChildren(el("div", { class: "banner banner-info" }, [icon("bulb"), el("span", { text: S.FILL_NO_BLANKS_YET })]));
    return;
  }

  const rows = answers.map((canonical, index) => {
    const alts = form.fb.alts[index] ?? [];
    const altInput = el("input", {
      class: "input input-sm",
      type: "text",
      dir: "auto",
      placeholder: S.ADD_ALTERNATIVE_PLACEHOLDER,
      maxlength: String(maxAnswerTextChars),
      "data-fk": `fb-alt-${index}`,
    });
    const roomLeft = maxFillBlankAnswers - 1 - alts.length;
    altInput.disabled = roomLeft <= 0;
    const addAlt = () => {
      const value = altInput.value.trim();
      if (!value) return;
      ctx.update(`fb-alt-${index}`, (f) => {
        f.fb.alts[index] = [...(f.fb.alts[index] ?? []), value].slice(0, maxFillBlankAnswers - 1);
      });
      renderBlankList(region, ctx, { maxFillBlankAnswers, maxAnswerTextChars, maxFillBlanks, manual });
      requestAnimationFrame(() => region.querySelector(`[data-fk="fb-alt-${index}"]`)?.focus());
    };
    altInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addAlt();
      }
    });

    return el("div", { class: "blank-card" }, [
      el("div", { class: "row" }, [
        el("span", { class: "fb-slot-n is-static", text: String(index + 1) }),
        el("span", { class: "small muted", text: S.BLANK_ANSWER }),
        el("span", { class: `strong ${canonical.trim() ? "" : "faint"}`, dir: "auto", "data-canonical": String(index), text: canonical.trim() || S.BLANK_NO_ANSWER }),
        el("span", { class: "grow" }),
        el("span", { class: "counter", text: `${1 + alts.length} / ${maxFillBlankAnswers}` }),
      ]),
      el(
        "div",
        { class: "row row-wrap" },
        alts.map((alt, altIndex) =>
          el("span", { class: "chip", dir: "auto" }, [
            alt,
            el(
              "button",
              {
                type: "button",
                class: "chip-remove",
                "aria-label": t(S.REMOVE_NAMED, { name: alt }),
                onclick: () => {
                  ctx.update(`fb-alt-rm-${index}`, (f) => {
                    f.fb.alts[index] = (f.fb.alts[index] ?? []).filter((_, i) => i !== altIndex);
                  });
                  renderBlankList(region, ctx, { maxFillBlankAnswers, maxAnswerTextChars, maxFillBlanks, manual });
                },
              },
              [icon("x", "icon icon-sm")]
            ),
          ])
        )
      ),
      el("div", { class: "row" }, [altInput, button({ label: S.ADD, size: "sm", variant: "secondary", disabled: roomLeft <= 0, onClick: addAlt })]),
    ]);
  });

  region.replaceChildren(
    el("div", { class: "label-row" }, [
      el("span", { class: "label", text: S.BLANKS_LABEL }),
      el("span", { class: "counter", text: `${answers.length} / ${maxFillBlanks}` }),
    ]),
    manual ? el("p", { class: "hint-text", text: S.BLANK_ANSWERS_OPTIONAL_MANUAL }) : el("p", { class: "hint-text", text: S.BLANK_ALTERNATIVES_HINT }),
    ...rows
  );
}
