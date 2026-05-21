const financeService = require('../services/finance.service');
const { sendError } = require('../utils/api-error');

class FinanceController {
  async getFinanceRecords(req, res) {
    try {
      const { from, to } = req.query;
      const report = await financeService.getFinanceReport(from, to);
      res.json(report);
    } catch (error) {
      console.error('❌ Ошибка P&L:', error);
      sendError(res, error, 'Ошибка финансового отчета');
    }
  }

  async addManualFinance(req, res) {
    try {
      const record = await financeService.createManualRecord(req.body);
      res.status(201).json(record);
    } catch (error) {
      sendError(res, error, 'Ошибка добавления записи');
    }
  }

  async getPayroll(req, res) {
    try {
      const { from, to } = req.query;
      const data = await financeService.calculatePayroll(from, to);
      res.json(data);
    } catch (error) {
      console.error('❌ Ошибка Payroll:', error);
      sendError(res, error, 'Ошибка расчета payroll');
    }
  }
}

module.exports = new FinanceController();
