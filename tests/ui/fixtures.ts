import type { Club, Dashboard, SourceRecord } from '../../shared/types';
import { readFileSync } from 'node:fs';
const catalog = JSON.parse(readFileSync(new URL('../../shared/route-catalog.json', import.meta.url), 'utf8')) as Dashboard['catalog'];

const syncedAt = new Date().toISOString();
export const clubA: Club = {
  id: '11111111-1111-4111-8111-111111111111', name: 'Willow Equestrian Club',
  brief: 'A riding and training facility with a dedicated horse care team.',
  baseUrl: 'https://efm.example.com', authorisation: 'Written approval · fixture reference 104',
  issuer: 'Club administrator', collectedAt: syncedAt, credentialMask: '••••••••',
  credentialExpiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  status: 'active', validatedAt: syncedAt, lastSuccessAt: syncedAt, disconnectedAt: null,
  createdAt: syncedAt, employeeCount: 25, horseCount: 2, stale: false,
};
export const clubB: Club = {
  ...clubA, id: '22222222-2222-4222-8222-222222222222', name: 'Northfield Riding Club',
  brief: 'A second club preparing its EFM connection.', status: 'pending',
  employeeCount: 1, horseCount: 1, lastSuccessAt: null, validatedAt: null, stale: true,
};
function record(clubId: string, type: SourceRecord['type'], sourceId: string, data: SourceRecord['data']): SourceRecord {
  return { id: `${clubId}:${type}:${sourceId}`, clubId, type, sourceId, data, syncedAt };
}
export const records: SourceRecord[] = [
  ...Array.from({ length: 25 }, (_, i) => record(clubA.id, 'employee', `employee-${i}`, {
    fullName: i === 0 ? 'Asha Menon' : `Team member ${String(i + 1).padStart(2, '0')}`,
    designation: i === 0 ? 'Stable Manager' : 'Groom', department: 'Stable operations',
    email: i === 0 ? 'asha.menon@example.com' : `team${i}@example.com`,
    phoneNumber: '+91 90000 00001', employmentStatus: 'Active',
  })),
  record(clubB.id, 'employee', 'employee-0', { fullName: 'Ravi Kumar', designation: 'Instructor', department: 'Training', email: 'ravi@example.com', employmentStatus: 'Active' }),
  record(clubA.id, 'horse', 'horse-1', { name: 'Aurora', breed: 'Thoroughbred', gender: 'Mare', stableNumber: 'A-03', ownerName: 'Priya Shah', ownerContact: '+91 90000 00002', status: 'Active', passportNumber: 'HRD-1001' }),
  record(clubA.id, 'horse', 'horse-2', { name: 'Atlas', breed: 'Warmblood', gender: 'Gelding', stableNumber: 'A-07', status: 'Active' }),
  record(clubB.id, 'horse', 'horse-1', { name: 'Comet', breed: 'Warmblood', gender: 'Gelding', status: 'Active' }),
  record(clubA.id, 'careTeam', 'care-1', { horseId: 'horse-1', staffId: 'employee-0', role: 'Stable Manager', isActive: true, staff: { fullName: 'Asha Menon' } }),
  record(clubA.id, 'feedInventory', 'feed-1', { feedType: 'oats', month: 10, year: 2026, unitsBrought: 100, unitsLeft: 85, totalUsed: 15, unit: 'kg' }),
  record(clubA.id, 'grocery', 'grocery-1', { name: 'Rice', quantity: 20, unit: 'kg', purchaseDate: '2026-10-11T00:00:00.000Z' }),
  record(clubA.id, 'consumption', 'day:2026-10-11:oats', { kind: 'day', date: '2026-10-11', feedType: 'oats', quantity: 2 }),
  record(clubA.id, 'consumption', 'horse:horse-1:oats', { kind: 'horse', horseId: 'horse-1', horseName: 'Aurora', feedType: 'oats', quantity: 2 }),
  record(clubA.id, 'health', 'health-1', { horseId: 'horse-1', recordType: 'Check-up', description: 'Routine examination', date: '2026-10-11T00:00:00.000Z', documents: 'https://example.com/health.pdf' }),
];
export const dashboard: Dashboard = {
  clubs: [clubA, clubB], records, catalog: catalog as Dashboard['catalog'],
  checks: [{ clubId: clubA.id, route: '/api/horses', state: 'ok', status: 200, latencyMs: 142, checkedAt: syncedAt, lastSuccessAt: syncedAt }],
};
