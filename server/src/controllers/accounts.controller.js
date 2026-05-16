const accountsService = require('../services/accounts.service');

class AccountsController {
  async getAll(req, res) {
    try {
      const accounts = await accountsService.getAll();
      res.json(accounts);
    } catch (error) {
      console.error('Ошибка получения пользователей:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  }

  async create(req, res) {
    try {
      const account = await accountsService.create(req.account, req.body);
      res.status(201).json(account);
    } catch (error) {
      res
        .status(error.statusCode || 500)
        .json({ error: error.message || 'Ошибка создания пользователя' });
    }
  }

  async update(req, res) {
    try {
      const account = await accountsService.update(
        req.account,
        req.params.id,
        req.body,
      );
      res.json(account);
    } catch (error) {
      res
        .status(error.statusCode || 500)
        .json({ error: error.message || 'Ошибка обновления пользователя' });
    }
  }

  async remove(req, res) {
    try {
      const result = await accountsService.remove(req.account, req.params.id);
      res.json(result);
    } catch (error) {
      res
        .status(error.statusCode || 500)
        .json({ error: error.message || 'Ошибка удаления пользователя' });
    }
  }
}

module.exports = new AccountsController();
