const utilizationService = require('../services/utilization.service');
const { sendError } = require('../utils/api-error');

class UtilizationController {
  async getAll(req, res) {
    try {
      const data = await utilizationService.getAll(req.tenant);
      res.json(data);
    } catch (error) {
      sendError(res, error, 'Ошибка получения утилизации');
    }
  }

  async upsert(req, res) {
    try {
      const records = await utilizationService.upsertMany(req.body, req.tenant);
      res.json({ success: true, records });
    } catch (error) {
      sendError(res, error, 'Ошибка сохранения утилизации');
    }
  }
}

module.exports = new UtilizationController();
