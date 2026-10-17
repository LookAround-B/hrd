export type EntityType = 'employee' | 'horse' | 'careTeam' | 'health' | 'medicine' | 'feedInventory' | 'consumption' | 'grocery' | 'feedPlan' | 'groceryUsage';
export type JsonRecord = Record<string, unknown>;
export interface Club {
  id: string; name: string; brief: string; baseUrl: string; authorisation: string;
  issuer: string; collectedAt: string; credentialMask: string; credentialExpiresAt: string | null;
  scopeNotes?: string; rateLimitNotes?: string;
  routeCatalog?: RouteDefinition[] | null;
  status: 'pending' | 'active' | 'credential_required' | 'disconnected';
  validatedAt: string | null; lastSuccessAt: string | null; disconnectedAt: string | null;
  createdAt: string; employeeCount: number; horseCount: number; stale: boolean;
}
export interface SourceRecord { id: string; clubId: string; type: EntityType; sourceId: string; data: JsonRecord; syncedAt: string; }
export interface RouteCheck { clubId: string; route: string; state: 'ok' | 'denied' | 'credential_required' | 'error'; status: number | null; latencyMs: number; checkedAt: string; lastSuccessAt: string | null; }
export interface Dashboard { clubs: Club[]; records: SourceRecord[]; checks: RouteCheck[]; catalog: RouteDefinition[]; }
export interface RouteDefinition { path: string; methods: string[]; safe: boolean; reason: string; type?: EntityType; }
export interface SessionUser { email: string; csrf: string; expiresAt: string; }
export interface SyncRun {
  state: 'running' | 'success' | 'limited' | 'partial' | 'error';
  datasets: Record<string, string>;
  started_at: string;
  finished_at: string | null;
}
