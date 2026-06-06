const corporateClientsService = require('../services/corporate-clients.service');
const { sendError } = require('../utils/api-error');

function sendXlsx(res, { buffer, filename }) {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

class CorporateClientsController {
  async list(req, res) {
    try {
      res.json(
        await corporateClientsService.listCorporateClients(req.query, req.account),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка списка корпоративных клиентов');
    }
  }

  async create(req, res) {
    try {
      res
        .status(201)
        .json(
          await corporateClientsService.createCorporateClient(
            req.body,
            req.account,
          ),
        );
    } catch (error) {
      sendError(res, error, 'Ошибка создания корпоративного клиента');
    }
  }

  async get(req, res) {
    try {
      res.json(
        await corporateClientsService.getCorporateClient(
          req.params.id,
          req.account,
        ),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка получения корпоративного клиента');
    }
  }

  async update(req, res) {
    try {
      res.json(
        await corporateClientsService.updateCorporateClient(
          req.params.id,
          req.body,
          req.account,
        ),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка обновления корпоративного клиента');
    }
  }

  async archive(req, res) {
    try {
      res.json(
        await corporateClientsService.archiveCorporateClient(
          req.params.id,
          req.body,
          req.account,
        ),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка архивации корпоративного клиента');
    }
  }

  async restore(req, res) {
    try {
      res.json(
        await corporateClientsService.restoreCorporateClient(
          req.params.id,
          req.account,
        ),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка восстановления корпоративного клиента');
    }
  }

  async listLedger(req, res) {
    try {
      res.json(
        await corporateClientsService.listLedgerEntries(
          req.params.id,
          req.query,
          req.account,
        ),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка истории корпоративного баланса');
    }
  }

  async exportLedger(req, res) {
    try {
      sendXlsx(
        res,
        await corporateClientsService.exportLedgerDetails(
          req.params.id,
          req.query,
          req.account,
        ),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка экспорта детализации корпоративного баланса');
    }
  }

  async createDeposit(req, res) {
    try {
      res
        .status(201)
        .json(
          await corporateClientsService.createDeposit(
            req.params.id,
            req.body,
            req.account,
          ),
        );
    } catch (error) {
      sendError(res, error, 'Ошибка пополнения корпоративного баланса');
    }
  }

  async cancelDeposit(req, res) {
    try {
      res.json(
        await corporateClientsService.cancelDeposit(
          req.params.id,
          req.params.entryId,
          req.body,
          req.account,
        ),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка отмены корпоративного пополнения');
    }
  }

  async createSpending(req, res) {
    try {
      res
        .status(201)
        .json(
          await corporateClientsService.createSpending(
            req.params.id,
            req.body,
            req.account,
          ),
        );
    } catch (error) {
      sendError(res, error, 'Ошибка корпоративного списания');
    }
  }

  async reverseSpending(req, res) {
    try {
      res.json(
        await corporateClientsService.reverseSpending(
          req.params.id,
          req.params.entryId,
          req.body,
          req.account,
        ),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка отмены корпоративного списания');
    }
  }
}

module.exports = new CorporateClientsController();
