'use strict';

const twoFactorAuth = require('../services/two-factor-auth.service');
const {
  disconnectAccountSockets,
  disconnectAccountSocketsExceptSession,
} = require('../realtime/session-boundary');
const { clearBrowserSessionCookies } = require('../security/browser-session');
const { sendError } = require('../utils/api-error');

class TwoFactorAuthController {
  async accountStatus(req, res) {
    try {
      res.set('Cache-Control', 'no-store');
      return res.json(await twoFactorAuth.accountStatus(req.account.id));
    } catch (error) {
      return sendError(res, error, 'Не удалось загрузить настройки безопасности');
    }
  }

  async beginAccountEnrollment(req, res) {
    try {
      res.set('Cache-Control', 'no-store');
      return res.json(await twoFactorAuth.beginAccountEnrollment(
        req.account,
        req.authentication,
      ));
    } catch (error) {
      return sendError(
        res,
        error,
        'Не удалось начать подключение двухфакторной аутентификации',
      );
    }
  }

  async confirmAccountEnrollment(req, res) {
    try {
      const result = await twoFactorAuth.confirmAccountEnrollment(
        req.account.id,
        req.body.code,
        { authentication: req.authentication },
      );
      disconnectAccountSocketsExceptSession(
        req.app.get('io'),
        req.account.id,
        req.authentication?.sessionId,
      );
      res.set('Cache-Control', 'no-store');
      return res.json({ ...result, signedOut: false });
    } catch (error) {
      return sendError(
        res,
        error,
        'Не удалось подключить двухфакторную аутентификацию',
      );
    }
  }

  async stepUpAccount(req, res) {
    try {
      return res.json(await twoFactorAuth.stepUpAccount(
        req.account.id,
        req.authentication,
        req.body.code,
      ));
    } catch (error) {
      return sendError(res, error, 'Не удалось подтвердить действие');
    }
  }

  async regenerateAccountRecoveryCodes(req, res) {
    try {
      const result = await twoFactorAuth.regenerateAccountRecoveryCodes(
        req.account.id,
        req.authentication,
      );
      disconnectAccountSocketsExceptSession(
        req.app.get('io'),
        req.account.id,
        req.authentication?.sessionId,
      );
      res.set('Cache-Control', 'no-store');
      return res.json({ ...result, signedOut: false });
    } catch (error) {
      return sendError(res, error, 'Не удалось выпустить новые резервные коды');
    }
  }

  async disableAccountFactor(req, res) {
    try {
      const result = await twoFactorAuth.disableAccountFactor(
        req.account.id,
        req.authentication,
      );
      disconnectAccountSockets(req.app.get('io'), req.account.id);
      clearBrowserSessionCookies(res);
      return res.json(result);
    } catch (error) {
      return sendError(
        res,
        error,
        'Не удалось отключить двухфакторную аутентификацию',
      );
    }
  }

  async operatorStatus(req, res) {
    try {
      res.set('Cache-Control', 'no-store');
      return res.json(await twoFactorAuth.operatorStatus(
        req.installationOperator,
      ));
    } catch (error) {
      return sendError(res, error, 'Не удалось загрузить настройки безопасности');
    }
  }

  async beginOperatorEnrollment(req, res) {
    try {
      res.set('Cache-Control', 'no-store');
      return res.json(await twoFactorAuth.beginOperatorEnrollment(
        req.installationOperator,
      ));
    } catch (error) {
      return sendError(
        res,
        error,
        'Не удалось начать подключение двухфакторной аутентификации',
      );
    }
  }

  async confirmOperatorEnrollment(req, res) {
    try {
      const result = await twoFactorAuth.confirmOperatorEnrollment(
        req.installationOperator,
        req.body.code,
      );
      res.set('Cache-Control', 'no-store');
      return res.json({ ...result, signedOut: true });
    } catch (error) {
      return sendError(
        res,
        error,
        'Не удалось подключить двухфакторную аутентификацию',
      );
    }
  }

  async stepUpOperator(req, res) {
    try {
      return res.json(await twoFactorAuth.stepUpOperator(
        req.installationOperator,
        req.body.code,
      ));
    } catch (error) {
      return sendError(res, error, 'Не удалось подтвердить действие');
    }
  }

  async regenerateOperatorRecoveryCodes(req, res) {
    try {
      const result = await twoFactorAuth.regenerateOperatorRecoveryCodes(
        req.installationOperator,
      );
      res.set('Cache-Control', 'no-store');
      return res.json({ ...result, signedOut: true });
    } catch (error) {
      return sendError(res, error, 'Не удалось выпустить новые резервные коды');
    }
  }
}

module.exports = new TwoFactorAuthController();
