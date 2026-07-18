const financeService = require('../services/finance.service');
const payrollService = require('../services/payroll.service');
const { sendError } = require('../utils/api-error');

function sendXlsx(res, { buffer, filename }) {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

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
      const record = await financeService.createManualRecord(req.body, req.account);
      res.status(201).json(record);
    } catch (error) {
      sendError(res, error, 'Ошибка добавления записи');
    }
  }

  async exportFinance(req, res) {
    try {
      const { from, to } = req.query;
      const file = await financeService.exportFinanceReport(from, to, req.account);
      sendXlsx(res, file);
    } catch (error) {
      sendError(res, error, 'Ошибка экспорта финансового отчета');
    }
  }

  async getPayroll(req, res) {
    try {
      const { from, to } = req.query;
      const data = await financeService.calculatePayroll(
        from,
        to,
        req.account,
        req.tenant,
      );
      res.json(data);
    } catch (error) {
      console.error('❌ Ошибка Payroll:', error);
      sendError(res, error, 'Ошибка расчета payroll');
    }
  }

  async listPayrollPeriods(req, res) {
    try {
      res.json(await payrollService.listPeriods(req.query, req.account, req.tenant));
    } catch (error) {
      sendError(res, error, 'Ошибка списка payroll-периодов');
    }
  }

  async createPayrollPeriod(req, res) {
    try {
      const period = await payrollService.createPeriod(req.body, req.account, req.tenant);
      res.status(201).json(payrollService.serializePeriod(period));
    } catch (error) {
      sendError(res, error, 'Ошибка создания payroll-периода');
    }
  }

  async recalculatePayrollPeriod(req, res) {
    try {
      const period = await payrollService.recalculatePeriod(
        req.params.id,
        req.account,
        req.body?.reason,
        req.tenant,
      );
      res.json(payrollService.serializePeriod(period));
    } catch (error) {
      sendError(res, error, 'Ошибка пересчета payroll-периода');
    }
  }

  async updatePayrollPeriodStatus(req, res) {
    try {
      const period = await payrollService.transitionPeriod(
        req.params.id,
        req.body,
        req.account,
        req.tenant,
      );
      res.json(payrollService.serializePeriod(period));
    } catch (error) {
      sendError(res, error, 'Ошибка изменения статуса payroll-периода');
    }
  }

  async exportPayroll(req, res) {
    try {
      const file = await payrollService.exportPayroll(req.query, req.account, req.tenant);
      sendXlsx(res, file);
    } catch (error) {
      sendError(res, error, 'Ошибка экспорта payroll');
    }
  }

  async getFinanceHistory(req, res) {
    try {
      res.json(await payrollService.getHistory(req.query, req.account, req.tenant));
    } catch (error) {
      sendError(res, error, 'Ошибка финансовой истории');
    }
  }
}

module.exports = new FinanceController();
