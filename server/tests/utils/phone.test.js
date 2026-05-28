const assert = require('node:assert/strict');
const test = require('node:test');
const {
  formatRussianPhone,
  getPhoneLookupDigits,
  normalizePhone,
} = require('../../src/utils/phone');

test('normalizes phone to digits only', () => {
  assert.equal(normalizePhone('+7 (901) 300-10-01'), '79013001001');
  assert.equal(normalizePhone(' 8 999 111 22 33 '), '89991112233');
  assert.equal(normalizePhone(null), '');
});

test('uses last ten digits for Russian phone lookup', () => {
  assert.equal(getPhoneLookupDigits('+7 (901) 300-10-01'), '9013001001');
  assert.equal(getPhoneLookupDigits('9013001001'), '9013001001');
  assert.equal(getPhoneLookupDigits('12345'), '12345');
});

test('formats Russian phones consistently', () => {
  assert.equal(formatRussianPhone('89013001001'), '+7 (901) 300-10-01');
  assert.equal(formatRussianPhone('+7 (901) 300-10-01'), '+7 (901) 300-10-01');
  assert.equal(formatRussianPhone('12345'), '12345');
});
