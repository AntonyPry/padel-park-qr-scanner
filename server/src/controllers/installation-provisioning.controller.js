'use strict';

const installationOperatorAuth = require('../services/installation-operator-auth.service');
const installationProvisioning = require('../services/installation-provisioning.service');
const installationManagement = require('../services/installation-management.service');
const { sendError } = require('../utils/api-error');

class InstallationProvisioningController {
  status(_req, res) {
    res.json(installationOperatorAuth.getPublicStatus());
  }

  async session(req, res) {
    try {
      res.json(await installationOperatorAuth.createSession(req.body));
    } catch (error) {
      sendError(res, error, 'Не удалось войти как оператор');
    }
  }

  async revokeSession(req, res) {
    try {
      await installationOperatorAuth.revokeSession(req.installationOperator);
      res.json({ success: true });
    } catch (error) {
      sendError(res, error, 'Не удалось завершить сессию оператора');
    }
  }

  async snapshot(req, res) {
    try {
      res.json(await installationProvisioning.getInstallationSnapshot(
        req.installationOperator,
      ));
    } catch (error) {
      sendError(res, error, 'Не удалось загрузить состояние установки');
    }
  }

  async organization(req, res) {
    try {
      res.json(
        await installationManagement.getInstallationOrganization(
          req.params.organizationId,
          req.installationOperator,
        ),
      );
    } catch (error) {
      sendError(res, error, 'Не удалось загрузить организацию');
    }
  }

  async updateOrganization(req, res) {
    try {
      res.json(await installationManagement.updateOrganization(
        req.params.organizationId,
        req.body,
        req.installationOperator,
      ));
    } catch (error) {
      sendError(res, error, 'Не удалось изменить организацию');
    }
  }

  async archiveOrganization(req, res) {
    try {
      const result = await installationManagement.setOrganizationLifecycle(
        req.params.organizationId,
        'archived',
        req.body,
        req.installationOperator,
      );
      await this.reconcileTenantIntegrations(req, result);
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Не удалось архивировать организацию');
    }
  }

  async reactivateOrganization(req, res) {
    try {
      res.json(await installationManagement.setOrganizationLifecycle(
        req.params.organizationId,
        'active',
        req.body,
        req.installationOperator,
      ));
    } catch (error) {
      sendError(res, error, 'Не удалось восстановить организацию');
    }
  }

  async updateClub(req, res) {
    try {
      res.json(await installationManagement.updateClub(
        req.params.organizationId,
        req.params.clubId,
        req.body,
        req.installationOperator,
      ));
    } catch (error) {
      sendError(res, error, 'Не удалось изменить клуб');
    }
  }

  async archiveClub(req, res) {
    try {
      const result = await installationManagement.setClubLifecycle(
        req.params.organizationId,
        req.params.clubId,
        'archived',
        req.body,
        req.installationOperator,
      );
      await this.reconcileTenantIntegrations(req, result, req.params.clubId);
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Не удалось архивировать клуб');
    }
  }

  async reactivateClub(req, res) {
    try {
      res.json(await installationManagement.setClubLifecycle(
        req.params.organizationId,
        req.params.clubId,
        'active',
        req.body,
        req.installationOperator,
      ));
    } catch (error) {
      sendError(res, error, 'Не удалось восстановить клуб');
    }
  }

  async configureIntegration(req, res) {
    try {
      const result = await installationManagement.configureIntegration(
        req.params.organizationId,
        req.params.clubId,
        req.params.provider,
        req.body,
        req.installationOperator,
      );
      await this.reconcileIntegration(req, result);
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Не удалось сохранить подключение');
    }
  }

  async rotateIntegration(req, res) {
    try {
      const result = await installationManagement.rotateIntegrationCredential(
        req.params.organizationId,
        req.params.clubId,
        req.params.provider,
        req.body,
        req.installationOperator,
      );
      await this.reconcileIntegration(req, result);
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Не удалось заменить учётные данные');
    }
  }

