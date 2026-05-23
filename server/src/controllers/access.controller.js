const accessService = require('../services/access.service');
const scannerEventsService = require('../services/scanner-events.service');
const { ACCESS_SOCKET_ROOM } = require('../sockets');
const { sendError } = require('../utils/api-error');

function getIo(req) {
  return req.app.get('io');
}

function emitAccessEvent(req, event) {
  getIo(req).to(ACCESS_SOCKET_ROOM).emit('scan_result', event);
}

class AccessController {
  async search(req, res) {
    try {
      const users = await accessService.searchUsers(req.query.q);
      res.json(users);
    } catch (error) {
      sendError(res, error, 'Поиск временно недоступен');
    }
  }

  async manualVisit(req, res) {
    const { userId, clientEventId, source, metadata } = req.body;
    if (!userId) return sendError(res, { statusCode: 400 }, 'Не указан клиент');

    try {
      const event = await accessService.createManualVisit(userId, {
        account: req.account,
        clientEventId,
        source: source || 'manual',
        metadata,
      });
      if (!event) return sendError(res, { statusCode: 404 }, 'Клиент не найден');

      emitAccessEvent(req, event);
      res.json({ status: 'ok', event });
    } catch (error) {
      sendError(res, error, 'Ошибка создания визита');
    }
  }

  async issueKey(req, res) {
    const { visitId, keyNumber } = req.body;

    try {
      await accessService.issueKey(visitId, keyNumber, req.account);
      res.json({ status: 'ok' });
    } catch (error) {
      sendError(res, error, 'Ошибка выдачи ключа');
    }
  }

  async scan(req, res) {
    const { qr, clientEventId, scannerSessionId, deviceLabel, metadata } = req.body;

    if (!qr) return sendError(res, { statusCode: 400 }, 'QR обязателен');

    try {
      const result = await accessService.scanQr(qr, {
        account: req.account,
        clientEventId,
        source: 'web_serial',
        metadata: {
          ...metadata,
          scannerSessionId,
          deviceLabel,
        },
      });

      if (result.found) {
        console.log(`✅ QR найден: ${result.event.user.name}`);
      } else {
        console.log(
          `❌ QR не найден: ${scannerEventsService.sanitizeQrPreview(result.qr)}`,
        );
      }

      emitAccessEvent(req, result.event);
      res.json({ status: 'ok', found: result.found, event: result.event });
    } catch (error) {
      console.error('Ошибка при сканировании:', error);
      await scannerEventsService.recordEvent({
        eventType: 'qr_error',
        severity: 'error',
        status: 'failed',
        message: error?.message || 'Ошибка сканирования QR',
        code: error?.code || 'QR_SCAN_FAILED',
        source: 'web_serial',
        rawQr: qr,
        account: req.account,
        clientEventId,
        metadata: {
          scannerSessionId,
          deviceLabel,
        },
      });
      sendError(res, error, 'Ошибка сканирования QR');
    }
  }

  async recordScannerEvent(req, res) {
    try {
      const event = await scannerEventsService.recordEvent({
        eventType: req.body.eventType,
        severity: req.body.severity,
        status: req.body.status,
        message: req.body.message,
        code: req.body.code,
        source: req.body.source || 'web_serial',
        rawQr: req.body.qr,
        visitId: req.body.visitId,
        userId: req.body.userId,
        account: req.account,
        clientEventId: req.body.clientEventId,
        metadata: req.body.metadata,
        throwOnError: true,
      });

      res.json({
        status: event ? 'ok' : 'duplicate',
        eventId: event?.id || null,
      });
    } catch (error) {
      sendError(res, error, 'Ошибка записи события сканера');
    }
  }

  async getScannerEvents(req, res) {
    try {
      const events = await scannerEventsService.listEvents(req.query);
      res.json(events);
    } catch (error) {
      sendError(res, error, 'Ошибка получения журнала сканера');
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
        req.account,
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
