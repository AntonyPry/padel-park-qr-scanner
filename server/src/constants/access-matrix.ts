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
  | 'callTasksManage'
  | 'callTasksView'
  | 'callTasksWork'
  | 'catalogManage'
  | 'catalogView'
  | 'financeManage'
  | 'financeView'
  | 'financeExport'
  | 'motivationManage'
  | 'motivationView'
  | 'payrollApprove'
  | 'payrollExport'
  | 'payrollPay'
  | 'payrollReview'
  | 'payrollView'
  | 'referencesManage'
  | 'referencesView'
  | 'reportsView'
  | 'shiftsManage'
  | 'shiftsOperate'
  | 'staffManage'
  | 'staffView'
  | 'systemUsersManage'
  | 'telephonyManage'
  | 'telephonyView'
  | 'telephonyWork'
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
  callTasksManage: ['owner', 'manager'],
  callTasksView: ['owner', 'manager', 'admin'],
  callTasksWork: ['owner', 'manager', 'admin'],
  catalogManage: ['owner', 'accountant'],
  catalogView: ['owner', 'manager', 'accountant', 'viewer'],
  financeManage: ['owner', 'accountant'],
  financeView: ['owner', 'manager', 'accountant', 'viewer'],
  financeExport: ['owner', 'manager', 'accountant'],
  motivationManage: ['owner', 'manager'],
  motivationView: ['owner', 'manager', 'admin'],
  payrollApprove: ['owner', 'manager'],
  payrollExport: ['owner', 'manager', 'accountant'],
  payrollPay: ['owner', 'accountant'],
  payrollReview: ['owner', 'manager', 'accountant'],
  payrollView: ['owner', 'manager', 'accountant'],
  referencesManage: ['owner', 'manager'],
  referencesView: ['owner', 'manager', 'admin', 'accountant', 'viewer'],
  reportsView: ['owner', 'manager', 'accountant', 'viewer'],
  shiftsManage: ['owner', 'manager'],
  shiftsOperate: ['owner', 'manager', 'admin'],
  staffManage: ['owner', 'manager'],
  staffView: ['owner', 'manager', 'accountant', 'viewer'],
  systemUsersManage: ['owner', 'manager'],
  telephonyManage: ['owner', 'manager'],
  telephonyView: ['owner', 'manager', 'admin', 'viewer'],
  telephonyWork: ['owner', 'manager', 'admin'],
  trainingNotesManage: ['owner', 'manager', 'trainer'],
  trainingNotesView: ['owner', 'manager', 'trainer'],
  utilizationManage: ['owner', 'manager'],
  utilizationView: ['owner', 'manager', 'accountant', 'viewer'],
};

module.exports = {
  ACCESS_MATRIX,
};
