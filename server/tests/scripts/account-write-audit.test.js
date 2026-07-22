'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  ALLOWLIST,
  auditRepository,
  auditSource,
} = require('../../scripts/audit-account-writes');

test('Account direct-write repository audit passes the exact writer allowlist', () => {
  assert.deepEqual(
    [...ALLOWLIST].sort(),
    [
      'src/services/account-lifecycle.service.js',
      'src/services/account-metadata.service.js',
      'src/services/account-seeder-adapter.js',
    ],
  );
  assert.deepEqual(auditRepository(), []);
});

test('AST audit rejects static and instance mutation method bypasses', () => {
  const fixtures = [
    {
      name: 'static alias create',
      source: `
        const AccountModel = db.Account;
        const createAlias = AccountModel.create.bind(AccountModel);
        await createAlias({ email: 'bad@example.com' });
      `,
      type: 'Account static write alias',
    },
    {
      name: 'destructured static increment/decrement/restore',
      source: `
        const { Account: ShadowAccount } = db;
        await ShadowAccount.increment('id', { where: { id: 1 } });
        await ShadowAccount.decrement('id', { where: { id: 1 } });
        await ShadowAccount.restore({ where: { id: 1 } });
      `,
      type: 'Account static write',
    },
    {
      name: 'deep static model alias chain',
      source: `
        const A1 = db.Account;
        const A2 = A1;
        const A3 = A2;
        const A4 = A3;
        const A5 = A4;
        const A6 = A5;
        const A7 = A6;
        const A8 = A7;
        const A9 = A8;
        await A9.destroy({ where: { id: 1 } });
      `,
      type: 'Account static write',
    },
    {
      name: 'static schema mutation',
      source: `
        await db.Account.sync({ force: true });
        await db.Account.drop();
      `,
      type: 'Account static write',
    },
    {
      name: 'inferred instance save',
      source: `
        const target = await db.Account.findByPk(1);
        target.email = 'bad@example.com';
        await target.save();
      `,
      type: 'Account instance write',
    },
    {
      name: 'instance method alias',
      source: `
        const target = await db.Account.findOne({ where: { id: 1 } });
        const persist = target.save.bind(target);
        await persist();
      `,
      type: 'Account instance write alias',
    },
    {
      name: 'instance increment/decrement/restore',
      source: `
        const account = await db.Account.findByPk(1);
        await account.increment('id');
        await account.decrement('id');
        await account.restore();
      `,
      type: 'Account instance write',
    },
  ];

  for (const fixture of fixtures) {
    const findings = auditSource(fixture.source, `${fixture.name}.js`);
    assert.ok(
      findings.some((finding) => finding.type === fixture.type),
      `${fixture.name}: ${JSON.stringify(findings)}`,
    );
  }
});

test('AST audit rejects QueryInterface bulk and aliased raw SQL Account writes', () => {
  const fixtures = [
    {
      name: 'bulk insert',
      source: `await queryInterface.bulkInsert('Accounts', rows);`,
      type: 'Accounts query-interface write',
    },
    {
      name: 'bulk update with table alias',
      source: `
        const accountTable = 'Accounts';
        await queryInterface.bulkUpdate(accountTable, values, where);
      `,
      type: 'Accounts query-interface write',
    },
    {
      name: 'bulk delete',
      source: `await queryInterface.bulkDelete('Accounts', where);`,
      type: 'Accounts query-interface write',
    },
    {
      name: 'bulk table descriptor',
      source: `
        await queryInterface.bulkUpdate({ tableName: 'Accounts' }, values, where);
      `,
      type: 'Accounts query-interface write',
    },
    {
      name: 'raw update through query alias',
      source: `
        const table = 'Accounts';
        const sql = 'UPDATE ' + table + ' SET status = \\'archived\\'';
        const execute = db.sequelize.query.bind(db.sequelize);
        await execute(sql);
      `,
      type: 'Accounts raw SQL write',
    },
    {
      name: 'raw insert template',
      source: `
        await db.sequelize.query(\`INSERT INTO Accounts (email) VALUES ('bad@example.com')\`);
      `,
      type: 'Accounts raw SQL write',
    },
    {
      name: 'raw delete',
      source: `await sequelize.query('DELETE FROM Accounts WHERE id = 1');`,
      type: 'Accounts raw SQL write',
    },
    {
      name: 'raw replace',
      source: `await sequelize.query('REPLACE INTO Accounts (id) VALUES (1)');`,
      type: 'Accounts raw SQL write',
    },
    {
      name: 'raw truncate',
      source: `await sequelize.query('TRUNCATE TABLE Accounts');`,
      type: 'Accounts raw SQL write',
    },
  ];

  for (const fixture of fixtures) {
    const findings = auditSource(fixture.source, `${fixture.name}.js`);
    assert.ok(
      findings.some((finding) => finding.type === fixture.type),
      `${fixture.name}: ${JSON.stringify(findings)}`,
    );
  }
});

test('AST audit ignores comments, Account reads and historical migrations', () => {
  assert.deepEqual(
    auditSource(
      `
        // db.Account.destroy({ where: {} });
        const account = await db.Account.findByPk(1);
        await db.sequelize.query('SELECT * FROM Accounts');
        console.log(account.email);
      `,
      'reads-only.js',
    ),
    [],
  );

  const serverRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'account-audit-'));
  try {
    for (const directory of ['src', 'scripts', 'seeders', 'migrations']) {
      fs.mkdirSync(path.join(serverRoot, directory));
    }
    fs.writeFileSync(
      path.join(serverRoot, 'migrations', 'historical.js'),
      `db.Account.create({ email: 'historical@example.com' });`,
    );
    fs.writeFileSync(
      path.join(serverRoot, 'src', 'read-only.js'),
      `db.Account.findByPk(1);`,
    );
    assert.deepEqual(auditRepository({ serverRoot }), []);
  } finally {
    fs.rmSync(serverRoot, { force: true, recursive: true });
  }
});
