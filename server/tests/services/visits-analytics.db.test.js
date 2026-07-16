const assert = require('node:assert/strict');
const { test } = require('node:test');
const db = require('../../models');
const XLSX = require('xlsx');
const { createSourceQualityExportBuffer, createVisitsExportBuffer, explainPeriodIndex, getCohortsLifecycle, getSourceQuality, getVisitsAnalytics, sourceKeyFromRow } = require('../../src/services/visits-analytics.service');
const { getDefaultOrganizationId } = require('../helpers/tenant-fixtures');

test('DB-backed visit analytics handles history, 30-day boundary, training, duplicates, merge and scannedAt', async () => {
  await db.sequelize.authenticate();
  const organizationId = await getDefaultOrganizationId(db);
  const suffix = `${Date.now()}`;
  const users = [];
  try {
    const makeUser = async (name, extra = {}) => {
      const user = await db.User.create({ organizationId, name: `${name}-${suffix}`, phone: `${suffix}${users.length}`.slice(-15), source: 'DB QA', ...extra });
      users.push(user);
      return user;
    };
    const returning = await makeUser('returning');
    const exact30 = await makeUser('exact30');
    const late = await makeUser('late');
    const fresh = await makeUser('fresh');
    const primary = await makeUser('primary');
    const merged = await makeUser('merged', { status: 'archived', mergedIntoUserId: primary.id, mergedAt: new Date() });
    const training = await makeUser('training');
    const create = (userId, scannedAt, extra = {}) => db.Visit.create({ userId, scannedAt, ...extra });
    await create(returning.id, '2097-12-20T10:00:00Z');
    await create(returning.id, '2098-01-05T10:00:00Z');
    const firstExact = await create(exact30.id, '2098-01-01T10:00:00Z', { createdAt: '2098-02-01T10:00:00Z' });
    await create(exact30.id, '2098-01-31T10:00:00Z');
    await create(late.id, '2098-01-01T11:00:00Z');
    await create(late.id, '2098-02-01T11:00:01Z');
    await create(fresh.id, '2098-01-25T10:00:00Z');
    await create(merged.id, '2098-01-10T10:00:00Z');
    await create(training.id, '2098-01-12T10:00:00Z', { isTraining: true });
    await create(returning.id, '2098-01-05T10:01:00Z', { duplicateOfVisitId: firstExact.id });

    const result = await getVisitsAnalytics('2098-01-01', '2098-01-31', { now: '2098-02-10T12:00:00Z' });
    assert.equal(result.totalVisits, 6, JSON.stringify(result));
    assert.equal(result.uniqueGuests, 5);
    assert.equal(result.newGuests, 4);
    assert.equal(result.returningGuests, 1);
    assert.equal(result.repeatVisits, 1);
    assert.equal(result.repeatRate30EligibleGuests, 3);
    assert.equal(result.repeatRate30RepeatedGuests, 1);
    assert.equal(Math.round(result.repeatRate30 * 100) / 100, 33.33);
  } finally {
    if (users.length) {
      await db.Visit.destroy({ where: { userId: users.map((user) => user.id) } });
      await db.User.update(
        { mergedIntoUserId: null },
        { where: { id: users.map((user) => user.id) } },
      );
      await db.User.destroy({ force: true, where: { id: users.map((user) => user.id) } });
    }
  }
});

