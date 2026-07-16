const DEFAULT_DOMAIN_HINTS = {
  access: {
    queryGroups: ['access', 'clients', 'visitsAnalytics'],
    routes: ['/admin', '/admin/clients', '/admin/visits-analytics'],
  },
  accounts: {
    queryGroups: ['accounts', 'staff'],
    routes: ['/admin/users'],
  },
  bookings: {
    queryGroups: ['bookings', 'clients', 'trainingPlans', 'managerControl', 'visitsAnalytics'],
    routes: ['/admin/bookings', '/admin/clients', '/admin/manager-control', '/admin/visits-analytics'],
  },
  booking_resources: {
    queryGroups: ['bookings'],
    routes: ['/admin/bookings'],
  },
  call_tasks: {
    queryGroups: ['callTasks', 'clientBases', 'clients', 'managerControl'],
    routes: [
      '/admin/call-tasks',
      '/admin/client-bases',
      '/admin/clients',
      '/admin/manager-control',
    ],
  },
  catalog: {
    queryGroups: ['catalog', 'finance', 'prepayments', 'motivation'],
    routes: [
      '/admin/catalog',
      '/admin/finances',
      '/admin/prepayments',
      '/admin/shift-settings',
    ],
  },
  certificates: {
    queryGroups: ['certificates', 'clients', 'bookings', 'prepayments', 'visitsAnalytics'],
    routes: [
      '/admin/certificates',
      '/admin/clients',
      '/admin/bookings',
      '/admin/prepayments',
      '/admin/visits-analytics',
    ],
  },
  client_bases: {
    queryGroups: ['clientBases', 'callTasks'],
    routes: ['/admin/client-bases', '/admin/call-tasks'],
  },
  client_subscriptions: {
    queryGroups: ['clientSubscriptions', 'clients', 'bookings', 'prepayments', 'visitsAnalytics'],
    routes: [
      '/admin/clients',
      '/admin/bookings',
      '/admin/prepayments',
      '/admin/catalog',
      '/admin/visits-analytics',
    ],
  },
  clients: {
    queryGroups: ['clients', 'callTasks', 'clientBases', 'bookings', 'visitsAnalytics'],
    routes: [
      '/admin/clients',
      '/admin/client-bases',
      '/admin/call-tasks',
      '/admin/bookings',
      '/admin/visits-analytics',
    ],
  },
  corporate_clients: {
    queryGroups: ['corporateClients', 'finance', 'prepayments', 'visitsAnalytics'],
    routes: ['/admin/corporate-clients', '/admin/finances', '/admin/prepayments', '/admin/visits-analytics'],
  },
  finance: {
    queryGroups: ['finance', 'catalog', 'prepayments', 'managerControl', 'visitsAnalytics'],
    routes: ['/admin/finances', '/admin/catalog', '/admin/prepayments', '/admin/visits-analytics'],
  },
  manager_control: {
    queryGroups: ['managerControl'],
    routes: ['/admin/manager-control'],
  },
  methodology: {
    queryGroups: ['methodology', 'methodologyAnalytics', 'trainingPlans'],
    routes: [
      '/admin/methodology',
      '/admin/methodology-analytics',
      '/admin/trainer',
    ],
  },
  methodology_analytics: {
    queryGroups: ['methodologyAnalytics'],
    routes: ['/admin/methodology-analytics'],
  },
  motivation: {
    queryGroups: ['motivation', 'finance', 'catalog'],
    routes: [
      '/admin/shift/motivation',
      '/admin/shift-settings',
      '/admin/finances',
      '/admin/catalog',
    ],
  },
  onboarding: {
    queryGroups: ['onboarding'],
    routes: ['/admin/onboarding'],
  },
  payroll: {
    queryGroups: ['payroll', 'finance', 'staff'],
    routes: ['/admin/staff', '/admin/finances'],
  },
  prepayment_sales: {
    queryGroups: ['prepayments', 'catalog', 'clients', 'bookings', 'visitsAnalytics'],
    routes: ['/admin/prepayments', '/admin/catalog', '/admin/clients', '/admin/visits-analytics'],
  },
  prepayment_settings: {
    queryGroups: ['prepayments', 'catalog'],
    routes: ['/admin/catalog', '/admin/prepayments'],
  },
  prepayments: {
    queryGroups: ['prepayments'],
    routes: ['/admin/prepayments'],
  },
  references: {
    queryGroups: ['references', 'clients', 'access', 'visitsAnalytics'],
    routes: ['/admin/references', '/admin/clients', '/admin', '/admin/visits-analytics'],
  },
  reports: {
    queryGroups: ['reports'],
    routes: ['/admin/visits-analytics', '/admin/utilization'],
  },
  shifts: {
    queryGroups: ['shifts', 'shiftCash', 'shiftReports', 'payroll', 'staff', 'motivation', 'finance'],
    routes: [
      '/admin/staff',
      '/admin/shift/motivation',
      '/admin/finances',
      '/admin/shift/reports',
      '/admin/shift/cash',
      '/admin/shift-settings',
    ],
  },
  staff: {
    queryGroups: ['staff', 'payroll', 'accounts'],
    routes: ['/admin/staff', '/admin/users'],
  },
  subscription_types: {
    queryGroups: ['subscriptionTypes', 'catalog', 'prepayments'],
    routes: ['/admin/catalog', '/admin/prepayments'],
  },
  telephony: {
    queryGroups: ['telephony', 'clients', 'callTasks'],
    routes: ['/admin/telephony', '/admin/clients', '/admin/call-tasks'],
  },
  training_notes: {
    queryGroups: ['clients', 'trainingNotes', 'methodologyAnalytics'],
    routes: ['/admin/trainer', '/admin/clients', '/admin/methodology-analytics'],
  },
  training_plans: {
    queryGroups: ['trainingPlans', 'bookings', 'clients', 'methodologyAnalytics'],
    routes: ['/admin/trainer', '/admin/bookings', '/admin/clients'],
  },
  utilization: {
    queryGroups: ['utilization'],
    routes: ['/admin/utilization'],
  },
  visits_analytics: {
    queryGroups: ['visitsAnalytics', 'access'],
    routes: ['/admin/visits-analytics', '/admin'],
  },
};

