const assert = require('node:assert/strict');
const test = require('node:test');
const { buildInitialPrompt, normalizeGlossary } = require('../src/glossary');
const {
  isSubtitleOutroHallucination,
  isFillerOnly,
  normalizeTranscriptSegments,
} = require('../src/normalizer');

const glossary = normalizeGlossary({
  aliases: [
    {
      aliases: ['подал парк', 'падал парк', 'падел парк'],
      canonical: 'Падел Парк',
      rule: 'padel_park_alias',
    },
    {
      aliases: ['подал теннис', 'Павел Тренисках'],
      canonical: 'падел-теннис',
      rule: 'padel_tennis_alias',
    },
    {
      aliases: ['падлу', 'падла', 'подлу', 'падл'],
      canonical: 'падел',
      contextAny: ['записаться', 'корт', 'играть', 'тренировка', 'ракетки'],
      rule: 'padel_alias',
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
      aliases: ['мастер клас', 'мастер класа', 'мастер классу'],
      canonical: 'мастер-класс',
      rule: 'master_class_alias',
    },
    {
      aliases: ['рокетки', 'рокеты', 'ракеты'],
      canonical: 'ракетки',
      contextAny: ['аренда', 'прокат', 'нужны', 'есть', 'падел', 'корт'],
      rule: 'rackets_alias',
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

test('normalizes club name greeting mishears', () => {
  const result = normalizeTranscriptSegments(
    [
      {
        channel: 'left',
        speaker: 'administrator',
        text: 'Добрый вечер, подал парк позвонили.',
      },
    ],
    glossary,
  );

  assert.equal(result.segments[0].text, 'Добрый вечер, Падел Парк позвонили.');
  assert.equal(result.corrections.length, 1);
  assert.equal(result.corrections[0].rule, 'padel_park_alias');
});

test('drops standalone subtitle outro hallucination segments only', () => {
  const result = normalizeTranscriptSegments(
    [
      {
        channel: 'left',
        endMs: 2000,
        speaker: 'administrator',
        startMs: 1000,
        text: 'Добрый день, Падел Парк.',
      },
      {
        channel: 'right',
        endMs: 4000,
        speaker: 'client',
        startMs: 3000,
        text: 'Продолжение следует.',
      },
      {
        channel: 'right',
        endMs: 5000,
        speaker: 'client',
        startMs: 4300,
        text: 'Редактор субботников А. Иванова',
      },
      {
        channel: 'right',
        endMs: 6200,
        speaker: 'client',
        startMs: 5200,
        text: 'Корректор Мария',
      },
      {
        channel: 'right',
        endMs: 7400,
        speaker: 'client',
        startMs: 6500,
        text: 'Субтитры создавал DimaTorzok',
      },
      {
        channel: 'left',
        endMs: 8400,
        speaker: 'administrator',
        startMs: 7600,
        text: 'Редактор суббота Корректор А.Кулакова',
      },
    ],
    glossary,
  );

  assert.deepEqual(
    result.segments.map((segment) => segment.text),
    ['Добрый день, Падел Парк.'],
  );
  assert.deepEqual(
    result.corrections.map((correction) => correction.type),
    [
      'subtitle_outro_drop',
      'subtitle_outro_drop',
      'subtitle_outro_drop',
      'subtitle_outro_drop',
      'subtitle_outro_drop',
    ],
  );
  assert.equal(isSubtitleOutroHallucination('Субтитры создавал DimaTorzok'), true);
  assert.equal(isSubtitleOutroHallucination('Редактор суббота Корректор А.Кулакова'), true);
});

test('keeps ordinary client phrase that mentions outro words', () => {
  const result = normalizeTranscriptSegments(
    [
      {
        channel: 'right',
        speaker: 'client',
        text: 'Клиент сказал, что продолжение следует после оплаты.',
      },
      {
        channel: 'left',
        speaker: 'administrator',
        text: 'Корректор нужен для текста договора, это не субтитры.',
      },
    ],
    glossary,
  );

  assert.equal(result.segments.length, 2);
  assert.equal(
    result.segments[0].text,
    'Клиент сказал, что продолжение следует после оплаты.',
  );
  assert.equal(
    result.segments[1].text,
    'Корректор нужен для текста договора, это не субтитры.',
  );
  assert.equal(result.corrections.length, 0);
});

test('corrects padlu and keeps structured correction metadata', () => {
  const result = normalizeTranscriptSegments(
    [
      {
        channel: 'right',
        endMs: 3500,
        speaker: 'client',
        startMs: 1000,
        text: 'Хочу записаться на падлу и узнать, есть ли рокетки.',
      },
    ],
    glossary,
  );

  assert.equal(
    result.segments[0].text,
    'Хочу записаться на падел и узнать, есть ли ракетки.',
  );
  assert.equal(result.corrections.length, 2);
  assert.deepEqual(
    result.corrections.map((correction) => correction.rule),
    ['padel_alias', 'rackets_alias'],
  );
  assert.equal(result.corrections[0].original, 'падлу');
  assert.equal(result.corrections[0].normalized, 'падел');
  assert.equal(result.corrections[0].speaker, 'client');
  assert.equal(result.corrections[0].channel, 'right');
  assert.equal(result.corrections[0].startMs, 1000);
  assert.equal(Number.isInteger(result.corrections[0].charIndex), true);
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
