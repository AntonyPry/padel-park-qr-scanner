const methodologyService = require('../services/training-methodology.service');
const methodologyAnalyticsService = require('../services/training-methodology-analytics.service');
const { sendError } = require('../utils/api-error');

function handleError(res, error, fallback) {
  sendError(res, error, fallback);
}

class TrainingMethodologyController {
  async getAnalytics(req, res) {
    try {
      res.json(await methodologyAnalyticsService.getAnalytics(req.query, req.account, req.tenant));
    } catch (error) {
      handleError(res, error, 'Ошибка получения аналитики методики');
    }
  }

  async listSkills(req, res) {
    try {
      res.json(await methodologyService.listSkills(req.query, req.account, req.tenant));
    } catch (error) {
      handleError(res, error, 'Ошибка получения навыков');
    }
  }

  async createSkill(req, res) {
    try {
      res.status(201).json(await methodologyService.createSkill(req.body, req.account, req.tenant));
    } catch (error) {
      handleError(res, error, 'Ошибка создания навыка');
    }
  }

  async updateSkill(req, res) {
    try {
      res.json(
        await methodologyService.updateSkill(req.params.id, req.body, req.account, req.tenant),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка обновления навыка');
    }
  }

  async listExercises(req, res) {
    try {
      res.json(await methodologyService.listExercises(req.query, req.account, req.tenant));
    } catch (error) {
      handleError(res, error, 'Ошибка получения упражнений');
    }
  }

  async createExercise(req, res) {
    try {
      res
        .status(201)
        .json(await methodologyService.createExercise(req.body, req.account, req.tenant));
    } catch (error) {
      handleError(res, error, 'Ошибка создания упражнения');
    }
  }

  async updateExercise(req, res) {
    try {
      res.json(
        await methodologyService.updateExercise(
          req.params.id,
          req.body,
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка обновления упражнения');
    }
  }

  async approveExercise(req, res) {
    try {
      res.json(await methodologyService.approveExercise(req.params.id, req.account, req.tenant));
    } catch (error) {
      handleError(res, error, 'Ошибка утверждения упражнения');
    }
  }

  async archiveExercise(req, res) {
    try {
      res.json(await methodologyService.archiveExercise(req.params.id, req.account, req.tenant));
    } catch (error) {
      handleError(res, error, 'Ошибка архивирования упражнения');
    }
  }

  async restoreExercise(req, res) {
    try {
      res.json(await methodologyService.restoreExercise(req.params.id, req.account, req.tenant));
    } catch (error) {
      handleError(res, error, 'Ошибка восстановления упражнения');
    }
  }
}

module.exports = new TrainingMethodologyController();
