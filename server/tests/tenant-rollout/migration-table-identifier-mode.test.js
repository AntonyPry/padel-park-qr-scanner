'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const MIGRATIONS = [
  {
    migration: require('../../migrations/20260718140000-add-tenant-methodology-skill-map'),
    name: 'methodology',
    plan(kind, item) {
      return {
        columns: [],
        foreignKeys: kind === 'foreignKey' ? [item] : [],
        indexes: [],
        removedLegacyUnique: null,
        triggers: kind === 'trigger' ? [item] : [],
      };
    },
    read(queryInterface, kind, item) {
      return this.migration.__testing.readArtifactRows(
        queryInterface,
        kind === 'foreignKey' ? 'constraint' : kind,
        item,
      );
    },
  },
  {
    migration: require('../../migrations/20260718160000-add-tenant-training-notes-plans'),
    name: 'training operations',
    plan(kind, item) {
      return {
        column: [],
        foreignKey: kind === 'foreignKey' ? [item] : [],
        index: [],
        trigger: kind === 'trigger' ? [item] : [],
      };
    },
    read(queryInterface, kind, item) {
      return this.migration.__testing.readArtifact(queryInterface, kind, item);
    },
  },
  {
    migration: require('../../migrations/20260719160000-add-tenant-shifts-reports'),
    name: 'shifts/reports',
    plan(kind, item) {
      return {
        column: [],
        foreignKey: kind === 'foreignKey' ? [item] : [],
        index: [],
        trigger: kind === 'trigger' ? [item] : [],
      };
    },
    read(queryInterface, kind, item) {
      return this.migration.__testing.readArtifact(queryInterface, kind, item);
    },
  },
];

function wrongCase(identifier) {
  return String(identifier).split('').map((character) =>
    character === character.toLowerCase()
      ? character.toUpperCase()
      : character.toLowerCase()).join('');
}

function foreignKeyRow(expected, overrides = {}) {
  return {
    COLUMN_NAME: expected.column,
    CONSTRAINT_NAME: 'global_fk_name',
    DELETE_RULE: expected.onDelete,
    REFERENCED_COLUMN_NAME: expected.referencedColumn,
    REFERENCED_TABLE_NAME: expected.referencedTable,
    TABLE_NAME: expected.table,
    UPDATE_RULE: expected.onUpdate,
    ...overrides,
  };
}

function triggerRow(expected, overrides = {}) {
  return {
    ACTION_STATEMENT: expected.body,
    ACTION_TIMING: 'BEFORE',
    EVENT_MANIPULATION: expected.event,
    EVENT_OBJECT_TABLE: expected.table,
    TRIGGER_NAME: 'global_trigger_name',
    ...overrides,
  };
}

function fakeQueryInterface(lowerCaseTableNames, artifactRow) {
  const state = { lowerCaseQueries: 0, mutations: [] };
  const queryInterface = {
    async removeConstraint(...args) {
      state.mutations.push(['removeConstraint', ...args]);
    },
    async removeIndex(...args) {
      state.mutations.push(['removeIndex', ...args]);
    },
    async removeColumn(...args) {
      state.mutations.push(['removeColumn', ...args]);
    },
    sequelize: {
      async query(sql) {
        if (/@@lower_case_table_names/u.test(sql)) {
          state.lowerCaseQueries += 1;
          return [[{ lowerCaseTableNames }]];
        }
        if (/^\s*(?:DROP|CREATE|ALTER)\b/iu.test(sql)) {
          state.mutations.push(['query', sql]);
          return [[]];
        }
        if (/INFORMATION_SCHEMA\.KEY_COLUMN_USAGE/u.test(sql)) {
          return artifactRow?.TABLE_NAME ? [[artifactRow]] : [[]];
        }
        if (/INFORMATION_SCHEMA\.TRIGGERS/u.test(sql)) {
          return artifactRow?.EVENT_OBJECT_TABLE ? [[artifactRow]] : [[]];
        }
        if (/INFORMATION_SCHEMA\.(?:COLUMNS|STATISTICS)/u.test(sql)) {
          return [[]];
        }
        throw new Error(`Unexpected identifier-mode test query: ${sql}`);
      },
    },
  };
  return { queryInterface, state };
}

