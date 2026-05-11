const shiftsService = require('../services/shifts.service');

class ShiftsController {
  async getActive(req, res) {
    try {
      const shift = await shiftsService.getActive();
      res.json({ shift });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка получения активной смены' });
    }
  }

  async startActive(req, res) {
    try {
      const shift = await shiftsService.startActive(req.account);
      res.json({ shift });
    } catch (error) {
      res
        .status(error.statusCode || 500)
        .json({ error: error.message || 'Ошибка старта смены' });
    }
  }

  async endActive(req, res) {
    try {
      const shift = await shiftsService.endActive(req.account);
      res.json({ shift });
    } catch (error) {
      res
        .status(error.statusCode || 500)
        .json({ error: error.message || 'Ошибка завершения смены' });
    }
  }

  async create(req, res) {
    try {
      const shift = await shiftsService.create(req.body);
      res.json(shift);
    } catch (error) {
      res
        .status(error.statusCode || 500)
        .json({ error: error.message || 'Ошибка добавления смены' });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Не указан ID смены' });

      const shift = await shiftsService.update(req.body);
      if (!shift) return res.status(404).json({ error: 'Смена не найдена' });

      res.json(shift);
    } catch (error) {
      res
        .status(error.statusCode || 500)
        .json({ error: error.message || 'Ошибка обновления смены' });
    }
  }

  async delete(req, res) {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Не указан ID смены' });

      const deleted = await shiftsService.remove(id);
      if (!deleted) return res.status(404).json({ error: 'Смена не найдена' });

      res.json({ status: 'ok' });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка удаления смены' });
    }
  }
}

module.exports = new ShiftsController();
