'use strict';

const {
  normalizeSql,
} = require('./20260720120000-add-installation-provisioning').__testing;

const TRIGGER_NAME = 'trg_onboarding_mode_update_tenant';
const TABLE_NAME = 'OnboardingTrainingModes';
let failNextCreateForTesting = false;

const AUTHORITY_CHECK = `NOT EXISTS (
  SELECT 1 FROM Memberships m JOIN Accounts a ON a.id=m.accountId
  JOIN Clubs c ON c.id=NEW.clubId AND c.organizationId=m.organizationId
  JOIN Organizations o ON o.id=m.organizationId
  WHERE m.id=NEW.membershipId AND m.organizationId=NEW.organizationId
    AND m.accountId=NEW.accountId AND m.status='active' AND a.status='active'
    AND c.status='active' AND o.status='active'
    AND (m.role='owner' OR EXISTS (
      SELECT 1 FROM MembershipClubAccesses access
      WHERE access.organizationId=NEW.organizationId AND access.membershipId=NEW.membershipId
        AND access.clubId=NEW.clubId AND access.status='active'
        AND COALESCE(access.roleOverride,m.role)=NEW.role
    ))
)`;

const OWNERSHIP_CHECKS = `
  IF OLD.organizationId<>NEW.organizationId OR OLD.membershipId<>NEW.membershipId OR OLD.accountId<>NEW.accountId
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='OnboardingTrainingMode ownership is immutable'; END IF;
  IF OLD.sessionId IS NOT NULL AND (
    OLD.clubId<>NEW.clubId OR (NEW.sessionId IS NOT NULL AND (
      NOT (OLD.role <=> NEW.role) OR OLD.sessionId<>NEW.sessionId
    ))
  ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Retained onboarding session ownership is immutable'; END IF;`;

const STRICT_BODY = `BEGIN${OWNERSHIP_CHECKS}
  IF ${AUTHORITY_CHECK}
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='OnboardingTrainingMode tenant authority mismatch'; END IF;
END`;

const EXPIRED_DISABLE = `(
  OLD.isEnabled=1 AND NEW.isEnabled=0
  AND OLD.expiresAt IS NOT NULL
  AND NEW.disabledAt IS NOT NULL
  AND OLD.expiresAt<=NEW.disabledAt
  AND OLD.clubId<=>NEW.clubId
  AND OLD.role<=>NEW.role
  AND OLD.sessionId<=>NEW.sessionId
  AND OLD.expiresAt<=>NEW.expiresAt
  AND OLD.enabledAt<=>NEW.enabledAt
  AND OLD.metadata<=>NEW.metadata
)`;

const CURRENT_BODY = `BEGIN${OWNERSHIP_CHECKS}
  IF NOT ${EXPIRED_DISABLE} AND ${AUTHORITY_CHECK}
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='OnboardingTrainingMode tenant authority mismatch'; END IF;
END`;

async function loadTrigger(queryInterface) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION, ACTION_STATEMENT
       FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=:name`,
    { replacements: { name: TRIGGER_NAME } },
  );
  if (rows.length !== 1) return null;
  return {
    body: rows[0].ACTION_STATEMENT,
    event: rows[0].EVENT_MANIPULATION,
    table: rows[0].EVENT_OBJECT_TABLE,
    timing: rows[0].ACTION_TIMING,
  };
}

function exactTrigger(trigger, body) {
  return trigger &&
    trigger.table === TABLE_NAME &&
    trigger.timing === 'BEFORE' &&
    trigger.event === 'UPDATE' &&
    normalizeSql(trigger.body) === normalizeSql(body);
}

async function createTrigger(queryInterface, body, allowForcedFailure = true) {
  if (allowForcedFailure && failNextCreateForTesting) {
    failNextCreateForTesting = false;
    const error = new Error('Forced onboarding trigger create failure');
    error.code = 'ONBOARDING_TRIGGER_CREATE_FORCED_FAILURE';
    throw error;
  }
  await queryInterface.sequelize.query(
    `CREATE TRIGGER \`${TRIGGER_NAME}\` BEFORE UPDATE ON \`${TABLE_NAME}\` FOR EACH ROW ${body}`,
  );
}

async function restoreExpectedTrigger(
  queryInterface,
  capturedBody,
  expectedBody,
  migrationError,
) {
  try {
    const trigger = await loadTrigger(queryInterface);
    if (!trigger) {
      await createTrigger(queryInterface, capturedBody, false);
    }
    const restored = await loadTrigger(queryInterface);
    if (exactTrigger(restored, expectedBody)) return;
    const error = new Error(
      'Onboarding training-mode trigger recovery found an unexpected definition',
    );
    error.code = 'ONBOARDING_TRAINING_MODE_TRIGGER_REPAIR_REQUIRED';
    throw error;
  } catch (recoveryError) {
    if (recoveryError.code === 'ONBOARDING_TRAINING_MODE_TRIGGER_REPAIR_REQUIRED') {
      recoveryError.migrationError = migrationError;
      throw recoveryError;
    }
    const repairError = new Error(
      'Onboarding training-mode authority guard may be missing after failed trigger restoration',
    );
    repairError.code = 'ONBOARDING_TRAINING_MODE_TRIGGER_REPAIR_REQUIRED';
    repairError.migrationError = migrationError;
    repairError.recoveryError = recoveryError;
    throw repairError;
  }
}

async function replaceTrigger(queryInterface, expectedBody, nextBody) {
  const trigger = await loadTrigger(queryInterface);
  if (exactTrigger(trigger, nextBody)) return;
  if (!exactTrigger(trigger, expectedBody)) {
    const error = new Error(
      'Onboarding training-mode trigger is missing or has an unexpected definition',
    );
    error.code = 'ONBOARDING_TRAINING_MODE_TRIGGER_MIGRATION_BLOCKED';
    throw error;
  }
  const capturedBody = trigger.body;
  await queryInterface.sequelize.query(`DROP TRIGGER \`${TRIGGER_NAME}\``);
  try {
    await createTrigger(queryInterface, nextBody);
  } catch (error) {
    await restoreExpectedTrigger(
      queryInterface,
      capturedBody,
      expectedBody,
      error,
    );
    throw error;
  }
  const replaced = await loadTrigger(queryInterface);
  if (!exactTrigger(replaced, nextBody)) {
    const error = new Error(
      'Onboarding training-mode trigger replacement did not reach the expected definition',
    );
    error.code = 'ONBOARDING_TRAINING_MODE_TRIGGER_REPAIR_REQUIRED';
    throw error;
  }
}

module.exports = {
  async up(queryInterface) {
    await replaceTrigger(queryInterface, STRICT_BODY, CURRENT_BODY);
  },

  async down(queryInterface) {
    await replaceTrigger(queryInterface, CURRENT_BODY, STRICT_BODY);
  },

  __testing: {
    CURRENT_BODY,
    STRICT_BODY,
    exactTrigger,
    failNextCreate() {
      failNextCreateForTesting = true;
    },
    loadTrigger,
  },
};
