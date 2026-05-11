const staffService = require('../services/staff.service');

class StaffController {
  async getAll(req, res) {
    try {
      const staff = await staffService.getAll();
      res.json(staff);
    } catch (error) {
      console.error('Ошибка получения персонала:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  }

  async create(req, res) {
    try {
      const staff = await staffService.create(req.body);
      res.json(staff);
    } catch (error) {
      res
        .status(error.statusCode || 500)
        .json({ error: error.message || 'Ошибка добавления' });
    }
  }
}

module.exports = new StaffController();
