const assert = require('node:assert/strict');
const test = require('node:test');
const { apiSchemas } = require('../../src/contracts/api-schemas');
const { schemaToJsonSchema } = require('../../src/contracts/openapi');

test('call task body accepts multiline scriptText and exposes it in OpenAPI schema', () => {
  const result = apiSchemas.callTasks.createFromBase.body.safeParse({
    description: 'Комментарий к задаче',
    dueAt: '2026-07-03T12:00:00.000Z',
    scriptText: 'Приветствие\nВопрос про интерес\nСледующий шаг',
    title: 'Обзвон тестовой базы',
  });

  assert.equal(result.success, true);
  assert.equal(
    result.data.scriptText,
    'Приветствие\nВопрос про интерес\nСледующий шаг',
  );

  const jsonSchema = schemaToJsonSchema(apiSchemas.callTasks.createFromBase.body);
  assert.ok(jsonSchema.properties.scriptText);
});
