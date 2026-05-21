const accessService = require('../services/access.service');
const { sendError } = require('../utils/api-error');

function getIo(req) {
  return req.app.get('io');
}

class AccessController {
  async search(req, res) {
    try {
      const users = await accessService.searchUsers(req.query.q);
      res.json(users);
    } catch (error) {
      res.json([]);
    }
  }

  async manualVisit(req, res) {
    const { userId } = req.body;
    if (!userId) return sendError(res, { statusCode: 400 }, 'Не указан клиент');

    try {
      const event = await accessService.createManualVisit(userId);
      if (!event) return sendError(res, { statusCode: 404 }, 'Клиент не найден');

      getIo(req).emit('scan_result', event);
      res.json({ status: 'ok' });
    } catch (error) {
      sendError(res, error, 'Ошибка создания визита');
    }
  }

  async issueKey(req, res) {
    const { visitId, keyNumber } = req.body;

    try {
      await accessService.issueKey(visitId, keyNumber);
      res.json({ status: 'ok' });
    } catch (error) {
      sendError(res, error, 'Ошибка выдачи ключа');
    }
  }

  async scan(req, res) {
    const { qr } = req.body;
    console.log('📡 Сканер прислал:', JSON.stringify(qr));

    if (!qr) return sendError(res, { statusCode: 400 }, 'QR обязателен');

    try {
      const result = await accessService.scanQr(qr);
      console.log('🧹 После очистки ищем:', result.qr);

      if (result.found) {
        console.log(`✅ Найден гость: ${result.event.user.name}`);
      } else {
        console.log(`❌ Гость с ID ${result.qr} НЕ НАЙДЕН в базе.`);
      }

      getIo(req).emit('scan_result', result.event);
      res.json({ status: 'ok', found: result.found });
    } catch (error) {
      console.error('Ошибка при сканировании:', error);
      sendError(res, error, 'Ошибка сканирования QR');
    }
  }

  async register(req, res) {
    const { name, phone, source, sourceId } = req.body;

    if (!name || !phone) {
      return sendError(res, { statusCode: 400 }, 'Имя и телефон обязательны');
    }

    try {
      const result = await accessService.registerReceptionUser({
        name,
        phone,
        source,
        sourceId,
      });
      res.json(result);
    } catch (error) {
      console.error('Ошибка веб-регистрации:', error);
      sendError(res, error, 'Ошибка сервера при регистрации');
    }
  }

  async getVisits(req, res) {
    try {
      const visits = await accessService.getRecentVisitCards();
      res.json(visits);
    } catch (error) {
      console.error(error);
      sendError(res, error, 'Ошибка получения входов');
    }
  }

  async updateVisitCategory(req, res) {
    const { visitId, category, categoryIds } = req.body;

    try {
      const result = await accessService.updateVisitCategory(
        visitId,
        category,
        categoryIds,
      );
      if (!result) return sendError(res, { statusCode: 404 }, 'Визит не найден');
      res.json({ status: 'ok', ...result });
    } catch (error) {
      console.error('Ошибка сохранения категории:', error);
      sendError(res, error, 'Ошибка сохранения категории');
    }
  }
}

module.exports = new AccessController();
