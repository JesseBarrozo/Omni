export const GENERATED_TAB_TITLE_MAX_LENGTH = 40;
export const GENERATED_TAB_TITLE_SOURCE_SCAN_LIMIT = 512;

const LEADING_FILLER_PATTERNS = [
  // English filler patterns
  /^(?:can|could|would)\s+you(?:\s+please)?(?:[,:]?\s+|$)/i,
  /^please(?:[,:]?\s+|$)/i,
  /^i\s+(?:want|need)\s+(?:you\s+)?to\s+/i,
  /^help\s+me(?:\s+to)?\s+/i,
  /^help\s+/i,
  /^let'?s\s+/i,
  /^we\s+need\s+to\s+/i,
  /^need\s+to\s+/i,
  // French filler patterns
  /^(?:peux|pourrais|pourriez|pouvez)-tu(?:\s+s['\u2019]il\s+te\s+pla[iî]t)?(?:[,:]?\s+|$)/i,
  /^(?:peux|pourrais|pourriez|pouvez)-vous(?:\s+s['\u2019]il\s+vous\s+pla[iî]t)?(?:[,:]?\s+|$)/i,
  /^(?:est-ce\s+que\s+tu\s+peux|tu\s+peux)\s+/i,
  /^(?:s['\u2019]il\s+te\s+pla[iî]t|s['\u2019]il\s+vous\s+pla[iî]t|stp|svp)(?:[,:]?\s+|$)/i,
  /^(?:merci\s+de(?:\s+bien\s+vouloir)?)(?:[,:]?\s+|$)/i,
  /^(?:je\s+(?:veux|voudrais|souhaite|aimerais)(?:\s+que\s+tu)?)(?:[,:]?\s+|$)/i,
  /^(?:aide-moi\s+[aà]|aide\s+moi\s+[aà]|aide-nous\s+[aà])(?:[,:]?\s+|$)/i,
  /^(?:il\s+faut|on\s+doit|faut-il)\s+/i,
  /^(?:fais-moi|fais\s+moi)(?:[,:]?\s+|$)/i,
];

const TRAILING_FILLER_PATTERNS = [
  /\s+please$/i,
  /\s+s['\u2019]il\s+te\s+pla[iî]t$/i,
  /\s+s['\u2019]il\s+vous\s+pla[iî]t$/i,
  /\s+merci(?:\s+d['\u2019]avance)?$/i,
  /\s+stp$/i,
  /\s+svp$/i,
];

function capitalizeFirstLetter(value) {
  return value.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase());
}

function truncateAtWordBoundary(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }
  const rawSlice = value.slice(0, maxLength);
  const sliced = rawSlice.trim();
  if (sliced.length < rawSlice.length) {
    return sliced;
  }
  const lastSpace = sliced.lastIndexOf(" ");
  if (lastSpace >= Math.floor(maxLength * 0.55)) {
    return sliced.slice(0, lastSpace).trim();
  }
  return sliced;
}

function isGeneratedTabTitleWhitespace(code) {
  return (
    code === 32 ||
    (code >= 9 && code <= 13) ||
    code === 160 ||
    code === 5760 ||
    (code >= 8192 && code <= 8202) ||
    code === 8232 ||
    code === 8233 ||
    code === 8239 ||
    code === 8287 ||
    code === 12288 ||
    code === 65279
  );
}

function foldGeneratedTabTitleWhitespace(value) {
  let normalized = "";
  let pendingWhitespace = false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (isGeneratedTabTitleWhitespace(code)) {
      pendingWhitespace = normalized.length > 0;
      continue;
    }
    if (pendingWhitespace) {
      normalized += " ";
      pendingWhitespace = false;
    }
    normalized += value.charAt(index);
  }
  return normalized;
}

export function deriveGeneratedTabTitle(prompt) {
  if (typeof prompt !== "string") {
    return null;
  }
  const promptPreview = prompt.slice(0, GENERATED_TAB_TITLE_SOURCE_SCAN_LIMIT);
  const firstClause = promptPreview
    .trim()
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[`*_~#>[\]{}()]/g, " ")
    .replace(/^(?:issue|task|bug|feature|pr)\s*(?:#?\d+)?\s*[:-]\s*/i, "")
    .split(/[.!?;\n\r\u2028\u2029]/u)[0]
    ?.trim();

  if (!firstClause) {
    return null;
  }

  let candidate = firstClause;
  for (let i = 0; i < 3; i += 1) {
    const before = candidate;
    for (const pattern of LEADING_FILLER_PATTERNS) {
      candidate = candidate.replace(pattern, "");
    }
    for (const pattern of TRAILING_FILLER_PATTERNS) {
      candidate = candidate.replace(pattern, "");
    }
    candidate = candidate.trim();
    if (candidate === before.trim()) {
      break;
    }
  }

  candidate = foldGeneratedTabTitleWhitespace(
    candidate.replace(/[^\p{L}\p{N}\s]/gu, " "),
  );

  if (!candidate) {
    return null;
  }

  return truncateAtWordBoundary(
    capitalizeFirstLetter(candidate),
    GENERATED_TAB_TITLE_MAX_LENGTH,
  );
}

export function isDefaultConversationTitle(title) {
  if (!title || typeof title !== "string") {
    return true;
  }
  const trimmed = title.trim();
  if (!trimmed) {
    return true;
  }
  if (
    trimmed === "Nouvelle conversation" ||
    trimmed === "New conversation" ||
    trimmed === "Nueva conversación"
  ) {
    return true;
  }
  if (/^Chat(?:\s+\d+)?$/i.test(trimmed)) {
    return true;
  }
  return false;
}
