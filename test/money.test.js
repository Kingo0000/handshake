import { describe, expect, it } from 'vitest';
import { fromCents, planRelease, toCents } from '../server/src/money.js';

const funded = { status: 'funded', amount: '400.00' };

describe('money', () => {
  it('round-trips amounts through cents without float error', () => {
    expect(toCents('0.1')).toBe(10);
    expect(toCents('19.99')).toBe(1999);
    expect(fromCents(toCents('300.05'))).toBe('300.05');
  });

  it('rejects malformed amounts', () => {
    for (const bad of ['', 'abc', '-5', '1.234', '1e3']) expect(() => toCents(bad)).toThrow(RangeError);
  });
});

describe('planRelease', () => {
  it('releases the full hold when no amount is given', () => {
    expect(planRelease(funded)).toEqual({ amount: '400.00', partial: false, returnedToClient: '0.00' });
  });

  it('plans a partial release and the amount returned to the client', () => {
    expect(planRelease(funded, '300')).toEqual({ amount: '300.00', partial: true, returnedToClient: '100.00' });
  });

  it('never releases more than is held', () => {
    expect(() => planRelease(funded, '400.01')).toThrow(/more than/);
    expect(() => planRelease(funded, '0')).toThrow(/more than zero/);
  });

  it('only releases funded milestones', () => {
    expect(() => planRelease({ ...funded, status: 'released' })).toThrow(/funded/);
  });
});
