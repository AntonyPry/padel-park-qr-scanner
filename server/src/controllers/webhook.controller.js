// src/controllers/webhook.controller.js
const evotorService = require('../services/evotor.service');

class WebhookController {
  async handleEvotor(req, res) {
    try {
      const secret = process.env.EVOTOR_WEBHOOK_SECRET || '';
      const token =
        req.headers['x-evotor-token'] || req.headers['authorization'] || '';

      if (secret && token.replace(/^Bearer\s+/i, '').trim() !== secret) {
        return res.status(401).send('Unauthorized');
      }

      // Вся тяжелая логика парсинга и сохранения ушла в сервис
      const result = await evotorService.processReceipt(req.body);

      if (result.alreadyProcessed) {
        return res.status(200).send('Already processed');
      }

      console.log(
        `✅ [NEW] Сохранен чек Эвотор: ${result.receipt.evotorId} на сумму ${result.receipt.totalAmount} ₽`,
      );

      res.status(200).send('OK');
    } catch (error) {
      console.error('Ошибка вебхука Эвотор:', error);
      res.status(500).send('Server Error');
    }
  }
}

module.exports = new WebhookController();
