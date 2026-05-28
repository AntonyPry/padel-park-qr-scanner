const express = require('express');
const trainingNotesController = require('../controllers/training-notes.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const router = express.Router();
const viewTrainingNotes = requireRole(...ACCESS_MATRIX.trainingNotesView);
const manageTrainingNotes = requireRole(...ACCESS_MATRIX.trainingNotesManage);

router.get(
  '/clients/:clientId/training-notes',
  viewTrainingNotes,
  validate({ params: apiSchemas.trainingNotes.clientParams }),
  trainingNotesController.getByClient,
);
router.post(
  '/clients/:clientId/training-notes',
  manageTrainingNotes,
  validate({
    body: apiSchemas.trainingNotes.body,
    params: apiSchemas.trainingNotes.clientParams,
  }),
  trainingNotesController.create,
);
router.put(
  '/training-notes/:noteId',
  manageTrainingNotes,
  validate({
    body: apiSchemas.trainingNotes.updateBody,
    params: apiSchemas.trainingNotes.noteParams,
  }),
  trainingNotesController.update,
);
router.delete(
  '/training-notes/:noteId',
  manageTrainingNotes,
  validate({ params: apiSchemas.trainingNotes.noteParams }),
  trainingNotesController.remove,
);

module.exports = router;
