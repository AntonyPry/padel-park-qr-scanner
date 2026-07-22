const db = require('../../models');
const {
  bookingTenantWhere,
  resolveBookingAccessContext,
} = require('./booking-access-context.service');

function mapUtilization(row) {
  const value = row.toJSON ? row.toJSON() : row;
  return {
    booked1: Number(value.booked1 || 0),
    booked2: Number(value.booked2 || 0),
    date: value.date,
    sessions1: Number(value.sessions1 || 0),
    sessions2: Number(value.sessions2 || 0),
  };
}

async function getAll(authority = null) {
  const context = await resolveBookingAccessContext(authority);
  const rows = await db.Utilizations.findAll({
    order: [['date', 'ASC']],
    where: bookingTenantWhere(context, {}, { force: true }),
  });
  return rows.map(mapUtilization);
}

async function upsertMany(input, authority = null) {
  const records = Array.isArray(input) ? input : [input];

  return db.sequelize.transaction(async (transaction) => {
    const context = await resolveBookingAccessContext(authority, {
      lock: true,
      transaction,
    });
    const result = [];
    for (const { date, booked1, booked2, sessions1, sessions2 } of records) {
      let row = await db.Utilizations.findOne({
        lock: transaction.LOCK.UPDATE,
        transaction,
        where: bookingTenantWhere(context, { date }, { force: true }),
      });
      const values = {
        date,
        booked1: Number(booked1) || 0,
        booked2: Number(booked2) || 0,
        sessions1: Number(sessions1) || 0,
        sessions2: Number(sessions2) || 0,
      };
      if (row) {
        await row.update(values, { transaction });
      } else {
        row = await db.Utilizations.create({
          ...values,
          clubId: context.clubId,
          organizationId: context.organizationId,
        }, { transaction });
      }
      result.push(mapUtilization(row));
    }
    return result;
  });
}

module.exports = {
  getAll,
  upsertMany,
};
