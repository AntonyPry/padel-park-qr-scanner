const accessService = require('../services/access.service');

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
    if (!userId) return res.status(400).send('No ID');

    try {
      const event = await accessService.createManualVisit(userId);
      if (!event) return res.status(404).send('User not found');

      getIo(req).emit('scan_result', event);
      res.json({ status: 'ok' });
    } catch (error) {
      res.status(500).send('Error');
    }
  }

  async issueKey(req, res) {
    const { visitId, keyNumber } = req.body;

    try {
      await accessService.issueKey(visitId, keyNumber);
      res.json({ status: 'ok' });
    } catch (error) {
      res.status(500).send('Error');
    }
  }

  async scan(req, res) {
    const { qr } = req.body;
    console.log('📡 Сканер прислал:', JSON.stringify(qr));

    if (!qr) return res.status(400).send('No QR');

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
      res.status(500).send('Server Error');
    }
  }

  async register(req, res) {
    const { name, phone, source } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: 'Имя и телефон обязательны' });
    }

    try {
      const result = await accessService.registerReceptionUser({
        name,
        phone,
        source,
      });
      res.json(result);
    } catch (error) {
      console.error('Ошибка веб-регистрации:', error);
      res.status(500).json({ error: 'Ошибка сервера при регистрации' });
    }
  }

  async getVisits(req, res) {
    try {
      const visits = await accessService.getRecentVisitCards();
      res.json(visits);
    } catch (error) {
      console.error(error);
      res.status(500).send('Error');
    }
  }

  async updateVisitCategory(req, res) {
    const { visitId, category } = req.body;

    try {
      await accessService.updateVisitCategory(visitId, category);
      res.json({ status: 'ok' });
    } catch (error) {
      console.error('Ошибка сохранения категории:', error);
      res.status(500).send('Error');
    }
  }
}

module.exports = new AccessController();
