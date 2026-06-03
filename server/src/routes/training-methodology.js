const express = require('express');
const methodologyController = require('../controllers/training-methodology.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const router = express.Router();
const viewMethodology = requireRole(...ACCESS_MATRIX.trainingMethodologyView);
const manageMethodology = requireRole(...ACCESS_MATRIX.trainingMethodologyManage);
const viewMethodologyAnalytics = requireRole(...ACCESS_MATRIX.trainingMethodologyAnalyticsView);

router.get(
  '/methodology/analytics',
  viewMethodologyAnalytics,
  validate({ query: apiSchemas.methodology.analyticsQuery }),
  methodologyController.getAnalytics,
);

router.get(
  '/methodology/skills',
  viewMethodology,
  validate({ query: apiSchemas.methodology.skillListQuery }),
  methodologyController.listSkills,
);
router.post(
  '/methodology/skills',
  manageMethodology,
  validate({ body: apiSchemas.methodology.skillBody }),
  methodologyController.createSkill,
);
router.put(
  '/methodology/skills/:id',
  manageMethodology,
  validate({
    body: apiSchemas.methodology.skillUpdateBody,
    params: apiSchemas.methodology.withId.params,
  }),
  methodologyController.updateSkill,
);

router.get(
  '/methodology/exercises',
  viewMethodology,
  validate({ query: apiSchemas.methodology.exerciseListQuery }),
  methodologyController.listExercises,
);
router.post(
  '/methodology/exercises',
  viewMethodology,
  validate({ body: apiSchemas.methodology.exerciseBody }),
  methodologyController.createExercise,
);
router.put(
  '/methodology/exercises/:id',
  viewMethodology,
  validate({
    body: apiSchemas.methodology.exerciseUpdateBody,
    params: apiSchemas.methodology.withId.params,
  }),
  methodologyController.updateExercise,
);
router.post(
  '/methodology/exercises/:id/approve',
  manageMethodology,
  validate({ params: apiSchemas.methodology.withId.params }),
  methodologyController.approveExercise,
);
router.post(
  '/methodology/exercises/:id/archive',
  manageMethodology,
  validate({ params: apiSchemas.methodology.withId.params }),
  methodologyController.archiveExercise,
);
router.post(
  '/methodology/exercises/:id/restore',
  manageMethodology,
  validate({ params: apiSchemas.methodology.withId.params }),
  methodologyController.restoreExercise,
);

module.exports = router;
