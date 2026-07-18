const onboardingService = require('../services/onboarding.service');
const { sendError } = require('../utils/api-error');

class OnboardingController {
  async getOverview(req, res) {
    try {
      const result = await onboardingService.getOverview(
        req.account,
        req.query,
        req.tenant,
      );
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
        req.tenant,
      );
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка обновления прогресса обучения');
    }
  }

  async getTask(req, res) {
    try {
      const result = await onboardingService.getTaskDetail(
        req.account,
        req.params.taskKey,
        req.query,
        req.tenant,
      );
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка получения задания обучения');
    }
  }

  async markLessonRead(req, res) {
    try {
      const result = await onboardingService.markLessonRead(
        req.account,
        req.params.taskKey,
        req.body,
        req.tenant,
      );
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка обновления инструкции задания');
    }
  }

  async startPractice(req, res) {
    try {
      const result = await onboardingService.startPractice(
        req.account,
        req.params.taskKey,
        req.body,
        req.tenant,
      );
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка старта практики задания');
    }
  }

  async completePracticeStep(req, res) {
    try {
      const result = await onboardingService.completePracticeStep(
        req.account,
        req.params.taskKey,
        req.params.stepKey,
        req.body,
        req.tenant,
      );
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка обновления шага задания');
    }
  }

  async submitQuizAttempt(req, res) {
    try {
      const result = await onboardingService.submitQuizAttempt(
        req.account,
        req.params.taskKey,
        req.body,
        req.tenant,
      );
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка проверки теста задания');
    }
  }

  async recordEvent(req, res) {
    try {
      const result = await onboardingService.recordClientEvent(
        req.account,
        req.body,
        req.tenant,
      );
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка записи события обучения');
    }
  }

  async resetProgress(req, res) {
    try {
      const result = await onboardingService.resetProgress(
        req.account,
        req.query,
        req.tenant,
      );
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка сброса прогресса обучения');
    }
  }

  async getTrainingMode(req, res) {
    try {
      const result = await onboardingService.getTrainingMode(
        req.account,
        req.tenant,
      );
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка получения режима тренировки');
    }
  }

  async setTrainingMode(req, res) {
    try {
      const result = await onboardingService.setTrainingMode(
        req.account,
        req.body,
        req.tenant,
      );
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
        req.tenant,
      );
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка получения учебных данных');
    }
  }

  async getMetrics(req, res) {
    try {
      const result = await onboardingService.getOnboardingMetrics(
        req.account,
        req.tenant,
      );
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
        req.tenant,
      );
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Ошибка очистки учебных данных');
    }
  }
}

module.exports = new OnboardingController();
