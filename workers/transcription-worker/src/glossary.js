const fsp = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_GLOSSARY_PATH = path.join(__dirname, '..', 'config', 'domain-glossary.json');

function normalizeTerm(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function normalizeGlossary(source = {}) {
  return {
    aliases: Array.isArray(source.aliases)
      ? source.aliases
          .map((rule) => ({
            aliases: Array.isArray(rule.aliases)
              ? rule.aliases.map(normalizeTerm).filter(Boolean)
              : [],
            canonical: normalizeTerm(rule.canonical),
            contextAny: Array.isArray(rule.contextAny)
              ? rule.contextAny.map(normalizeTerm).filter(Boolean)
              : [],
            rule: normalizeTerm(rule.rule) || 'domain_alias',
          }))
          .filter((rule) => rule.aliases.length > 0 && rule.canonical)
      : [],
    canonicalTerms: Array.isArray(source.canonicalTerms)
      ? source.canonicalTerms.map(normalizeTerm).filter(Boolean)
      : [],
    promptTerms: Array.isArray(source.promptTerms)
      ? source.promptTerms.map(normalizeTerm).filter(Boolean)
      : [],
  };
}

async function loadDomainGlossary(glossaryPath = DEFAULT_GLOSSARY_PATH) {
  const raw = await fsp.readFile(glossaryPath || DEFAULT_GLOSSARY_PATH, 'utf8');
  return normalizeGlossary(JSON.parse(raw));
}

function buildInitialPrompt(glossary, options = {}) {
  const maxChars = Number(options.maxChars || 420);
  const terms = [...new Set((glossary?.promptTerms || []).map(normalizeTerm).filter(Boolean))];
  if (terms.length === 0) return null;

  const prefix = 'Термины клуба и CRM: ';
  let prompt = prefix;
  for (const term of terms) {
    const next = prompt === prefix ? term : `, ${term}`;
    if ((prompt + next + '.').length > maxChars) break;
    prompt += next;
  }

  return `${prompt}.`;
}

module.exports = {
  buildInitialPrompt,
  loadDomainGlossary,
  normalizeGlossary,
};
