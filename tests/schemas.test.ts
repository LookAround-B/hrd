import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { issueMessage, validateRequest } from '../shared/schemas';

const club = { name: 'Club', baseUrl: 'https://efm.example.com', token: 'x'.repeat(20), issuer: 'Owner', authorisation: 'Ref 104', termsConfirmed: true };
const error = (run: () => unknown) => { try { run(); } catch (e) { if (e instanceof ZodError) return issueMessage(e); throw e; } return null; };

describe('shared request schemas', () => {
  it('accepts valid input and fills defaults', () => {
    expect(validateRequest('clubs', {}, club)!.body).toMatchObject({ brief: '', scopeNotes: '', rateLimitNotes: '' });
    expect(validateRequest('efm-data/rows', { clubId: '11111111-1111-4111-8111-111111111111', dataset: 'Attendance', take: '20' }, undefined)!.query).toMatchObject({ take: 20, skip: 0, dir: 'asc' });
  });
  it('rejects unknown fields everywhere, including GET queries and empty-body actions', () => {
    expect(error(() => validateRequest('clubs', {}, { ...club, admin: true }))).toMatch(/admin/);
    expect(error(() => validateRequest('dashboard', { debug: '1' }, undefined))).toMatch(/debug/);
    expect(error(() => validateRequest('clubs/11111111-1111-4111-8111-111111111111/sync', {}, { force: true }))).toMatch(/force/);
    expect(error(() => validateRequest('clubs/11111111-1111-4111-8111-111111111111/credential', {}, { token: 'x'.repeat(20), issuer: 'Owner', authorisation: 'Ref 104', termsConfirmed: false }))).toMatch(/termsConfirmed/);
  });
  it('explains the first problem in plain words', () => {
    expect(error(() => validateRequest('clubs', {}, { ...club, issuer: 'A' }))).toBe('Issued by: Enter at least 2 characters for the issuer.');
    expect(error(() => validateRequest('clubs', {}, { ...club, termsConfirmed: false }))).toBe('Club approval: Confirm the club approved this integration.');
    expect(error(() => validateRequest('consumption', { from: '2026-10-13', to: '2026-10-01' }, undefined))).toBe('To: The end date must be on or after the start date.');
    expect(error(() => validateRequest('auth/demo', {}, { phone: '9000000001' }))).toMatch(/^Access code:/);
  });
  it('returns undefined for unknown routes so the API answers 404', () => {
    expect(validateRequest('nope', {}, undefined)).toBeUndefined();
  });
});