const ROUTE_RULES = [
  { pattern: /^\/webhooks\/evotor$/, domain: 'finance', entity: 'receipt', action: 'imported', source: 'webhook' },
  { pattern: /^\/manual-visit$/, domain: 'access', entity: 'visit', action: 'created' },
  { pattern: /^\/scan$/, domain: 'access', entity: 'visit', action: 'created' },
  { pattern: /^\/key$/, domain: 'access', entity: 'visit_key', action: 'updated' },
  { pattern: /^\/register$/, domain: 'clients', entity: 'client', action: 'created' },
  { pattern: /^\/visit\/category$/, domain: 'access', entity: 'visit_category', action: 'updated' },
  { pattern: /^\/scanner-events$/, domain: 'access', entity: 'scanner_event', action: 'created' },
  { pattern: /^\/clients\/views(?:\/(?<viewId>\d+))?$/, domain: 'clients', entity: 'client_saved_view' },
  { pattern: /^\/clients\/duplicates$/, domain: 'clients', entity: 'client_duplicate_group', action: 'recalculated' },
  { pattern: /^\/clients\/training-recommendation\/group$/, domain: 'training_notes', entity: 'training_recommendation', action: 'recalculated' },
  { pattern: /^\/clients\/(?<clientId>\d+)\/training-notes$/, domain: 'training_notes', entity: 'training_note' },
  { pattern: /^\/clients\/(?<clientId>\d+)\/skill-map\/(?<skillId>\d+)$/, domain: 'training_notes', entity: 'client_skill', action: 'updated' },
  { pattern: /^\/clients\/(?<id>\d+)\/merge$/, domain: 'clients', entity: 'client', action: 'merged' },
  { pattern: /^\/clients\/(?<id>\d+)\/permanent$/, domain: 'clients', entity: 'client', action: 'deleted' },
  { pattern: /^\/clients(?:\/(?<id>\d+))?$/, domain: 'clients', entity: 'client' },
  { pattern: /^\/client-bases\/(?<baseId>\d+)\/call-tasks$/, domain: 'call_tasks', entity: 'call_task', action: 'created' },
  { pattern: /^\/client-bases\/(?<id>\d+)\/permanent$/, domain: 'client_bases', entity: 'client_base', action: 'deleted' },
  { pattern: /^\/client-bases\/(?<id>\d+)\/restore$/, domain: 'client_bases', entity: 'client_base', action: 'restored' },
  { pattern: /^\/client-bases(?:\/(?<id>\d+))?$/, domain: 'client_bases', entity: 'client_base' },
  { pattern: /^\/call-tasks\/recurring\/run$/, domain: 'call_tasks', entity: 'call_task', action: 'synced' },
  { pattern: /^\/call-tasks\/(?<id>\d+)\/sync$/, domain: 'call_tasks', entity: 'call_task', action: 'synced' },
  { pattern: /^\/call-tasks\/(?<id>\d+)\/clients\/bulk$/, domain: 'call_tasks', entity: 'call_task_client', action: 'updated' },
  { pattern: /^\/call-tasks\/(?<id>\d+)\/permanent$/, domain: 'call_tasks', entity: 'call_task', action: 'deleted' },
  { pattern: /^\/call-tasks(?:\/(?<id>\d+))?$/, domain: 'call_tasks', entity: 'call_task' },
  { pattern: /^\/call-task-clients\/(?<taskClientId>\d+)\/attempts$/, domain: 'call_tasks', entity: 'call_task_attempt', action: 'created' },
  { pattern: /^\/bookings\/courts(?:\/(?<id>\d+))?$/, domain: 'booking_resources', entity: 'court' },
  { pattern: /^\/bookings\/settings$/, domain: 'bookings', entity: 'booking_settings', action: 'updated' },
  { pattern: /^\/bookings\/price-rules(?:\/(?<id>\d+))?$/, domain: 'bookings', entity: 'booking_price_rule' },
  { pattern: /^\/bookings\/blocks(?:\/(?<id>\d+))?$/, domain: 'bookings', entity: 'court_block' },
  { pattern: /^\/bookings\/exceptions(?:\/(?<id>\d+))?$/, domain: 'bookings', entity: 'booking_schedule_exception' },
  { pattern: /^\/bookings\/series\/preview$/, domain: 'bookings', entity: 'booking_series_preview', action: 'recalculated' },
  { pattern: /^\/bookings\/series\/(?<id>\d+)\/archive$/, domain: 'bookings', entity: 'booking_series', action: 'archived' },
  { pattern: /^\/bookings\/series$/, domain: 'bookings', entity: 'booking_series', action: 'created' },
  { pattern: /^\/bookings\/(?<id>\d+)\/training-plan$/, domain: 'training_plans', entity: 'training_plan', action: 'created' },
  { pattern: /^\/bookings\/(?<id>\d+)\/status$/, domain: 'bookings', entity: 'booking', action: 'updated' },
  { pattern: /^\/bookings(?:\/(?<id>\d+))?$/, domain: 'bookings', entity: 'booking' },
  { pattern: /^\/finance\/payroll\/periods\/(?<id>\d+)\/recalculate$/, domain: 'payroll', entity: 'payroll_period', action: 'recalculated' },
  { pattern: /^\/finance\/payroll\/periods\/(?<id>\d+)\/status$/, domain: 'payroll', entity: 'payroll_period', action: 'updated' },
  { pattern: /^\/finance\/payroll\/periods$/, domain: 'payroll', entity: 'payroll_period', action: 'created' },
  { pattern: /^\/finance$/, domain: 'finance', entity: 'finance_record' },
  { pattern: /^\/catalog\/categories\/(?<id>\d+)\/restore$/, domain: 'catalog', entity: 'catalog_category', action: 'restored' },
  { pattern: /^\/catalog\/categories\/(?<id>\d+)\/permanent$/, domain: 'catalog', entity: 'catalog_category', action: 'deleted' },
  { pattern: /^\/catalog\/categories(?:\/(?<id>\d+))?$/, domain: 'catalog', entity: 'catalog_category' },
  { pattern: /^\/catalog\/sale-settings$/, domain: 'prepayment_settings', entity: 'evotor_sale_setting' },
  { pattern: /^\/catalog\/pending-sales\/(?<id>\d+)\/link$/, domain: 'prepayment_sales', entity: 'pending_sale', action: 'synced' },
  { pattern: /^\/catalog\/pending-sales\/(?<id>\d+)\/(?:ignore|cancel)$/, domain: 'prepayment_sales', entity: 'pending_sale', action: 'updated' },
  { pattern: /^\/catalog\/rules\/(?<id>\d+)\/restore$/, domain: 'catalog', entity: 'catalog_rule', action: 'restored' },
  { pattern: /^\/catalog\/rules\/(?<id>\d+)\/permanent$/, domain: 'catalog', entity: 'catalog_rule', action: 'deleted' },
  { pattern: /^\/catalog\/rules(?:\/(?<id>\d+))?$/, domain: 'catalog', entity: 'catalog_rule' },
  { pattern: /^\/subscriptions\/types\/(?<id>\d+)\/archive$/, domain: 'subscription_types', entity: 'subscription_type', action: 'archived' },
  { pattern: /^\/subscriptions\/types\/(?<id>\d+)\/restore$/, domain: 'subscription_types', entity: 'subscription_type', action: 'restored' },
  { pattern: /^\/subscriptions\/types\/(?<id>\d+)\/permanent$/, domain: 'subscription_types', entity: 'subscription_type', action: 'deleted' },
  { pattern: /^\/subscriptions\/types(?:\/(?<id>\d+))?$/, domain: 'subscription_types', entity: 'subscription_type' },
  { pattern: /^\/client-subscriptions\/(?<id>\d+)\/redemptions(?:\/(?<redemptionId>\d+)\/reverse)?$/, domain: 'client_subscriptions', entity: 'client_subscription_redemption' },
  { pattern: /^\/certificates\/(?<id>\d+)\/redemptions(?:\/(?<redemptionId>\d+)\/reverse)?$/, domain: 'certificates', entity: 'certificate_redemption' },
  { pattern: /^\/corporate-clients\/(?<id>\d+)\/archive$/, domain: 'corporate_clients', entity: 'corporate_client', action: 'archived' },
  { pattern: /^\/corporate-clients\/(?<id>\d+)\/restore$/, domain: 'corporate_clients', entity: 'corporate_client', action: 'restored' },
  { pattern: /^\/corporate-clients\/(?<id>\d+)\/deposits(?:\/(?<entryId>\d+)\/cancel)?$/, domain: 'corporate_clients', entity: 'corporate_ledger_entry' },
  { pattern: /^\/corporate-clients\/(?<id>\d+)\/spendings(?:\/(?<entryId>\d+)\/reverse)?$/, domain: 'corporate_clients', entity: 'corporate_ledger_entry' },
  { pattern: /^\/corporate-clients(?:\/(?<id>\d+))?$/, domain: 'corporate_clients', entity: 'corporate_client' },
  { pattern: /^\/staff\/(?<id>\d+)\/restore$/, domain: 'staff', entity: 'staff', action: 'restored' },
  { pattern: /^\/staff\/(?<id>\d+)\/permanent$/, domain: 'staff', entity: 'staff', action: 'deleted' },
  { pattern: /^\/staff(?:\/(?<id>\d+))?$/, domain: 'staff', entity: 'staff' },
  { pattern: /^\/accounts\/(?<id>\d+)\/restore$/, domain: 'accounts', entity: 'account', action: 'restored' },
  { pattern: /^\/accounts\/(?<id>\d+)\/permanent$/, domain: 'accounts', entity: 'account', action: 'deleted' },
  { pattern: /^\/accounts(?:\/(?<id>\d+))?$/, domain: 'accounts', entity: 'account' },
  { pattern: /^\/references\/(?<type>[^/]+)\/(?<id>\d+)\/archive$/, domain: 'references', entity: 'reference', action: 'archived' },
  { pattern: /^\/references\/(?<type>[^/]+)\/(?<id>\d+)\/restore$/, domain: 'references', entity: 'reference', action: 'restored' },
  { pattern: /^\/references\/(?<type>[^/]+)\/(?<id>\d+)\/permanent$/, domain: 'references', entity: 'reference', action: 'deleted' },
  { pattern: /^\/references\/(?<type>[^/]+)(?:\/(?<id>\d+))?$/, domain: 'references', entity: 'reference' },
  { pattern: /^\/shift-report-templates\/(?<id>\d+)\/archive$/, domain: 'shifts', entity: 'shift_report_template', action: 'archived' },
  { pattern: /^\/shift-report-templates\/(?<id>\d+)\/restore$/, domain: 'shifts', entity: 'shift_report_template', action: 'restored' },
  { pattern: /^\/shift-report-templates\/(?<templateId>\d+)\/items$/, domain: 'shifts', entity: 'shift_report_template_item', action: 'created' },
  { pattern: /^\/shift-report-templates(?:\/(?<id>\d+))?$/, domain: 'shifts', entity: 'shift_report_template' },
  { pattern: /^\/shift-report-template-items\/(?<id>\d+)\/archive$/, domain: 'shifts', entity: 'shift_report_template_item', action: 'archived' },
  { pattern: /^\/shift-report-template-items\/(?<id>\d+)\/restore$/, domain: 'shifts', entity: 'shift_report_template_item', action: 'restored' },
  { pattern: /^\/shift-report-template-items\/(?<id>\d+)$/, domain: 'shifts', entity: 'shift_report_template_item' },
  { pattern: /^\/shift-reports\/(?<reportId>\d+)\/answers\/(?<answerId>\d+)\/attachments(?:\/(?<attachmentId>[^/]+))?$/, domain: 'shifts', entity: 'shift_report_attachment' },
  { pattern: /^\/shift-reports\/(?<id>\d+)\/draft$/, domain: 'shifts', entity: 'shift_report', action: 'updated' },
  { pattern: /^\/shift-reports\/(?<id>\d+)\/submit$/, domain: 'shifts', entity: 'shift_report', action: 'submitted' },
  { pattern: /^\/shifts\/active\/cash\/opening$/, domain: 'shifts', entity: 'shift_cash_session', action: 'updated' },
  { pattern: /^\/shifts\/active\/cash\/expenses\/(?<expenseId>\d+)\/cancel$/, domain: 'shifts', entity: 'shift_cash_expense', action: 'archived' },
  { pattern: /^\/shifts\/active\/cash\/expenses\/(?<expenseId>\d+)\/attachments(?:\/(?<attachmentId>[^/]+))?$/, domain: 'shifts', entity: 'shift_cash_attachment' },
  { pattern: /^\/shifts\/active\/cash\/expenses(?:\/(?<expenseId>\d+))?$/, domain: 'shifts', entity: 'shift_cash_expense' },
  { pattern: /^\/shifts\/start$/, domain: 'shifts', entity: 'shift', action: 'created' },
  { pattern: /^\/shifts\/end$/, domain: 'shifts', entity: 'shift', action: 'updated' },
  { pattern: /^\/shifts$/, domain: 'shifts', entity: 'shift' },
  { pattern: /^\/motivation\/rules\/(?<key>[^/]+)$/, domain: 'motivation', entity: 'motivation_rule', action: 'updated' },
  { pattern: /^\/motivation\/categories\/(?<categoryId>\d+)\/rule$/, domain: 'motivation', entity: 'motivation_bonus_rule_category', action: 'updated' },
  { pattern: /^\/motivation\/bonus-rules(?:\/(?<id>\d+))?$/, domain: 'motivation', entity: 'motivation_bonus_rule' },
  { pattern: /^\/utilization$/, domain: 'utilization', entity: 'utilization', action: 'updated' },
  { pattern: /^\/methodology\/skills(?:\/(?<id>\d+))?$/, domain: 'methodology', entity: 'training_skill' },
  { pattern: /^\/methodology\/exercises\/(?<id>\d+)\/approve$/, domain: 'methodology', entity: 'training_exercise', action: 'updated' },
  { pattern: /^\/methodology\/exercises\/(?<id>\d+)\/archive$/, domain: 'methodology', entity: 'training_exercise', action: 'archived' },
  { pattern: /^\/methodology\/exercises\/(?<id>\d+)\/restore$/, domain: 'methodology', entity: 'training_exercise', action: 'restored' },
  { pattern: /^\/methodology\/exercises(?:\/(?<id>\d+))?$/, domain: 'methodology', entity: 'training_exercise' },
  { pattern: /^\/training-notes\/(?<noteId>\d+)$/, domain: 'training_notes', entity: 'training_note' },
  { pattern: /^\/training-plans\/(?<planId>\d+)\/exercises$/, domain: 'training_plans', entity: 'training_plan_exercise', action: 'updated' },
  { pattern: /^\/training-plans\/(?<planId>\d+)\/complete$/, domain: 'training_plans', entity: 'training_plan', action: 'updated' },
  { pattern: /^\/training-plans\/(?<planId>\d+)\/quick-complete$/, domain: 'training_plans', entity: 'training_plan', action: 'updated' },
  { pattern: /^\/training-plans(?:\/(?<planId>\d+))?$/, domain: 'training_plans', entity: 'training_plan' },
  { pattern: /^\/telephony\/calls\/(?<id>\d+)\/(?:start|client|client\/create|complete|ignore|recording-reference|transcription-jobs)$/, domain: 'telephony', entity: 'telephony_call', action: 'updated' },
  { pattern: /^\/telephony\/transcription-jobs\/(?<id>\d+)\/(?:audio-reference|progress|result|fail|retry|worker-retry)$/, domain: 'telephony', entity: 'telephony_transcription_job', action: 'updated' },
  { pattern: /^\/telephony\/transcription-jobs\/claim$/, domain: 'telephony', entity: 'telephony_transcription_job', action: 'updated' },
  { pattern: /^\/telephony\/beeline\/(?:sync|records\/sync)$/, domain: 'telephony', entity: 'telephony_call', action: 'synced' },
  { pattern: /^\/telephony\/beeline\/(?:subscribe|subscription\/check)$/, domain: 'telephony', entity: 'telephony_subscription', action: 'synced' },
  { pattern: /^\/telephony\/raw-events\/(?<id>\d+)\/reprocess$/, domain: 'telephony', entity: 'telephony_raw_event', action: 'synced' },
  { pattern: /^\/onboarding\/training-mode$/, domain: 'onboarding', entity: 'training_mode', action: 'updated' },
  { pattern: /^\/onboarding\/training-data$/, domain: 'onboarding', entity: 'training_data', action: 'deleted' },
  { pattern: /^\/onboarding\/tasks\/(?<taskKey>[^/]+)\/complete$/, domain: 'onboarding', entity: 'onboarding_task', action: 'updated' },
  { pattern: /^\/onboarding\/events$/, domain: 'onboarding', entity: 'onboarding_event', action: 'created' },
  { pattern: /^\/onboarding\/progress$/, domain: 'onboarding', entity: 'onboarding_progress', action: 'deleted' },
];

