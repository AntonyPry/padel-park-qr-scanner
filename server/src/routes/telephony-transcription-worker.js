const express = require('express');
const telephonyController = require('../controllers/telephony.controller');
const { requireTranscriptionWorkerToken } = require('../middleware/transcription-worker');
const { limitWorkerIngress } = require('../middleware/auth-rate-limit');
const { SURFACES } = require('../services/auth-rate-limit.service');
const { validate } = require('../middleware/validate');
const { apiSchemas } = require('../contracts/api-schemas');
const { requireRouteClassification } = require('../middleware/tenant-context');
const {
  ENDPOINT_CLASSIFICATIONS,
} = require('../tenant-context/route-scope-declarations');

const router = express.Router();
const workerEndpoint = requireRouteClassification(ENDPOINT_CLASSIFICATIONS.WORKER);

router.get(
  '/telephony/transcription-jobs/worker-queue',
  workerEndpoint,
  limitWorkerIngress(SURFACES.WORKER_QUEUE),
  requireTranscriptionWorkerToken,
  validate({ query: apiSchemas.telephony.transcriptionJobsQuery }),
  telephonyController.getWorkerTranscriptionQueue,
);
router.post(
  '/telephony/transcription-jobs/claim',
  workerEndpoint,
  limitWorkerIngress(SURFACES.WORKER_CLAIM),
  requireTranscriptionWorkerToken,
  validate({ body: apiSchemas.telephony.transcriptionClaimBody }),
  telephonyController.claimTranscriptionJob,
);
router.post(
  '/telephony/transcription-jobs/:id/audio-reference',
  workerEndpoint,
  limitWorkerIngress(SURFACES.WORKER_AUDIO_REFERENCE),
  requireTranscriptionWorkerToken,
  validate(apiSchemas.telephony.transcriptionAudioReference),
  telephonyController.getTranscriptionJobAudioReference,
);
router.post(
  '/telephony/transcription-jobs/:id/progress',
  workerEndpoint,
  limitWorkerIngress(SURFACES.WORKER_PROGRESS),
  requireTranscriptionWorkerToken,
  validate(apiSchemas.telephony.transcriptionProgress),
  telephonyController.updateTranscriptionJobProgress,
);
router.post(
  '/telephony/transcription-jobs/:id/result',
  workerEndpoint,
  limitWorkerIngress(SURFACES.WORKER_RESULT),
  requireTranscriptionWorkerToken,
  validate(apiSchemas.telephony.transcriptionResult),
  telephonyController.completeTranscriptionJob,
);
router.post(
  '/telephony/transcription-jobs/:id/fail',
  workerEndpoint,
  limitWorkerIngress(SURFACES.WORKER_FAIL),
  requireTranscriptionWorkerToken,
  validate(apiSchemas.telephony.transcriptionFail),
  telephonyController.failTranscriptionJob,
);
router.post(
  '/telephony/transcription-jobs/:id/worker-retry',
  workerEndpoint,
  limitWorkerIngress(SURFACES.WORKER_RETRY),
  requireTranscriptionWorkerToken,
  validate({
    body: apiSchemas.telephony.transcriptionClaimBody,
    params: apiSchemas.telephony.withId.params,
  }),
  telephonyController.retryTranscriptionJobForWorker,
);

module.exports = router;
