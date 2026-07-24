'use strict';

const db = require('../../models');
const {
  AUTH_DATA_PURPOSES,
  authDataEncryptionConfiguration,
  authDataEnvelopeKeyVersion,
  rewrapAuthData,
} = require('../security/auth-data-envelope');

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_REFS = 1_000;
const MAX_BATCH_SIZE = 500;
const MAX_REFS = 10_000;

function boundedInteger(value, fallback, maximum, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new TypeError(`${label} must be between 1 and ${maximum}`);
  }
  return parsed;
}

function emptyCounts() {
  return {
    decryptable: 0,
    errors: 0,
    rewrapped: 0,
    scanned: 0,
    skipped: 0,
    wouldRewrap: 0,
  };
}

function addCount(report, purpose, version, field) {
  const versionLabel = version === null ? 'unknown' : String(version);
  report.purposes[purpose] ||= { totals: emptyCounts(), versions: {} };
  report.purposes[purpose].versions[versionLabel] ||= emptyCounts();
  report.totals[field] += 1;
  report.purposes[purpose].totals[field] += 1;
  report.purposes[purpose].versions[versionLabel][field] += 1;
}

function modelPlans(models = db) {
  return [
    {
      identity(row) {
        return {
          accountId: row.accountId,
          purpose: AUTH_DATA_PURPOSES.ACCOUNT_TWO_FACTOR,
        };
      },
      identityField: 'accountId',
      model: models.AccountTwoFactor,
      purpose: AUTH_DATA_PURPOSES.ACCOUNT_TWO_FACTOR,
    },
    {
      identity(row) {
        return {
          operatorId: row.operatorId,
          purpose: AUTH_DATA_PURPOSES.INSTALLATION_OPERATOR_TWO_FACTOR,
        };
      },
      identityField: 'operatorId',
      model: models.InstallationOperatorTwoFactor,
      purpose: AUTH_DATA_PURPOSES.INSTALLATION_OPERATOR_TWO_FACTOR,
    },
  ];
}

const ENVELOPE_REFS = Object.freeze([
  Object.freeze({
    ciphertextField: 'secretCiphertext',
    keyVersionField: 'keyVersion',
  }),
  Object.freeze({
    ciphertextField: 'pendingSecretCiphertext',
    keyVersionField: 'pendingKeyVersion',
  }),
]);

async function inspectReference({
  apply,
  currentVersion,
  identity,
  model,
  purpose,
  reference,
  report,
  row,
}) {
  const ciphertext = row[reference.ciphertextField];
  if (!ciphertext) return;

  let version;
  try {
    version = authDataEnvelopeKeyVersion(ciphertext);
  } catch {
    addCount(report, purpose, null, 'scanned');
    addCount(report, purpose, null, 'errors');
    return;
  }
  addCount(report, purpose, version, 'scanned');
  try {
    if (Number(row[reference.keyVersionField]) !== version) {
      throw new Error('Envelope metadata mismatch');
    }

    const result = rewrapAuthData(ciphertext, identity);
    addCount(report, purpose, version, 'decryptable');
    if (!result.rewrapped) {
      addCount(report, purpose, version, 'skipped');
      return;
    }
    addCount(report, purpose, version, 'wouldRewrap');
    if (!apply) return;

    const [updated] = await model.update(
      {
        [reference.ciphertextField]: result.ciphertext,
        [reference.keyVersionField]: currentVersion,
      },
      {
        where: {
          id: row.id,
          [reference.ciphertextField]: ciphertext,
          [reference.keyVersionField]: version,
        },
      },
    );
    if (updated === 1) {
      addCount(report, purpose, version, 'rewrapped');
    } else {
      addCount(report, purpose, version, 'skipped');
    }
  } catch {
    addCount(report, purpose, version, 'errors');
  }
}

async function checkAndRewrapAuthData(options = {}) {
  const apply = options.apply === true;
  const batchSize = boundedInteger(
    options.batchSize,
    DEFAULT_BATCH_SIZE,
    MAX_BATCH_SIZE,
    'batchSize',
  );
  const maxRefs = boundedInteger(
    options.maxRefs,
    DEFAULT_MAX_REFS,
    MAX_REFS,
    'maxRefs',
  );
  const configuration = authDataEncryptionConfiguration();
  const report = {
    batchSize,
    currentKeyVersion: configuration.currentVersion,
    maxRefs,
    mode: apply ? 'apply' : 'dry-run',
    purposes: {},
    totals: emptyCounts(),
  };

  for (const plan of modelPlans(options.models)) {
    if (report.totals.scanned >= maxRefs) break;
    let afterId = '';
    while (report.totals.scanned < maxRefs) {
      const remainingRows = Math.max(
        1,
        Math.ceil((maxRefs - report.totals.scanned) / ENVELOPE_REFS.length),
      );
      const rows = await plan.model.unscoped().findAll({
        attributes: [
          'id',
          plan.identityField,
          ...ENVELOPE_REFS.flatMap((reference) => [
            reference.ciphertextField,
            reference.keyVersionField,
          ]),
        ],
        limit: Math.min(batchSize, remainingRows),
        order: [['id', 'ASC']],
        raw: true,
        where: afterId
          ? { id: { [db.Sequelize.Op.gt]: afterId } }
          : undefined,
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        afterId = row.id;
        for (const reference of ENVELOPE_REFS) {
          if (report.totals.scanned >= maxRefs) break;
          await inspectReference({
            apply,
            currentVersion: configuration.currentVersion,
            identity: plan.identity(row),
            model: plan.model,
            purpose: plan.purpose,
            reference,
            report,
            row,
          });
        }
      }
      if (rows.length < Math.min(batchSize, remainingRows)) break;
    }
  }
  return report;
}

module.exports = {
  checkAndRewrapAuthData,
  _private: {
    DEFAULT_BATCH_SIZE,
    DEFAULT_MAX_REFS,
    ENVELOPE_REFS,
    MAX_BATCH_SIZE,
    MAX_REFS,
    boundedInteger,
    emptyCounts,
    modelPlans,
  },
};
