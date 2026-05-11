const { Op } = require('sequelize');
const db = require('../../models');

const REPEAT_SCAN_WINDOW_MINUTES = 5;

function normalizeQr(rawQr) {
  return String(rawQr).replace(/[\s@\r\n]/g, '');
}

async function searchUsers(query) {
  if (!query || query.length < 2) return [];

  return db.User.findAll({
    where: {
      [Op.or]: [
        { name: { [Op.like]: `%${query}%` } },
        { phone: { [Op.like]: `%${query}%` } },
      ],
    },
    limit: 5,
  });
}

async function findUserByQr(qr) {
  if (qr.startsWith('vk_')) {
    return db.User.findOne({ where: { vkId: qr.replace('vk_', '') } });
  }

  if (qr.startsWith('web_')) {
    return db.User.findOne({ where: { webId: qr } });
  }

  return db.User.findOne({
    where: {
      [Op.or]: [{ telegramId: qr }, { telegramId: `@${qr}` }],
    },
  });
}

async function createVisitForUser(user) {
  const lastVisit = await db.Visit.findOne({
    where: { userId: user.id },
    order: [['createdAt', 'DESC']],
  });

  let visitId;
  let isNewVisit = true;

  if (
    lastVisit &&
    (Date.now() - new Date(lastVisit.createdAt).getTime()) / 60000 <
      REPEAT_SCAN_WINDOW_MINUTES
  ) {
    visitId = lastVisit.id;
    isNewVisit = false;
  }

  if (isNewVisit) {
    const newVisit = await db.Visit.create({ userId: user.id });
    visitId = newVisit.id;
  }

  return {
    success: true,
    user,
    visitId,
    isRepeated: !isNewVisit,
  };
}

async function createManualVisit(userId) {
  const user = await db.User.findByPk(userId);
  if (!user) return null;

  return createVisitForUser(user);
}

async function scanQr(rawQr) {
  const qr = normalizeQr(rawQr);
  const user = await findUserByQr(qr);

  if (!user) {
    return {
      found: false,
      qr,
      event: { success: false, id: qr },
    };
  }

  const event = await createVisitForUser(user);
  return {
    found: true,
    qr,
    event,
  };
}

async function registerReceptionUser({ name, phone, source }) {
  const webId = `web_${Date.now()}`;
  const user = await db.User.create({
    webId,
    name,
    phone,
    source: source || 'Ресепшн (Админ)',
  });

  return {
    status: 'success',
    user,
    qrData: webId,
  };
}

async function getRecentVisitCards(limit = 50) {
  const visits = await db.Visit.findAll({
    limit,
    order: [['createdAt', 'DESC']],
    include: [{ model: db.User }],
  });

  return visits.map((visit) => ({
    id: String(visit.id),
    success: true,
    time: new Date(visit.createdAt).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    name: visit.User?.name || 'Неизвестный',
    phone: visit.User?.phone || '',
    source: visit.User?.source || '-',
    visitId: visit.id,
    keyNumber: visit.keyNumber || '',
    keyIssued: !!visit.keyNumber,
    category: visit.category || '',
  }));
}

async function issueKey(visitId, keyNumber) {
  return db.Visit.update({ keyNumber }, { where: { id: visitId } });
}

async function updateVisitCategory(visitId, category) {
  return db.Visit.update({ category }, { where: { id: visitId } });
}

module.exports = {
  searchUsers,
  createManualVisit,
  scanQr,
  registerReceptionUser,
  getRecentVisitCards,
  issueKey,
  updateVisitCategory,
};
