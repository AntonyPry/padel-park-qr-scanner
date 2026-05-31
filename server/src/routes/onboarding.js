const express = require('express');
const onboardingController = require('../controllers/onboarding.controller');
const { validate } = require('../middleware/validate');
const { apiSchemas } = require('../contracts/api-schemas');

const router = express.Router();

router.get(
  '/onboarding',
  validate({ query: apiSchemas.onboarding.roleQuery }),
  onboardingController.getOverview,
);
router.get(
  '/onboarding/training-mode',
  onboardingController.getTrainingMode,
);
router.put(
  '/onboarding/training-mode',
  validate({ body: apiSchemas.onboarding.trainingModeBody }),
  onboardingController.setTrainingMode,
);
router.get(
  '/onboarding/training-data',
  validate({ query: apiSchemas.onboarding.roleQuery }),
  onboardingController.getTrainingDataSummary,
);
router.get(
  '/onboarding/metrics',
  onboardingController.getMetrics,
);
router.get(
  '/onboarding/tasks/:taskKey',
  validate({
    params: apiSchemas.onboarding.taskParams,
    query: apiSchemas.onboarding.roleQuery,
  }),
  onboardingController.getTask,
);
router.delete(
  '/onboarding/training-data',
  validate({ query: apiSchemas.onboarding.roleQuery }),
  onboardingController.cleanupTrainingData,
);
router.post(
  '/onboarding/tasks/:taskKey/complete',
  validate({
    body: apiSchemas.onboarding.completeBody,
    params: apiSchemas.onboarding.taskParams,
  }),
  onboardingController.completeTask,
);
router.post(
  '/onboarding/tasks/:taskKey/lesson-read',
  validate({
    body: apiSchemas.onboarding.progressBody,
    params: apiSchemas.onboarding.taskParams,
  }),
  onboardingController.markLessonRead,
);
router.post(
  '/onboarding/tasks/:taskKey/practice-start',
  validate({
    body: apiSchemas.onboarding.progressBody,
    params: apiSchemas.onboarding.taskParams,
  }),
  onboardingController.startPractice,
);
router.post(
  '/onboarding/tasks/:taskKey/steps/:stepKey',
  validate({
    body: apiSchemas.onboarding.progressBody,
    params: apiSchemas.onboarding.stepParams,
  }),
  onboardingController.completePracticeStep,
);
router.post(
  '/onboarding/tasks/:taskKey/quiz-attempt',
  validate({
    body: apiSchemas.onboarding.quizAttemptBody,
    params: apiSchemas.onboarding.taskParams,
  }),
  onboardingController.submitQuizAttempt,
);
router.post(
  '/onboarding/events',
  validate({ body: apiSchemas.onboarding.eventBody }),
  onboardingController.recordEvent,
);
router.delete(
  '/onboarding/progress',
  validate({ query: apiSchemas.onboarding.roleQuery }),
  onboardingController.resetProgress,
);

module.exports = router;
