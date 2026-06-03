const express = require('express');
const trainingPlansController = require('../controllers/training-plans.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const router = express.Router();
const viewTrainingPlans = requireRole(...ACCESS_MATRIX.trainingNotesView);
const manageTrainingPlans = requireRole(...ACCESS_MATRIX.trainingNotesManage);

router.get(
  '/training-plans',
  viewTrainingPlans,
  validate({ query: apiSchemas.trainingPlans.listQuery }),
  trainingPlansController.list,
);
router.post(
  '/training-plans',
  manageTrainingPlans,
  validate({ body: apiSchemas.trainingPlans.body }),
  trainingPlansController.create,
);
router.get(
  '/training-plans/:planId',
  viewTrainingPlans,
  validate({ params: apiSchemas.trainingPlans.params }),
  trainingPlansController.getOne,
);
router.put(
  '/training-plans/:planId/exercises',
  manageTrainingPlans,
  validate({
    body: apiSchemas.trainingPlans.exercisesBody,
    params: apiSchemas.trainingPlans.params,
  }),
  trainingPlansController.updateExercises,
);
router.post(
  '/training-plans/:planId/complete',
  manageTrainingPlans,
  validate({
    body: apiSchemas.trainingPlans.completeBody,
    params: apiSchemas.trainingPlans.params,
  }),
  trainingPlansController.complete,
);
router.post(
  '/training-plans/:planId/quick-complete',
  manageTrainingPlans,
  validate({
    body: apiSchemas.trainingPlans.quickCompleteBody,
    params: apiSchemas.trainingPlans.params,
  }),
  trainingPlansController.quickComplete,
);

module.exports = router;
