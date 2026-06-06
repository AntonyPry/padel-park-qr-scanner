const assert = require('node:assert/strict');
const test = require('node:test');
const { ACCESS_MATRIX } = require('../../src/constants/access-matrix');

test('trainer permissions stay limited to training notes and safe client view', () => {
  assert.equal(ACCESS_MATRIX.clientsView.includes('trainer'), true);
  assert.equal(ACCESS_MATRIX.trainingNotesView.includes('trainer'), true);
  assert.equal(ACCESS_MATRIX.trainingNotesManage.includes('trainer'), true);
  assert.equal(ACCESS_MATRIX.trainingMethodologyView.includes('trainer'), true);

  assert.equal(ACCESS_MATRIX.clientsManage.includes('trainer'), false);
  assert.equal(ACCESS_MATRIX.clientsMerge.includes('trainer'), false);
  assert.equal(ACCESS_MATRIX.financeView.includes('trainer'), false);
  assert.equal(ACCESS_MATRIX.callTasksView.includes('trainer'), false);
  assert.equal(ACCESS_MATRIX.trainingMethodologyAnalyticsView.includes('trainer'), false);
  assert.equal(ACCESS_MATRIX.trainingMethodologyManage.includes('trainer'), false);
});

test('owners and managers can approve methodology exercises', () => {
  assert.deepEqual(ACCESS_MATRIX.trainingMethodologyManage, ['owner', 'manager']);
  assert.deepEqual(ACCESS_MATRIX.trainingMethodologyAnalyticsView, ['owner', 'manager']);
  assert.equal(ACCESS_MATRIX.trainingMethodologyView.includes('owner'), true);
  assert.equal(ACCESS_MATRIX.trainingMethodologyView.includes('manager'), true);
});

test('manager can view finances but cannot manage finance operations', () => {
  assert.equal(ACCESS_MATRIX.financeView.includes('manager'), true);
  assert.equal(ACCESS_MATRIX.financeExport.includes('manager'), true);
  assert.equal(ACCESS_MATRIX.financeManage.includes('manager'), false);
});

test('accountant can read payroll-related motivation data without managing motivation', () => {
  assert.equal(ACCESS_MATRIX.financeView.includes('accountant'), true);
  assert.equal(ACCESS_MATRIX.payrollView.includes('accountant'), true);
  assert.equal(ACCESS_MATRIX.motivationView.includes('accountant'), true);
  assert.equal(ACCESS_MATRIX.motivationManage.includes('accountant'), false);
});

test('corporate deposits follow finance manage permissions', () => {
  assert.deepEqual(ACCESS_MATRIX.corporateClientsView, [
    'owner',
    'manager',
    'accountant',
    'viewer',
  ]);
  assert.deepEqual(ACCESS_MATRIX.corporateDepositsManage, ['owner', 'accountant']);
  assert.equal(ACCESS_MATRIX.corporateClientsView.includes('admin'), false);
  assert.equal(ACCESS_MATRIX.corporateDepositsManage.includes('manager'), false);
  assert.equal(ACCESS_MATRIX.corporateDepositsManage.includes('trainer'), false);
});

test('prepayment sale settings stay separate from catalog management', () => {
  assert.deepEqual(ACCESS_MATRIX.prepaymentSettingsManage, ['owner', 'manager']);
  assert.deepEqual(ACCESS_MATRIX.prepaymentSalesManage, ['owner', 'manager']);
  assert.deepEqual(ACCESS_MATRIX.prepaymentsDashboardView, [
    'owner',
    'manager',
    'admin',
    'accountant',
  ]);
  assert.equal(ACCESS_MATRIX.catalogManage.includes('manager'), false);
  assert.equal(ACCESS_MATRIX.prepaymentSettingsManage.includes('accountant'), false);
  assert.equal(ACCESS_MATRIX.prepaymentsDashboardView.includes('trainer'), false);
});

test('subscription type management stays owner manager while trainers do not see balances', () => {
  assert.deepEqual(ACCESS_MATRIX.subscriptionTypesManage, ['owner', 'manager']);
  assert.deepEqual(ACCESS_MATRIX.subscriptionTypesView, ['owner', 'manager']);
  assert.deepEqual(ACCESS_MATRIX.clientSubscriptionsRedeem, ['owner', 'manager', 'admin']);
  assert.equal(ACCESS_MATRIX.clientSubscriptionsView.includes('admin'), true);
  assert.equal(ACCESS_MATRIX.clientSubscriptionsRedeem.includes('admin'), true);
  assert.equal(ACCESS_MATRIX.clientSubscriptionsRedeem.includes('viewer'), false);
  assert.equal(ACCESS_MATRIX.clientSubscriptionsView.includes('accountant'), false);
  assert.equal(ACCESS_MATRIX.clientSubscriptionsRedeem.includes('accountant'), false);
  assert.equal(ACCESS_MATRIX.clientSubscriptionsView.includes('trainer'), false);
  assert.equal(ACCESS_MATRIX.clientSubscriptionsRedeem.includes('trainer'), false);
  assert.equal(ACCESS_MATRIX.clientsView.includes('accountant'), false);
});

test('certificate redemption is available to admins without trainer or accountant leakage', () => {
  assert.deepEqual(ACCESS_MATRIX.certificatesRedeem, ['owner', 'manager', 'admin']);
  assert.equal(ACCESS_MATRIX.certificatesView.includes('viewer'), true);
  assert.equal(ACCESS_MATRIX.certificatesView.includes('admin'), true);
  assert.equal(ACCESS_MATRIX.certificatesRedeem.includes('viewer'), false);
  assert.equal(ACCESS_MATRIX.certificatesView.includes('accountant'), false);
  assert.equal(ACCESS_MATRIX.certificatesRedeem.includes('accountant'), false);
  assert.equal(ACCESS_MATRIX.certificatesView.includes('trainer'), false);
  assert.equal(ACCESS_MATRIX.certificatesRedeem.includes('trainer'), false);
});

test('admins can manage phone bookings without finance or catalog access', () => {
  assert.equal(ACCESS_MATRIX.bookingsView.includes('admin'), true);
  assert.equal(ACCESS_MATRIX.bookingsManage.includes('admin'), true);
  assert.equal(ACCESS_MATRIX.financeView.includes('admin'), false);
  assert.equal(ACCESS_MATRIX.catalogManage.includes('admin'), false);
});

test('telephony separates setup from call processing', () => {
  assert.equal(ACCESS_MATRIX.telephonyManage.includes('owner'), true);
  assert.equal(ACCESS_MATRIX.telephonyManage.includes('manager'), true);
  assert.equal(ACCESS_MATRIX.telephonyManage.includes('admin'), false);
  assert.equal(ACCESS_MATRIX.telephonyWork.includes('admin'), true);
  assert.equal(ACCESS_MATRIX.telephonyView.includes('viewer'), true);
  assert.equal(ACCESS_MATRIX.telephonyWork.includes('viewer'), false);
});
