// JWT and Authentication utilities
import jwt from 'jsonwebtoken'
import { NextRequest, NextResponse } from 'next/server'
import type { NextApiRequest } from 'next'
import { rememberJson } from '@/lib/cache'
import { cacheKeys, CACHE_TTL_SECONDS } from '@/lib/cacheKeys'

const JWT_SECRET: string = (() => {
  const secret = process.env.JWT_SECRET
  if (!secret || secret === 'your-secret-key') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: JWT_SECRET environment variable must be set in production')
    }
    console.warn('[AUTH] WARNING: Using default JWT_SECRET. Set JWT_SECRET env var for production.')
    return 'dev-only-insecure-secret'
  }
  return secret
})()
const JWT_EXPIRE: string = process.env.JWT_EXPIRE || '7d'

export interface JwtPayload {
  id: string
  email: string
  designation: string
  // Approval state baked into the token so middleware can gate without a DB
  // round-trip. Optional for backward-compat with tokens minted before this
  // claim existed (see proxy.ts — only an explicit `false` is blocked).
  isApproved?: boolean
  integration?: { keyId: string }
}

export const generateToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRE } as any)
}

export const generateIntegrationToken = (payload: JwtPayload): string =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: 15 * 60, algorithm: 'HS256' })

export const verifyToken = (token: string): JwtPayload | null => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload
    return decoded
  } catch (error) {
    return null
  }
}

export const getTokenFromRequest = (request: NextApiRequest | NextRequest): string | null => {
  // Handle NextApiRequest (used in pages/api routes)
  if ('headers' in request && typeof request.headers === 'object' && !('get' in request.headers)) {
    const headers = request.headers as Record<string, string | string[]>
    const authHeader = headers['authorization'] as string | undefined
    if (!authHeader) return null
    
    const parts = authHeader.split(' ')
    if (parts.length !== 2 || parts[0] !== 'Bearer') return null
    
    return parts[1]
  }
  
  // Handle NextRequest (used in middleware)
  if ('headers' in request && typeof request.headers.get === 'function') {
    const authHeader = request.headers.get('authorization')
    if (!authHeader) return null
    
    const parts = authHeader.split(' ')
    if (parts.length !== 2 || parts[0] !== 'Bearer') return null
    
    return parts[1]
  }
  
  return null
}

export const createErrorResponse = (message: string, status: number) => {
  return NextResponse.json({ error: message }, { status })
}

export const createSuccessResponse = (data: any, status: number = 200) => {
  return NextResponse.json(data, { status })
}

// ── Permission helpers ──────────────────────────────────────

import prisma from '@/lib/prisma'
import { getRolePermissions } from '@/lib/roles-prd'

const ADMIN_DESIGNATIONS = ['Super Admin', 'Director', 'School Administrator']

