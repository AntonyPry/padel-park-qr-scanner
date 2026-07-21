const { z } = require('zod');
const { apiSchemas } = require('./api-schemas');
const {
  getEndpointTenantScope,
} = require('../tenant-context/route-scope-declarations');

type HttpMethod = 'delete' | 'get' | 'patch' | 'post' | 'put';

interface EndpointContract {
  body?: unknown;
  description?: string;
  id: string;
  method: HttpMethod;
  params?: unknown;
  path: string;
  public?: boolean;
  query?: unknown;
  response?: unknown;
  responseType?: 'binary' | 'json' | 'xlsx';
  successStatus?: number;
  summary: string;
  tags: string[];
  tenantScope?: 'global' | 'installation' | 'membership' | 'organization' | 'club' | 'provider_ingress' | 'worker';
}

const responseOk = z.object({}).passthrough();
const validationError = z.object({
  code: z.literal('VALIDATION_ERROR'),
  details: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
      path: z.string(),
    }),
  ),
  error: z.string(),
  status: z.literal(400),
});
const apiError = z.object({
  code: z.string().optional(),
  details: z.unknown().optional(),
  error: z.string(),
  status: z.number(),
});
const integrationConnectionParams = z.object({
  connectionPublicId: z.string().regex(/^ic_[a-f0-9]{32}$/u),
});
const beelineCapabilityParams = integrationConnectionParams.extend({
  callbackToken: z.string().regex(/^[a-f0-9]{64}$/u),
});

