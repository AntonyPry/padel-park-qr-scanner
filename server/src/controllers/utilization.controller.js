const utilizationService = require('../services/utilization.service');

class UtilizationController {
  async getAll(req, res) {
    try {
      const data = await utilizationService.getAll();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async upsert(req, res) {
    try {
      const records = await utilizationService.upsertMany(req.body);
      res.json({ success: true, records });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new UtilizationController();
