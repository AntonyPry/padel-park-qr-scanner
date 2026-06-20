import type { AccountRole } from './account-roles';

type AccessKey =
  | 'accessOperate'
  | 'auditView'
  | 'bookingsManage'
  | 'bookingsView'
  | 'clientsManage'
  | 'clientsMerge'
  | 'clientsView'
  | 'clientBasesManage'
  | 'clientBasesView'
  | 'clientSubscriptionsRedeem'
  | 'clientSubscriptionsView'
  | 'certificatesRedeem'
  | 'certificatesView'
  | 'callTasksManage'
  | 'callTasksView'
  | 'callTasksWork'
  | 'catalogManage'
  | 'catalogView'
  | 'corporateClientsView'
  | 'corporateDepositsManage'
  | 'financeManage'
  | 'financeView'
  | 'financeExport'
  | 'managerControlDashboardView'
  | 'motivationManage'
  | 'motivationView'
  | 'payrollApprove'
  | 'payrollExport'
  | 'payrollPay'
  | 'payrollReview'
  | 'payrollView'
  | 'prepaymentSalesManage'
  | 'prepaymentSalesView'
  | 'prepaymentsDashboardView'
  | 'prepaymentSettingsManage'
  | 'referencesManage'
  | 'referencesView'
  | 'reportsView'
  | 'shiftsManage'
  | 'shiftsOperate'
  | 'staffManage'
  | 'staffView'
  | 'subscriptionTypesManage'
  | 'subscriptionTypesView'
  | 'systemUsersManage'
  | 'telephonyManage'
  | 'telephonyView'
  | 'telephonyWork'
  | 'trainingMethodologyAnalyticsView'
  | 'trainingMethodologyManage'
  | 'trainingMethodologyView'
  | 'trainingNotesManage'
  | 'trainingNotesView'
  | 'utilizationManage'
  | 'utilizationView';

const ACCESS_MATRIX: Record<AccessKey, AccountRole[]> = {
  accessOperate: ['owner', 'manager', 'admin'],
  auditView: ['owner', 'manager'],
  bookingsManage: ['owner', 'manager', 'admin'],
  bookingsView: ['owner', 'manager', 'admin', 'viewer'],
  clientsManage: ['owner', 'manager', 'admin'],
  clientsMerge: ['owner', 'manager'],
  clientsView: ['owner', 'manager', 'admin', 'viewer', 'trainer'],
  clientBasesManage: ['owner', 'manager'],
  clientBasesView: ['owner', 'manager'],
  clientSubscriptionsRedeem: ['owner', 'manager', 'admin'],
  clientSubscriptionsView: ['owner', 'manager', 'admin', 'viewer'],
  certificatesRedeem: ['owner', 'manager', 'admin'],
  certificatesView: ['owner', 'manager', 'admin', 'viewer'],
  callTasksManage: ['owner', 'manager'],
  callTasksView: ['owner', 'manager', 'admin'],
  callTasksWork: ['owner', 'manager', 'admin'],
  catalogManage: ['owner', 'accountant'],
  catalogView: ['owner', 'manager', 'accountant', 'viewer'],
  corporateClientsView: ['owner', 'manager', 'accountant', 'viewer'],
  corporateDepositsManage: ['owner', 'accountant'],
  financeManage: ['owner', 'accountant'],
  financeView: ['owner', 'manager', 'accountant', 'viewer'],
  financeExport: ['owner', 'manager', 'accountant'],
  managerControlDashboardView: ['owner', 'manager'],
  motivationManage: ['owner', 'manager'],
  motivationView: ['owner', 'manager', 'admin'],
  payrollApprove: ['owner', 'manager'],
  payrollExport: ['owner', 'manager', 'accountant'],
  payrollPay: ['owner', 'accountant'],
  payrollReview: ['owner', 'manager', 'accountant'],
  payrollView: ['owner', 'manager', 'accountant'],
  prepaymentSalesManage: ['owner', 'manager'],
  prepaymentSalesView: ['owner', 'manager'],
  prepaymentsDashboardView: ['owner', 'manager', 'admin', 'accountant'],
  prepaymentSettingsManage: ['owner', 'manager'],
  referencesManage: ['owner', 'manager'],
  referencesView: ['owner', 'manager', 'admin', 'accountant', 'viewer'],
  reportsView: ['owner', 'manager', 'accountant', 'viewer'],
  shiftsManage: ['owner', 'manager'],
  shiftsOperate: ['owner', 'manager', 'admin'],
  staffManage: ['owner', 'manager'],
  staffView: ['owner', 'manager', 'accountant', 'viewer'],
  subscriptionTypesManage: ['owner', 'manager'],
  subscriptionTypesView: ['owner', 'manager'],
  systemUsersManage: ['owner', 'manager'],
  telephonyManage: ['owner', 'manager'],
  telephonyView: ['owner', 'manager', 'admin', 'viewer'],
  telephonyWork: ['owner', 'manager', 'admin'],
  trainingMethodologyAnalyticsView: ['owner', 'manager'],
  trainingMethodologyManage: ['owner', 'manager'],
  trainingMethodologyView: ['owner', 'manager', 'trainer'],
  trainingNotesManage: ['owner', 'manager', 'trainer'],
  trainingNotesView: ['owner', 'manager', 'trainer'],
  utilizationManage: ['owner', 'manager'],
  utilizationView: ['owner', 'manager', 'accountant', 'viewer'],
};

module.exports = {
  ACCESS_MATRIX,
};
