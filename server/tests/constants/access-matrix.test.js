const assert = require('node:assert/strict');
const test = require('node:test');
const { ACCESS_MATRIX } = require('../../src/constants/access-matrix');

test('trainer permissions stay limited to training notes and safe client view', () => {
  assert.equal(ACCESS_MATRIX.clientsView.includes('trainer'), true);
  assert.equal(ACCESS_MATRIX.trainingNotesView.includes('trainer'), true);
  assert.equal(ACCESS_MATRIX.trainingNotesManage.includes('trainer'), true);

  assert.equal(ACCESS_MATRIX.clientsManage.includes('trainer'), false);
  assert.equal(ACCESS_MATRIX.clientsMerge.includes('trainer'), false);
  assert.equal(ACCESS_MATRIX.financeView.includes('trainer'), false);
  assert.equal(ACCESS_MATRIX.callTasksView.includes('trainer'), false);
});

test('manager can view finances but cannot manage finance operations', () => {
  assert.equal(ACCESS_MATRIX.financeView.includes('manager'), true);
  assert.equal(ACCESS_MATRIX.financeExport.includes('manager'), true);
  assert.equal(ACCESS_MATRIX.financeManage.includes('manager'), false);
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
