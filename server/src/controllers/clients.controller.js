const clientsService = require('../services/clients.service');

function handleError(res, error, fallback) {
  res
    .status(error.statusCode || 500)
    .json({ error: error.message || fallback });
}

class ClientsController {
  async getAll(req, res) {
    try {
      res.json(await clientsService.listClients(req.query));
    } catch (error) {
      handleError(res, error, 'Ошибка получения клиентов');
    }
  }

  async getOne(req, res) {
    try {
      res.json(await clientsService.getClientDetails(req.params.id));
    } catch (error) {
      handleError(res, error, 'Ошибка получения клиента');
    }
  }

  async create(req, res) {
    try {
      res.status(201).json(await clientsService.createClient(req.body));
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
}

module.exports = new ClientsController();