function normalizeApiPath(req) {
  const rawPath = String(req.originalUrl || req.url || '').split('?')[0];
  return rawPath.replace(/^\/api(?=\/|$)/, '') || '/';
}

function defaultAction(method) {
  if (method === 'POST') return 'created';
  if (method === 'DELETE') return 'archived';
  return 'updated';
}

function findResponseEntityId(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (body.id != null) return body.id;
  if (body.event?.id != null) return body.event.id;
  if (body.client?.id != null) return body.client.id;
  if (body.account?.id != null) return body.account.id;
  if (body.item?.id != null) return body.item.id;
  if (body.data?.id != null) return body.data.id;
  if (body.result?.id != null) return body.result.id;
  return null;
}

function selectEntityId(matchGroups, body) {
  const keys = [
    'id',
    'clientId',
    'viewId',
    'baseId',
    'entryId',
    'expenseId',
    'redemptionId',
    'taskClientId',
    'noteId',
    'planId',
    'skillId',
    'shiftId',
    'categoryId',
    'key',
    'taskKey',
  ];
  for (const key of keys) {
    if (matchGroups?.[key] != null) return String(matchGroups[key]);
  }
  const responseId = findResponseEntityId(body);
  return responseId == null ? null : String(responseId);
}

function matchRealtimeChange(req, responseBody) {
  const method = String(req.method || '').toUpperCase();
  const path = normalizeApiPath(req);
  const route = ROUTE_RULES.find((rule) => rule.pattern.test(path));
  if (!route) return null;

  const groups = route.pattern.exec(path)?.groups || {};
  const domainHints = DEFAULT_DOMAIN_HINTS[route.domain] || {
    queryGroups: [route.domain],
    routes: [],
  };

  return {
    action: route.action || defaultAction(method),
    domain: route.domain,
    entity: route.entity,
    entityId: selectEntityId(groups, responseBody),
    hints: {
      queryGroups: [...domainHints.queryGroups],
      routes: [...domainHints.routes],
    },
    match: groups,
    path,
    source: route.source,
  };
}

module.exports = {
  DEFAULT_DOMAIN_HINTS,
  ROUTE_RULES,
  matchRealtimeChange,
  normalizeApiPath,
};
