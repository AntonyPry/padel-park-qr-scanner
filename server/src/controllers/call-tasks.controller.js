const callTasksService = require('../services/call-tasks.service');
const { sendError } = require('../utils/api-error');

function handleError(res, error, fallback) {
  sendError(res, error, fallback);
}

class CallTasksController {
  async createFromBase(req, res) {
    try {
      res
        .status(201)
        .json(
          await callTasksService.createFromBase(
            req.account,
            req.params.baseId,
            req.body,
          ),
        );
    } catch (error) {
      handleError(res, error, 'Ошибка создания задачи обзвона');
    }
  }

  async getAll(req, res) {
    try {
      res.json(await callTasksService.list(req.account, req.query));
    } catch (error) {
      handleError(res, error, 'Ошибка получения задач обзвона');
    }
  }

  async getOne(req, res) {
    try {
      res.json(await callTasksService.getOne(req.account, req.params.id));
    } catch (error) {
      handleError(res, error, 'Ошибка получения задачи обзвона');
    }
  }

  async update(req, res) {
    try {
      res.json(
        await callTasksService.update(req.account, req.params.id, req.body),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка обновления задачи обзвона');
    }
  }

  async removeArchived(req, res) {
    try {
      res.json(await callTasksService.removeArchived(req.account, req.params.id));
    } catch (error) {
      handleError(res, error, 'Ошибка удаления задачи обзвона из архива');
    }
  }

  async sync(req, res) {
    try {
      res.json(await callTasksService.sync(req.account, req.params.id));
    } catch (error) {
      handleError(res, error, 'Ошибка обновления динамической задачи');
    }
  }

  async runRecurring(req, res) {
    try {
      res.json(await callTasksService.runDueRecurringTasks(new Date()));
    } catch (error) {
      handleError(res, error, 'Ошибка запуска автозадач обзвона');
    }
  }

  async getClients(req, res) {
    try {
      res.json(
        await callTasksService.listTaskClients(
          req.account,
          req.params.id,
          req.query,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка получения клиентов задачи');
    }
  }

  async addAttempt(req, res) {
    try {
      res.json(
        await callTasksService.addAttempt(
          req.account,
          req.params.taskClientId,
          req.body,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка сохранения результата звонка');
    }
  }
}

module.exports = new CallTasksController();
