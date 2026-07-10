const express = require('express');
const telephonyController = require('../controllers/telephony.controller');
const { requireTranscriptionWorkerToken } = require('../middleware/transcription-worker');
const { validate } = require('../middleware/validate');
const { apiSchemas } = require('../contracts/api-schemas');

const router = express.Router();

router.get(
  '/telephony/transcription-jobs/worker-queue',
  requireTranscriptionWorkerToken,
  validate({ query: apiSchemas.telephony.transcriptionJobsQuery }),
  telephonyController.getWorkerTranscriptionQueue,
);
router.post(
  '/telephony/transcription-jobs/claim',
  requireTranscriptionWorkerToken,
  validate({ body: apiSchemas.telephony.transcriptionClaimBody }),
  telephonyController.claimTranscriptionJob,
);
router.post(
  '/telephony/transcription-jobs/:id/audio-reference',
  requireTranscriptionWorkerToken,
  validate(apiSchemas.telephony.withId),
  telephonyController.getTranscriptionJobAudioReference,
);
router.post(
  '/telephony/transcription-jobs/:id/progress',
  requireTranscriptionWorkerToken,
  validate(apiSchemas.telephony.transcriptionProgress),
  telephonyController.updateTranscriptionJobProgress,
);
router.post(
  '/telephony/transcription-jobs/:id/result',
  requireTranscriptionWorkerToken,
  validate(apiSchemas.telephony.transcriptionResult),
  telephonyController.completeTranscriptionJob,
);
router.post(
  '/telephony/transcription-jobs/:id/fail',
  requireTranscriptionWorkerToken,
  validate(apiSchemas.telephony.transcriptionFail),
  telephonyController.failTranscriptionJob,
);
router.post(
  '/telephony/transcription-jobs/:id/worker-retry',
  requireTranscriptionWorkerToken,
  validate({
    body: apiSchemas.telephony.transcriptionClaimBody,
    params: apiSchemas.telephony.withId.params,
  }),
  telephonyController.retryTranscriptionJobForWorker,
);

module.exports = router;
