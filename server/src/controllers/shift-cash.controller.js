'use strict';

const shiftCashService = require('../services/shift-cash.service');
const { sendError } = require('../utils/api-error');

class ShiftCashController {
  async getActive(req, res) {
    try {
      res.json(await shiftCashService.getActiveCash(req.account));
    } catch (error) {
      sendError(res, error, 'Ошибка загрузки кассы смены');
    }
  }

  async getByShift(req, res) {
    try {
      res.json(await shiftCashService.getShiftCash(req.params.shiftId, req.account));
    } catch (error) {
      sendError(res, error, 'Ошибка загрузки кассы смены');
    }
  }

  async saveOpening(req, res) {
    try {
      res.json(await shiftCashService.saveOpening(req.body, req.account));
    } catch (error) {
      sendError(res, error, 'Ошибка сохранения начального остатка');
    }
  }

  async createExpense(req, res) {
    try {
      res.status(201).json(await shiftCashService.createExpense(req.body, req.account));
    } catch (error) {
      sendError(res, error, 'Ошибка добавления кассового расхода');
    }
  }

  async updateExpense(req, res) {
    try {
      res.json(
        await shiftCashService.updateExpense(req.params.expenseId, req.body, req.account),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка обновления кассового расхода');
    }
  }

  async cancelExpense(req, res) {
    try {
      res.json(
        await shiftCashService.cancelExpense(req.params.expenseId, req.body, req.account),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка отмены кассового расхода');
    }
  }

  async uploadAttachment(req, res) {
    try {
      res.status(201).json(
        await shiftCashService.uploadAttachment(
          req.params.expenseId,
          req.body,
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка загрузки фото чека');
    }
  }

  async removeAttachment(req, res) {
    try {
      res.json(
        await shiftCashService.removeAttachment(
          req.params.expenseId,
          req.params.attachmentId,
          req.account,
          req.tenant,
        ),
      );
    } catch (error) {
      sendError(res, error, 'Ошибка удаления фото чека');
    }
  }

  async getAttachment(req, res) {
    try {
      const { absolutePath, attachment } = await shiftCashService.getAttachment(
        req.params.expenseId,
        req.params.attachmentId,
        req.account,
        req.tenant,
      );
      res.setHeader('Content-Type', attachment.mimeType);
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(attachment.originalName || 'receipt')}"`,
      );
      res.sendFile(absolutePath);
    } catch (error) {
      sendError(res, error, 'Ошибка открытия фото чека');
    }
  }
}

module.exports = new ShiftCashController();
