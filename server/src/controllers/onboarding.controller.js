const onboardingService = require('../services/onboarding.service');
const { sendError } = require('../utils/api-error');

class OnboardingController {
  async getOverview(req, res) {
    try {
      const result = await onboardingService.getOverview(req.account, req.query);
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка получения обучения');
    }
  }

  async completeTask(req, res) {
    try {
      const result = await onboardingService.completeTask(
        req.account,
        req.params.taskKey,
        req.body,
      );
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка обновления прогресса обучения');
    }
  }

  async recordEvent(req, res) {
    try {
      const result = await onboardingService.recordClientEvent(
        req.account,
        req.body,
      );
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка записи события обучения');
    }
  }

  async resetProgress(req, res) {
    try {
      const result = await onboardingService.resetProgress(req.account, req.query);
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка сброса прогресса обучения');
    }
  }

  async getTrainingMode(req, res) {
    try {
      const result = await onboardingService.getTrainingMode(req.account);
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка получения режима тренировки');
    }
  }

  async setTrainingMode(req, res) {
    try {
      const result = await onboardingService.setTrainingMode(req.account, req.body);
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка изменения режима тренировки');
    }
  }

  async getTrainingDataSummary(req, res) {
    try {
      const result = await onboardingService.getTrainingDataSummary(
        req.account,
        req.query,
      );
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка получения учебных данных');
    }
  }

  async getMetrics(req, res) {
    try {
      const result = await onboardingService.getOnboardingMetrics(req.account);
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка получения метрик обучения');
    }
  }

  async cleanupTrainingData(req, res) {
    try {
      const result = await onboardingService.cleanupTrainingData(
        req.account,
        req.query,
      );
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка очистки учебных данных');
    }
  }
}

module.exports = new OnboardingController();
