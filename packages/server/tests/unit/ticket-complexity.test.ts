import { describe, it, expect } from 'vitest';
import {
  TICKET_COMPLEXITIES,
  complexityProgress,
  formatComplexitySum,
  normalizeTicketComplexity,
  parseTicketComplexityInput,
  sumComplexity,
  validateResolvedParams,
} from '@fleex/shared';
import type { TicketComplexity } from '@fleex/shared';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';

const t = (complexity: TicketComplexity | null, status = 'todo') => ({ status, complexity });

describe('ticket complexity — shared helpers', () => {
  it('is a closed Fibonacci-like scale ending in ∞', () => {
    // The whole point of the closed scale: estimates stay comparable and summable.
    expect([...TICKET_COMPLEXITIES]).toEqual(['0', '0.5', '1', '2', '3', '5', '8', '13', '21', '34', '55', 'inf']);
  });

  it('sums the finite points but keeps ∞ and unestimated tickets apart', () => {
    // A total that silently folded ∞ in (or treated "not estimated" as 0) would
    // be a wrong number shown as if it were right.
    const sum = sumComplexity([t('0.5'), t('13'), t('inf'), t(null), t('0')]);
    expect(sum).toEqual({ points: 13.5, infinite: 1, unestimated: 1, estimated: 4 });
  });

  it('formats a sum as "N pts", flags ∞, and shows a dash when nothing is estimated', () => {
    expect(formatComplexitySum(sumComplexity([t('0.5'), t('13'), t('inf')]))).toBe('13.5 pts + ∞');
    expect(formatComplexitySum(sumComplexity([t('3'), t('5')]))).toBe('8 pts');
    // `0` is an estimate (trivial), so it still renders a number…
    expect(formatComplexitySum(sumComplexity([t('0')]))).toBe('0 pts');
    // …whereas only unestimated tickets render no number at all.
    expect(formatComplexitySum(sumComplexity([t(null), t(null)]))).toBe('—');
    expect(formatComplexitySum(sumComplexity([]))).toBe('—');
  });

  it('computes epic progress over non-cancelled tickets only', () => {
    const { done, total } = complexityProgress([
      t('2', 'done'),
      t('1', 'done'),
      t('5', 'doing'),
      t('inf', 'todo'),
      t(null, 'todo'),
      t('8', 'cancelled'), // abandoned work must not inflate the total
    ]);
    expect(done.points).toBe(3);
    expect(total).toEqual({ points: 8, infinite: 1, unestimated: 1, estimated: 4 });
  });

  it('parses CLI input with aliases, and rejects anything off the scale', () => {
    expect(parseTicketComplexityInput('5')).toBe('5');
    expect(parseTicketComplexityInput('∞')).toBe('inf');
    expect(parseTicketComplexityInput('Infinity')).toBe('inf');
    expect(parseTicketComplexityInput('.5')).toBe('0.5');
    expect(parseTicketComplexityInput('0,5')).toBe('0.5');
    expect(parseTicketComplexityInput('none')).toBeNull();
    expect(parseTicketComplexityInput('4')).toBeUndefined();
    expect(parseTicketComplexityInput('XL')).toBeUndefined();
  });

  it('normalises an off-scale stored value to "not estimated"', () => {
    expect(normalizeTicketComplexity('8')).toBe('8');
    expect(normalizeTicketComplexity('4')).toBeNull();
    expect(normalizeTicketComplexity(5)).toBeNull();
    expect(normalizeTicketComplexity(undefined)).toBeNull();
  });
});

describe('TicketEntity complexity', () => {
  const make = (complexity?: TicketComplexity | null) =>
    TicketEntity.create({ id: 't', boardId: 'b', displayId: 1, title: 'x', complexity });

  it('defaults to not estimated, never to 0', () => {
    expect(make().complexity).toBeNull();
    expect(make().toDTO().complexity).toBeNull();
  });

  it('records a {from,to} diff so the change lands in the ticket activity', () => {
    const ticket = make();
    expect(ticket.update({ complexity: '5' })).toEqual({ complexity: { from: null, to: '5' } });
    expect(ticket.toDTO().complexity).toBe('5');
    expect(ticket.update({ complexity: null })).toEqual({ complexity: { from: '5', to: null } });
  });

  it('produces no diff (hence no activity) when the same value is sent again', () => {
    const ticket = make('inf');
    expect(ticket.update({ complexity: 'inf' })).toEqual({});
  });

  it('ignores an off-scale value instead of persisting or clearing it', () => {
    const ticket = make('3');
    expect(ticket.update({ complexity: '4' as TicketComplexity })).toEqual({});
    expect(ticket.complexity).toBe('3');
  });
});

describe('ticket.set_complexity native action', () => {
  const check = (complexity: unknown) => validateResolvedParams('ticket.set_complexity', { complexity });

  it('accepts a scale value and null (clears the estimate), and rejects an off-scale value', () => {
    expect(check('8')).toEqual([]);
    expect(check('inf')).toEqual([]);
    expect(check(null)).toEqual([]);
    expect(check('4').length).toBeGreaterThan(0);
  });

  it('lets ticket.create carry a complexity', () => {
    expect(validateResolvedParams('ticket.create', { boardId: 'b', title: 'x', complexity: '3' })).toEqual([]);
    expect(validateResolvedParams('ticket.create', { boardId: 'b', title: 'x', complexity: 'XL' }).length).toBeGreaterThan(0);
  });
});