for (const descriptor of MIGRATIONS) {
  test(`${descriptor.name} uses server-aware table identifier equality`, async () => {
    const { __testing } = descriptor.migration;
    const [foreignKeyName, foreignKey] = Object.entries(__testing.FOREIGN_KEYS)[0];
    const [triggerName, trigger] = Object.entries(__testing.TRIGGERS)[0];
    const exactForeignKey = foreignKeyRow(foreignKey, {
      CONSTRAINT_NAME: foreignKeyName,
    });
    const exactTrigger = triggerRow(trigger, { TRIGGER_NAME: triggerName });
    const wrongOwnerForeignKey = {
      ...exactForeignKey,
      TABLE_NAME: wrongCase(foreignKey.table),
    };
    const wrongReferenceForeignKey = {
      ...exactForeignKey,
      REFERENCED_TABLE_NAME: wrongCase(foreignKey.referencedTable),
    };
    const wrongOwnerTrigger = {
      ...exactTrigger,
      EVENT_OBJECT_TABLE: wrongCase(trigger.table),
    };

    assert.throws(
      () => __testing.tableIdentifierEquals(foreignKey.table, foreignKey.table),
      /Unsupported lower_case_table_names/,
    );
    assert.equal(__testing.foreignKeyIsCanonical(exactForeignKey, foreignKey, 0), true);
    assert.equal(__testing.triggerIsCanonical(exactTrigger, trigger, 0), true);
    assert.equal(__testing.foreignKeyIsCanonical(
      wrongOwnerForeignKey,
      foreignKey,
      0,
    ), false);
    assert.equal(__testing.foreignKeyIsCanonical(
      wrongReferenceForeignKey,
      foreignKey,
      0,
    ), false);
    assert.equal(__testing.triggerIsCanonical(wrongOwnerTrigger, trigger, 0), false);

    for (const setting of [1, 2]) {
      assert.equal(__testing.foreignKeyIsCanonical(
        wrongOwnerForeignKey,
        foreignKey,
        setting,
      ), true);
      assert.equal(__testing.foreignKeyIsCanonical(
        wrongReferenceForeignKey,
        foreignKey,
        setting,
      ), true);
      assert.equal(__testing.triggerIsCanonical(
        wrongOwnerTrigger,
        trigger,
        setting,
      ), true);
    }

    const cacheProbe = fakeQueryInterface(0);
    assert.equal(await __testing.getLowerCaseTableNames(cacheProbe.queryInterface), 0);
    assert.equal(await __testing.getLowerCaseTableNames(cacheProbe.queryInterface), 0);
    assert.equal(cacheProbe.state.lowerCaseQueries, 1);

    for (const [kind, item, wrongRow] of [
      ['foreignKey', { ...foreignKey, name: foreignKeyName }, wrongOwnerForeignKey],
      ['trigger', { ...trigger, name: triggerName }, wrongOwnerTrigger],
    ]) {
      const classifierProbe = fakeQueryInterface(0, wrongRow);
      assert.equal((await __testing.classifyState(
        classifierProbe.queryInterface,
      )).state, 'partial');
      assert.deepEqual(classifierProbe.state.mutations, []);

      const strictProbe = fakeQueryInterface(0, wrongRow);
      assert.deepEqual(await descriptor.read(
        strictProbe.queryInterface,
        kind,
        item,
      ), []);
      await assert.rejects(
        descriptor.migration.__testing.cleanupInvocation(
          strictProbe.queryInterface,
          descriptor.plan(kind, { ...item, signature: 'owned-signature' }),
        ),
        /cleanup ownership lost/i,
      );
      assert.deepEqual(strictProbe.state.mutations, []);

      for (const setting of [1, 2]) {
        const foldedProbe = fakeQueryInterface(setting, wrongRow);
        assert.equal((await descriptor.read(
          foldedProbe.queryInterface,
          kind,
          item,
        )).length, 1);
        assert.deepEqual(foldedProbe.state.mutations, []);
      }
    }
  });
}