const rawEndpointContracts: EndpointContract[] = [
  { id: 'system.health', method: 'get', path: '/health', public: true, summary: 'Service health check', tags: ['System'] },
  { id: 'system.openapi', method: 'get', path: '/openapi.json', public: true, summary: 'OpenAPI document', tags: ['System'] },

  { id: 'auth.status', method: 'get', path: '/auth/status', public: true, summary: 'Setup status', tags: ['Auth'] },
  { ...apiSchemas.auth.bootstrap, id: 'auth.bootstrap', method: 'post', path: '/auth/bootstrap', public: true, summary: 'Bootstrap owner account', tags: ['Auth'] },
  { ...apiSchemas.auth.login, id: 'auth.login', method: 'post', path: '/auth/login', public: true, summary: 'Login', tags: ['Auth'] },
  { id: 'auth.me', method: 'get', path: '/auth/me', summary: 'Current account', tags: ['Auth'] },
  { id: 'auth.memberships', method: 'get', path: '/auth/me/memberships', response: apiSchemas.auth.membershipsResponse, summary: 'Current account tenant memberships', tags: ['Auth'] },
  { id: 'installationProvisioning.status', method: 'get', path: '/installation/provisioning/status', public: true, response: apiSchemas.installationProvisioning.statusResponse, summary: 'Installation provisioning status', tags: ['Installation Provisioning'] },
  { ...apiSchemas.installationProvisioning.session, id: 'installationProvisioning.session', method: 'post', path: '/installation/provisioning/session', public: true, summary: 'Create installation operator session', tags: ['Installation Provisioning'] },
  { id: 'installationProvisioning.snapshot', method: 'get', path: '/installation/provisioning/snapshot', response: apiSchemas.installationProvisioning.snapshotResponse, summary: 'Read installation tenant graph', tags: ['Installation Provisioning'] },
  { ...apiSchemas.installationProvisioning.create, id: 'installationProvisioning.create', method: 'post', path: '/installation/provisioning/organizations', successStatus: 201, summary: 'Atomically provision an Organization and first owner activation', tags: ['Installation Provisioning'] },
  { ...apiSchemas.installationProvisioning.reissue, id: 'installationProvisioning.reissue', method: 'post', path: '/installation/provisioning/organizations/{organizationId}/activation/reissue', summary: 'Reissue first owner activation link', tags: ['Installation Provisioning'] },
  { ...apiSchemas.installationProvisioning.activationStatus, id: 'installationProvisioning.activationStatus', method: 'post', path: '/installation/provisioning/activation/status', public: true, summary: 'Inspect first owner activation link', tags: ['Installation Provisioning'] },
  { ...apiSchemas.installationProvisioning.activate, id: 'installationProvisioning.activate', method: 'post', path: '/installation/provisioning/activation/consume', public: true, summary: 'Activate first owner account', tags: ['Installation Provisioning'] },
  { id: 'webhooks.evotor', method: 'post', path: '/webhooks/evotor', public: true, summary: 'Receive Evotor webhook event', tags: ['Integrations'] },
  { id: 'webhooks.evotorConnection', method: 'post', params: integrationConnectionParams, path: '/webhooks/evotor/{connectionPublicId}', public: true, summary: 'Receive Evotor webhook through an integration connection', tags: ['Integrations'] },

  { id: 'access.search', method: 'get', path: '/search', query: apiSchemas.access.searchQuery, summary: 'Search clients for access monitor', tags: ['Access'] },
  { ...apiSchemas.access.manualVisit, id: 'access.manualVisit', method: 'post', path: '/manual-visit', summary: 'Create manual visit', tags: ['Access'] },
  { ...apiSchemas.access.issueKey, id: 'access.issueKey', method: 'post', path: '/key', summary: 'Issue key for visit', tags: ['Access'] },
  { ...apiSchemas.access.correctKey, id: 'access.correctKey', method: 'patch', path: '/key', summary: 'Correct issued key number', tags: ['Access'] },
  { ...apiSchemas.access.scan, id: 'access.scan', method: 'post', path: '/scan', summary: 'Process QR scan', tags: ['Access'] },
  { id: 'access.scannerEvents', method: 'get', path: '/scanner-events', query: apiSchemas.access.scannerEventsQuery, summary: 'List scanner events', tags: ['Access'] },
  { ...apiSchemas.access.scannerEvent, id: 'access.recordScannerEvent', method: 'post', path: '/scanner-events', summary: 'Record scanner diagnostic event', tags: ['Access'] },
  { ...apiSchemas.access.register, id: 'access.register', method: 'post', path: '/register', summary: 'Register client from access monitor', tags: ['Access'] },
  { id: 'access.visits', method: 'get', path: '/visits', summary: 'Recent visit cards', tags: ['Access'] },
  { ...apiSchemas.access.visitCategory, id: 'access.updateVisitCategory', method: 'post', path: '/visit/category', summary: 'Update visit category', tags: ['Access'] },

  { id: 'accounts.list', method: 'get', path: '/accounts', query: apiSchemas.accounts.listQuery, summary: 'List system users', tags: ['Accounts'] },
  { id: 'accounts.create', method: 'post', path: '/accounts', body: apiSchemas.accounts.createBody, summary: 'Create system user', tags: ['Accounts'] },
  { id: 'accounts.update', method: 'put', path: '/accounts/{id}', body: apiSchemas.accounts.body.partial().passthrough(), params: apiSchemas.accounts.params, summary: 'Update system user', tags: ['Accounts'] },
  { id: 'accounts.restore', method: 'post', path: '/accounts/{id}/restore', params: apiSchemas.accounts.params, summary: 'Restore archived system user', tags: ['Accounts'] },
  { id: 'accounts.deletePermanent', method: 'delete', path: '/accounts/{id}/permanent', params: apiSchemas.accounts.params, summary: 'Delete archived system user permanently', tags: ['Accounts'] },
  { id: 'accounts.archive', method: 'delete', path: '/accounts/{id}', params: apiSchemas.accounts.params, summary: 'Archive system user', tags: ['Accounts'] },

  { id: 'onboarding.overview', method: 'get', path: '/onboarding', query: apiSchemas.onboarding.roleQuery, summary: 'Get onboarding path and progress', tags: ['Onboarding'] },
  { id: 'onboarding.trainingMode', method: 'get', path: '/onboarding/training-mode', summary: 'Get onboarding training mode state', tags: ['Onboarding'] },
  { id: 'onboarding.trainingModeUpdate', method: 'put', path: '/onboarding/training-mode', body: apiSchemas.onboarding.trainingModeBody, summary: 'Update onboarding training mode state', tags: ['Onboarding'] },
  { id: 'onboarding.trainingData', method: 'get', path: '/onboarding/training-data', query: apiSchemas.onboarding.roleQuery, summary: 'Get onboarding training data summary', tags: ['Onboarding'] },
  { id: 'onboarding.trainingDataCleanup', method: 'delete', path: '/onboarding/training-data', query: apiSchemas.onboarding.roleQuery, summary: 'Cleanup onboarding training data', tags: ['Onboarding'] },
  { id: 'onboarding.metrics', method: 'get', path: '/onboarding/metrics', summary: 'Get onboarding completion metrics by role', tags: ['Onboarding'] },
  { id: 'onboarding.taskDetail', method: 'get', path: '/onboarding/tasks/{taskKey}', params: apiSchemas.onboarding.taskParams, query: apiSchemas.onboarding.roleQuery, summary: 'Get guided onboarding task detail', tags: ['Onboarding'] },
  { id: 'onboarding.completeTask', method: 'post', path: '/onboarding/tasks/{taskKey}/complete', body: apiSchemas.onboarding.completeBody, params: apiSchemas.onboarding.taskParams, summary: 'Mark onboarding task as completed', tags: ['Onboarding'] },
  { id: 'onboarding.lessonRead', method: 'post', path: '/onboarding/tasks/{taskKey}/lesson-read', body: apiSchemas.onboarding.progressBody, params: apiSchemas.onboarding.taskParams, summary: 'Mark guided onboarding lesson as read', tags: ['Onboarding'] },
  { id: 'onboarding.practiceStart', method: 'post', path: '/onboarding/tasks/{taskKey}/practice-start', body: apiSchemas.onboarding.progressBody, params: apiSchemas.onboarding.taskParams, summary: 'Start guided onboarding practice', tags: ['Onboarding'] },
  { id: 'onboarding.practiceStep', method: 'post', path: '/onboarding/tasks/{taskKey}/steps/{stepKey}', body: apiSchemas.onboarding.progressBody, params: apiSchemas.onboarding.stepParams, summary: 'Complete guided onboarding practice step', tags: ['Onboarding'] },
  { id: 'onboarding.quizAttempt', method: 'post', path: '/onboarding/tasks/{taskKey}/quiz-attempt', body: apiSchemas.onboarding.quizAttemptBody, params: apiSchemas.onboarding.taskParams, summary: 'Submit guided onboarding quiz attempt', tags: ['Onboarding'] },
  { id: 'onboarding.recordEvent', method: 'post', path: '/onboarding/events', body: apiSchemas.onboarding.eventBody, summary: 'Record client-side onboarding checkpoint event', tags: ['Onboarding'] },
  { id: 'onboarding.resetProgress', method: 'delete', path: '/onboarding/progress', query: apiSchemas.onboarding.roleQuery, summary: 'Reset onboarding progress for selected role', tags: ['Onboarding'] },

  { id: 'audit.list', method: 'get', path: '/audit-logs', query: apiSchemas.audit.listQuery, summary: 'List audit logs', tags: ['Audit'] },

  { id: 'bookings.schedule', method: 'get', path: '/bookings/schedule', query: apiSchemas.bookings.scheduleQuery, summary: 'Booking schedule by day', tags: ['Bookings'] },
  { id: 'bookings.courts', method: 'get', path: '/bookings/courts', query: apiSchemas.bookings.statusQuery, summary: 'List booking calendar resources', tags: ['Bookings'] },
  { id: 'bookings.courtCreate', method: 'post', path: '/bookings/courts', body: apiSchemas.bookings.resourceBody, summary: 'Create booking calendar resource', tags: ['Bookings'] },
  { id: 'bookings.courtUpdate', method: 'put', path: '/bookings/courts/{id}', body: apiSchemas.bookings.resourceBody.partial().passthrough(), params: apiSchemas.bookings.params, summary: 'Update booking calendar resource', tags: ['Bookings'] },
  { id: 'bookings.courtArchive', method: 'delete', path: '/bookings/courts/{id}', params: apiSchemas.bookings.params, summary: 'Archive booking calendar resource', tags: ['Bookings'] },
  { id: 'bookings.responsibles', method: 'get', path: '/bookings/responsibles', summary: 'List staff available as booking responsibles', tags: ['Bookings'] },
  { id: 'bookings.analytics', method: 'get', path: '/bookings/analytics', query: apiSchemas.bookings.analyticsQuery, summary: 'Booking analytics report', tags: ['Bookings'] },
  { id: 'bookings.settings', method: 'get', path: '/bookings/settings', summary: 'Get booking settings', tags: ['Bookings'] },
  { id: 'bookings.settingsUpdate', method: 'put', path: '/bookings/settings', body: apiSchemas.bookings.settingsBody, summary: 'Update booking settings', tags: ['Bookings'] },
  { id: 'bookings.quote', method: 'get', path: '/bookings/quote', query: apiSchemas.bookings.quoteQuery, summary: 'Calculate booking price quote', tags: ['Bookings'] },
  { id: 'bookings.priceRules', method: 'get', path: '/bookings/price-rules', query: apiSchemas.bookings.statusQuery, summary: 'List booking price rules', tags: ['Bookings'] },
  { id: 'bookings.priceRuleCreate', method: 'post', path: '/bookings/price-rules', body: apiSchemas.bookings.priceRuleBody, summary: 'Create booking price rule', tags: ['Bookings'] },
  { id: 'bookings.priceRuleUpdate', method: 'put', path: '/bookings/price-rules/{id}', body: apiSchemas.bookings.priceRuleBody.partial().passthrough(), params: apiSchemas.bookings.params, summary: 'Update booking price rule', tags: ['Bookings'] },
  { id: 'bookings.priceRuleArchive', method: 'delete', path: '/bookings/price-rules/{id}', params: apiSchemas.bookings.params, summary: 'Archive booking price rule', tags: ['Bookings'] },
  { id: 'bookings.blocks', method: 'get', path: '/bookings/blocks', query: apiSchemas.bookings.statusQuery.extend({ date: apiSchemas.bookings.scheduleQuery.shape.date }), summary: 'List court blocks', tags: ['Bookings'] },
  { id: 'bookings.blockCreate', method: 'post', path: '/bookings/blocks', body: apiSchemas.bookings.blockBody, summary: 'Create court block', tags: ['Bookings'] },
  { id: 'bookings.blockUpdate', method: 'put', path: '/bookings/blocks/{id}', body: apiSchemas.bookings.blockBody.partial().passthrough(), params: apiSchemas.bookings.params, summary: 'Update court block', tags: ['Bookings'] },
  { id: 'bookings.blockArchive', method: 'delete', path: '/bookings/blocks/{id}', params: apiSchemas.bookings.params, summary: 'Archive court block', tags: ['Bookings'] },
  { id: 'bookings.exceptions', method: 'get', path: '/bookings/exceptions', query: apiSchemas.bookings.statusQuery, summary: 'List booking schedule exceptions', tags: ['Bookings'] },
  { id: 'bookings.exceptionCreate', method: 'post', path: '/bookings/exceptions', body: apiSchemas.bookings.exceptionBody, summary: 'Create booking schedule exception', tags: ['Bookings'] },
  { id: 'bookings.exceptionUpdate', method: 'put', path: '/bookings/exceptions/{id}', body: apiSchemas.bookings.exceptionBody.partial().passthrough(), params: apiSchemas.bookings.params, summary: 'Update booking schedule exception', tags: ['Bookings'] },
  { id: 'bookings.exceptionArchive', method: 'delete', path: '/bookings/exceptions/{id}', params: apiSchemas.bookings.params, summary: 'Archive booking schedule exception', tags: ['Bookings'] },
  { id: 'bookings.series', method: 'get', path: '/bookings/series', query: apiSchemas.bookings.statusQuery, summary: 'List recurring booking series', tags: ['Bookings'] },
  { id: 'bookings.seriesPreview', method: 'post', path: '/bookings/series/preview', body: apiSchemas.bookings.seriesBody, summary: 'Preview recurring booking series', tags: ['Bookings'] },
  { id: 'bookings.seriesCreate', method: 'post', path: '/bookings/series', body: apiSchemas.bookings.seriesBody, summary: 'Create recurring booking series', tags: ['Bookings'] },
  { id: 'bookings.seriesArchive', method: 'post', path: '/bookings/series/{id}/archive', body: apiSchemas.bookings.seriesArchiveBody, params: apiSchemas.bookings.params, summary: 'Archive recurring booking series', tags: ['Bookings'] },
  { id: 'bookings.create', method: 'post', path: '/bookings', body: apiSchemas.bookings.body, summary: 'Create court booking', tags: ['Bookings'] },
  { id: 'bookings.get', method: 'get', path: '/bookings/{id}', params: apiSchemas.bookings.params, summary: 'Get court booking', tags: ['Bookings'] },
  { id: 'bookings.trainingPlan.get', method: 'get', path: '/bookings/{id}/training-plan', params: apiSchemas.bookings.params, summary: 'Get linked training plan for booking', tags: ['Bookings'] },
  { id: 'bookings.trainingPlan.create', method: 'post', path: '/bookings/{id}/training-plan', params: apiSchemas.bookings.params, successStatus: 201, summary: 'Create training plan from booking', tags: ['Bookings'] },
  { id: 'bookings.update', method: 'put', path: '/bookings/{id}', body: apiSchemas.bookings.updateBody, params: apiSchemas.bookings.params, summary: 'Update court booking', tags: ['Bookings'] },
  { id: 'bookings.status', method: 'patch', path: '/bookings/{id}/status', body: apiSchemas.bookings.statusBody, params: apiSchemas.bookings.params, summary: 'Change court booking status', tags: ['Bookings'] },
  { id: 'bookings.history', method: 'get', path: '/bookings/{id}/history', params: apiSchemas.bookings.params, summary: 'List booking change history', tags: ['Bookings'] },

  { id: 'catalog.categories.list', method: 'get', path: '/catalog/categories', query: apiSchemas.catalog.listQuery, summary: 'List catalog categories', tags: ['Catalog'] },
  { id: 'catalog.categories.create', method: 'post', path: '/catalog/categories', body: apiSchemas.catalog.categoryBody, summary: 'Create catalog category', tags: ['Catalog'] },
  { id: 'catalog.categories.update', method: 'put', path: '/catalog/categories/{id}', body: apiSchemas.catalog.categoryUpdateBody, params: apiSchemas.catalog.withId.params, summary: 'Update catalog category', tags: ['Catalog'] },
  { id: 'catalog.categories.restore', method: 'post', path: '/catalog/categories/{id}/restore', params: apiSchemas.catalog.withId.params, summary: 'Restore catalog category', tags: ['Catalog'] },
  { id: 'catalog.categories.deletePermanent', method: 'delete', path: '/catalog/categories/{id}/permanent', params: apiSchemas.catalog.withId.params, summary: 'Delete archived catalog category permanently', tags: ['Catalog'] },
  { id: 'catalog.categories.archive', method: 'delete', path: '/catalog/categories/{id}', params: apiSchemas.catalog.withId.params, summary: 'Archive catalog category', tags: ['Catalog'] },
  { id: 'catalog.saleSettings.list', method: 'get', path: '/catalog/sale-settings', summary: 'List Evotor sale intent settings', tags: ['Catalog'] },
  { id: 'catalog.saleSettings.save', method: 'post', path: '/catalog/sale-settings', body: apiSchemas.catalog.saleSettingBody, summary: 'Save Evotor sale intent setting', tags: ['Catalog'] },
  { id: 'catalog.pendingSales.list', method: 'get', path: '/catalog/pending-sales', query: apiSchemas.catalog.pendingSalesQuery, summary: 'List pending Evotor sales', tags: ['Catalog'] },
  { id: 'catalog.pendingSales.link', method: 'post', path: '/catalog/pending-sales/{id}/link', body: apiSchemas.catalog.pendingSaleLinkBody, params: apiSchemas.catalog.withId.params, summary: 'Link pending Evotor sale to client', tags: ['Catalog'] },
  { id: 'catalog.pendingSales.ignore', method: 'post', path: '/catalog/pending-sales/{id}/ignore', body: apiSchemas.catalog.pendingSaleReasonBody, params: apiSchemas.catalog.withId.params, summary: 'Ignore pending Evotor sale', tags: ['Catalog'] },
  { id: 'catalog.pendingSales.cancel', method: 'post', path: '/catalog/pending-sales/{id}/cancel', body: apiSchemas.catalog.pendingSaleReasonBody, params: apiSchemas.catalog.withId.params, summary: 'Cancel pending Evotor sale', tags: ['Catalog'] },
  { id: 'catalog.unmapped', method: 'get', path: '/catalog/unmapped', summary: 'List unmapped receipt items', tags: ['Catalog'] },
  { id: 'catalog.rules.list', method: 'get', path: '/catalog/rules', query: apiSchemas.catalog.listQuery, summary: 'List catalog mapping rules', tags: ['Catalog'] },
  { id: 'catalog.rules.create', method: 'post', path: '/catalog/rules', body: apiSchemas.catalog.ruleBody, summary: 'Create catalog mapping rule', tags: ['Catalog'] },
  { id: 'catalog.rules.restore', method: 'post', path: '/catalog/rules/{id}/restore', params: apiSchemas.catalog.withId.params, summary: 'Restore catalog mapping rule', tags: ['Catalog'] },
  { id: 'catalog.rules.deletePermanent', method: 'delete', path: '/catalog/rules/{id}/permanent', params: apiSchemas.catalog.withId.params, summary: 'Delete archived catalog mapping rule permanently', tags: ['Catalog'] },
  { id: 'catalog.rules.archive', method: 'delete', path: '/catalog/rules/{id}', params: apiSchemas.catalog.withId.params, summary: 'Archive catalog mapping rule', tags: ['Catalog'] },

  { id: 'subscriptions.types.list', method: 'get', path: '/subscriptions/types', query: apiSchemas.subscriptions.typeListQuery, summary: 'List subscription types', tags: ['Subscriptions'] },
  { id: 'subscriptions.types.create', method: 'post', path: '/subscriptions/types', body: apiSchemas.subscriptions.typeBody, summary: 'Create subscription type', tags: ['Subscriptions'] },
  { id: 'subscriptions.types.update', method: 'put', path: '/subscriptions/types/{id}', body: apiSchemas.subscriptions.typeUpdateBody, params: apiSchemas.subscriptions.withId.params, summary: 'Update subscription type', tags: ['Subscriptions'] },
  { id: 'subscriptions.types.archive', method: 'post', path: '/subscriptions/types/{id}/archive', params: apiSchemas.subscriptions.withId.params, summary: 'Archive subscription type', tags: ['Subscriptions'] },
  { id: 'subscriptions.types.restore', method: 'post', path: '/subscriptions/types/{id}/restore', params: apiSchemas.subscriptions.withId.params, summary: 'Restore subscription type', tags: ['Subscriptions'] },
  { id: 'subscriptions.types.deletePermanent', method: 'delete', path: '/subscriptions/types/{id}/permanent', params: apiSchemas.subscriptions.withId.params, summary: 'Delete archived subscription type permanently', tags: ['Subscriptions'] },
  { id: 'subscriptions.client.list', method: 'get', path: '/clients/{clientId}/subscriptions', params: apiSchemas.subscriptions.clientParams, query: apiSchemas.subscriptions.clientListQuery, summary: 'List client subscriptions', tags: ['Subscriptions'] },
  { id: 'subscriptions.client.issue', method: 'post', path: '/clients/{clientId}/subscriptions', body: apiSchemas.subscriptions.manualIssueBody, params: apiSchemas.subscriptions.clientParams, successStatus: 201, summary: 'Manually issue an existing subscription type to a client', tags: ['Subscriptions'] },
  { id: 'subscriptions.client.get', method: 'get', path: '/client-subscriptions/{id}', params: apiSchemas.subscriptions.withId.params, summary: 'Get client subscription', tags: ['Subscriptions'] },
  { id: 'subscriptions.client.redemptions', method: 'get', path: '/client-subscriptions/{id}/redemptions', params: apiSchemas.subscriptions.withId.params, summary: 'List client subscription redemption history', tags: ['Subscriptions'] },
  { id: 'subscriptions.client.redeem', method: 'post', path: '/client-subscriptions/{id}/redemptions', body: apiSchemas.subscriptions.redemptionBody, params: apiSchemas.subscriptions.withId.params, successStatus: 201, summary: 'Redeem one or more training sessions from client subscription', tags: ['Subscriptions'] },
  { id: 'subscriptions.client.reverseRedemption', method: 'post', path: '/client-subscriptions/{id}/redemptions/{redemptionId}/reverse', body: apiSchemas.subscriptions.redemptionReverse.body, params: apiSchemas.subscriptions.redemptionReverse.params, summary: 'Reverse client subscription redemption', tags: ['Subscriptions'] },

  { id: 'certificates.list', method: 'get', path: '/certificates', query: apiSchemas.certificates.listQuery, summary: 'Search certificates by code, client and status', tags: ['Certificates'] },
  { id: 'certificates.client.list', method: 'get', path: '/clients/{clientId}/certificates', params: apiSchemas.certificates.clientParams, query: apiSchemas.certificates.clientListQuery, summary: 'List client certificates', tags: ['Certificates'] },
  { id: 'certificates.client.issue', method: 'post', path: '/clients/{clientId}/certificates', body: apiSchemas.certificates.manualIssueBody, params: apiSchemas.certificates.clientParams, successStatus: 201, summary: 'Manually issue a certificate to a client', tags: ['Certificates'] },
  { id: 'certificates.get', method: 'get', path: '/certificates/{id}', params: apiSchemas.certificates.withId.params, summary: 'Get certificate details', tags: ['Certificates'] },
  { id: 'certificates.redemptions', method: 'get', path: '/certificates/{id}/redemptions', params: apiSchemas.certificates.withId.params, summary: 'List certificate redemption history', tags: ['Certificates'] },
  { id: 'certificates.redeem', method: 'post', path: '/certificates/{id}/redemptions', body: apiSchemas.certificates.redemptionBody, params: apiSchemas.certificates.withId.params, successStatus: 201, summary: 'Redeem certificate balance or package unit', tags: ['Certificates'] },
  { id: 'certificates.reverseRedemption', method: 'post', path: '/certificates/{id}/redemptions/{redemptionId}/reverse', body: apiSchemas.certificates.redemptionReverse.body, params: apiSchemas.certificates.redemptionReverse.params, summary: 'Reverse certificate redemption', tags: ['Certificates'] },

  { id: 'corporateClients.list', method: 'get', path: '/corporate-clients', query: apiSchemas.corporateClients.listQuery, summary: 'List corporate clients and balances', tags: ['Corporate Clients'] },
  { id: 'corporateClients.create', method: 'post', path: '/corporate-clients', body: apiSchemas.corporateClients.body, successStatus: 201, summary: 'Create corporate client', tags: ['Corporate Clients'] },
  { id: 'corporateClients.get', method: 'get', path: '/corporate-clients/{id}', params: apiSchemas.corporateClients.withId.params, summary: 'Get corporate client balance card', tags: ['Corporate Clients'] },
  { id: 'corporateClients.update', method: 'put', path: '/corporate-clients/{id}', body: apiSchemas.corporateClients.updateBody, params: apiSchemas.corporateClients.withId.params, summary: 'Update corporate client', tags: ['Corporate Clients'] },
  { id: 'corporateClients.archive', method: 'post', path: '/corporate-clients/{id}/archive', body: apiSchemas.corporateClients.reasonBody, params: apiSchemas.corporateClients.withId.params, summary: 'Archive corporate client', tags: ['Corporate Clients'] },
  { id: 'corporateClients.restore', method: 'post', path: '/corporate-clients/{id}/restore', params: apiSchemas.corporateClients.withId.params, summary: 'Restore corporate client', tags: ['Corporate Clients'] },
  { id: 'corporateClients.ledger', method: 'get', path: '/corporate-clients/{id}/ledger', params: apiSchemas.corporateClients.withId.params, query: apiSchemas.corporateClients.ledgerQuery, summary: 'List corporate client ledger entries', tags: ['Corporate Clients'] },
  { id: 'corporateClients.ledgerExport', method: 'get', path: '/corporate-clients/{id}/ledger/export', params: apiSchemas.corporateClients.withId.params, query: apiSchemas.corporateClients.ledgerQuery, responseType: 'xlsx', summary: 'Export corporate client ledger details', tags: ['Corporate Clients'] },
  { id: 'corporateClients.deposit', method: 'post', path: '/corporate-clients/{id}/deposits', body: apiSchemas.corporateClients.depositContractBody, params: apiSchemas.corporateClients.withId.params, successStatus: 201, summary: 'Create or link corporate deposit', tags: ['Corporate Clients'] },
  { id: 'corporateClients.depositCancel', method: 'post', path: '/corporate-clients/{id}/deposits/{entryId}/cancel', body: apiSchemas.corporateClients.reasonBody, params: apiSchemas.corporateClients.entryParams, summary: 'Cancel corporate deposit and synced finance income', tags: ['Corporate Clients'] },
  { id: 'corporateClients.spending', method: 'post', path: '/corporate-clients/{id}/spendings', body: apiSchemas.corporateClients.spendingBody, params: apiSchemas.corporateClients.withId.params, successStatus: 201, summary: 'Create corporate client balance spending', tags: ['Corporate Clients'] },
  { id: 'corporateClients.spendingReverse', method: 'post', path: '/corporate-clients/{id}/spendings/{entryId}/reverse', body: apiSchemas.corporateClients.reasonBody, params: apiSchemas.corporateClients.entryParams, summary: 'Reverse corporate client balance spending', tags: ['Corporate Clients'] },

  { id: 'prepayments.dashboard', method: 'get', path: '/prepayments/dashboard', query: apiSchemas.prepaymentsDashboard.query, summary: 'Unified prepayments and redemptions dashboard', tags: ['Prepayments'] },
  { id: 'managerControl.dashboard', method: 'get', path: '/manager-control/dashboard', query: apiSchemas.managerControlDashboard.query, summary: 'Manager control attention queue', tags: ['Manager Control'] },

  { id: 'clientBases.list', method: 'get', path: '/client-bases', query: apiSchemas.clientBases.listQuery, summary: 'List client bases', tags: ['Client Bases'] },
  { id: 'clientBases.create', method: 'post', path: '/client-bases', body: apiSchemas.clientBases.body, summary: 'Create client base', tags: ['Client Bases'] },
  { id: 'clientBases.clients', method: 'get', path: '/client-bases/{id}/clients', params: apiSchemas.clientBases.withId.params, query: apiSchemas.clients.listQuery, summary: 'List clients in base', tags: ['Client Bases'] },
  { id: 'clientBases.update', method: 'put', path: '/client-bases/{id}', body: apiSchemas.clientBases.updateBody, params: apiSchemas.clientBases.withId.params, summary: 'Update client base', tags: ['Client Bases'] },
  { id: 'clientBases.archive', method: 'delete', path: '/client-bases/{id}', params: apiSchemas.clientBases.withId.params, summary: 'Archive client base', tags: ['Client Bases'] },
  { id: 'clientBases.deletePermanent', method: 'delete', path: '/client-bases/{id}/permanent', params: apiSchemas.clientBases.withId.params, summary: 'Delete archived client base permanently', tags: ['Client Bases'] },
  { id: 'clientBases.restore', method: 'post', path: '/client-bases/{id}/restore', params: apiSchemas.clientBases.withId.params, summary: 'Restore client base', tags: ['Client Bases'] },

  { id: 'callTasks.createFromBase', method: 'post', path: '/client-bases/{baseId}/call-tasks', body: apiSchemas.callTasks.createFromBase.body, params: apiSchemas.callTasks.createFromBase.params, summary: 'Create call task from client base', tags: ['Call Tasks'] },
  { id: 'callTasks.createForClient', method: 'post', path: '/clients/{clientId}/call-tasks', body: apiSchemas.callTasks.createForClient.body, params: apiSchemas.callTasks.createForClient.params, summary: 'Create call task for one client', tags: ['Call Tasks'] },
  { id: 'callTasks.list', method: 'get', path: '/call-tasks', query: apiSchemas.callTasks.listQuery, summary: 'List call tasks', tags: ['Call Tasks'] },
  { id: 'callTasks.report', method: 'get', path: '/call-tasks/report', query: apiSchemas.callTasks.reportQuery, summary: 'Call task report', tags: ['Call Tasks'] },
  { id: 'callTasks.runRecurring', method: 'post', path: '/call-tasks/recurring/run', summary: 'Run due recurring call tasks', tags: ['Call Tasks'] },
  { id: 'callTasks.get', method: 'get', path: '/call-tasks/{id}', params: apiSchemas.callTasks.withId.params, summary: 'Get call task', tags: ['Call Tasks'] },
  { id: 'callTasks.update', method: 'put', path: '/call-tasks/{id}', body: apiSchemas.callTasks.update.body, params: apiSchemas.callTasks.update.params, summary: 'Update call task', tags: ['Call Tasks'] },
  { id: 'callTasks.deletePermanent', method: 'delete', path: '/call-tasks/{id}/permanent', params: apiSchemas.callTasks.withId.params, summary: 'Delete archived call task permanently', tags: ['Call Tasks'] },
  { id: 'callTasks.sync', method: 'post', path: '/call-tasks/{id}/sync', params: apiSchemas.callTasks.withId.params, summary: 'Sync dynamic call task', tags: ['Call Tasks'] },
  { id: 'callTasks.clients', method: 'get', path: '/call-tasks/{id}/clients', params: apiSchemas.callTasks.withId.params, query: apiSchemas.callTasks.clientsQuery, summary: 'List call task clients', tags: ['Call Tasks'] },
  { id: 'callTasks.clientsBulk', method: 'patch', path: '/call-tasks/{id}/clients/bulk', body: apiSchemas.callTasks.bulk.body, params: apiSchemas.callTasks.bulk.params, summary: 'Bulk update call task clients', tags: ['Call Tasks'] },
  { id: 'callTasks.addAttempt', method: 'post', path: '/call-task-clients/{taskClientId}/attempts', body: apiSchemas.callTasks.attempt.body, params: apiSchemas.callTasks.attempt.params, summary: 'Add call attempt', tags: ['Call Tasks'] },

  { id: 'telephony.config', method: 'get', path: '/telephony/config', summary: 'Get Beeline telephony config', tags: ['Telephony'] },
  { id: 'telephony.stats', method: 'get', path: '/telephony/stats', summary: 'Get telephony dashboard stats', tags: ['Telephony'] },
  { id: 'telephony.report', method: 'get', path: '/telephony/report', query: apiSchemas.telephony.reportQuery, summary: 'Get telephony processing report', tags: ['Telephony'] },
  { id: 'telephony.calls', method: 'get', path: '/telephony/calls', query: apiSchemas.telephony.callsQuery, summary: 'List telephony calls', tags: ['Telephony'] },
  { id: 'telephony.getCall', method: 'get', path: '/telephony/calls/{id}', params: apiSchemas.telephony.withId.params, summary: 'Get telephony call', tags: ['Telephony'] },
  { id: 'telephony.startCall', method: 'post', path: '/telephony/calls/{id}/start', params: apiSchemas.telephony.withId.params, summary: 'Start call processing', tags: ['Telephony'] },
  { id: 'telephony.linkClient', method: 'post', path: '/telephony/calls/{id}/client', body: apiSchemas.telephony.linkClient.body, params: apiSchemas.telephony.linkClient.params, summary: 'Link client to telephony call', tags: ['Telephony'] },
  { id: 'telephony.createClient', method: 'post', path: '/telephony/calls/{id}/client/create', body: apiSchemas.telephony.createClient.body, params: apiSchemas.telephony.createClient.params, successStatus: 201, summary: 'Create client from telephony call', tags: ['Telephony'] },
  { id: 'telephony.completeCall', method: 'post', path: '/telephony/calls/{id}/complete', body: apiSchemas.telephony.complete.body, params: apiSchemas.telephony.complete.params, summary: 'Complete call processing', tags: ['Telephony'] },
  { id: 'telephony.ignoreCall', method: 'post', path: '/telephony/calls/{id}/ignore', body: apiSchemas.telephony.ignore.body, params: apiSchemas.telephony.ignore.params, summary: 'Ignore telephony call', tags: ['Telephony'] },
  { id: 'telephony.recordingReference', method: 'post', path: '/telephony/calls/{id}/recording-reference', params: apiSchemas.telephony.withId.params, summary: 'Refresh call recording reference', tags: ['Telephony'] },
  { id: 'telephony.createTranscriptionJob', method: 'post', path: '/telephony/calls/{id}/transcription-jobs', params: apiSchemas.telephony.withId.params, successStatus: 201, summary: 'Create call transcription job', tags: ['Telephony'] },
  { id: 'telephony.queueMissingTranscriptionJobs', method: 'post', path: '/telephony/transcription-jobs/queue-missing', body: apiSchemas.telephony.transcriptionBackfillBody, summary: 'Queue a bounded batch of calls missing transcription', tags: ['Telephony'] },
  { id: 'telephony.callTranscriptionJobs', method: 'get', path: '/telephony/calls/{id}/transcription-jobs', params: apiSchemas.telephony.withId.params, query: apiSchemas.telephony.transcriptionJobsQuery, summary: 'List call transcription jobs', tags: ['Telephony'] },
  { id: 'telephony.transcriptionJobs', method: 'get', path: '/telephony/transcription-jobs', query: apiSchemas.telephony.transcriptionJobsQuery, summary: 'List transcription jobs', tags: ['Telephony'] },
  { id: 'telephony.transcriptionJobStats', method: 'get', path: '/telephony/transcription-jobs/stats', summary: 'Get transcription job stats', tags: ['Telephony'] },
  { id: 'telephony.getTranscriptionJob', method: 'get', path: '/telephony/transcription-jobs/{id}', params: apiSchemas.telephony.withId.params, summary: 'Get transcription job', tags: ['Telephony'] },
  { id: 'telephony.workerTranscriptionQueue', method: 'get', path: '/telephony/transcription-jobs/worker-queue', query: apiSchemas.telephony.transcriptionJobsQuery, public: true, summary: 'Get worker transcription queue snapshot', tags: ['Telephony'] },
  { id: 'telephony.claimTranscriptionJob', method: 'post', path: '/telephony/transcription-jobs/claim', body: apiSchemas.telephony.transcriptionClaimBody, public: true, summary: 'Claim queued transcription job', tags: ['Telephony'] },
  { id: 'telephony.transcriptionAudioReference', method: 'post', path: '/telephony/transcription-jobs/{id}/audio-reference', body: apiSchemas.telephony.transcriptionAudioReference.body, params: apiSchemas.telephony.transcriptionAudioReference.params, public: true, summary: 'Get transcription audio reference', tags: ['Telephony'] },
  { id: 'telephony.updateTranscriptionProgress', method: 'post', path: '/telephony/transcription-jobs/{id}/progress', body: apiSchemas.telephony.transcriptionProgress.body, params: apiSchemas.telephony.transcriptionProgress.params, public: true, summary: 'Update transcription progress heartbeat', tags: ['Telephony'] },
  { id: 'telephony.completeTranscriptionJob', method: 'post', path: '/telephony/transcription-jobs/{id}/result', body: apiSchemas.telephony.transcriptionResult.body, params: apiSchemas.telephony.transcriptionResult.params, public: true, summary: 'Submit transcription result', tags: ['Telephony'] },
  { id: 'telephony.failTranscriptionJob', method: 'post', path: '/telephony/transcription-jobs/{id}/fail', body: apiSchemas.telephony.transcriptionFail.body, params: apiSchemas.telephony.transcriptionFail.params, public: true, summary: 'Fail transcription job', tags: ['Telephony'] },
  { id: 'telephony.workerRetryTranscriptionJob', method: 'post', path: '/telephony/transcription-jobs/{id}/worker-retry', params: apiSchemas.telephony.withId.params, public: true, summary: 'Retry failed transcription job from worker dashboard', tags: ['Telephony'] },
  { id: 'telephony.retryTranscriptionJob', method: 'post', path: '/telephony/transcription-jobs/{id}/retry', params: apiSchemas.telephony.withId.params, summary: 'Retry failed transcription job', tags: ['Telephony'] },
  { id: 'telephony.syncStatistics', method: 'post', path: '/telephony/beeline/sync', body: apiSchemas.telephony.syncBody, summary: 'Sync Beeline statistics', tags: ['Telephony'] },
  { id: 'telephony.syncRecordings', method: 'post', path: '/telephony/beeline/records/sync', body: apiSchemas.telephony.recordsSyncBody, summary: 'Sync Beeline recordings', tags: ['Telephony'] },
  { id: 'telephony.subscribe', method: 'post', path: '/telephony/beeline/subscribe', body: apiSchemas.telephony.subscribeBody, summary: 'Create Beeline XSI subscription', tags: ['Telephony'] },
  { id: 'telephony.checkSubscription', method: 'post', path: '/telephony/beeline/subscription/check', summary: 'Check Beeline XSI subscription', tags: ['Telephony'] },
  { id: 'telephony.rawEvents', method: 'get', path: '/telephony/raw-events', query: apiSchemas.telephony.rawEventsQuery, summary: 'List raw Beeline events', tags: ['Telephony'] },
  { id: 'telephony.reprocessRawEvent', method: 'post', path: '/telephony/raw-events/{id}/reprocess', params: apiSchemas.telephony.withId.params, summary: 'Reprocess raw Beeline event', tags: ['Telephony'] },
  { id: 'telephony.beelineWebhook', method: 'post', path: '/integrations/beeline/events', public: true, summary: 'Reject legacy Beeline webhook route', tags: ['Telephony'] },
  { id: 'telephony.beelineConnectionWebhook', method: 'post', params: integrationConnectionParams, path: '/integrations/beeline/events/{connectionPublicId}', public: true, summary: 'Receive Beeline webhook through an integration connection', tags: ['Telephony'] },
  { id: 'telephony.beelineCapabilityWebhook', method: 'post', params: beelineCapabilityParams, path: '/integrations/beeline/events/{connectionPublicId}/{callbackToken}', public: true, summary: 'Receive Beeline webhook through an encrypted callback capability', tags: ['Telephony'] },

  { id: 'clients.list', method: 'get', path: '/clients', query: apiSchemas.clients.listQuery, summary: 'List clients', tags: ['Clients'] },
  { id: 'clients.search', method: 'get', path: '/clients/search', query: apiSchemas.clients.listQuery, summary: 'Search clients for operational workflows', tags: ['Clients'] },
  { id: 'clients.lookup', method: 'get', path: '/clients/lookup', query: apiSchemas.clients.lookupQuery, summary: 'Lookup client by phone', tags: ['Clients'] },
  { id: 'clients.duplicates', method: 'get', path: '/clients/duplicates', summary: 'Find duplicate client groups', tags: ['Clients'] },
  { id: 'clients.views.list', method: 'get', path: '/clients/views', summary: 'List saved client views', tags: ['Clients'] },
  { id: 'clients.views.create', method: 'post', path: '/clients/views', body: apiSchemas.clients.savedViewBody, summary: 'Create saved client view', tags: ['Clients'] },
  { id: 'clients.views.update', method: 'put', path: '/clients/views/{viewId}', body: apiSchemas.clients.savedViewUpdateBody, params: apiSchemas.clients.viewParams, summary: 'Update saved client view', tags: ['Clients'] },
  { id: 'clients.views.delete', method: 'delete', path: '/clients/views/{viewId}', params: apiSchemas.clients.viewParams, summary: 'Delete saved client view', tags: ['Clients'] },
  { id: 'clients.create', method: 'post', path: '/clients', body: apiSchemas.clients.body, summary: 'Create client', tags: ['Clients'] },
  { id: 'clients.groupTrainingRecommendation', method: 'post', path: '/clients/training-recommendation/group', body: apiSchemas.clients.groupTrainingRecommendationBody, summary: 'Recommend group training plan for selected clients', tags: ['Clients'] },
  { id: 'clients.trainingRecommendation', method: 'get', path: '/clients/{clientId}/training-recommendation', params: apiSchemas.clients.skillMapParams, query: apiSchemas.clients.trainingRecommendationQuery, summary: 'Recommend personal training plan for one client', tags: ['Clients'] },
  { id: 'clients.skillMap.list', method: 'get', path: '/clients/{clientId}/skill-map', params: apiSchemas.clients.skillMapParams, summary: 'List client skill map', tags: ['Clients'] },
  { id: 'clients.skillMap.update', method: 'put', path: '/clients/{clientId}/skill-map/{skillId}', body: apiSchemas.clients.skillMapUpdateBody, params: apiSchemas.clients.skillMapEntryParams, summary: 'Update client skill map entry', tags: ['Clients'] },
  { id: 'clients.get', method: 'get', path: '/clients/{id}', params: apiSchemas.clients.params, summary: 'Get client', tags: ['Clients'] },
  { id: 'clients.update', method: 'put', path: '/clients/{id}', body: apiSchemas.clients.updateBody, params: apiSchemas.clients.params, summary: 'Update client', tags: ['Clients'] },
  { id: 'clients.deletePermanent', method: 'delete', path: '/clients/{id}/permanent', params: apiSchemas.clients.params, summary: 'Delete archived client permanently', tags: ['Clients'] },
  { id: 'clients.merge', method: 'post', path: '/clients/{id}/merge', body: apiSchemas.clients.mergeBody, params: apiSchemas.clients.params, summary: 'Merge duplicate clients', tags: ['Clients'] },

  { id: 'finance.report', method: 'get', path: '/finance', query: apiSchemas.finance.dateRangeQuery, summary: 'P&L report', tags: ['Finance'] },
  { id: 'finance.manualCreate', method: 'post', path: '/finance', body: apiSchemas.finance.manualBody, summary: 'Create manual finance record', tags: ['Finance'] },
  { id: 'finance.export', method: 'get', path: '/finance/export', query: apiSchemas.finance.dateRangeQuery, responseType: 'xlsx', summary: 'Export P&L report', tags: ['Finance'] },
  { id: 'finance.history', method: 'get', path: '/finance/history', query: apiSchemas.finance.historyQuery, summary: 'Finance change history', tags: ['Finance'] },
  { id: 'finance.payroll', method: 'get', path: '/finance/payroll', query: apiSchemas.finance.dateRangeQuery, summary: 'Payroll calculation', tags: ['Payroll'] },
  { id: 'finance.payrollExport', method: 'get', path: '/finance/payroll/export', query: apiSchemas.finance.dateRangeQuery, responseType: 'xlsx', summary: 'Export payroll', tags: ['Payroll'] },
  { id: 'finance.payrollPeriods', method: 'get', path: '/finance/payroll/periods', query: apiSchemas.finance.dateRangeQuery, summary: 'List payroll periods', tags: ['Payroll'] },
  { id: 'finance.payrollPeriodCreate', method: 'post', path: '/finance/payroll/periods', body: apiSchemas.finance.payrollPeriodBody, summary: 'Create payroll period', tags: ['Payroll'] },
  { id: 'finance.payrollRecalculate', method: 'post', path: '/finance/payroll/periods/{id}/recalculate', body: apiSchemas.finance.recalculateBody, params: apiSchemas.finance.withId.params, summary: 'Recalculate payroll period', tags: ['Payroll'] },
  { id: 'finance.payrollStatus', method: 'patch', path: '/finance/payroll/periods/{id}/status', body: apiSchemas.finance.payrollStatusBody, params: apiSchemas.finance.withId.params, summary: 'Change payroll period status', tags: ['Payroll'] },

  { id: 'motivation.currentSales', method: 'get', path: '/motivation/current-sales', query: apiSchemas.motivation.currentSalesQuery, summary: 'Current shift sales for motivation', tags: ['Motivation'] },
  { id: 'motivation.rules', method: 'get', path: '/motivation/rules', summary: 'List base motivation rules', tags: ['Motivation'] },
  { id: 'motivation.bonusRules', method: 'get', path: '/motivation/bonus-rules', summary: 'List bonus motivation rules', tags: ['Motivation'] },
  { id: 'motivation.categories', method: 'get', path: '/motivation/categories', summary: 'List categories available for motivation', tags: ['Motivation'] },
  { id: 'motivation.ruleUpdate', method: 'put', path: '/motivation/rules/{key}', body: apiSchemas.motivation.rule.body, params: apiSchemas.motivation.rule.params, summary: 'Update base motivation rule', tags: ['Motivation'] },
  { id: 'motivation.assignCategory', method: 'put', path: '/motivation/categories/{categoryId}/rule', body: apiSchemas.motivation.assignCategory.body, params: apiSchemas.motivation.assignCategory.params, summary: 'Assign category to bonus rule', tags: ['Motivation'] },
  { id: 'motivation.bonusRuleCreate', method: 'post', path: '/motivation/bonus-rules', body: apiSchemas.motivation.bonusRuleBody, summary: 'Create bonus motivation rule', tags: ['Motivation'] },
  { id: 'motivation.bonusRuleUpdate', method: 'put', path: '/motivation/bonus-rules/{id}', body: apiSchemas.motivation.bonusRuleBody.partial().passthrough(), params: apiSchemas.motivation.withId.params, summary: 'Update bonus motivation rule', tags: ['Motivation'] },
  { id: 'motivation.bonusRuleDelete', method: 'delete', path: '/motivation/bonus-rules/{id}', params: apiSchemas.motivation.withId.params, summary: 'Delete bonus motivation rule', tags: ['Motivation'] },

  { id: 'references.list', method: 'get', path: '/references/{type}', params: apiSchemas.references.typeParams, query: apiSchemas.references.listQuery, summary: 'List CRM reference values', tags: ['References'] },
  { id: 'references.create', method: 'post', path: '/references/{type}', body: apiSchemas.references.body, params: apiSchemas.references.typeParams, summary: 'Create CRM reference value', tags: ['References'] },
  { id: 'references.update', method: 'put', path: '/references/{type}/{id}', body: apiSchemas.references.updateBody, params: apiSchemas.references.params, summary: 'Update CRM reference value', tags: ['References'] },
  { id: 'references.archive', method: 'post', path: '/references/{type}/{id}/archive', params: apiSchemas.references.params, summary: 'Archive CRM reference value', tags: ['References'] },
  { id: 'references.restore', method: 'post', path: '/references/{type}/{id}/restore', params: apiSchemas.references.params, summary: 'Restore CRM reference value', tags: ['References'] },
  { id: 'references.deletePermanent', method: 'delete', path: '/references/{type}/{id}/permanent', params: apiSchemas.references.params, summary: 'Delete archived CRM reference value permanently', tags: ['References'] },

  { id: 'staff.list', method: 'get', path: '/staff', query: apiSchemas.staff.listQuery, summary: 'List staff', tags: ['Staff'] },
  { id: 'staff.create', method: 'post', path: '/staff', body: apiSchemas.staff.body, summary: 'Create staff member', tags: ['Staff'] },
  { id: 'staff.get', method: 'get', path: '/staff/{id}', params: apiSchemas.staff.params, summary: 'Get staff member', tags: ['Staff'] },
  { id: 'staff.update', method: 'put', path: '/staff/{id}', body: apiSchemas.staff.body, params: apiSchemas.staff.params, summary: 'Update staff member', tags: ['Staff'] },
  { id: 'staff.restore', method: 'post', path: '/staff/{id}/restore', params: apiSchemas.staff.params, summary: 'Restore staff member', tags: ['Staff'] },
  { id: 'staff.deletePermanent', method: 'delete', path: '/staff/{id}/permanent', params: apiSchemas.staff.params, summary: 'Delete archived staff member permanently', tags: ['Staff'] },
  { id: 'staff.archive', method: 'delete', path: '/staff/{id}', params: apiSchemas.staff.params, summary: 'Archive staff member', tags: ['Staff'] },

  { id: 'shifts.active', method: 'get', path: '/shifts/active', summary: 'Get active shift', tags: ['Shifts'] },
  { id: 'shifts.start', method: 'post', path: '/shifts/start', summary: 'Start active shift', tags: ['Shifts'] },
  { id: 'shifts.end', method: 'post', path: '/shifts/end', body: apiSchemas.shifts.endBody, summary: 'End active shift with cash reconciliation', tags: ['Shifts'] },
  { id: 'shiftCash.active', method: 'get', path: '/shifts/active/cash', summary: 'Get active shift cash summary', tags: ['Shift Cash'] },
  { id: 'shiftCash.getByShift', method: 'get', path: '/shifts/{shiftId}/cash', params: apiSchemas.shiftCash.shiftParams, summary: 'Review cash summary for a shift', tags: ['Shift Cash'] },
  { id: 'shiftCash.opening', method: 'put', path: '/shifts/active/cash/opening', body: apiSchemas.shiftCash.openingBody, summary: 'Record opening cash balance', tags: ['Shift Cash'] },
  { id: 'shiftCash.expenseCreate', method: 'post', path: '/shifts/active/cash/expenses', body: apiSchemas.shiftCash.expenseBody, successStatus: 201, summary: 'Create active shift cash expense', tags: ['Shift Cash'] },
  { id: 'shiftCash.expenseUpdate', method: 'put', path: '/shifts/active/cash/expenses/{expenseId}', body: apiSchemas.shiftCash.expenseBody, params: apiSchemas.shiftCash.expenseParams, summary: 'Update shift cash expense', tags: ['Shift Cash'] },
  { id: 'shiftCash.expenseCancel', method: 'post', path: '/shifts/active/cash/expenses/{expenseId}/cancel', body: apiSchemas.shiftCash.cancelBody, params: apiSchemas.shiftCash.expenseParams, summary: 'Soft-cancel shift cash expense', tags: ['Shift Cash'] },
  { id: 'shiftCash.attachmentUpload', method: 'post', path: '/shifts/active/cash/expenses/{expenseId}/attachments', body: apiSchemas.shiftCash.attachmentBody, params: apiSchemas.shiftCash.expenseParams, successStatus: 201, summary: 'Upload cash expense receipt photo', tags: ['Shift Cash'] },
  { id: 'shiftCash.attachmentRemove', method: 'delete', path: '/shifts/active/cash/expenses/{expenseId}/attachments/{attachmentId}', params: apiSchemas.shiftCash.attachmentParams, summary: 'Remove cash expense receipt photo', tags: ['Shift Cash'] },
  { id: 'shiftCash.attachment', method: 'get', path: '/shifts/cash/expenses/{expenseId}/attachments/{attachmentId}', params: apiSchemas.shiftCash.attachmentParams, responseType: 'blob', summary: 'Open cash expense receipt photo', tags: ['Shift Cash'] },
  { id: 'shifts.create', method: 'post', path: '/shifts', body: apiSchemas.shifts.body, summary: 'Create manual shift', tags: ['Shifts'] },
  { id: 'shifts.update', method: 'put', path: '/shifts', body: apiSchemas.shifts.updateBody, summary: 'Update manual shift', tags: ['Shifts'] },
  { id: 'shifts.archive', method: 'delete', path: '/shifts', body: apiSchemas.shifts.deleteBody, summary: 'Archive shift', tags: ['Shifts'] },

  { id: 'shiftReportTemplates.list', method: 'get', path: '/shift-report-templates', query: apiSchemas.shiftReports.templateListQuery, summary: 'List shift report templates', tags: ['Shift Reports'] },
  { id: 'shiftReportTemplates.create', method: 'post', path: '/shift-report-templates', body: apiSchemas.shiftReports.templateBody, successStatus: 201, summary: 'Create shift report template', tags: ['Shift Reports'] },
  { id: 'shiftReportTemplates.update', method: 'put', path: '/shift-report-templates/{id}', body: apiSchemas.shiftReports.templateUpdateBody, params: apiSchemas.shiftReports.withId.params, summary: 'Update shift report template', tags: ['Shift Reports'] },
  { id: 'shiftReportTemplates.archive', method: 'post', path: '/shift-report-templates/{id}/archive', params: apiSchemas.shiftReports.withId.params, summary: 'Archive shift report template', tags: ['Shift Reports'] },
  { id: 'shiftReportTemplates.restore', method: 'post', path: '/shift-report-templates/{id}/restore', params: apiSchemas.shiftReports.withId.params, summary: 'Restore shift report template', tags: ['Shift Reports'] },
  { id: 'shiftReportTemplateItems.create', method: 'post', path: '/shift-report-templates/{templateId}/items', body: apiSchemas.shiftReports.templateItemBody, params: apiSchemas.shiftReports.templateItemCreateParams, successStatus: 201, summary: 'Create shift report template item', tags: ['Shift Reports'] },
  { id: 'shiftReportTemplateItems.update', method: 'put', path: '/shift-report-template-items/{id}', body: apiSchemas.shiftReports.templateItemUpdateBody, params: apiSchemas.shiftReports.withId.params, summary: 'Update shift report template item', tags: ['Shift Reports'] },
  { id: 'shiftReportTemplateItems.archive', method: 'post', path: '/shift-report-template-items/{id}/archive', params: apiSchemas.shiftReports.withId.params, summary: 'Archive shift report template item', tags: ['Shift Reports'] },
  { id: 'shiftReportTemplateItems.restore', method: 'post', path: '/shift-report-template-items/{id}/restore', params: apiSchemas.shiftReports.withId.params, summary: 'Restore shift report template item', tags: ['Shift Reports'] },
  { id: 'shiftReports.activeShift', method: 'get', path: '/shifts/active/reports', summary: 'List reports for active shift', tags: ['Shift Reports'] },
  { id: 'shiftReports.list', method: 'get', path: '/shift-reports', query: apiSchemas.shiftReports.reportListQuery, summary: 'List shift reports', tags: ['Shift Reports'] },
  { id: 'shiftReports.get', method: 'get', path: '/shift-reports/{id}', params: apiSchemas.shiftReports.withId.params, summary: 'Get shift report', tags: ['Shift Reports'] },
  { id: 'shiftReports.saveDraft', method: 'put', path: '/shift-reports/{id}/draft', body: apiSchemas.shiftReports.reportSaveBody, params: apiSchemas.shiftReports.withId.params, summary: 'Save shift report draft', tags: ['Shift Reports'] },
  { id: 'shiftReports.submit', method: 'post', path: '/shift-reports/{id}/submit', body: apiSchemas.shiftReports.reportSaveBody, params: apiSchemas.shiftReports.withId.params, summary: 'Submit shift report', tags: ['Shift Reports'] },
  { id: 'shiftReports.uploadAttachment', method: 'post', path: '/shift-reports/{reportId}/answers/{answerId}/attachments', body: apiSchemas.shiftReports.attachmentBody, params: apiSchemas.shiftReports.attachmentParams, successStatus: 201, summary: 'Upload shift report photo', tags: ['Shift Reports'] },
  { id: 'shiftReports.removeAttachment', method: 'delete', path: '/shift-reports/{reportId}/answers/{answerId}/attachments/{attachmentId}', params: apiSchemas.shiftReports.attachmentDeleteParams, summary: 'Remove shift report photo', tags: ['Shift Reports'] },
  { id: 'shiftReports.attachment', method: 'get', path: '/shift-reports/{reportId}/answers/{answerId}/attachments/{attachmentId}', params: apiSchemas.shiftReports.attachmentDeleteParams, responseType: 'binary', summary: 'Get shift report photo', tags: ['Shift Reports'] },

  { id: 'trainingNotes.list', method: 'get', path: '/clients/{clientId}/training-notes', params: apiSchemas.trainingNotes.clientParams, summary: 'List training notes for client', tags: ['Training Notes'] },
  { id: 'trainingNotes.create', method: 'post', path: '/clients/{clientId}/training-notes', body: apiSchemas.trainingNotes.body, params: apiSchemas.trainingNotes.clientParams, summary: 'Create training note', tags: ['Training Notes'] },
  { id: 'trainingNotes.update', method: 'put', path: '/training-notes/{noteId}', body: apiSchemas.trainingNotes.updateBody, params: apiSchemas.trainingNotes.noteParams, summary: 'Update training note', tags: ['Training Notes'] },
  { id: 'trainingNotes.delete', method: 'delete', path: '/training-notes/{noteId}', params: apiSchemas.trainingNotes.noteParams, summary: 'Delete training note', tags: ['Training Notes'] },

  { id: 'trainingPlans.list', method: 'get', path: '/training-plans', query: apiSchemas.trainingPlans.listQuery, summary: 'List planned and completed training plans', tags: ['Training Plans'] },
  { id: 'trainingPlans.create', method: 'post', path: '/training-plans', body: apiSchemas.trainingPlans.body, successStatus: 201, summary: 'Create training plan before class', tags: ['Training Plans'] },
  { id: 'trainingPlans.get', method: 'get', path: '/training-plans/{planId}', params: apiSchemas.trainingPlans.params, summary: 'Get training plan details', tags: ['Training Plans'] },
  { id: 'trainingPlans.updateExercises', method: 'put', path: '/training-plans/{planId}/exercises', body: apiSchemas.trainingPlans.exercisesBody, params: apiSchemas.trainingPlans.params, summary: 'Replace planned training exercises', tags: ['Training Plans'] },
  { id: 'trainingPlans.complete', method: 'post', path: '/training-plans/{planId}/complete', body: apiSchemas.trainingPlans.completeBody, params: apiSchemas.trainingPlans.params, summary: 'Confirm completed training plan and write diary records', tags: ['Training Plans'] },
  { id: 'trainingPlans.quickComplete', method: 'post', path: '/training-plans/{planId}/quick-complete', body: apiSchemas.trainingPlans.quickCompleteBody, params: apiSchemas.trainingPlans.params, summary: 'Quickly complete planned training with default exercise results', tags: ['Training Plans'] },

  { id: 'methodology.analytics', method: 'get', path: '/methodology/analytics', query: apiSchemas.methodology.analyticsQuery, summary: 'Training methodology and training quality analytics', tags: ['Training Methodology'] },
  { id: 'methodology.skills.list', method: 'get', path: '/methodology/skills', query: apiSchemas.methodology.skillListQuery, summary: 'List training methodology skills', tags: ['Training Methodology'] },
  { id: 'methodology.skills.create', method: 'post', path: '/methodology/skills', body: apiSchemas.methodology.skillBody, successStatus: 201, summary: 'Create training methodology skill', tags: ['Training Methodology'] },
  { id: 'methodology.skills.update', method: 'put', path: '/methodology/skills/{id}', body: apiSchemas.methodology.skillUpdateBody, params: apiSchemas.methodology.withId.params, summary: 'Update training methodology skill', tags: ['Training Methodology'] },
  { id: 'methodology.exercises.list', method: 'get', path: '/methodology/exercises', query: apiSchemas.methodology.exerciseListQuery, summary: 'List training methodology exercises', tags: ['Training Methodology'] },
  { id: 'methodology.exercises.create', method: 'post', path: '/methodology/exercises', body: apiSchemas.methodology.exerciseBody, successStatus: 201, summary: 'Create training methodology exercise', tags: ['Training Methodology'] },
  { id: 'methodology.exercises.update', method: 'put', path: '/methodology/exercises/{id}', body: apiSchemas.methodology.exerciseUpdateBody, params: apiSchemas.methodology.withId.params, summary: 'Update training methodology exercise', tags: ['Training Methodology'] },
  { id: 'methodology.exercises.approve', method: 'post', path: '/methodology/exercises/{id}/approve', params: apiSchemas.methodology.withId.params, summary: 'Approve training methodology exercise', tags: ['Training Methodology'] },
  { id: 'methodology.exercises.archive', method: 'post', path: '/methodology/exercises/{id}/archive', params: apiSchemas.methodology.withId.params, summary: 'Archive training methodology exercise', tags: ['Training Methodology'] },
  { id: 'methodology.exercises.restore', method: 'post', path: '/methodology/exercises/{id}/restore', params: apiSchemas.methodology.withId.params, summary: 'Restore archived training methodology exercise to draft', tags: ['Training Methodology'] },

  { id: 'utilization.list', method: 'get', path: '/utilization', summary: 'List court utilization', tags: ['Utilization'] },
  { id: 'utilization.upsert', method: 'post', path: '/utilization', body: apiSchemas.utilization.body, summary: 'Upsert court utilization', tags: ['Utilization'] },

  { id: 'visitsAnalytics.get', method: 'get', path: '/analytics/visits', query: apiSchemas.visitsAnalytics.dateRangeQuery, summary: 'Visits analytics', tags: ['Reports'] },
  { id: 'visitsAnalytics.sourceQuality', method: 'get', path: '/analytics/visits/source-quality', query: apiSchemas.visitsAnalytics.sourceQualityQuery, summary: 'Visits source quality', tags: ['Reports'] },
  { id: 'visitsAnalytics.cohortsLifecycle', method: 'get', path: '/analytics/visits/cohorts-lifecycle', query: apiSchemas.visitsAnalytics.filteredDateRangeQuery, summary: 'Visits cohorts and client lifecycle', tags: ['Reports'] },
  { id: 'visitsAnalytics.revenueLtv', method: 'get', path: '/analytics/visits/revenue-ltv', query: apiSchemas.visitsAnalytics.filteredDateRangeQuery, summary: 'Attributed revenue and LTV by acquisition source and cohort', tags: ['Reports'] },
  { id: 'visitsAnalytics.clientBasePreview', method: 'post', path: '/analytics/visits/client-base-preview', body: apiSchemas.visitsAnalytics.clientBasePreviewBody, summary: 'Preview a ClientBase from visits analytics filters', tags: ['Reports', 'Client bases'] },
  { id: 'visitsAnalytics.createClientBase', method: 'post', path: '/analytics/visits/client-bases', body: apiSchemas.visitsAnalytics.clientBaseCreateBody, summary: 'Create a server-owned ClientBase from visits analytics selection', tags: ['Reports', 'Client bases'] },
  { id: 'visitsAnalytics.export', method: 'get', path: '/export/visits', query: apiSchemas.visitsAnalytics.filteredDateRangeQuery, responseType: 'xlsx', summary: 'Export visits analytics', tags: ['Reports'] },
  { id: 'visitsAnalytics.sourceQualityExport', method: 'get', path: '/export/visits/source-quality', query: apiSchemas.visitsAnalytics.sourceQualityQuery, responseType: 'xlsx', summary: 'Export visits source quality', tags: ['Reports'] },
];

