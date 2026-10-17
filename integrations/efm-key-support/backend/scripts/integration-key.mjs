// Run only from an EFM administrator's server shell. The key is shown once.
import { createHash, randomBytes } from 'node:crypto'
import nextEnv from '@next/env'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Match next start's production env-file precedence, regardless of the shell's
// working directory. Never create keys in a lower-priority .env database.
export function loadIntegrationEnvironment(directory = fileURLToPath(new URL('..', import.meta.url))) {
  nextEnv.loadEnvConfig(directory, false, { info() {}, error() {} })
}

export async function manageIntegrationKey(prisma, args, write = console.log) {
  const [command, value, name = 'HRD'] = args
  if (command === 'create') {
    if (!value || !name.trim() || name.length > 100) throw new Error('Usage: integration:key -- create employee@example.com "HRD"')
    const employee = await prisma.employee.findUnique({ where: { email: value } })
    if (!employee || !employee.isApproved || employee.employmentStatus !== 'Active') throw new Error('Choose an existing approved active EFM employee.')
    const rawKey = `efm_live_${randomBytes(32).toString('base64url')}`
    const key = await prisma.efmIntegrationKey.create({ data: {
      name: name.trim(), employeeId: employee.id,
      keyHash: createHash('sha256').update(rawKey).digest('hex'), keyPrefix: rawKey.slice(0, 13),
    } })
    write(`Key ID: ${key.id}\nSave this key securely; it is shown only once:\n${rawKey}`)
    return
  }
  if (command === 'list') {
    const keys = await prisma.efmIntegrationKey.findMany({ select: {
      id: true, name: true, keyPrefix: true, employeeId: true,
      createdAt: true, lastUsedAt: true, revokedAt: true,
    }, orderBy: { createdAt: 'desc' } })
    write(JSON.stringify(keys, null, 2))
    return
  }
  if (command === 'revoke' && value) {
    await prisma.efmIntegrationKey.update({ where: { id: value }, data: { revokedAt: new Date() } })
    write('Key revoked. Already-issued integration tokens are rejected on their next request.')
    return
  }
  throw new Error('Usage: integration:key -- create <employee-email> [name] | list | revoke <key-id>')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadIntegrationEnvironment()
  // Import after Next's env loader; Prisma's generated client can otherwise
  // load .env during module initialization before production settings win.
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()
  try { await manageIntegrationKey(prisma, process.argv.slice(2)) }
  catch { console.error('Integration key command failed. Check the command, approved account, migration and database access.'); process.exitCode = 1 }
  finally { await prisma.$disconnect() }
}
