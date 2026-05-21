const staffService = require('../services/staff.service');
const { sendError } = require('../utils/api-error');

class StaffController {
  async getAll(req, res) {
    try {
      const staff = await staffService.getAll(req.query);
      res.json(staff);
    } catch (error) {
      sendError(res, error, 'Ошибка получения персонала');
    }
  }

  async create(req, res) {
    try {
      const staff = await staffService.create(req.body);
      res.status(201).json(staff);
    } catch (error) {
      sendError(res, error, 'Ошибка добавления сотрудника');
    }
  }

  async update(req, res) {
    try {
      const staff = await staffService.update(req.params.id, req.body);
      res.json(staff);
    } catch (error) {
      sendError(res, error, 'Ошибка обновления сотрудника');
    }
  }

  async remove(req, res) {
    try {
      const result = await staffService.remove(req.params.id);
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка удаления сотрудника');
    }
  }

  async restore(req, res) {
    try {
      const result = await staffService.restore(req.params.id);
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка восстановления сотрудника');
    }
  }

  async removeArchived(req, res) {
    try {
      const result = await staffService.removeArchived(req.params.id);
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка удаления сотрудника из архива');
    }
  }
}

module.exports = new StaffController();