const endpointContracts: EndpointContract[] = rawEndpointContracts.map((endpoint) => {
  const tenantScope = getEndpointTenantScope(endpoint.id);
  if (!tenantScope) {
    throw new Error(`Tenant scope is not declared for endpoint ${endpoint.id}`);
  }
  return Object.freeze({ ...endpoint, tenantScope });
});

function schemaToJsonSchema(schema: unknown) {
  if (!schema) return undefined;
  try {
    const jsonSchema = z.toJSONSchema(schema, { io: 'input' });
    delete jsonSchema.$schema;
    return jsonSchema;
  } catch {
    return { additionalProperties: true, type: 'object' };
  }
}

function getParamSchema(paramsSchema: unknown, name: string) {
  const jsonSchema = schemaToJsonSchema(paramsSchema);
  return jsonSchema?.properties?.[name] || { type: 'string' };
}

function getPathParamNames(path: string) {
  return Array.from(path.matchAll(/\{([^}]+)\}/g)).map((match) => match[1]);
}

function buildParameters(endpoint: EndpointContract) {
  const parameters = [];
  if (
    endpoint.tenantScope === 'membership' ||
    endpoint.tenantScope === 'organization' ||
    endpoint.tenantScope === 'club'
  ) {
    parameters.push({
      description: 'Verified organization context. Body, query and JWT tenant IDs are not authoritative.',
      in: 'header',
      name: 'X-Organization-Id',
      required: true,
      schema: { minimum: 1, type: 'integer' },
    });
  }
  if (endpoint.tenantScope === 'club') {
    parameters.push({
      description: 'Verified club context within X-Organization-Id.',
      in: 'header',
      name: 'X-Club-Id',
      required: true,
      schema: { minimum: 1, type: 'integer' },
    });
  }
  for (const name of getPathParamNames(endpoint.path)) {
    parameters.push({
      in: 'path',
      name,
      required: true,
      schema: getParamSchema(endpoint.params, name),
    });
  }

  const querySchema = schemaToJsonSchema(endpoint.query);
  const queryProperties = querySchema?.properties || {};
  const requiredQuery = new Set(querySchema?.required || []);
  for (const name of Object.keys(queryProperties)) {
    parameters.push({
      in: 'query',
      name,
      required: requiredQuery.has(name),
      schema: queryProperties[name],
    });
  }

  return parameters;
}

