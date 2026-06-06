const express = require('express');
const router = express.Router();
const subscriptionsController = require('../controllers/subscriptions.controller');
const { requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { apiSchemas } = require('../contracts/api-schemas');

const viewSubscriptionTypes = requireRole(
  ...ACCESS_MATRIX.subscriptionTypesView,
);
const manageSubscriptionTypes = requireRole(
  ...ACCESS_MATRIX.subscriptionTypesManage,
);
const viewClientSubscriptions = requireRole(
  ...ACCESS_MATRIX.clientSubscriptionsView,
);
const redeemClientSubscriptions = requireRole(
  ...ACCESS_MATRIX.clientSubscriptionsRedeem,
);

router.get(
  '/subscriptions/types',
  viewSubscriptionTypes,
  validate({ query: apiSchemas.subscriptions.typeListQuery }),
  subscriptionsController.listTypes,
);
router.post(
  '/subscriptions/types',
  manageSubscriptionTypes,
  validate({ body: apiSchemas.subscriptions.typeBody }),
  subscriptionsController.createType,
);
router.put(
  '/subscriptions/types/:id',
  manageSubscriptionTypes,
  validate({
    body: apiSchemas.subscriptions.typeUpdateBody,
    params: apiSchemas.subscriptions.withId.params,
  }),
  subscriptionsController.updateType,
);
router.post(
  '/subscriptions/types/:id/archive',
  manageSubscriptionTypes,
  validate(apiSchemas.subscriptions.withId),
  subscriptionsController.archiveType,
);
router.post(
  '/subscriptions/types/:id/restore',
  manageSubscriptionTypes,
  validate(apiSchemas.subscriptions.withId),
  subscriptionsController.restoreType,
);
router.delete(
  '/subscriptions/types/:id/permanent',
  manageSubscriptionTypes,
  validate(apiSchemas.subscriptions.withId),
  subscriptionsController.removeArchivedType,
);
router.get(
  '/clients/:clientId/subscriptions',
  viewClientSubscriptions,
  validate({
    params: apiSchemas.subscriptions.clientParams,
    query: apiSchemas.subscriptions.clientListQuery,
  }),
  subscriptionsController.listClientSubscriptions,
);
router.get(
  '/client-subscriptions/:id',
  viewClientSubscriptions,
  validate(apiSchemas.subscriptions.withId),
  subscriptionsController.getClientSubscription,
);
router.get(
  '/client-subscriptions/:id/redemptions',
  viewClientSubscriptions,
  validate(apiSchemas.subscriptions.withId),
  subscriptionsController.listClientSubscriptionRedemptions,
);
router.post(
  '/client-subscriptions/:id/redemptions',
  redeemClientSubscriptions,
  validate({
    body: apiSchemas.subscriptions.redemptionBody,
    params: apiSchemas.subscriptions.withId.params,
  }),
  subscriptionsController.redeemClientSubscription,
);
router.post(
  '/client-subscriptions/:id/redemptions/:redemptionId/reverse',
  redeemClientSubscriptions,
  validate(apiSchemas.subscriptions.redemptionReverse),
  subscriptionsController.reverseClientSubscriptionRedemption,
);

module.exports = router;
