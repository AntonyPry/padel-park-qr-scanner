const clientBasesService = require('../services/client-bases.service');
const { sendError } = require('../utils/api-error');

function handleError(res, error, fallback) {
  sendError(res, error, fallback);
}

class ClientBasesController {
  async getAll(req, res) {
    try {
      res.json(await clientBasesService.list(req.query, req.tenant));
    } catch (error) {
      handleError(res, error, 'Ошибка получения баз клиентов');
    }
  }

  async create(req, res) {
    try {
      res.status(201).json(
        await clientBasesService.create(req.account, req.body, req.tenant),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка создания базы клиентов');
    }
  }

  async update(req, res) {
    try {
      res.json(
        await clientBasesService.update(req.params.id, req.body, req.tenant),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка обновления базы клиентов');
    }
  }

  async archive(req, res) {
    try {
      res.json(await clientBasesService.archive(req.params.id, req.tenant));
    } catch (error) {
      handleError(res, error, 'Ошибка архивации базы клиентов');
    }
  }

  async restore(req, res) {
    try {
      res.json(await clientBasesService.restore(req.params.id, req.tenant));
    } catch (error) {
      handleError(res, error, 'Ошибка восстановления базы клиентов');
    }
  }

  async removeArchived(req, res) {
    try {
      res.json(await clientBasesService.removeArchived(req.params.id));
    } catch (error) {
      handleError(res, error, 'Ошибка удаления базы клиентов из архива');
    }
  }

  async getClients(req, res) {
    try {
      res.json(
        await clientBasesService.getClients(
          req.params.id,
          req.query,
          req.tenant,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка получения клиентов базы');
    }
  }
}

module.exports = new ClientBasesController();
