const financeService = require('../services/finance.service');

class FinanceController {
  async getFinanceRecords(req, res) {
    try {
      const { from, to } = req.query;
      const report = await financeService.getFinanceReport(from, to);
      res.json(report);
    } catch (error) {
      console.error('❌ Ошибка P&L:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  }

  async addManualFinance(req, res) {
    try {
      // Логика добавления ручной операции (если есть модель Finance)
      const record = await financeService.createManualRecord(req.body);
      res.json(record);
    } catch (error) {
      res.status(500).json({ error: 'Ошибка добавления записи' });
    }
  }

  async getPayroll(req, res) {
    try {
      const { from, to } = req.query;
      const data = await financeService.calculatePayroll(from, to);
      res.json(data);
    } catch (error) {
      console.error('❌ Ошибка Payroll:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  }
}

module.exports = new FinanceController();
