const trainingNotesService = require('../services/training-notes.service');
const { sendError } = require('../utils/api-error');

function handleError(res, error, fallback) {
  sendError(res, error, fallback);
}

class TrainingNotesController {
  async getByClient(req, res) {
    try {
      res.json(await trainingNotesService.listByClient(req.params.clientId));
    } catch (error) {
      handleError(res, error, 'Ошибка получения дневника тренировок');
    }
  }

  async create(req, res) {
    try {
      res
        .status(201)
        .json(
          await trainingNotesService.create(
            req.params.clientId,
            req.body,
            req.account,
          ),
        );
    } catch (error) {
      handleError(res, error, 'Ошибка создания записи тренировки');
    }
  }
}

module.exports = new TrainingNotesController();