function buildOperation(endpoint: EndpointContract) {
  const successStatus = endpoint.successStatus || 200;
  const tenantScoped =
    endpoint.tenantScope === 'membership' ||
    endpoint.tenantScope === 'organization' ||
    endpoint.tenantScope === 'club';
  let successContent: Record<string, unknown> = {
    'application/json': {
      schema: schemaToJsonSchema(endpoint.response || responseOk),
    },
  };
  if (endpoint.responseType === 'xlsx') {
    successContent = {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: { format: 'binary', type: 'string' },
      },
    };
  }
  if (endpoint.responseType === 'binary') {
    successContent = {
      'application/octet-stream': {
        schema: { format: 'binary', type: 'string' },
      },
    };
  }
  const responses: Record<number, unknown> = {
    [successStatus]: {
      content: successContent,
      description: 'Success',
    },
    400: {
      content: {
        'application/json': {
          schema: tenantScoped
            ? {
                oneOf: [
                  schemaToJsonSchema(validationError),
                  { $ref: '#/components/schemas/ApiError' },
                ],
              }
            : schemaToJsonSchema(validationError),
        },
      },
      description: tenantScoped
        ? 'Validation or tenant context error'
        : 'Validation error',
    },
    401: {
      content: {
        'application/json': {
          schema: schemaToJsonSchema(apiError),
        },
      },
      description: 'Unauthorized',
    },
    500: {
      content: {
        'application/json': {
          schema: schemaToJsonSchema(apiError),
        },
      },
      description: 'Server error',
    },
  };
  if (tenantScoped) {
    responses[403] = {
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ApiError' },
        },
      },
      description: 'Forbidden tenant context',
    };
    responses[404] = {
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ApiError' },
        },
      },
      description: 'Tenant or resource not found',
    };
  }
  const operation: Record<string, unknown> = {
    operationId: endpoint.id,
    responses,
    security: endpoint.public ? [] : [{ bearerAuth: [] }],
    summary: endpoint.summary,
    tags: endpoint.tags,
    'x-tenant-scope': endpoint.tenantScope,
  };

  if (endpoint.description) operation.description = endpoint.description;

  const parameters = buildParameters(endpoint);
  if (parameters.length > 0) operation.parameters = parameters;

  const bodySchema = schemaToJsonSchema(endpoint.body);
  if (bodySchema) {
    operation.requestBody = {
      content: {
        'application/json': {
          schema: bodySchema,
        },
      },
      required: true,
    };
  }

  return operation;
}

function getOpenApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  const tags = Array.from(
    new Set(endpointContracts.flatMap((endpoint) => endpoint.tags)),
  )
    .sort()
    .map((name) => ({ name }));

  endpointContracts.forEach((endpoint) => {
    paths[endpoint.path] = paths[endpoint.path] || {};
    paths[endpoint.path][endpoint.method] = buildOperation(endpoint);
  });

  return {
    openapi: '3.1.0',
    info: {
      title: 'Setly API',
      version: '1.0.0',
    },
    servers: [{ url: '/api' }],
    tags,
    components: {
      schemas: {
        ApiError: schemaToJsonSchema(apiError),
      },
      securitySchemes: {
        bearerAuth: {
          bearerFormat: 'JWT',
          scheme: 'bearer',
          type: 'http',
        },
      },
    },
    paths,
  };
}

module.exports = {
  endpointContracts,
  getOpenApiDocument,
  schemaToJsonSchema,
};