const TASK_CAPABILITY_RULES = {
  canViewTasks: [
    'assign_daily_tasks',
    'assign_tasks',
    'manage_bookings',
    'approve_reject_tasks',
    'approve_groom_logs',
    'approve_instructor_updates',
    'view_assigned_tasks',
    'view_assigned_horses',
    'mark_task_completion',
    'submit_task_completion',
    'submit_task_updates',
    'submit_task_update',
    'submit_horse_care_logs',
    'log_work_performed',
    'mark_issue_status',
  ],
  canCreateTasks: ['assign_daily_tasks', 'assign_tasks'],
  canManageBookings: ['manage_bookings', 'assign_daily_tasks', 'assign_tasks'],
  canReviewTasks: [
    'approve_reject_tasks',
    'approve_groom_logs',
    'approve_instructor_updates',
  ],
  canWorkOnAssignedTasks: [
    'view_assigned_tasks',
    'view_assigned_horses',
    'mark_task_completion',
    'submit_task_completion',
    'submit_task_updates',
    'submit_task_update',
    'submit_horse_care_logs',
    'log_work_performed',
    'mark_issue_status',
  ],
  canManageHorseTeams: ['assign_horses_to_staff'],
  canViewInspections: [
    'submit_inspection_rounds',
    'view_inspection_rounds',
    'resolve_inspection_rounds',
    'inspections_read',
    'inspections_write',
    'inspections_resolve',
  ],
  canViewAllInspections: [
    'view_inspection_rounds',
    'resolve_inspection_rounds',
    'inspections_read',
    'inspections_resolve',
  ],
  canCreateInspections: ['submit_inspection_rounds', 'inspections_write'],
  canResolveInspections: ['resolve_inspection_rounds', 'inspections_resolve'],
  canUpdateOwnRoundChecks: ['update_own_round_checks'],
  canViewTeamRoundChecks: ['view_team_round_checks'],
  canViewMedicineLogs: [
    'log_medicine_administration',
    'record_treatment_notes',
    'approve_medicine_entries',
    'view_medical_alerts',
    'medicine_logs_read',
    'medicine_logs_write',
    'medicine_logs_approve',
  ],
  canViewHorseFeeds: [
    'add_feed_notes',
    'view_feed_compliance',
    'horse_feeds_read',
    'horse_feeds_write',
  ],
  canRecordHorseFeeds: ['add_feed_notes', 'horse_feeds_write'],
  canRecordMedicineLogs: [
    'log_medicine_administration',
    'record_treatment_notes',
    'medicine_logs_write',
  ],
  canApproveMedicineLogs: ['approve_medicine_entries', 'medicine_logs_approve'],
  canViewPendingMedicineLogs: ['approve_medicine_entries', 'medicine_logs_approve'],
  canViewOwnMedicineLogs: [
    'log_medicine_administration',
    'record_treatment_notes',
    'medicine_logs_read',
    'medicine_logs_write',
  ],
  canViewFarrierShoeing: [
    'log_farrier_visits',
    'record_hoof_work',
    'schedule_next_visit',
    'farrier_shoeing_read',
    'farrier_shoeing_write',
  ],
  canRecordFarrierShoeing: [
    'log_farrier_visits',
    'record_hoof_work',
    'schedule_next_visit',
    'farrier_shoeing_write',
  ],
  canReadFeedInventory: ['feed_inventory_read', 'feed_inventory_write'],
  canWriteFeedInventory: ['feed_inventory_write'],
  canReadMedicineInventory: ['medicine_inventory_read', 'medicine_inventory_write'],
  canWriteMedicineInventory: ['medicine_inventory_write'],
  canReadFarrierInventory: ['farrier_inventory_read', 'farrier_inventory_write'],
  canWriteFarrierInventory: ['farrier_inventory_write'],
  canReadTackInventory: ['tack_inventory_read', 'tack_inventory_write'],
  canWriteTackInventory: ['tack_inventory_write'],
  canReadHousekeepingInventory: ['housekeeping_inventory_read', 'housekeeping_inventory_write'],
  canWriteHousekeepingInventory: ['housekeeping_inventory_write'],
  canReadGrassBedding: ['grass_bedding_read', 'grass_bedding_write'],
  canWriteGrassBedding: ['grass_bedding_write'],
  canViewMeetings: ['meetings_read', 'meetings_write'],
  canWriteMeetings: ['meetings_write'],
  canManageMemberships: ['manage_memberships'],
} as const

export type TaskCapabilityKey = keyof typeof TASK_CAPABILITY_RULES
export type TaskCapabilities = Record<TaskCapabilityKey, boolean>

export type PermissionKey =
  | 'manageEmployees'
  | 'viewReports'
  | 'issueFines'
  | 'manageInventory'
  | 'manageSchedules'
  | 'viewPayroll'

type EmployeePermissionRecord = {
  manageEmployees: boolean
  viewReports: boolean
  issueFines: boolean
  manageInventory: boolean
  manageSchedules: boolean
  viewPayroll: boolean
}

export const isAdminDesignation = (designation?: string | null): boolean =>
  ADMIN_DESIGNATIONS.includes(designation || '')

/**
 * DB-aware version of {@link isAdminDesignation}, for the self-signup clamp.
 *
 * Admin roles are configurable at runtime (`Role.isAdmin`, editable from
 * /api/permissions/v2/roles), so the static ADMIN_DESIGNATIONS list goes stale
 * the moment an admin marks a new role privileged — and a self-signup could
 * then claim it and bypass every permission check. Checks both sources, and
 * fails CLOSED (treats the designation as privileged, so the caller clamps it
 * to the default role) if the role lookup is unavailable.
 */
export const isPrivilegedDesignation = async (
  designation?: string | null
): Promise<boolean> => {
  const value = (designation || '').trim()
  if (!value) return false
  if (ADMIN_DESIGNATIONS.includes(value)) return true
  try {
    const { isAdminRole } = await import('@/lib/permissions')
    return await isAdminRole(value)
  } catch (error) {
    console.error('[AUTH] admin-role lookup failed; treating designation as privileged:', error)
    return true
  }
}