test('DB-backed canonical chain leaf → middle → root uses final root everywhere', async () => {
  await db.sequelize.authenticate();
  const organizationId = await getDefaultOrganizationId(db);
  const suffix = `${Date.now()}`;
  const users = [];
  try {
    const makeUser = async (name, source) => {
      const user = await db.User.create({ organizationId, name: `${name}-${suffix}`, phone: `${suffix}${users.length}`.slice(-15), source });
      users.push(user);
      return user;
    };
    const rootSource = `Root Source ${suffix}`;
    const root = await makeUser('FINAL ROOT', rootSource);
    const middle = await makeUser('middle', `Middle Source ${suffix}`);
    const leaf = await makeUser('leaf', `Leaf Source ${suffix}`);
    await middle.update({ status: 'archived', mergedIntoUserId: root.id, mergedAt: new Date() });
    await leaf.update({ status: 'archived', mergedIntoUserId: middle.id, mergedAt: new Date() });
    await db.Visit.bulkCreate([
      { userId: leaf.id, scannedAt: '2095-06-01T08:00:00Z' },
      { userId: middle.id, scannedAt: '2095-06-02T08:00:00Z' },
      { userId: root.id, scannedAt: '2095-06-03T08:00:00Z' },
    ]);

    const result = await getVisitsAnalytics('2095-06-01', '2095-06-30', { now: '2095-08-01T00:00:00Z' });
    assert.equal(result.totalVisits, 3);
    assert.equal(result.uniqueGuests, 1);
    assert.deepEqual(result.sources, [{ name: rootSource, value: 3 }]);
    assert.equal(result.topGuests[0].name, root.name);
    assert.equal(result.topGuests[0].phone, root.phone);
    assert.equal(result.topGuests[0].visits, 3);

    const lifecycle = await getCohortsLifecycle('2095-06-01', '2095-06-30', { sourceKeys: [sourceKeyFromRow({ sourceName: rootSource })] });
    assert.equal(lifecycle.cohorts.length, 1);
    assert.equal(lifecycle.cohorts[0].cohortSize, 1);
    assert.equal(lifecycle.lifecycle.totalClassified, 1);

    const workbook = XLSX.read(await createVisitsExportBuffer('2095-06-01', '2095-06-30', { now: '2095-08-01T00:00:00Z' }));
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Визиты']);
    assert.equal(rows.length, 3);
    assert.equal(rows.every((row) => row.Гость === root.name && row.Источник === rootSource), true);
  } finally {
    if (users.length) {
      await db.Visit.destroy({ where: { userId: users.map((user) => user.id) } });
      await db.User.update(
        { mergedIntoUserId: null },
        { where: { id: users.map((user) => user.id) } },
      );
      await db.User.destroy({ force: true, where: { id: users.map((user) => user.id) } });
    }
  }
});

test('DB-backed canonical resolution terminates on merged cycles', async () => {
  await db.sequelize.authenticate();
  const organizationId = await getDefaultOrganizationId(db);
  const suffix = `${Date.now()}`;
  const users = [];
  try {
    const cycleSource = `Cycle ${suffix}`;
    for (const name of ['cycle-a', 'cycle-b']) users.push(await db.User.create({ organizationId, name: `${name}-${suffix}`, phone: `${suffix}${users.length}`.slice(-15), source: cycleSource }));
    await users[0].update({ mergedIntoUserId: users[1].id, status: 'archived' });
    await users[1].update({ mergedIntoUserId: users[0].id, status: 'archived' });
    await db.Visit.bulkCreate(users.map((user, index) => ({ userId: user.id, scannedAt: `2094-05-0${index + 1}T08:00:00Z` })));
    const result = await getVisitsAnalytics('2094-05-01', '2094-05-31', { now: '2094-07-01T00:00:00Z' });
    assert.equal(result.totalVisits, 2);
    assert.equal(result.uniqueGuests, 1);
    const lifecycle = await getCohortsLifecycle('2094-05-01', '2094-05-31', { sourceKeys: [sourceKeyFromRow({ sourceName: cycleSource })] });
    assert.equal(lifecycle.lifecycle.totalClassified, 1);
    assert.equal(lifecycle.cohorts[0].cohortSize, 1);
  } finally {
    if (users.length) {
      await db.Visit.destroy({ where: { userId: users.map((user) => user.id) } });
      await db.User.update({ mergedIntoUserId: null }, { where: { id: users.map((user) => user.id) } });
      await db.User.destroy({ force: true, where: { id: users.map((user) => user.id) } });
    }
  }
});

test('DB-backed EXPLAIN uses visitedAt range index', async () => {
  const plan = await explainPeriodIndex('2095-01-01', '2095-01-31', { now: '2095-02-01T00:00:00Z' });
  assert.equal(plan.some((row) => row.key === 'idx_visits_visited_at' && row.type === 'range'), true, JSON.stringify(plan));
});

