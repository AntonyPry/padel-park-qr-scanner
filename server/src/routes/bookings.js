const express = require('express');
const bookingRulesController = require('../controllers/booking-rules.controller');
const bookingsController = require('../controllers/bookings.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const router = express.Router();
const viewBookings = requireRole(...ACCESS_MATRIX.bookingsView);
const manageBookings = requireRole(...ACCESS_MATRIX.bookingsManage);

router.get(
  '/bookings/schedule',
  viewBookings,
  validate({ query: apiSchemas.bookings.scheduleQuery }),
  bookingsController.getSchedule,
);
router.get('/bookings/courts', viewBookings, bookingsController.getCourts);
router.get(
  '/bookings/analytics',
  viewBookings,
  validate({ query: apiSchemas.bookings.analyticsQuery }),
  bookingsController.getAnalytics,
);
router.get('/bookings/settings', viewBookings, bookingRulesController.getSettings);
router.put(
  '/bookings/settings',
  manageBookings,
  validate({ body: apiSchemas.bookings.settingsBody }),
  bookingRulesController.updateSettings,
);
router.get(
  '/bookings/quote',
  viewBookings,
  validate({ query: apiSchemas.bookings.quoteQuery }),
  bookingRulesController.quote,
);
router.get(
  '/bookings/price-rules',
  viewBookings,
  validate({ query: apiSchemas.bookings.statusQuery }),
  bookingRulesController.listPriceRules,
);
router.post(
  '/bookings/price-rules',
  manageBookings,
  validate({ body: apiSchemas.bookings.priceRuleBody }),
  bookingRulesController.createPriceRule,
);
router.put(
  '/bookings/price-rules/:id',
  manageBookings,
  validate({ body: apiSchemas.bookings.priceRuleBody.partial().passthrough(), params: apiSchemas.bookings.params }),
  bookingRulesController.updatePriceRule,
);
router.delete(
  '/bookings/price-rules/:id',
  manageBookings,
  validate({ params: apiSchemas.bookings.params }),
  bookingRulesController.archivePriceRule,
);
router.get(
  '/bookings/blocks',
  viewBookings,
  validate({ query: apiSchemas.bookings.statusQuery.extend({ date: apiSchemas.bookings.scheduleQuery.shape.date }) }),
  bookingRulesController.listBlocks,
);
router.post(
  '/bookings/blocks',
  manageBookings,
  validate({ body: apiSchemas.bookings.blockBody }),
  bookingRulesController.createBlock,
);
router.put(
  '/bookings/blocks/:id',
  manageBookings,
  validate({ body: apiSchemas.bookings.blockBody.partial().passthrough(), params: apiSchemas.bookings.params }),
  bookingRulesController.updateBlock,
);
router.delete(
  '/bookings/blocks/:id',
  manageBookings,
  validate({ params: apiSchemas.bookings.params }),
  bookingRulesController.archiveBlock,
);
router.get(
  '/bookings/exceptions',
  viewBookings,
  validate({ query: apiSchemas.bookings.statusQuery }),
  bookingRulesController.listExceptions,
);
router.post(
  '/bookings/exceptions',
  manageBookings,
  validate({ body: apiSchemas.bookings.exceptionBody }),
  bookingRulesController.upsertException,
);
router.put(
  '/bookings/exceptions/:id',
  manageBookings,
  validate({ body: apiSchemas.bookings.exceptionBody.partial().passthrough(), params: apiSchemas.bookings.params }),
  bookingRulesController.updateException,
);
router.delete(
  '/bookings/exceptions/:id',
  manageBookings,
  validate({ params: apiSchemas.bookings.params }),
  bookingRulesController.archiveException,
);
router.get(
  '/bookings/series',
  viewBookings,
  validate({ query: apiSchemas.bookings.statusQuery }),
  bookingsController.listSeries,
);
router.post(
  '/bookings/series/preview',
  manageBookings,
  validate({ body: apiSchemas.bookings.seriesBody }),
  bookingsController.previewSeries,
);
router.post(
  '/bookings/series',
  manageBookings,
  validate({ body: apiSchemas.bookings.seriesBody }),
  bookingsController.createSeries,
);
router.post(
  '/bookings/series/:id/archive',
  manageBookings,
  validate({
    body: apiSchemas.bookings.seriesArchiveBody,
    params: apiSchemas.bookings.params,
  }),
  bookingsController.archiveSeries,
);
router.post(
  '/bookings',
  manageBookings,
  validate({ body: apiSchemas.bookings.body }),
  bookingsController.create,
);
router.get(
  '/bookings/:id',
  viewBookings,
  validate({ params: apiSchemas.bookings.params }),
  bookingsController.getOne,
);
router.put(
  '/bookings/:id',
  manageBookings,
  validate({ body: apiSchemas.bookings.updateBody, params: apiSchemas.bookings.params }),
  bookingsController.update,
);
router.patch(
  '/bookings/:id/status',
  manageBookings,
  validate({ body: apiSchemas.bookings.statusBody, params: apiSchemas.bookings.params }),
  bookingsController.updateStatus,
);
router.get(
  '/bookings/:id/history',
  viewBookings,
  validate({ params: apiSchemas.bookings.params }),
  bookingsController.getHistory,
);

module.exports = router;
