const clientsService = require('../services/clients.service');
const { sendError } = require('../utils/api-error');

function handleError(res, error, fallback) {
  sendError(res, error, fallback);
}

class ClientsController {
  async getAll(req, res) {
    try {
      res.json(await clientsService.listClients(req.query, req.account));
    } catch (error) {
      handleError(res, error, 'Ошибка получения клиентов');
    }
  }

  async getOne(req, res) {
    try {
      res.json(await clientsService.getClientDetails(req.params.id, req.account));
    } catch (error) {
      handleError(res, error, 'Ошибка получения клиента');
    }
  }

  async create(req, res) {
    try {
      res.status(201).json(await clientsService.createClient(req.body, req.account));
    } catch (error) {
      handleError(res, error, 'Ошибка создания клиента');
    }
  }

  async update(req, res) {
    try {
      res.json(await clientsService.updateClient(req.params.id, req.body));
    } catch (error) {
      handleError(res, error, 'Ошибка обновления клиента');
    }
  }

  async lookup(req, res) {
    try {
      res.json({
        client: await clientsService.lookupByPhone(
          req.query.phone,
          req.query.excludeClientId,
          req.account,
          { includeArchived: req.query.includeArchived === 'true' },
        ),
      });
    } catch (error) {
      handleError(res, error, 'Ошибка поиска клиента');
    }
  }

  async getDuplicates(req, res) {
    try {
      res.json(await clientsService.getDuplicateGroups());
    } catch (error) {
      handleError(res, error, 'Ошибка поиска дублей');
    }
  }

  async merge(req, res) {
    try {
      res.json(
        await clientsService.mergeClients(
          req.params.id,
          req.body.duplicateClientIds,
          req.account,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка объединения клиентов');
    }
  }

  async removeArchived(req, res) {
    try {
      res.json(await clientsService.removeArchivedClient(req.params.id));
    } catch (error) {
      handleError(res, error, 'Ошибка удаления клиента из архива');
    }
  }

  async getSavedViews(req, res) {
    try {
      res.json(await clientsService.listSavedViews(req.account));
    } catch (error) {
      handleError(res, error, 'Ошибка получения представлений клиентов');
    }
  }

  async createSavedView(req, res) {
    try {
      res.status(201).json(
        await clientsService.createSavedView(req.account, req.body),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка сохранения представления клиентов');
    }
  }

  async updateSavedView(req, res) {
    try {
      res.json(
        await clientsService.updateSavedView(
          req.account,
          req.params.viewId,
          req.body,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка обновления представления клиентов');
    }
  }

  async deleteSavedView(req, res) {
    try {
      res.json(await clientsService.deleteSavedView(req.account, req.params.viewId));
    } catch (error) {
      handleError(res, error, 'Ошибка удаления представления клиентов');
    }
  }
}

module.exports = new ClientsController();
