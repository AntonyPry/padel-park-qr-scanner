'use strict';

const db = require('../../models');

function positiveId(value, label) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return normalized;
}

async function countAuthUsableOwners({
  excludeMembershipId = null,
  membershipId = null,
  organizationId,
  transaction,
}) {
  if (!transaction) {
    throw new Error('Owner invariant requires an active transaction');
  }
  if (excludeMembershipId !== null && membershipId !== null) {
    throw new Error('Owner invariant membership filters are mutually exclusive');
  }

  const replacements = {
    organizationId: positiveId(organizationId, 'organizationId'),
  };
  let membershipFilter = '';
  if (membershipId !== null) {
    replacements.membershipId = positiveId(membershipId, 'membershipId');
    membershipFilter = 'AND m.id = :membershipId';
  } else if (excludeMembershipId !== null) {
    replacements.excludeMembershipId = positiveId(
      excludeMembershipId,
      'excludeMembershipId',
    );
    membershipFilter = 'AND m.id <> :excludeMembershipId';
  }

  const [rows] = await db.sequelize.query(
    `SELECT COUNT(*) AS ownerCount
       FROM Memberships AS m
       JOIN Accounts AS a
         ON a.id = m.accountId
       LEFT JOIN Staffs AS s
         ON s.id = m.staffId
        AND s.organizationId = m.organizationId
      WHERE m.organizationId = :organizationId
        AND m.role = 'owner'
        AND m.status = 'active'
        AND a.status = 'active'
        ${membershipFilter}
        AND (
          (m.staffId IS NULL AND a.staffId IS NULL)
          OR (
            m.staffId IS NOT NULL
            AND a.staffId = m.staffId
            AND s.id IS NOT NULL
            AND s.status = 'active'
          )
        )`,
    { replacements, transaction },
  );

  return Number(rows[0]?.ownerCount || 0);
}

async function isAuthUsableOwnerMembership(options) {
  return (await countAuthUsableOwners(options)) === 1;
}

module.exports = {
  countAuthUsableOwners,
  isAuthUsableOwnerMembership,
};
