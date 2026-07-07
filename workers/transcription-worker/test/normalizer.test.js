const assert = require('node:assert/strict');
const test = require('node:test');
const { buildInitialPrompt, normalizeGlossary } = require('../src/glossary');
const {
  isFillerOnly,
  normalizeTranscriptSegments,
} = require('../src/normalizer');

const glossary = normalizeGlossary({
  aliases: [
    {
      aliases: ['подал теннис', 'Павел Тренисках'],
      canonical: 'падел-теннис',
      rule: 'padel_tennis_alias',
    },
    {
      aliases: ['порт'],
      canonical: 'корт',
      contextAny: ['бронь', 'забронирую', 'аренда', 'игра'],
      rule: 'court_booking_context',
    },
    {
      aliases: ['код'],
      canonical: 'корт',
      contextAny: ['маленький', 'большой'],
      rule: 'court_size_context',
    },
    {
      aliases: ['мастеринка', 'материнка'],
      canonical: 'мастер-класс',
      contextAny: ['запись', 'занятие'],
      rule: 'master_class_context',
    },
    {
      aliases: ['Лунда'],
      canonical: 'Lunda',
      rule: 'lunda_alias',
    },
  ],
  promptTerms: ['Падел Парк', 'падел-теннис', 'корт', 'приложение Lunda'],
});

test('builds short initial prompt from glossary terms', () => {
  const prompt = buildInitialPrompt(glossary, { maxChars: 120 });

  assert.match(prompt, /Падел Парк/);
  assert.match(prompt, /падел-теннис/);
  assert.ok(prompt.length <= 120);
});

test('normalizes only explicit domain aliases and keeps metadata', () => {
  const result = normalizeTranscriptSegments(
    [
      {
        channel: 'right',
        speaker: 'client',
        startMs: 1000,
        endMs: 3000,
        text: 'Хочу подал теннис и приложение Лунда.',
      },
      {
        channel: 'left',
        speaker: 'administrator',
        startMs: 3500,
        endMs: 5000,
        text: 'Запишу вас на маленький код.',
      },
    ],
    glossary,
  );

  assert.equal(result.segments[0].text, 'Хочу падел-теннис и приложение Lunda.');
  assert.equal(result.segments[1].text, 'Запишу вас на маленький корт.');
  assert.deepEqual(
    result.corrections.map((correction) => correction.rule),
    ['padel_tennis_alias', 'lunda_alias', 'court_size_context'],
  );
});

test('does not replace contextual aliases without nearby domain context', () => {
  const result = normalizeTranscriptSegments(
    [
      {
        channel: 'right',
        speaker: 'client',
        text: 'Пришлите код из сообщения и проверьте порт на роутере.',
      },
    ],
    glossary,
  );

  assert.equal(result.segments[0].text, 'Пришлите код из сообщения и проверьте порт на роутере.');
  assert.equal(result.corrections.length, 0);
});

test('collapses and drops repeated filler hallucinations', () => {
  const result = normalizeTranscriptSegments(
    [
      {
        channel: 'right',
        endMs: 2000,
        speaker: 'client',
        startMs: 1000,
        text: 'Угу. Угу. Угу. Угу.',
      },
      {
        channel: 'right',
        endMs: 4000,
        speaker: 'client',
        startMs: 2500,
        text: 'Угу.',
      },
      {
        channel: 'left',
        endMs: 7000,
        speaker: 'administrator',
        startMs: 5000,
        text: 'Забронирую большой порт.',
      },
    ],
    glossary,
  );

  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[0].text, 'Угу.');
  assert.equal(isFillerOnly(result.segments[0].text), true);
  assert.equal(result.segments[1].text, 'Забронирую большой корт.');
  assert.deepEqual(
    result.corrections.map((correction) => correction.type),
    ['filler_collapse', 'filler_drop', 'domain_term'],
  );
});
