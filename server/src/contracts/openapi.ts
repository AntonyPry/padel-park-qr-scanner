const { z } = require('zod');
const { apiSchemas } = require('./api-schemas');

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
  responseType?: 'json' | 'xlsx';
  summary: string;
  tags: string[];
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

const endpointContracts: EndpointContract[] = [
  { id: 'system.health', method: 'get', path: '/health', public: true, summary: 'Service health check', tags: ['System'] },
  { id: 'system.openapi', method: 'get', path: '/openapi.json', public: true, summary: 'OpenAPI document', tags: ['System'] },

  { id: 'auth.status', method: 'get', path: '/auth/status', public: true, summary: 'Setup status', tags: ['Auth'] },
  { ...apiSchemas.auth.bootstrap, id: 'auth.bootstrap', method: 'post', path: '/auth/bootstrap', public: true, summary: 'Bootstrap owner account', tags: ['Auth'] },
  { ...apiSchemas.auth.login, id: 'auth.login', method: 'post', path: '/auth/login', public: true, summary: 'Login', tags: ['Auth'] },
  { id: 'auth.me', method: 'get', path: '/auth/me', summary: 'Current account', tags: ['Auth'] },

  { id: 'access.search', method: 'get', path: '/search', query: apiSchemas.access.searchQuery, summary: 'Search clients for access monitor', tags: ['Access'] },
  { ...apiSchemas.access.manualVisit, id: 'access.manualVisit', method: 'post', path: '/manual-visit', summary: 'Create manual visit', tags: ['Access'] },
  { ...apiSchemas.access.issueKey, id: 'access.issueKey', method: 'post', path: '/key', summary: 'Issue key for visit', tags: ['Access'] },
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

  { id: 'audit.list', method: 'get', path: '/audit-logs', query: apiSchemas.audit.listQuery, summary: 'List audit logs', tags: ['Audit'] },

  { id: 'bookings.schedule', method: 'get', path: '/bookings/schedule', query: apiSchemas.bookings.scheduleQuery, summary: 'Booking schedule by day', tags: ['Bookings'] },
  { id: 'bookings.courts', method: 'get', path: '/bookings/courts', summary: 'List active courts', tags: ['Bookings'] },
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
  { id: 'bookings.update', method: 'put', path: '/bookings/{id}', body: apiSchemas.bookings.updateBody, params: apiSchemas.bookings.params, summary: 'Update court booking', tags: ['Bookings'] },
  { id: 'bookings.status', method: 'patch', path: '/bookings/{id}/status', body: apiSchemas.bookings.statusBody, params: apiSchemas.bookings.params, summary: 'Change court booking status', tags: ['Bookings'] },
  { id: 'bookings.history', method: 'get', path: '/bookings/{id}/history', params: apiSchemas.bookings.params, summary: 'List booking change history', tags: ['Bookings'] },

  { id: 'catalog.categories.list', method: 'get', path: '/catalog/categories', query: apiSchemas.catalog.listQuery, summary: 'List catalog categories', tags: ['Catalog'] },
  { id: 'catalog.categories.create', method: 'post', path: '/catalog/categories', body: apiSchemas.catalog.categoryBody, summary: 'Create catalog category', tags: ['Catalog'] },
  { id: 'catalog.categories.update', method: 'put', path: '/catalog/categories/{id}', body: apiSchemas.catalog.categoryUpdateBody, params: apiSchemas.catalog.withId.params, summary: 'Update catalog category', tags: ['Catalog'] },
  { id: 'catalog.categories.restore', method: 'post', path: '/catalog/categories/{id}/restore', params: apiSchemas.catalog.withId.params, summary: 'Restore catalog category', tags: ['Catalog'] },
  { id: 'catalog.categories.deletePermanent', method: 'delete', path: '/catalog/categories/{id}/permanent', params: apiSchemas.catalog.withId.params, summary: 'Delete archived catalog category permanently', tags: ['Catalog'] },
  { id: 'catalog.categories.archive', method: 'delete', path: '/catalog/categories/{id}', params: apiSchemas.catalog.withId.params, summary: 'Archive catalog category', tags: ['Catalog'] },
  { id: 'catalog.unmapped', method: 'get', path: '/catalog/unmapped', summary: 'List unmapped receipt items', tags: ['Catalog'] },
  { id: 'catalog.rules.list', method: 'get', path: '/catalog/rules', query: apiSchemas.catalog.listQuery, summary: 'List catalog mapping rules', tags: ['Catalog'] },
  { id: 'catalog.rules.create', method: 'post', path: '/catalog/rules', body: apiSchemas.catalog.ruleBody, summary: 'Create catalog mapping rule', tags: ['Catalog'] },
  { id: 'catalog.rules.restore', method: 'post', path: '/catalog/rules/{id}/restore', params: apiSchemas.catalog.withId.params, summary: 'Restore catalog mapping rule', tags: ['Catalog'] },
  { id: 'catalog.rules.deletePermanent', method: 'delete', path: '/catalog/rules/{id}/permanent', params: apiSchemas.catalog.withId.params, summary: 'Delete archived catalog mapping rule permanently', tags: ['Catalog'] },
  { id: 'catalog.rules.archive', method: 'delete', path: '/catalog/rules/{id}', params: apiSchemas.catalog.withId.params, summary: 'Archive catalog mapping rule', tags: ['Catalog'] },

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

  { id: 'clients.list', method: 'get', path: '/clients', query: apiSchemas.clients.listQuery, summary: 'List clients', tags: ['Clients'] },
  { id: 'clients.lookup', method: 'get', path: '/clients/lookup', query: apiSchemas.clients.lookupQuery, summary: 'Lookup client by phone', tags: ['Clients'] },
  { id: 'clients.duplicates', method: 'get', path: '/clients/duplicates', summary: 'Find duplicate client groups', tags: ['Clients'] },
  { id: 'clients.views.list', method: 'get', path: '/clients/views', summary: 'List saved client views', tags: ['Clients'] },
  { id: 'clients.views.create', method: 'post', path: '/clients/views', body: apiSchemas.clients.savedViewBody, summary: 'Create saved client view', tags: ['Clients'] },
  { id: 'clients.views.update', method: 'put', path: '/clients/views/{viewId}', body: apiSchemas.clients.savedViewUpdateBody, params: apiSchemas.clients.viewParams, summary: 'Update saved client view', tags: ['Clients'] },
  { id: 'clients.views.delete', method: 'delete', path: '/clients/views/{viewId}', params: apiSchemas.clients.viewParams, summary: 'Delete saved client view', tags: ['Clients'] },
  { id: 'clients.create', method: 'post', path: '/clients', body: apiSchemas.clients.body, summary: 'Create client', tags: ['Clients'] },
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
  { id: 'staff.update', method: 'put', path: '/staff/{id}', body: apiSchemas.staff.body, params: apiSchemas.staff.params, summary: 'Update staff member', tags: ['Staff'] },
  { id: 'staff.restore', method: 'post', path: '/staff/{id}/restore', params: apiSchemas.staff.params, summary: 'Restore staff member', tags: ['Staff'] },
  { id: 'staff.deletePermanent', method: 'delete', path: '/staff/{id}/permanent', params: apiSchemas.staff.params, summary: 'Delete archived staff member permanently', tags: ['Staff'] },
  { id: 'staff.archive', method: 'delete', path: '/staff/{id}', params: apiSchemas.staff.params, summary: 'Archive staff member', tags: ['Staff'] },

  { id: 'shifts.active', method: 'get', path: '/shifts/active', summary: 'Get active shift', tags: ['Shifts'] },
  { id: 'shifts.start', method: 'post', path: '/shifts/start', summary: 'Start active shift', tags: ['Shifts'] },
  { id: 'shifts.end', method: 'post', path: '/shifts/end', summary: 'End active shift', tags: ['Shifts'] },
  { id: 'shifts.create', method: 'post', path: '/shifts', body: apiSchemas.shifts.body, summary: 'Create manual shift', tags: ['Shifts'] },
  { id: 'shifts.update', method: 'put', path: '/shifts', body: apiSchemas.shifts.updateBody, summary: 'Update manual shift', tags: ['Shifts'] },
  { id: 'shifts.archive', method: 'delete', path: '/shifts', body: apiSchemas.shifts.deleteBody, summary: 'Archive shift', tags: ['Shifts'] },

  { id: 'trainingNotes.list', method: 'get', path: '/clients/{clientId}/training-notes', params: apiSchemas.trainingNotes.clientParams, summary: 'List training notes for client', tags: ['Training Notes'] },
  { id: 'trainingNotes.create', method: 'post', path: '/clients/{clientId}/training-notes', body: apiSchemas.trainingNotes.body, params: apiSchemas.trainingNotes.clientParams, summary: 'Create training note', tags: ['Training Notes'] },
  { id: 'trainingNotes.update', method: 'put', path: '/training-notes/{noteId}', body: apiSchemas.trainingNotes.updateBody, params: apiSchemas.trainingNotes.noteParams, summary: 'Update training note', tags: ['Training Notes'] },
  { id: 'trainingNotes.delete', method: 'delete', path: '/training-notes/{noteId}', params: apiSchemas.trainingNotes.noteParams, summary: 'Delete training note', tags: ['Training Notes'] },

  { id: 'utilization.list', method: 'get', path: '/utilization', summary: 'List court utilization', tags: ['Utilization'] },
  { id: 'utilization.upsert', method: 'post', path: '/utilization', body: apiSchemas.utilization.body, summary: 'Upsert court utilization', tags: ['Utilization'] },

  { id: 'visitsAnalytics.get', method: 'get', path: '/analytics/visits', query: apiSchemas.visitsAnalytics.dateRangeQuery, summary: 'Visits analytics', tags: ['Reports'] },
  { id: 'visitsAnalytics.export', method: 'get', path: '/export/visits', query: apiSchemas.visitsAnalytics.dateRangeQuery, responseType: 'xlsx', summary: 'Export visits analytics', tags: ['Reports'] },
];

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
  const successContent =
    endpoint.responseType === 'xlsx'
      ? {
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
            schema: { format: 'binary', type: 'string' },
          },
        }
      : {
          'application/json': {
            schema: schemaToJsonSchema(responseOk),
          },
        };
  const operation: Record<string, unknown> = {
    operationId: endpoint.id,
    responses: {
      200: {
        content: successContent,
        description: 'Success',
      },
      400: {
        content: {
          'application/json': {
            schema: schemaToJsonSchema(validationError),
          },
        },
        description: 'Validation error',
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
    },
    security: endpoint.public ? [] : [{ bearerAuth: [] }],
    summary: endpoint.summary,
    tags: endpoint.tags,
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
      title: 'Padel Park CRM API',
      version: '1.0.0',
    },
    servers: [{ url: '/api' }],
    tags,
    components: {
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
