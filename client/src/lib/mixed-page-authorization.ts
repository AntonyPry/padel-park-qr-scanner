import type { ApiEndpointId, TenantScope } from '@/api/generated';
import type {
  ClientRoute,
  RouteAuthorizationStrategy,
} from '@/lib/permissions';

export type MixedPageDependencyPhase =
  | 'initial'
  | 'realtime'
  | 'section'
  | 'mutation';

export interface MixedPageDependencyGroup {
  endpoints: readonly ApiEndpointId[];
  gate: 'route' | string;
  phases: readonly MixedPageDependencyPhase[];
  scope: Extract<TenantScope, 'membership' | 'organization' | 'club'>;
  section: string;
}

export interface MixedPageAuthorizationInventory {
  dependencies: readonly MixedPageDependencyGroup[];
  sourceFile: string;
  strategy: Exclude<RouteAuthorizationStrategy, 'single'>;
}

const BASE_MIXED_PAGE_AUTHORIZATION = {
  '/admin': {
    sourceFile: 'Admin.tsx',
    strategy: 'partial',
    dependencies: [
      {
        scope: 'club',
        section: 'reception, access scanner and visits',
        phases: ['initial', 'realtime', 'mutation'],
        gate: 'route',
        endpoints: [
          'access.visits',
          'access.search',
          'access.manualVisit',
          'access.issueKey',
          'access.correctKey',
          'access.scan',
          'access.updateVisitCategory',
        ],
      },
      {
        scope: 'organization',
        section: 'reference dictionaries',
        phases: ['initial'],
        gate: 'canLoadOrganizationReferences',
        endpoints: ['references.list'],
      },
      {
        scope: 'organization',
        section: 'client registration and duplicate lookup',
        phases: ['section', 'mutation'],
        gate: 'canManageOrganizationClients',
        endpoints: ['clients.lookup', 'clients.create', 'clients.update'],
      },
    ],
  },
  '/admin/bookings': {
    sourceFile: 'BookingsPage.tsx',
    strategy: 'composite',
    dependencies: [
      {
        scope: 'club',
        section: 'schedule, resources, pricing, series and booking mutations',
        phases: ['initial', 'section', 'mutation'],
        gate: 'route',
        endpoints: [
          'bookings.schedule',
          'bookings.responsibles',
          'bookings.analytics',
          'bookings.courts',
          'bookings.courtCreate',
          'bookings.courtUpdate',
          'bookings.courtArchive',
          'bookings.settings',
          'bookings.settingsUpdate',
          'bookings.quote',
          'bookings.priceRules',
          'bookings.priceRuleCreate',
          'bookings.priceRuleUpdate',
          'bookings.priceRuleArchive',
          'bookings.blocks',
          'bookings.blockCreate',
          'bookings.blockUpdate',
          'bookings.blockArchive',
          'bookings.exceptions',
          'bookings.exceptionCreate',
          'bookings.exceptionUpdate',
          'bookings.exceptionArchive',
          'bookings.series',
          'bookings.seriesPreview',
          'bookings.seriesCreate',
          'bookings.seriesArchive',
          'bookings.create',
          'bookings.get',
          'bookings.trainingPlan.get',
          'bookings.trainingPlan.create',
          'bookings.update',
          'bookings.status',
          'bookings.history',
          'clients.get',
          'trainingPlans.quickComplete',
        ],
      },
      {
        scope: 'organization',
        section: 'client lookup and group participants',
        phases: ['section'],
        gate: 'route',
        endpoints: ['clients.list', 'clients.lookup'],
      },
    ],
  },
  '/admin/clients': {
    sourceFile: 'ClientsPage.tsx',
    strategy: 'composite',
    dependencies: [
      {
        scope: 'organization',
        section: 'client registry, references, methodology and identity mutations',
        phases: ['initial', 'realtime', 'section', 'mutation'],
        gate: 'route',
        endpoints: [
          'clients.list',
          'clients.lookup',
          'clients.duplicates',
          'clients.create',
          'clients.update',
          'clients.merge',
          'clients.deletePermanent',
          'references.list',
          'methodology.exercises.list',
          'clients.skillMap.update',
        ],
      },
      {
        scope: 'club',
        section: 'saved views and club operational client actions',
        phases: ['initial', 'realtime', 'section', 'mutation'],
        gate: 'route',
        endpoints: [
          'clients.views.list',
          'clients.views.create',
          'clients.views.update',
          'clients.views.delete',
          'clients.get',
          'clients.trainingRecommendation',
          'trainingNotes.create',
          'callTasks.createForClient',
          'subscriptions.client.redeem',
          'subscriptions.client.reverseRedemption',
          'certificates.redeem',
          'certificates.reverseRedemption',
        ],
      },
    ],
  },
  '/admin/trainer': {
    sourceFile: 'TrainerPage.tsx',
    strategy: 'composite',
    dependencies: [
      {
        scope: 'organization',
        section: 'client registry, skill map and methodology exercise library',
        phases: ['initial', 'realtime', 'section', 'mutation'],
        gate: 'route',
        endpoints: [
          'clients.list',
          'clients.skillMap.list',
          'clients.skillMap.update',
          'methodology.exercises.list',
        ],
      },
      {
        scope: 'club',
        section: 'training notes and plans',
        phases: ['initial', 'realtime', 'section', 'mutation'],
        gate: 'route',
        endpoints: [
          'trainingNotes.list',
          'clients.trainingRecommendation',
          'clients.groupTrainingRecommendation',
          'trainingNotes.create',
          'trainingNotes.update',
          'trainingNotes.delete',
          'clients.get',
          'trainingPlans.list',
          'trainingPlans.create',
          'trainingPlans.updateExercises',
          'trainingPlans.complete',
          'trainingPlans.quickComplete',
        ],
      },
    ],
  },
  '/admin/motivation': {
    sourceFile: 'AdminMotivationPage.tsx',
    strategy: 'composite',
    dependencies: [
      {
        scope: 'club',
        section: 'current shift, current sales and active shift reports',
        phases: ['initial', 'realtime', 'mutation'],
        gate: 'route',
        endpoints: [
          'motivation.currentSales',
          'shifts.active',
          'shifts.start',
          'shifts.end',
          'shiftReports.activeShift',
        ],
      },
      {
        scope: 'organization',
        section: 'motivation rules, bonus rules and categories',
        phases: ['initial', 'realtime', 'mutation'],
        gate: 'route',
        endpoints: [
          'motivation.rules',
          'motivation.bonusRules',
          'motivation.categories',
          'motivation.ruleUpdate',
          'motivation.assignCategory',
          'motivation.bonusRuleCreate',
          'motivation.bonusRuleUpdate',
          'motivation.bonusRuleDelete',
        ],
      },
    ],
  },
  '/admin/catalog': {
    sourceFile: 'CatalogPage.tsx',
    strategy: 'composite',
    dependencies: [
      {
        scope: 'organization',
        section: 'P&L categories, motivation rules, subscription types and client lookup',
        phases: ['initial', 'realtime', 'section', 'mutation'],
        gate: 'route',
        endpoints: [
          'catalog.categories.list',
          'catalog.categories.create',
          'catalog.categories.update',
          'catalog.categories.restore',
          'catalog.categories.deletePermanent',
          'catalog.categories.archive',
          'motivation.bonusRules',
          'motivation.assignCategory',
          'subscriptions.types.list',
          'subscriptions.types.create',
          'subscriptions.types.update',
          'subscriptions.types.archive',
          'subscriptions.types.restore',
          'subscriptions.types.deletePermanent',
          'clients.list',
        ],
      },
      {
        scope: 'club',
        section: 'catalog mapping rules, sale settings and pending sales',
        phases: ['initial', 'realtime', 'section', 'mutation'],
        gate: 'route',
        endpoints: [
          'catalog.unmapped',
          'catalog.rules.list',
          'catalog.rules.create',
          'catalog.rules.restore',
          'catalog.rules.deletePermanent',
          'catalog.rules.archive',
          'catalog.saleSettings.list',
          'catalog.saleSettings.save',
          'catalog.pendingSales.list',
          'catalog.pendingSales.link',
          'catalog.pendingSales.ignore',
          'catalog.pendingSales.cancel',
        ],
      },
    ],
  },
  '/admin/shift-reports': {
    sourceFile: 'ShiftReportsPage.tsx',
    strategy: 'composite',
    dependencies: [
      {
        scope: 'club',
        section: 'shift reports and answers',
        phases: ['initial', 'realtime', 'section', 'mutation'],
        gate: 'route',
        endpoints: [
          'shiftReports.list',
          'shiftReports.get',
          'shiftReports.saveDraft',
          'shiftReports.submit',
          'shiftReports.uploadAttachment',
          'shiftReports.removeAttachment',
          'shiftReports.attachment',
        ],
      },
      {
        scope: 'organization',
        section: 'shift report templates and template items',
        phases: ['initial', 'realtime', 'section', 'mutation'],
        gate: 'route',
        endpoints: [
          'shiftReportTemplates.list',
          'shiftReportTemplates.create',
          'shiftReportTemplates.update',
          'shiftReportTemplates.archive',
          'shiftReportTemplates.restore',
          'shiftReportTemplateItems.create',
          'shiftReportTemplateItems.update',
          'shiftReportTemplateItems.archive',
          'shiftReportTemplateItems.restore',
        ],
      },
    ],
  },
  '/admin/finances': {
    sourceFile: 'FinancePage.tsx',
    strategy: 'composite',
    dependencies: [
      {
        scope: 'club',
        section: 'finance report, history, export and manual records',
        phases: ['initial', 'realtime', 'mutation'],
        gate: 'route',
        endpoints: [
          'finance.report',
          'finance.history',
          'finance.manualCreate',
          'finance.export',
        ],
      },
      {
        scope: 'organization',
        section: 'P&L category dictionary',
        phases: ['initial', 'realtime'],
        gate: 'route',
        endpoints: ['catalog.categories.list'],
      },
    ],
  },
  '/admin/call-tasks': {
    sourceFile: 'CallTasksPage.tsx',
    strategy: 'partial',
    dependencies: [
      {
        scope: 'club',
        section: 'call task list, report, client queue and mutations',
        phases: ['initial', 'realtime', 'section', 'mutation'],
        gate: 'route',
        endpoints: [
          'callTasks.list',
          'callTasks.report',
          'callTasks.get',
          'callTasks.update',
          'callTasks.deletePermanent',
          'callTasks.sync',
          'callTasks.clients',
          'callTasks.clientsBulk',
          'callTasks.addAttempt',
        ],
      },
      {
        scope: 'organization',
        section: 'responsible account options',
        phases: ['initial', 'realtime', 'section'],
        gate: 'canLoadAccountOptions',
        endpoints: ['accounts.list'],
      },
    ],
  },
  '/admin/client-bases': {
    sourceFile: 'ClientBasesPage.tsx',
    strategy: 'partial',
    dependencies: [
      {
        scope: 'club',
        section: 'client bases, previews and call task mutations',
        phases: ['initial', 'realtime', 'section', 'mutation'],
        gate: 'route',
        endpoints: [
          'clientBases.list',
          'clientBases.clients',
          'clientBases.create',
          'clientBases.update',
          'clientBases.archive',
          'clientBases.restore',
          'clientBases.deletePermanent',
          'callTasks.createFromBase',
          'callTasks.runRecurring',
        ],
      },
      {
        scope: 'organization',
        section: 'reference filter options',
        phases: ['initial', 'realtime', 'section'],
        gate: 'canLoadOrganizationReferences',
        endpoints: ['references.list'],
      },
      {
        scope: 'organization',
        section: 'responsible account options',
        phases: ['initial', 'realtime', 'section'],
        gate: 'canLoadAccountOptions',
        endpoints: ['accounts.list'],
      },
    ],
  },
  '/admin/corporate-clients': {
    sourceFile: 'CorporateClientsPage.tsx',
    strategy: 'partial',
    dependencies: [
      {
        scope: 'organization',
        section: 'corporate registry and P&L category dictionary',
        phases: ['initial', 'realtime', 'mutation'],
        gate: 'route',
        endpoints: [
          'corporateClients.list',
          'corporateClients.get',
          'corporateClients.create',
          'corporateClients.update',
          'corporateClients.archive',
          'corporateClients.restore',
          'catalog.categories.list',
        ],
      },
      {
        scope: 'club',
        section: 'corporate ledger, export and balance mutations',
        phases: ['realtime', 'section', 'mutation'],
        gate: 'canViewClubLedger/canManageClubLedger',
        endpoints: [
          'corporateClients.ledger',
          'corporateClients.ledgerExport',
          'corporateClients.deposit',
          'corporateClients.depositCancel',
          'corporateClients.spending',
          'corporateClients.spendingReverse',
        ],
      },
    ],
  },
  '/admin/staff': {
    sourceFile: 'StaffPage.tsx',
    strategy: 'partial',
    dependencies: [
      {
        scope: 'organization',
        section: 'staff registry and payroll',
        phases: ['initial', 'realtime', 'mutation'],
        gate: 'route',
        endpoints: [
          'staff.list',
          'staff.create',
          'staff.update',
          'staff.restore',
          'staff.archive',
          'staff.deletePermanent',
          'finance.payroll',
          'finance.payrollExport',
          'finance.payrollPeriods',
          'finance.payrollPeriodCreate',
          'finance.payrollRecalculate',
          'finance.payrollStatus',
        ],
      },
      {
        scope: 'club',
        section: 'manual shift mutations',
        phases: ['mutation'],
        gate: 'canEditShifts',
        endpoints: ['shifts.create', 'shifts.update', 'shifts.archive'],
      },
    ],
  },
  '/admin/onboarding': {
    sourceFile: 'OnboardingPage.tsx',
    strategy: 'partial',
    dependencies: [
      {
        scope: 'membership',
        section: 'onboarding overview, tasks and progress mutations',
        phases: ['initial', 'section', 'mutation'],
        gate: 'route',
        endpoints: [
          'onboarding.overview',
          'onboarding.taskDetail',
          'onboarding.completeTask',
          'onboarding.lessonRead',
          'onboarding.practiceStart',
          'onboarding.practiceStep',
          'onboarding.quizAttempt',
          'onboarding.resetProgress',
        ],
      },
      {
        scope: 'organization',
        section: 'owner metrics',
        phases: ['section'],
        gate: "organizationRole === 'owner'",
        endpoints: ['onboarding.metrics'],
      },
      {
        scope: 'club',
        section: 'owner training data and cleanup',
        phases: ['section', 'mutation'],
        gate: "clubRole === 'owner'",
        endpoints: [
          'onboarding.trainingData',
          'onboarding.trainingDataCleanup',
        ],
      },
    ],
  },
  '/admin/telephony': {
    sourceFile: 'TelephonyPage.tsx',
    strategy: 'partial',
    dependencies: [
      {
        scope: 'club',
        section: 'telephony report, calls, processing and integration settings',
        phases: ['initial', 'realtime', 'section', 'mutation'],
        gate: 'route',
        endpoints: [
          'telephony.stats',
          'telephony.report',
          'telephony.calls',
          'telephony.getCall',
          'telephony.startCall',
          'telephony.linkClient',
          'telephony.createClient',
          'telephony.completeCall',
          'telephony.ignoreCall',
          'telephony.recordingReference',
          'telephony.createTranscriptionJob',
          'telephony.queueMissingTranscriptionJobs',
          'telephony.retryTranscriptionJob',
          'telephony.syncStatistics',
          'telephony.syncRecordings',
          'telephony.subscribe',
          'telephony.checkSubscription',
          'telephony.config',
          'telephony.rawEvents',
          'telephony.reprocessRawEvent',
        ],
      },
      {
        scope: 'organization',
        section: 'client search in call processing dialog',
        phases: ['section'],
        gate: 'canSearchOrganizationClients',
        endpoints: ['clients.list'],
      },
      {
        scope: 'organization',
        section: 'client source options in call processing dialog',
        phases: ['section'],
        gate: 'canLoadOrganizationReferences',
        endpoints: ['references.list'],
      },
    ],
  },
} as const satisfies Partial<
  Record<ClientRoute, MixedPageAuthorizationInventory>
>;

export const MIXED_PAGE_AUTHORIZATION = {
  ...BASE_MIXED_PAGE_AUTHORIZATION,
  '/admin/shift/motivation':
    BASE_MIXED_PAGE_AUTHORIZATION['/admin/motivation'],
  '/admin/shift/reports':
    BASE_MIXED_PAGE_AUTHORIZATION['/admin/shift-reports'],
} as const satisfies Partial<
  Record<ClientRoute, MixedPageAuthorizationInventory>
>;
