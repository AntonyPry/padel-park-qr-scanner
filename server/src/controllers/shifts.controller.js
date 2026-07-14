const shiftsService = require('../services/shifts.service');
const { sendError } = require('../utils/api-error');

class ShiftsController {
  async getActive(req, res) {
    try {
      const shift = await shiftsService.getActive();
      res.json({ shift });
    } catch (error) {
      sendError(res, error, 'Ошибка получения активной смены');
    }
  }

  async startActive(req, res) {
    try {
      const shift = await shiftsService.startActive(req.account);
      res.json({ shift });
    } catch (error) {
      sendError(res, error, 'Ошибка старта смены');
    }
  }

  async endActive(req, res) {
    try {
      res.json(await shiftsService.endActive(req.account, req.body));
    } catch (error) {
      sendError(res, error, 'Ошибка завершения смены');
    }
  }

  async create(req, res) {
    try {
      const shift = await shiftsService.create(req.body, req.account);
      res.json(shift);
    } catch (error) {
      sendError(res, error, 'Ошибка добавления смены');
    }
  }

  async update(req, res) {
    try {
      const { id } = req.body;
      if (!id) return sendError(res, { statusCode: 400 }, 'Не указан ID смены');

      const shift = await shiftsService.update(req.body, req.account);
      if (!shift) return sendError(res, { statusCode: 404 }, 'Смена не найдена');

      res.json(shift);
    } catch (error) {
      sendError(res, error, 'Ошибка обновления смены');
    }
  }

  async delete(req, res) {
    try {
      const { id } = req.body;
      if (!id) return sendError(res, { statusCode: 400 }, 'Не указан ID смены');

      const shift = await shiftsService.remove(id, req.account, req.body?.reason);
      if (!shift) return sendError(res, { statusCode: 404 }, 'Смена не найдена');

      res.json({ status: 'ok', shift });
    } catch (error) {
      sendError(res, error, 'Ошибка удаления смены');
    }
  }
}

module.exports = new ShiftsController();
