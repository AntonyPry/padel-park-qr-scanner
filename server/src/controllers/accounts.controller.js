const accountsService = require('../services/accounts.service');
const { disconnectAccountSockets } = require('../realtime/session-boundary');
const { sendError } = require('../utils/api-error');

class AccountsController {
  async getAll(req, res) {
    try {
      const accounts = await accountsService.getAll(req.query, req.tenant);
      res.json(accounts);
    } catch (error) {
      sendError(res, error, 'Ошибка получения пользователей');
    }
  }

  async create(req, res) {
    try {
      const account = await accountsService.create(req.account, req.body, req.tenant);
      res.status(201).json(account);
    } catch (error) {
      sendError(res, error, 'Ошибка создания пользователя');
    }
  }

  async update(req, res) {
    try {
      const account = await accountsService.update(
        req.account,
        req.params.id,
        req.body,
        req.tenant,
      );
      if (
        req.body.role ||
        Object.prototype.hasOwnProperty.call(req.body, 'staffId') ||
        (req.body.status && req.body.status !== 'active')
      ) {
        disconnectAccountSockets(req.app.get('io'), account.id);
      }
      res.json(account);
    } catch (error) {
      sendError(res, error, 'Ошибка обновления пользователя');
    }
  }

  async remove(req, res) {
    try {
      const result = await accountsService.remove(
        req.account,
        req.params.id,
        req.tenant,
      );
      disconnectAccountSockets(req.app.get('io'), result.id);
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка удаления пользователя');
    }
  }

  async restore(req, res) {
    try {
      const result = await accountsService.restore(
        req.account,
        req.params.id,
        req.tenant,
      );
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка восстановления пользователя');
    }
  }

  async removeArchived(req, res) {
    try {
      const result = await accountsService.removeArchived(
        req.account,
        req.params.id,
        req.tenant,
      );
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка удаления пользователя из архива');
    }
  }
}

module.exports = new AccountsController();