test('DB-backed source quality handles boundaries, maturity, canonical source and Excel parity', async () => {
  await db.sequelize.authenticate();
  const organizationId = await getDefaultOrganizationId(db);
  const suffix = `${Date.now()}`;
  const users = [];
  let source;
  try {
    source = await db.ClientSource.create({ organizationId, name: `VK-${suffix}`, status: 'active' });
    const make = async (name, extra={}) => { const user=await db.User.create({organizationId,name:`${name}-${suffix}`,phone:`7${suffix}${users.length}`.slice(-15),source:'Legacy',...extra});users.push(user);return user; };
    const exact=await make('exact',{sourceId:source.id});
    const late=await make('late',{sourceId:source.id});
    const fresh=await make('fresh',{sourceId:source.id});
    const root=await make('root',{sourceId:source.id});
    const leaf=await make('leaf',{source:'Wrong',status:'archived',mergedIntoUserId:root.id});
    const legacy=await make('legacy');
    const unspecified=await make('unspecified',{source:''});
    await db.Visit.bulkCreate([
      {userId:exact.id,scannedAt:'2090-01-01T10:00:00Z'},{userId:exact.id,scannedAt:'2090-01-31T10:00:00Z'},{userId:exact.id,scannedAt:'2090-03-31T10:00:00Z'},
      {userId:late.id,scannedAt:'2090-01-02T10:00:00Z'},{userId:late.id,scannedAt:'2090-02-01T10:00:01Z'},
      {userId:fresh.id,scannedAt:'2090-01-30T10:00:00Z'},
      {userId:leaf.id,scannedAt:'2090-01-03T10:00:00Z'},{userId:root.id,scannedAt:'2090-01-04T10:00:00Z'},
      {userId:legacy.id,scannedAt:'2090-01-05T10:00:00Z'},{userId:unspecified.id,scannedAt:'2090-01-06T10:00:00Z'},
    ]);
    const result=await getSourceQuality('2090-01-01','2090-01-31',{now:'2090-05-01T00:00:00Z'});
    const row=result.sources.find(item=>item.source===source.name);
    assert.ok(row, JSON.stringify(result));
    assert.equal(row.newClients,4);
    assert.equal(row.repeat30.count,2);
    assert.equal(row.repeat30.eligibleCount,4);
    assert.equal(row.repeat90.count,3);
    assert.equal(row.threePlus90.count,1);
    assert.equal(result.sources.some(item=>item.source==='Legacy'&&item.sourceKey.startsWith('legacy:')),true);
    assert.equal(result.sources.some(item=>item.source==='Не указан'&&item.sourceKey==='unspecified'),true);
    const filterOptions={now:'2090-05-01T00:00:00Z',sourceKeys:[row.sourceKey]};
    const filtered=await getSourceQuality('2090-01-01','2090-01-31',filterOptions);
    assert.deepEqual(filtered.sources.map(item=>item.source),[source.name]);
    const workbook=XLSX.read(await createSourceQualityExportBuffer('2090-01-01','2090-01-31',filterOptions));
    const exportRows=XLSX.utils.sheet_to_json(workbook.Sheets['Качество источников']);
    assert.deepEqual(exportRows.map(item=>item.Источник),[source.name]);
    const exported=exportRows[0];
    assert.equal(exported['Вернулись 30, кол-во'],row.repeat30.count);
    assert.equal(exported['Вернулись 30, eligible'],row.repeat30.eligibleCount);

    const lifecycle=await getCohortsLifecycle('2090-01-01','2090-04-30',filterOptions);
    assert.deepEqual(lifecycle.availableSources.some(item=>item.sourceKey===row.sourceKey),true);
    assert.equal(lifecycle.cohorts.reduce((sum,item)=>sum+item.cohortSize,0),4);
    assert.equal(lifecycle.lifecycle.totalClassified,4);
    assert.equal(lifecycle.cohorts.find(item=>item.cohortMonth==='2090-01').repeat30.eligibleCount,4);

    await db.Visit.create({userId:exact.id,scannedAt:'2090-05-01T00:00:00Z'});
    const historical=await getCohortsLifecycle('2090-01-01','2090-04-30',filterOptions);
    assert.equal(historical.lifecycle.statuses.reduce((sum,item)=>sum+item.count,0),4);

    const fullWorkbook=XLSX.read(await createVisitsExportBuffer('2090-01-01','2090-04-30',filterOptions));
    assert.ok(fullWorkbook.Sheets['Когорты']);
    assert.ok(fullWorkbook.Sheets['Жизненный цикл']);
    const summaryExport=XLSX.utils.sheet_to_json(fullWorkbook.Sheets['Сводка'],{header:1});
    assert.equal(summaryExport.find(item=>item[0]==='Всего визитов')[1],8);
    assert.equal(summaryExport.find(item=>item[0]==='Примененные источники')[1],source.name);
    const visitExport=XLSX.utils.sheet_to_json(fullWorkbook.Sheets['Визиты']);
    assert.equal(visitExport.length,8);
    assert.equal(visitExport.every(item=>item.Источник===source.name),true);
    const cohortExport=XLSX.utils.sheet_to_json(fullWorkbook.Sheets['Когорты']);
    assert.equal(cohortExport[0]['Размер когорты'],lifecycle.cohorts[0].cohortSize);
    const lifecycleExport=XLSX.utils.sheet_to_json(fullWorkbook.Sheets['Жизненный цикл']);
    assert.equal(lifecycleExport.reduce((sum,item)=>sum+item['Количество клиентов'],0),4);
  } finally {
    if(users.length){await db.Visit.destroy({where:{userId:users.map(x=>x.id)}});await db.User.update({mergedIntoUserId:null},{where:{id:users.map(x=>x.id)}});await db.User.destroy({force:true,where:{id:users.map(x=>x.id)}});}
    if(source) await source.destroy();
  }
});