// Roles that teach lessons and must only ever see their OWN incentives/bookings.
// Matched loosely so label variants ("Senior Instructor", "Head Riding Boy") are
// still scoped — the exact-string check used to leak other instructors' data.
export const isInstructorDesignation = (designation?: string | null): boolean => {
  const d = (designation || '').toLowerCase()
  return d.includes('instructor') || d.includes('riding boy')
}

const buildEffectiveTaskPermissionMap = (
  designation: string,
  overrides: Array<{ permission: string; granted: boolean }>
): Record<string, boolean> => {
  const effectivePermissions: Record<string, boolean> = {}

  for (const permission of getRolePermissions(designation)) {
    effectivePermissions[permission] = true
  }

  for (const override of overrides) {
    effectivePermissions[override.permission] = override.granted
  }

  return effectivePermissions
}

const buildTaskCapabilities = (
  effectivePermissions: Record<string, boolean>,
  isAdmin: boolean
): TaskCapabilities => {
  const capabilities = {} as TaskCapabilities

  for (const capability of Object.keys(TASK_CAPABILITY_RULES) as TaskCapabilityKey[]) {
    capabilities[capability] =
      isAdmin ||
      TASK_CAPABILITY_RULES[capability].some(
        (permission) => effectivePermissions[permission] === true
      )
  }

  return capabilities
}

const getEmployeePermissionRecord = async (
  employeeId: string
): Promise<EmployeePermissionRecord | null> => {
  if (!employeeId) {
    return null
  }

  return rememberJson<EmployeePermissionRecord | null>(
    cacheKeys.authPermissionMap(employeeId),
    CACHE_TTL_SECONDS.authPermissions,
    async () =>
      prisma.employeePermission.findUnique({
        where: { employeeId },
        select: {
          manageEmployees: true,
          viewReports: true,
          issueFines: true,
          manageInventory: true,
          manageSchedules: true,
          viewPayroll: true,
        },
      })
  )
}

export const getEffectiveTaskPermissionsForUser = async (
  employeeId: string,
  designation: string
): Promise<Record<string, boolean>> => {
  if (!employeeId) return {}

  return rememberJson<Record<string, boolean>>(
    cacheKeys.authTaskPermissionMap(employeeId, designation),
    CACHE_TTL_SECONDS.authTaskPermissions,
    async () => {
      const overrides = await prisma.employeeTaskPermission.findMany({
        where: { employeeId },
        select: {
          permission: true,
          granted: true,
        },
      })

      return buildEffectiveTaskPermissionMap(designation, overrides)
    }
  )
}

export const getTaskCapabilitiesForUser = async (
  employeeId: string,
  designation: string
): Promise<TaskCapabilities> => {
  return rememberJson<TaskCapabilities>(
    cacheKeys.authTaskCapabilities(employeeId, designation),
    CACHE_TTL_SECONDS.authTaskCapabilities,
    async () => {
      const isAdmin = isAdminDesignation(designation)
      const effectivePermissions = isAdmin
        ? {}
        : await getEffectiveTaskPermissionsForUser(employeeId, designation)

      return buildTaskCapabilities(effectivePermissions, isAdmin)
    }
  )
}

/**
 * Check whether a user (from JWT) has a specific permission.
 * Admins always pass. For others, look up the EmployeePermission row.
 * If no row exists the user falls back to *denied*.
 */
export const checkPermission = async (
  decoded: JwtPayload,
  permission: PermissionKey
): Promise<boolean> => {
  // Admins bypass permission checks
  if (isAdminDesignation(decoded.designation)) return true

  const row = await getEmployeePermissionRecord(decoded.id)
  return Boolean(row?.[permission])
}

/**
 * Check whether a user has a specific task-level permission.
 * Resolution order:
 *   1. Per-employee override in EmployeeTaskPermission → use it
 *   2. No override → fall back to role default from ROLE_PERMISSIONS
 * Admins always pass.
 */
export const checkTaskPermission = async (
  decoded: JwtPayload,
  permission: string
): Promise<boolean> => {
  // Admins bypass
  if (isAdminDesignation(decoded.designation)) return true

  const effectivePermissions = await getEffectiveTaskPermissionsForUser(
    decoded.id,
    decoded.designation
  )

  return effectivePermissions[permission] === true
}

export const checkTaskCapability = async (
  decoded: JwtPayload,
  capability: TaskCapabilityKey
): Promise<boolean> => {
  const capabilities = await getTaskCapabilitiesForUser(
    decoded.id,
    decoded.designation
  )

  return capabilities[capability] === true
}
