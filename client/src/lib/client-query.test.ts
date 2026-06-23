import { describe, expect, it } from 'vitest';
import {
  appendNumericFilter,
  buildClientsListQueryString,
  normalizeNumericFilterInput,
} from './client-query';

describe('client list query generation', () => {
  it('does not append empty numeric filters as zero', () => {
    const query = new URLSearchParams(
      buildClientsListQueryString({
        lastVisitDaysFrom: null,
        lastVisitDaysTo: undefined,
        page: 1,
        q: '',
        segment: 'all',
        status: 'active',
        visitCountMax: '   ',
        visitCountMin: '',
      }),
    );

    expect(query.get('status')).toBe('active');
    expect(query.has('visitCountMin')).toBe(false);
    expect(query.has('visitCountMax')).toBe(false);
    expect(query.has('lastVisitDaysFrom')).toBe(false);
    expect(query.has('lastVisitDaysTo')).toBe(false);
  });

  it('keeps explicit zero numeric filters', () => {
    const params = new URLSearchParams();

    appendNumericFilter(params, 'visitCountMax', '0');
    appendNumericFilter(params, 'visitCountMin', 0);

    expect(params.get('visitCountMax')).toBe('0');
    expect(params.get('visitCountMin')).toBe('0');
  });

  it('normalizes whitespace numeric input to empty value', () => {
    expect(normalizeNumericFilterInput('   ')).toBe('');
    expect(normalizeNumericFilterInput('0')).toBe('0');
  });

  it('adds recovery search flag only when explicitly enabled', () => {
    const regularQuery = new URLSearchParams(
      buildClientsListQueryString({
        includeMerged: false,
        page: 1,
        segment: 'all',
        status: 'active',
      }),
    );
    const recoveryQuery = new URLSearchParams(
      buildClientsListQueryString({
        includeMerged: true,
        page: 1,
        q: '+7 999 111-22-33',
        segment: 'all',
        status: 'all',
      }),
    );

    expect(regularQuery.has('includeMerged')).toBe(false);
    expect(recoveryQuery.get('includeMerged')).toBe('true');
    expect(recoveryQuery.get('status')).toBe('all');
    expect(recoveryQuery.get('q')).toBe('+7 999 111-22-33');
  });
});
