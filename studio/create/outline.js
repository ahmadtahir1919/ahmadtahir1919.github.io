// Question-type labels shared by the bank, grading and results pages. (The quiz editor's own
// type list, in the app's order, is create/qe-model.js TYPES.)

import { QUESTION_TYPES } from "../core/models.js";
import { S } from "../core/strings.js";

export const TYPE_META = {
  [QUESTION_TYPES.SINGLE_CHOICE]: { iconName: "single", label: () => S.TYPE_SINGLE, sub: () => S.TYPE_SINGLE_SUB, key: "1" },
  [QUESTION_TYPES.MULTIPLE_CORRECT]: { iconName: "multiple", label: () => S.TYPE_MULTIPLE, sub: () => S.TYPE_MULTIPLE_SUB, key: "2" },
  [QUESTION_TYPES.TRUE_FALSE]: { iconName: "truefalse", label: () => S.TYPE_TRUE_FALSE, sub: () => S.TYPE_TRUE_FALSE_SUB, key: "3" },
  [QUESTION_TYPES.WRITTEN]: { iconName: "written", label: () => S.TYPE_WRITTEN, sub: () => S.TYPE_WRITTEN_SUB, key: "4" },
  [QUESTION_TYPES.FILL_BLANK]: { iconName: "blank", label: () => S.TYPE_FILL_BLANK, sub: () => S.TYPE_FILL_BLANK_SUB, key: "5" },
  [QUESTION_TYPES.POLL]: { iconName: "poll", label: () => S.TYPE_POLL, sub: () => S.TYPE_POLL_SUB, key: "6" },
};

export function typeLabel(type) {
  return TYPE_META[type]?.label() ?? type;
}
