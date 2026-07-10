const express = require('express');
const telephonyController = require('../controllers/telephony.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const router = express.Router();
const viewTelephony = requireRole(...ACCESS_MATRIX.telephonyView);
const workTelephony = requireRole(...ACCESS_MATRIX.telephonyWork);
const manageTelephony = requireRole(...ACCESS_MATRIX.telephonyManage);

router.get(
  '/telephony/config',
  manageTelephony,
  telephonyController.getConfig,
);
router.get('/telephony/stats', viewTelephony, telephonyController.getStats);
router.get(
  '/telephony/report',
  viewTelephony,
  validate({ query: apiSchemas.telephony.reportQuery }),
  telephonyController.getReport,
);
router.get(
  '/telephony/calls',
  viewTelephony,
  validate({ query: apiSchemas.telephony.callsQuery }),
  telephonyController.getCalls,
);
router.get(
  '/telephony/calls/:id',
  viewTelephony,
  validate(apiSchemas.telephony.withId),
  telephonyController.getCall,
);
router.post(
  '/telephony/calls/:id/start',
  workTelephony,
  validate(apiSchemas.telephony.withId),
  telephonyController.startProcessing,
);
router.post(
  '/telephony/calls/:id/client',
  workTelephony,
  validate(apiSchemas.telephony.linkClient),
  telephonyController.linkClient,
);
router.post(
  '/telephony/calls/:id/client/create',
  workTelephony,
  validate(apiSchemas.telephony.createClient),
  telephonyController.createClient,
);
router.post(
  '/telephony/calls/:id/complete',
  workTelephony,
  validate(apiSchemas.telephony.complete),
  telephonyController.completeCall,
);
router.post(
  '/telephony/calls/:id/ignore',
  workTelephony,
  validate(apiSchemas.telephony.ignore),
  telephonyController.ignoreCall,
);
router.post(
  '/telephony/calls/:id/recording-reference',
  workTelephony,
  validate(apiSchemas.telephony.withId),
  telephonyController.refreshRecordingReference,
);
router.post(
  '/telephony/calls/:id/transcription-jobs',
  workTelephony,
  validate(apiSchemas.telephony.withId),
  telephonyController.createTranscriptionJob,
);
router.post(
  '/telephony/transcription-jobs/queue-missing',
  workTelephony,
  validate({ body: apiSchemas.telephony.transcriptionBackfillBody }),
  telephonyController.queueMissingTranscriptionJobs,
);
router.get(
  '/telephony/calls/:id/transcription-jobs',
  workTelephony,
  validate({
    params: apiSchemas.telephony.withId.params,
    query: apiSchemas.telephony.transcriptionJobsQuery,
  }),
  telephonyController.listCallTranscriptionJobs,
);
router.get(
  '/telephony/transcription-jobs/stats',
  workTelephony,
  telephonyController.getTranscriptionStats,
);
router.get(
  '/telephony/transcription-jobs',
  workTelephony,
  validate({ query: apiSchemas.telephony.transcriptionJobsQuery }),
  telephonyController.listTranscriptionJobs,
);
router.get(
  '/telephony/transcription-jobs/:id',
  workTelephony,
  validate(apiSchemas.telephony.withId),
  telephonyController.getTranscriptionJob,
);
router.post(
  '/telephony/transcription-jobs/:id/retry',
  workTelephony,
  validate(apiSchemas.telephony.withId),
  telephonyController.retryTranscriptionJob,
);
router.post(
  '/telephony/beeline/sync',
  manageTelephony,
  validate({ body: apiSchemas.telephony.syncBody }),
  telephonyController.syncStatistics,
);
router.post(
  '/telephony/beeline/records/sync',
  manageTelephony,
  validate({ body: apiSchemas.telephony.recordsSyncBody }),
  telephonyController.syncRecordings,
);
router.post(
  '/telephony/beeline/subscribe',
  manageTelephony,
  validate({ body: apiSchemas.telephony.subscribeBody }),
  telephonyController.subscribe,
);
router.post(
  '/telephony/beeline/subscription/check',
  manageTelephony,
  telephonyController.checkSubscription,
);
router.get(
  '/telephony/raw-events',
  manageTelephony,
  validate({ query: apiSchemas.telephony.rawEventsQuery }),
  telephonyController.getRawEvents,
);
router.post(
  '/telephony/raw-events/:id/reprocess',
  manageTelephony,
  validate(apiSchemas.telephony.withId),
  telephonyController.reprocessRawEvent,
);

module.exports = router;
