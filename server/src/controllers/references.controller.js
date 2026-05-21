const referencesService = require('../services/references.service');
const { sendError } = require('../utils/api-error');

function handleError(res, error, fallback) {
  sendError(res, error, fallback);
}

class ReferencesController {
  async list(req, res) {
    try {
      res.json(await referencesService.list(req.params.type, req.query));
    } catch (error) {
      handleError(res, error, 'Ошибка получения справочника');
    }
  }

  async create(req, res) {
    try {
      res.status(201).json(await referencesService.create(req.params.type, req.body));
    } catch (error) {
      handleError(res, error, 'Ошибка создания значения справочника');
    }
  }

  async update(req, res) {
    try {
      res.json(
        await referencesService.update(req.params.type, req.params.id, req.body),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка обновления значения справочника');
    }
  }

  async archive(req, res) {
    try {
      res.json(await referencesService.archive(req.params.type, req.params.id));
    } catch (error) {
      handleError(res, error, 'Ошибка архивирования значения справочника');
    }
  }

  async restore(req, res) {
    try {
      res.json(await referencesService.restore(req.params.type, req.params.id));
    } catch (error) {
      handleError(res, error, 'Ошибка восстановления значения справочника');
    }
  }

  async removeArchived(req, res) {
    try {
      res.json(
        await referencesService.removeArchived(req.params.type, req.params.id),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка удаления значения справочника из архива');
    }
  }
}

module.exports = new ReferencesController();
