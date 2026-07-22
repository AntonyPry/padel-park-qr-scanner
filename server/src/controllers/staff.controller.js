const staffService = require('../services/staff.service');
const { disconnectStaffSockets } = require('../realtime/session-boundary');
const { sendError } = require('../utils/api-error');

class StaffController {
  async getAll(req, res) {
    try {
      const staff = await staffService.getAll(req.query, req.tenant);
      res.json(staff);
    } catch (error) {
      sendError(res, error, 'Ошибка получения персонала');
    }
  }

  async getById(req, res) {
    try {
      res.json(await staffService.getStaffById(req.params.id, req.tenant));
    } catch (error) {
      sendError(res, error, 'Ошибка получения сотрудника');
    }
  }

  async create(req, res) {
    try {
      const staff = await staffService.create(req.body, req.tenant);
      res.status(201).json(staff);
    } catch (error) {
      sendError(res, error, 'Ошибка добавления сотрудника');
    }
  }

  async update(req, res) {
    try {
      const staff = await staffService.update(req.params.id, req.body, req.tenant);
      if (req.body.status && req.body.status !== 'active') {
        disconnectStaffSockets(req.app.get('io'), staff.id);
      }
      res.json(staff);
    } catch (error) {
      sendError(res, error, 'Ошибка обновления сотрудника');
    }
  }

  async remove(req, res) {
    try {
      const result = await staffService.remove(req.params.id, req.tenant);
      disconnectStaffSockets(req.app.get('io'), result.id);
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка удаления сотрудника');
    }
  }

  async restore(req, res) {
    try {
      const result = await staffService.restore(req.params.id, req.tenant);
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка восстановления сотрудника');
    }
  }

  async removeArchived(req, res) {
    try {
      const result = await staffService.removeArchived(req.params.id, req.tenant);
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка удаления сотрудника из архива');
    }
  }
}

module.exports = new StaffController();
