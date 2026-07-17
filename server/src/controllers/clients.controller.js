const clientsService = require('../services/clients.service');
const clientSkillMapService = require('../services/client-skill-map.service');
const trainingRecommendationsService = require('../services/training-recommendations.service');
const { sendError } = require('../utils/api-error');
const {
  setOnboardingEventResultHeaders,
} = require('../middleware/onboarding-quest');

function handleError(res, error, fallback) {
  sendError(res, error, fallback);
}

class ClientsController {
  async getAll(req, res) {
    try {
      res.json(await clientsService.listClients(req.query, req.account));
    } catch (error) {
      handleError(res, error, 'Ошибка получения клиентов');
    }
  }

  async getOne(req, res) {
    try {
      res.json(await clientsService.getClientDetails(req.params.id, req.account));
    } catch (error) {
      handleError(res, error, 'Ошибка получения клиента');
    }
  }

  async create(req, res) {
    try {
      const outcome = await clientsService.createClientWithEventResult(
        req.body,
        req.account,
        { onboardingContext: req.onboardingQuest },
      );
      setOnboardingEventResultHeaders(res, outcome.onboardingEventResult);
      res.status(201).json(outcome.result);
    } catch (error) {
      handleError(res, error, 'Ошибка создания клиента');
    }
  }

  async update(req, res) {
    try {
      res.json(await clientsService.updateClient(req.params.id, req.body, req.account));
    } catch (error) {
      handleError(res, error, 'Ошибка обновления клиента');
    }
  }

  async lookup(req, res) {
    try {
      res.json({
        client: await clientsService.lookupByPhone(
          req.query.phone,
          req.query.excludeClientId,
          req.account,
          { includeArchived: req.query.includeArchived === 'true' },
        ),
      });
    } catch (error) {
      handleError(res, error, 'Ошибка поиска клиента');
    }
  }

  async getDuplicates(req, res) {
    try {
      res.json(await clientsService.getDuplicateGroups());
    } catch (error) {
      handleError(res, error, 'Ошибка поиска дублей');
    }
  }

  async merge(req, res) {
    try {
      res.json(
        await clientsService.mergeClients(
          req.params.id,
          req.body.duplicateClientIds,
          req.account,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка объединения клиентов');
    }
  }

  async removeArchived(req, res) {
    try {
      res.json(await clientsService.removeArchivedClient(req.params.id));
    } catch (error) {
      handleError(res, error, 'Ошибка удаления клиента из архива');
    }
  }

  async getSavedViews(req, res) {
    try {
      res.json(await clientsService.listSavedViews(req.account));
    } catch (error) {
      handleError(res, error, 'Ошибка получения представлений клиентов');
    }
  }

  async createSavedView(req, res) {
    try {
      res.status(201).json(
        await clientsService.createSavedView(req.account, req.body),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка сохранения представления клиентов');
    }
  }

  async updateSavedView(req, res) {
    try {
      res.json(
        await clientsService.updateSavedView(
          req.account,
          req.params.viewId,
          req.body,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка обновления представления клиентов');
    }
  }

  async deleteSavedView(req, res) {
    try {
      res.json(await clientsService.deleteSavedView(req.account, req.params.viewId));
    } catch (error) {
      handleError(res, error, 'Ошибка удаления представления клиентов');
    }
  }

  async getSkillMap(req, res) {
    try {
      res.json(
        await clientSkillMapService.listForClient(
          req.params.clientId,
          req.account,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка получения карты навыков клиента');
    }
  }

  async updateSkillMap(req, res) {
    try {
      res.json(
        await clientSkillMapService.updateEntry(
          req.params.clientId,
          req.params.skillId,
          req.body,
          req.account,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка обновления карты навыков клиента');
    }
  }

  async getTrainingRecommendation(req, res) {
    try {
      res.json(
        await trainingRecommendationsService.recommendForClient(
          req.params.clientId,
          req.query,
          req.account,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка рекомендации тренировки');
    }
  }

  async getGroupTrainingRecommendation(req, res) {
    try {
      res.json(
        await trainingRecommendationsService.recommendForGroup(
          req.body,
          req.account,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка групповой рекомендации тренировки');
    }
  }
}

module.exports = new ClientsController();
