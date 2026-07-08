function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeForMatch(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeForSubtitleMatch(value) {
  return normalizeForMatch(value)
    .replace(/ё/g, 'е')
    .replace(/[«»„“”"']/g, ' ')
    .replace(/[.,!?;:()[\]{}]/g, ' ')
    .replace(/[—–-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasRuleContext(text, terms = []) {
  if (!terms || terms.length === 0) return true;
  const normalized = normalizeForMatch(text);
  return terms.some((term) => normalized.includes(normalizeForMatch(term)));
}

function aliasPattern(alias) {
  return new RegExp(
    `(^|[^\\p{L}\\p{N}])(${escapeRegExp(alias)})(?=$|[^\\p{L}\\p{N}])`,
    'giu',
  );
}

function correctionBase(segment, segmentIndex) {
  return {
    channel: segment?.channel || null,
    endMs: Number.isFinite(Number(segment?.endMs)) ? Number(segment.endMs) : null,
    segmentIndex,
    speaker: segment?.speaker || null,
    startMs: Number.isFinite(Number(segment?.startMs)) ? Number(segment.startMs) : null,
  };
}

function applyDomainRules(text, segment, segmentIndex, glossary) {
  let normalized = normalizeText(text);
  const corrections = [];

  for (const rule of glossary?.aliases || []) {
    if (!hasRuleContext(normalized, rule.contextAny)) continue;

    for (const alias of rule.aliases || []) {
      const pattern = aliasPattern(alias);
      normalized = normalized.replace(pattern, (match, prefix, matched, offset) => {
        if (normalizeForMatch(matched) === normalizeForMatch(rule.canonical)) {
          return match;
        }

        corrections.push({
          ...correctionBase(segment, segmentIndex),
          alias: matched,
          canonical: rule.canonical,
          charIndex: offset + prefix.length,
          original: matched,
          normalized: rule.canonical,
          reason:
            rule.contextAny && rule.contextAny.length > 0
              ? 'domain_alias_with_context'
              : 'domain_alias',
          rule: rule.rule,
          type: 'domain_term',
        });
        return `${prefix}${rule.canonical}`;
      });
    }
  }

  return { corrections, text: normalized };
}

const FILLER_WORDS = new Set(['угу', 'ага', 'мгм', 'мм', 'эм']);
const SUBTITLE_OUTRO_EXACT_RULES = new Map([
  ['продолжение следует', 'subtitle_outro_continuation'],
]);
const SUBTITLE_OUTRO_PREFIX_RULES = [
  {
    pattern:
      /^субтитры\s+(создавал[аи]?|создал[аи]?|сделал[аи]?|подготовил[аи]?|оформил[аи]?|редактировал[аи]?|автор|от|для)(?=$|\s)/u,
    rule: 'subtitle_creator_credit',
  },
  {
    pattern:
      /^редактор\s+(субтитров?|субтитр[a-zа-я0-9]*|суббот[a-zа-я0-9]*|сабтайтл[a-zа-я0-9]*)(?=$|\s)/u,
    rule: 'subtitle_editor_credit',
  },
  {
    pattern: /^корректор(?:\s+субтитров?)?(?:\s+[a-zа-я0-9]+){0,5}$/u,
    rule: 'subtitle_corrector_credit',
  },
];
const SUBTITLE_CONVERSATION_HINTS = [
  'администратор',
  'документ',
  'звонок',
  'клиент',
  'можно',
  'нужно',
  'пожалуйста',
  'сказал',
  'скажите',
  'текст',
  'хочу',
];

function getSubtitleOutroHallucinationRule(text) {
  const normalized = normalizeForSubtitleMatch(text);
  if (!normalized) return null;

  const exactRule = SUBTITLE_OUTRO_EXACT_RULES.get(normalized);
  if (exactRule) return exactRule;
  if (normalized.startsWith('продолжение следует ')) {
    const rest = normalized.replace(/^продолжение следует\s+/, '');
    if (getSubtitleOutroHallucinationRule(rest)) return 'subtitle_outro_chain';
  }

  if (normalized.length > 180) return null;
  if (SUBTITLE_CONVERSATION_HINTS.some((hint) => normalized.includes(hint))) return null;

  const rule = SUBTITLE_OUTRO_PREFIX_RULES.find((item) => item.pattern.test(normalized));
  return rule?.rule || null;
}

function isSubtitleOutroHallucination(text) {
  return Boolean(getSubtitleOutroHallucinationRule(text));
}

function fillerTokens(text) {
  return normalizeForMatch(text)
    .replace(/[.,!?;:()[\]{}"']/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function isFillerOnly(text) {
  const tokens = fillerTokens(text);
  return tokens.length > 0 && tokens.every((token) => FILLER_WORDS.has(token));
}

function collapseFillerText(text) {
  const tokens = fillerTokens(text);
  if (tokens.length < 3 || !tokens.every((token) => FILLER_WORDS.has(token))) {
    return { collapsed: false, text };
  }

  const first = tokens[0] === 'угу' ? 'Угу.' : `${tokens[0][0].toUpperCase()}${tokens[0].slice(1)}.`;
  return { collapsed: true, text: first };
}

function sameFillerRun(previous, segment) {
  if (!previous) return false;
  if (previous.channel !== (segment.channel || null)) return false;
  if (previous.speaker !== (segment.speaker || null)) return false;

  const currentStart = Number(segment.startMs);
  if (!Number.isFinite(currentStart) || previous.endMs === null) return true;
  return currentStart - previous.endMs <= 15000;
}

function normalizeTranscriptSegments(segments = [], glossary = {}, options = {}) {
  const normalizedSegments = [];
  const corrections = [];
  let previousFiller = null;
  const dropRepeatedFillers = options.dropRepeatedFillers !== false;

  (segments || []).forEach((segment, segmentIndex) => {
    const rawText = normalizeText(segment?.text);
    if (!rawText) return;

    const subtitleOutroRule = getSubtitleOutroHallucinationRule(rawText);
    if (subtitleOutroRule) {
      corrections.push({
        ...correctionBase(segment, segmentIndex),
        original: rawText,
        normalized: '',
        reason: 'standalone_subtitle_outro_hallucination',
        rule: subtitleOutroRule,
        type: 'subtitle_outro_drop',
      });
      return;
    }

    const domainResult = applyDomainRules(rawText, segment, segmentIndex, glossary);
    corrections.push(...domainResult.corrections);

    const fillerResult = collapseFillerText(domainResult.text);
    if (fillerResult.collapsed) {
      corrections.push({
        ...correctionBase(segment, segmentIndex),
        original: domainResult.text,
        normalized: fillerResult.text,
        reason: 'repeated_filler_inside_segment',
        rule: 'collapse_repeated_filler',
        type: 'filler_collapse',
      });
    }

    const nextSegment = {
      ...segment,
      rawText,
      text: fillerResult.text,
    };
    const fillerOnly = isFillerOnly(nextSegment.text);

    if (dropRepeatedFillers && fillerOnly && sameFillerRun(previousFiller, nextSegment)) {
      corrections.push({
        ...correctionBase(segment, segmentIndex),
        original: rawText,
        normalized: '',
        reason: 'repeated_filler_same_channel',
        rule: 'drop_repeated_filler_segment',
        type: 'filler_drop',
      });
      return;
    }

    if (fillerOnly) {
      previousFiller = {
        channel: nextSegment.channel || null,
        endMs: Number.isFinite(Number(nextSegment.endMs)) ? Number(nextSegment.endMs) : null,
        speaker: nextSegment.speaker || null,
      };
    } else {
      previousFiller = null;
    }

    normalizedSegments.push({
      ...nextSegment,
      sortOrder: normalizedSegments.length,
    });
  });

  return {
    corrections,
    segments: normalizedSegments,
  };
}

module.exports = {
  collapseFillerText,
  isSubtitleOutroHallucination,
  isFillerOnly,
  normalizeTranscriptSegments,
};