  async validateIntegration(req, res) {
    try {
      res.json(await installationManagement.validateIntegration(
        req.params.organizationId,
        req.params.clubId,
        req.params.provider,
        req.body,
        req.installationOperator,
      ));
    } catch (error) {
      sendError(res, error, 'Не удалось проверить подключение');
    }
  }

  async setIntegrationStatus(req, res) {
    try {
      const statusByAction = { activate: 'active', disable: 'disabled', revoke: 'revoked' };
      const result = await installationManagement.setIntegrationStatus(
        req.params.organizationId,
        req.params.clubId,
        req.params.provider,
        statusByAction[req.params.action],
        req.body,
        req.installationOperator,
      );
      await this.reconcileIntegration(req, result);
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Не удалось изменить состояние подключения');
    }
  }

  async restartIntegration(req, res) {
    try {
      const result = await installationManagement.restartIntegration(
        req.params.organizationId,
        req.params.clubId,
        req.params.provider,
        req.body,
        req.installationOperator,
      );
      await this.reconcileIntegration(req, result);
      res.json(result);
    } catch (error) {
      sendError(res, error, 'Не удалось перезапустить подключение');
    }
  }

  async beelineAction(req, res) {
    try {
      res.json(await installationManagement.runBeelineAction(
        req.params.organizationId,
        req.params.clubId,
        req.params.action,
        req.body,
        req.installationOperator,
      ));
    } catch (error) {
      sendError(res, error, 'Не удалось выполнить действие Билайн');
    }
  }

  async reconcileIntegration(req, result) {
    const reconcile = req.app.get('onIntegrationConnectionChanged');
    if (typeof reconcile !== 'function') return;
    try {
      await reconcile({
        clubId: Number(req.params.clubId),
        organizationId: Number(req.params.organizationId),
        provider: req.params.provider,
      });
    } catch {
      console.error('INSTALLATION_CONNECTION_RECONCILE_FAILED', {
        clubId: Number(req.params.clubId),
        organizationId: Number(req.params.organizationId),
        provider: req.params.provider,
      });
      result.runtime = { status: 'restart_required' };
    }
  }

  async reconcileTenantIntegrations(req, result, clubId = null) {
    const reconcile = req.app.get('onIntegrationConnectionChanged');
    if (typeof reconcile !== 'function') return;
    try {
      const scopes = await installationManagement.listBotRunnerScopes(
        req.params.organizationId,
        clubId,
      );
      for (const scope of scopes) await reconcile(scope);
    } catch {
      console.error('INSTALLATION_TENANT_RECONCILE_FAILED', {
        clubId: clubId ? Number(clubId) : null,
        organizationId: Number(req.params.organizationId),
      });
      result.runtime = { status: 'restart_required' };
    }
  }

  async create(req, res) {
    try {
      const result = await installationProvisioning.provisionOrganization(
        req.body,
        req.installationOperator,
      );
      const onTenantInitialized = req.app.get('onTenantInitialized');
      if (typeof onTenantInitialized === 'function') {
        try {
          await onTenantInitialized();
        } catch (error) {
          console.error('Не удалось обновить runtime после provisioning:', error);
        }
      }
      res.status(result.idempotency.replayed ? 200 : 201).json(result);
    } catch (error) {
      sendError(res, error, 'Не удалось создать организацию');
    }
  }

  async activationStatus(req, res) {
    try {
      res.json(await installationProvisioning.inspectActivation(req.body.token));
    } catch (error) {
      sendError(res, error, 'Не удалось проверить ссылку активации');
    }
  }

  async activate(req, res) {
    try {
      res.json(
        await installationProvisioning.activateOwner(
          req.body.token,
          req.body.password,
        ),
      );
    } catch (error) {
      sendError(res, error, 'Не удалось активировать аккаунт');
    }
  }

  async reissue(req, res) {
    try {
      res.json(
        await installationProvisioning.reissueActivation(
          req.params.organizationId,
          req.installationOperator,
        ),
      );
    } catch (error) {
      sendError(res, error, 'Не удалось перевыпустить ссылку активации');
    }
  }
}

module.exports = new InstallationProvisioningController();
