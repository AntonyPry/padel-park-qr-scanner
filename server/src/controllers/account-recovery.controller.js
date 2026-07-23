'use strict';

const recovery = require('../services/account-recovery.service');
const { sendError } = require('../utils/api-error');
const { clearBrowserSessionCookies } = require('../security/browser-session');
const { disconnectAccountSockets } = require('../realtime/session-boundary');

function ownerActor(req) { return { type: 'owner', accountId: req.account.id }; }
function operatorActor(req) { return { type: 'operator', username: req.installationOperator?.username }; }

class AccountRecoveryController {
  async status(req, res) {
    try { return res.json(await recovery.inspectToken(req.body.token)); } catch (_error) { return res.json({ available: false }); }
  }

  async reset(req, res) {
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    try {
      const result = await recovery.resetPassword(req.body.token, req.body.password);
      disconnectAccountSockets(req.app.get('io'), result.accountId);
      clearBrowserSessionCookies(res);
      return res.json({ success: true });
    } catch (error) { return sendError(res, error, 'Ссылка недействительна или устарела'); }
  }

  async accounts(req, res) { try { return res.json({ accounts: await recovery.listAccounts(req.params.organizationId, req.params.clubId) }); } catch (error) { return sendError(res, error, 'Не удалось загрузить пользователей'); } }
  async account(req, res) { try { return res.json(await recovery.getAccount(req.params.accountId, req.params.organizationId, req.params.clubId)); } catch (error) { return sendError(res, error, 'Не удалось загрузить аккаунт'); } }
  async updateAccount(req, res) { try { return res.json(await recovery.updateAccountProfile(req.params.accountId, req.params.organizationId, req.params.clubId, req.body, req.installationOperator)); } catch (error) { return sendError(res, error, 'Не удалось обновить данные аккаунта'); } }
  async requests(req, res) { try { return res.json({ requests: await recovery.listRequests(req.params.organizationId, req.params.clubId, req.query.accountId) }); } catch (error) { return sendError(res, error, 'Не удалось загрузить запросы восстановления'); } }
  async createRequest(req, res) { try { return res.status(201).json(await recovery.createRequest(req.params.organizationId, req.params.clubId, req.body, operatorActor(req))); } catch (error) { return sendError(res, error, 'Не удалось создать запрос восстановления'); } }
  async issue(req, res) { try { res.set('Cache-Control', 'no-store'); res.set('Pragma', 'no-cache'); return res.json(await recovery.issueToken(req.params.requestId, operatorActor(req), req.params.organizationId, req.params.clubId)); } catch (error) { return sendError(res, error, 'Не удалось выдать ссылку смены пароля'); } }
  async revoke(req, res) { try { return res.json(await recovery.revokeRequest(req.params.requestId, operatorActor(req), req.params.organizationId, req.params.clubId)); } catch (error) { return sendError(res, error, 'Не удалось отозвать ссылку'); } }

  async ownerCreate(req, res) { try { const organizationId = req.tenant?.organizationId || await recovery.organizationForOwner(req.account.id); return res.status(201).json(await recovery.createRequest(organizationId, req.body.clubId, req.body, ownerActor(req))); } catch (error) { return sendError(res, error, 'Не удалось создать запрос восстановления'); } }
  async ownerRequests(req, res) { try { const organizationId = req.tenant?.organizationId || await recovery.organizationForOwner(req.account.id); return res.json({ requests: await recovery.listOwnerRequests(organizationId, req.query.clubId, req.params.id, ownerActor(req)) }); } catch (error) { return sendError(res, error, 'Не удалось загрузить запросы восстановления'); } }
  async ownerIssue(req, res) { try { const organizationId = req.tenant?.organizationId || await recovery.organizationForOwner(req.account.id); res.set('Cache-Control', 'no-store'); res.set('Pragma', 'no-cache'); return res.json(await recovery.issueToken(req.params.requestId, ownerActor(req), organizationId, req.body.clubId)); } catch (error) { return sendError(res, error, 'Не удалось выдать ссылку смены пароля'); } }
  async ownerRevoke(req, res) { try { const organizationId = req.tenant?.organizationId || await recovery.organizationForOwner(req.account.id); return res.json(await recovery.revokeRequest(req.params.requestId, ownerActor(req), organizationId, req.body.clubId)); } catch (error) { return sendError(res, error, 'Не удалось отозвать ссылку'); } }
}

module.exports = new AccountRecoveryController();
