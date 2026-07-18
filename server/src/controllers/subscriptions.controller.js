const subscriptionsService = require('../services/subscriptions.service');
const { sendError } = require('../utils/api-error');

function handleError(res, error, fallback) {
  sendError(res, error, fallback);
}

class SubscriptionsController {
  async listTypes(req, res) {
    try {
      res.json(
        await subscriptionsService.listSubscriptionTypes(req.query, req.tenant),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка получения типов абонементов');
    }
  }

  async createType(req, res) {
    try {
      res
        .status(201)
        .json(
          await subscriptionsService.createSubscriptionType(
            req.body,
            req.account,
            req.tenant,
          ),
        );
    } catch (error) {
      handleError(res, error, 'Ошибка создания типа абонемента');
    }
  }

  async updateType(req, res) {
    try {
      res.json(
        await subscriptionsService.updateSubscriptionType(
          req.params.id,
          req.body,
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка обновления типа абонемента');
    }
  }

  async archiveType(req, res) {
    try {
      res.json(
        await subscriptionsService.archiveSubscriptionType(
          req.params.id,
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка архивирования типа абонемента');
    }
  }

  async restoreType(req, res) {
    try {
      res.json(
        await subscriptionsService.restoreSubscriptionType(
          req.params.id,
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка восстановления типа абонемента');
    }
  }

  async removeArchivedType(req, res) {
    try {
      res.json(
        await subscriptionsService.removeArchivedSubscriptionType(
          req.params.id,
          req.tenant,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка удаления типа абонемента');
    }
  }

  async listClientSubscriptions(req, res) {
    try {
      res.json(
        await subscriptionsService.listClientSubscriptions(
          req.params.clientId,
          req.query,
          req.tenant,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка получения абонементов клиента');
    }
  }

  async getClientSubscription(req, res) {
    try {
      res.json(
        await subscriptionsService.getClientSubscription(req.params.id, req.tenant),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка получения абонемента клиента');
    }
  }

  async listClientSubscriptionRedemptions(req, res) {
    try {
      res.json(
        await subscriptionsService.listClientSubscriptionRedemptions(
          req.params.id,
          req.tenant,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка получения истории списаний абонемента');
    }
  }

  async redeemClientSubscription(req, res) {
    try {
      res.status(201).json(
        await subscriptionsService.redeemClientSubscription(
          req.params.id,
          req.body,
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка списания абонемента');
    }
  }

  async reverseClientSubscriptionRedemption(req, res) {
    try {
      res.json(
        await subscriptionsService.reverseClientSubscriptionRedemption(
          req.params.id,
          req.params.redemptionId,
          req.body,
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка отмены списания абонемента');
    }
  }
}

module.exports = new SubscriptionsController();
