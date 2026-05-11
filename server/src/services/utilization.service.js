const db = require('../../models');

async function getAll() {
  return db.Utilizations.findAll({ order: [['date', 'ASC']] });
}

async function upsertMany(input) {
  const records = Array.isArray(input) ? input : [input];

  return Promise.all(
    records.map(({ date, booked1, booked2, sessions1, sessions2 }) =>
      db.Utilizations.upsert({
        date,
        booked1: Number(booked1) || 0,
        booked2: Number(booked2) || 0,
        sessions1: Number(sessions1) || 0,
        sessions2: Number(sessions2) || 0,
      }).then(([record]) => record),
    ),
  );
}

module.exports = {
  getAll,
  upsertMany,
};
