const ACCESS_MATRIX = {
  accessOperate: ['owner', 'manager', 'admin'],
  clientsManage: ['owner', 'manager', 'admin'],
  clientsMerge: ['owner', 'manager'],
  clientsView: ['owner', 'manager', 'admin', 'viewer'],
  catalogManage: ['owner', 'accountant'],
  catalogView: ['owner', 'manager', 'accountant', 'viewer'],
  financeManage: ['owner', 'accountant'],
  financeView: ['owner', 'manager', 'accountant', 'viewer'],
  motivationManage: ['owner', 'manager'],
  motivationView: ['owner', 'manager', 'admin'],
  payrollView: ['owner', 'manager', 'accountant', 'viewer'],
  reportsView: ['owner', 'manager', 'accountant', 'viewer'],
  shiftsManage: ['owner', 'manager'],
  shiftsOperate: ['owner', 'manager', 'admin'],
  staffManage: ['owner', 'manager'],
  staffView: ['owner', 'manager', 'accountant', 'viewer'],
  systemUsersManage: ['owner', 'manager'],
  utilizationManage: ['owner', 'manager'],
  utilizationView: ['owner', 'manager', 'accountant', 'viewer'],
};

module.exports = {
  ACCESS_MATRIX,
};
