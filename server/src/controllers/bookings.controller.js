const bookingsService = require('../services/bookings.service');
const { sendError } = require('../utils/api-error');

function handleError(res, error, fallback) {
  sendError(res, error, fallback);
}

class BookingsController {
  async getSchedule(req, res) {
    try {
      res.json(await bookingsService.getSchedule(req.query));
    } catch (error) {
      handleError(res, error, 'Ошибка получения расписания');
    }
  }

  async getCourts(req, res) {
    try {
      res.json(await bookingsService.listBookingResources(req.query));
    } catch (error) {
      handleError(res, error, 'Ошибка получения колонок бронирования');
    }
  }

  async createCourt(req, res) {
    try {
      res.status(201).json(await bookingsService.createBookingResource(req.body));
    } catch (error) {
      handleError(res, error, 'Ошибка создания колонки бронирования');
    }
  }

  async updateCourt(req, res) {
    try {
      res.json(await bookingsService.updateBookingResource(req.params.id, req.body));
    } catch (error) {
      handleError(res, error, 'Ошибка обновления колонки бронирования');
    }
  }

  async archiveCourt(req, res) {
    try {
      res.json(await bookingsService.archiveBookingResource(req.params.id));
    } catch (error) {
      handleError(res, error, 'Ошибка выключения колонки бронирования');
    }
  }

  async getResponsibles(_req, res) {
    try {
      res.json(await bookingsService.listResponsibleStaff());
    } catch (error) {
      handleError(res, error, 'Ошибка получения ответственных сотрудников');
    }
  }

  async getAnalytics(req, res) {
    try {
      res.json(await bookingsService.getBookingAnalytics(req.query));
    } catch (error) {
      handleError(res, error, 'Ошибка получения отчета по бронированиям');
    }
  }

  async getOne(req, res) {
    try {
      res.json(await bookingsService.getBooking(req.params.id));
    } catch (error) {
      handleError(res, error, 'Ошибка получения брони');
    }
  }

  async create(req, res) {
    try {
      res.status(201).json(
        await bookingsService.createBooking(req.body, req.account, req.tenant),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка создания брони');
    }
  }

  async update(req, res) {
    try {
      res.json(
        await bookingsService.updateBooking(
          req.params.id,
          req.body,
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка обновления брони');
    }
  }

  async updateStatus(req, res) {
    try {
      res.json(
        await bookingsService.changeBookingStatus(
          req.params.id,
          req.body,
          req.account,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка изменения статуса брони');
    }
  }

  async getHistory(req, res) {
    try {
      res.json(await bookingsService.listBookingHistory(req.params.id));
    } catch (error) {
      handleError(res, error, 'Ошибка получения истории брони');
    }
  }

  async getTrainingPlan(req, res) {
    try {
      res.json(
        await bookingsService.getBookingTrainingPlan(req.params.id, req.account),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка получения плана тренировки по брони');
    }
  }

  async createTrainingPlan(req, res) {
    try {
      res.status(201).json(
        await bookingsService.createBookingTrainingPlan(req.params.id, req.account),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка создания плана тренировки по брони');
    }
  }

  async listSeries(req, res) {
    try {
      res.json(await bookingsService.listBookingSeries(req.query));
    } catch (error) {
      handleError(res, error, 'Ошибка получения постоянных броней');
    }
  }

  async previewSeries(req, res) {
    try {
      res.json(await bookingsService.previewBookingSeries(req.body));
    } catch (error) {
      handleError(res, error, 'Ошибка проверки серии броней');
    }
  }

  async createSeries(req, res) {
    try {
      res.status(201).json(
        await bookingsService.createBookingSeries(
          req.body,
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка создания серии броней');
    }
  }

  async archiveSeries(req, res) {
    try {
      res.json(
        await bookingsService.archiveBookingSeries(
          req.params.id,
          req.body,
          req.account,
        ),
      );
    } catch (error) {
      handleError(res, error, 'Ошибка архивирования серии броней');
    }
  }
}

module.exports = new BookingsController();
