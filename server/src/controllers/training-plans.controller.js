const trainingPlansService = require('../services/training-plans.service');
const { sendError } = require('../utils/api-error');

function handleError(res, error, fallback) {
  sendError(res, error, fallback);
}

class TrainingPlansController {
  async list(req, res) {
    try {
      res.json(await trainingPlansService.list(req.query, req.account, req.tenant));
    } catch (error) {
      handleError(res, error, 'Ошибка получения планов тренировок');
    }
  }

  async create(req, res) {
    try {
      res.status(201).json(await trainingPlansService.create(
        req.body,
        req.account,
        req.tenant,
      ));
    } catch (error) {
      handleError(res, error, 'Ошибка создания плана тренировки');
    }
  }

  async getOne(req, res) {
    try {
      res.json(await trainingPlansService.getById(
        req.params.planId,
        req.account,
        req.tenant,
      ));
    } catch (error) {
      handleError(res, error, 'Ошибка получения плана тренировки');
    }
  }

  async updateExercises(req, res) {
    try {
      res.json(
        await trainingPlansService.updateExercises(
          req.params.planId,
          req.body,
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка обновления плана тренировки');
    }
  }

  async complete(req, res) {
    try {
      res.json(
        await trainingPlansService.complete(
          req.params.planId,
          req.body,
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка подтверждения тренировки');
    }
  }

  async quickComplete(req, res) {
    try {
      res.json(
        await trainingPlansService.quickComplete(
          req.params.planId,
          req.body,
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка быстрого завершения плана');
    }
  }
}

module.exports = new TrainingPlansController();
