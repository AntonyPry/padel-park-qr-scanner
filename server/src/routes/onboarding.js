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
