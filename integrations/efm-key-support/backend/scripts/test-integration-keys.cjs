// No live database, Redis or EFM traffic. Exercise the actual auth/proxy/route.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')

function load(relative, mocks) {
  const exports = {}
  const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
  vm.runInNewContext(code, { exports, Buffer, Date, console, process: { env: { NODE_ENV: 'production', JWT_SECRET: 'test-only-secret-with-at-least-32-characters' } }, require: name => name in mocks ? mocks[name] : require(name) })
  return exports
}
const employee = { id: 'employee-1', email: 'integration@example.com', designation: 'Super Admin', isApproved: true, employmentStatus: 'Active' }
let keyRow = null, unavailable = false, blocked = false, rateAllowed = true, feedAllowed = true
const feedQueries = []
const prisma = {
  efmIntegrationKey: {
    findUnique: async ({ where }) => { if (unavailable) throw new Error('database unavailable'); return keyRow && (where.id === keyRow.id || where.keyHash === keyRow.keyHash) ? keyRow : null },
    update: async ({ where, data }) => { assert.equal(where.id, keyRow.id); Object.assign(keyRow, data); return keyRow },
    create: async ({ data }) => { keyRow = { ...data, id: 'key-1', revokedAt: null, employee }; return keyRow },
    findMany: async ({ select }) => [{ ...Object.fromEntries(Object.keys(select).map(k => [k, keyRow[k]])) }],
  },
  employee: { findUnique: async ({ where }) => where.email === employee.email ? employee : null },
  horseFeed: {
    findMany: async query => { feedQueries.push(query); return [{ id: 'plan-1', horseId: 'horse-1', oats: 2, temporaryMenuName: 'Fixture menu' }] },
    count: async () => 1,
  },
  groceryTracker: {
    findMany: async query => { check(query.where.category.not, 'NON-FOOD ITEMS'); return [{ id: 'usage-1', itemName: 'Fixture rice', w1Used: 2 }] },
    count: async () => 1,
  },
}
const cache = { isEmployeeBlocked: async () => blocked, rememberJson: async (_k, _ttl, loader) => loader() }
const server = require('next/server')
const auth = load('src/lib/auth.ts', { '@/lib/prisma': { __esModule: true, default: prisma }, '@/lib/cache': cache, '@/lib/cacheKeys': {}, '@/lib/roles-prd': {} })
const keys = load('src/lib/integrationKeys.ts', { '@/lib/prisma': { __esModule: true, default: prisma }, '@/lib/redis': { getRedisClient: async () => null, getRedisKeyPrefix: () => 'test' } })
const mocks = { '@/lib/auth': auth, '@/lib/cache': cache, '@/lib/integrationKeys': keys, '@/lib/prisma': { __esModule: true, default: prisma }, '@/lib/cors': { corsHeadersFor: () => ({}) }, '@/lib/rateLimit': { rateLimit: async () => ({ allowed: rateAllowed, resetAt: Math.floor(Date.now() / 1000) + 60 }) }, 'next/server': server }
const exchange = load('src/pages/api/integrations/token.ts', mocks).default
const proxy = load('src/proxy.ts', mocks).default
const feedPlans = load('src/pages/api/integrations/horse-feed-plans.ts', { ...mocks,
  '@/lib/auth': { ...auth, getTaskCapabilitiesForUser: async () => ({ canViewHorseFeeds: false, canRecordHorseFeeds: false }) },
  '@/lib/permissions': { hasFeaturePermission: async () => feedAllowed },
  '@/lib/withAuth': { withAuth: handler => (req, res) => handler(req, res, employee) },
}).default
const groceryUsage = load('src/pages/api/integrations/grocery-usage.ts', { ...mocks,
  '@/lib/permissions': { hasFeaturePermission: async () => feedAllowed },
  '@/lib/withAuth': { withAuth: handler => (req, res) => handler(req, res, employee) },
}).default
const manifest = load('src/pages/api/integrations/manifest.ts', { ...mocks,
  '@/lib/integration-route-catalog.json': JSON.parse(fs.readFileSync(path.join(__dirname, '../src/lib/integration-route-catalog.json'), 'utf8')),
  '@/lib/withAuth': { withAuth: handler => (req, res) => handler(req, res, { ...employee, integration: { keyId: keyRow?.id } }) },
}).default
const request = (method, route, token) => ({ method, nextUrl: new URL(`https://efm.example.com${route}`), headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}) })
async function call(body, method = 'POST', route = exchange, query = {}) {
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, status(n) { this.statusCode = n; return this }, json(data) { this.data = data; return this } }
  await route({ method, body, query, headers: {}, socket: {} }, res)
  return res
}
let checks = 0
const check = (actual, expected) => { assert.equal(actual, expected); checks++ }

;(async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'efm-env-test-'))
  try {
    fs.writeFileSync(path.join(fixture, '.env'), 'DATABASE_URL=fixture-base\n')
    fs.writeFileSync(path.join(fixture, '.env.production'), 'DATABASE_URL=fixture-production\n')
    fs.writeFileSync(path.join(fixture, '.env.production.local'), 'DATABASE_URL=fixture-production-local\n')
    const script = pathToFileURL(path.join(__dirname, 'integration-key.mjs')).href
    const args = ['--input-type=module', '-e', 'const {loadIntegrationEnvironment}=await import(process.argv[1]);loadIntegrationEnvironment(process.argv[2]);process.stdout.write(process.env.DATABASE_URL===process.argv[3]?"expected":"unexpected")', script, fixture, 'fixture-production-local']
    const selected = spawnSync(process.execPath, args, { encoding: 'utf8', env: { PATH: process.env.PATH, NODE_ENV: 'production' } })
    check(selected.status, 0); check(selected.stdout, 'expected')
    const external = spawnSync(process.execPath, [...args.slice(0,-1), 'fixture-external'], { encoding: 'utf8', env: { PATH: process.env.PATH, NODE_ENV: 'production', DATABASE_URL: 'fixture-external' } })
    check(external.status, 0); check(external.stdout, 'expected')
  } finally { fs.rmSync(fixture, { recursive: true, force: true }) }
  const { manageIntegrationKey } = await import('./integration-key.mjs')
  const output = []
  await manageIntegrationKey(prisma, ['create', employee.email, 'HRD'], message => output.push(message))
  const rawKey = output[0].split('\n').at(-1)
  check(keys.isWellFormedIntegrationKey(rawKey), true)
  check(keyRow.keyHash, keys.hashIntegrationKey(rawKey))
  check(JSON.stringify(keyRow).includes(rawKey), false)
  check(keys.integrationKeyDisplayPrefix(rawKey), keyRow.keyPrefix)
  await manageIntegrationKey(prisma, ['list'], message => output.push(message))
  check(output.at(-1).includes(rawKey), false)
  check(output.at(-1).includes(keyRow.keyHash), false)
  employee.isApproved = false
  await assert.rejects(manageIntegrationKey(prisma, ['create', employee.email]))
  check((await call({ key: rawKey })).statusCode, 401)
  employee.isApproved = true
  employee.employmentStatus = 'Terminated'
  await assert.rejects(manageIntegrationKey(prisma, ['create', employee.email]))
  check((await call({ key: rawKey })).statusCode, 401)
  employee.employmentStatus = 'Active'
  check((await call({ key: 'efm_live_invalid' })).statusCode, 401)
  check((await call({ key: keys.generateIntegrationKey() })).statusCode, 401)
  check((await call({ key: rawKey }, 'GET')).statusCode, 405)
  rateAllowed = false; check((await call({ key: rawKey })).statusCode, 429); rateAllowed = true
  const issued = await call({ key: rawKey })
  check(issued.statusCode, 200); check(issued.headers['Cache-Control'], 'no-store')
  check(issued.data.expiresIn, 900)
  const decoded = auth.verifyToken(issued.data.token)
  check(decoded.exp - decoded.iat, 900); check(decoded.integration.keyId, keyRow.id)
  check(decoded.id, employee.id)
  check(JSON.stringify(issued.data).includes(rawKey), false)
  const plans = await call(null, 'GET', feedPlans, { skip: '0', take: '500' })
  check(plans.statusCode, 200); check(plans.data.pagination.total, 1); check(plans.data.data[0].temporaryMenuName, 'Fixture menu')
  check(feedQueries[0].take, 500); check(feedQueries[0].select.menuCompletionNotifiedAt, undefined)
  check((await call(null, 'POST', feedPlans)).statusCode, 405)
  check((await call(null, 'GET', feedPlans, { take: '501' })).statusCode, 400)
  feedAllowed = false; check((await call(null, 'GET', feedPlans)).statusCode, 403); feedAllowed = true
  const usage = await call(null, 'GET', groceryUsage, { skip: '0', take: '500' })
  check(usage.statusCode, 200); check(usage.data.data[0].w1Used, 2)
  check((await call(null, 'POST', groceryUsage)).statusCode, 405)
  check((await call(null, 'GET', groceryUsage, { skip: '-1' })).statusCode, 400)
  feedAllowed = false; check((await call(null, 'GET', groceryUsage)).statusCode, 403); feedAllowed = true
  const discovered = await call(null, 'GET', manifest)
  check(discovered.statusCode, 200); check(discovered.data.readOnly, true)
  check(discovered.data.routes.some(route => route.path === '/api/integrations/horse-feed-plans'), true)
  check(discovered.data.rateLimits.tokenExchange.requests, 30)
  check((await call(null, 'POST', manifest)).statusCode, 405)
  check((await proxy(request('GET', '/api/horses', issued.data.token))).status, 200)
  for (const route of ['/api/auth/me', '/api/employees', '/api/employees/employee-1', '/api/horse-care-team', '/api/health-records', '/api/medicine-logs', '/api/feed-inventory', '/api/feed-inventory/consumption-report', '/api/groceries-inventory', '/api/integrations/horse-feed-plans', '/api/integrations/grocery-usage', '/api/integrations/manifest']) {
    check((await proxy(request('GET', route, issued.data.token))).status, 200)
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) check((await proxy(request(method, '/api/horses', issued.data.token))).status, 403)
  for (const route of ['/api/horse-feeds', '/api/horse-feeds/summary', '/api/stock-tracker', '/api/grocery-tracker', '/api/tasks', '/api/settings']) check((await proxy(request('GET', route, issued.data.token))).status, 403)
  check((await proxy(request('GET', '/api/horses', rawKey))).status, 401)
  const legacy = auth.generateToken({ ...employee })
  check((await proxy(request('POST', '/api/horses', legacy))).status, 200)
  check(auth.verifyToken(legacy).exp - auth.verifyToken(legacy).iat, 7 * 24 * 60 * 60)
  check((await proxy(request('GET', '/api/horses'))).status, 401)
  check((await proxy(request('POST', '/api/integrations/token'))).status, 200)
  blocked = true
  check((await call({ key: rawKey })).statusCode, 401)
  check((await proxy(request('GET', '/api/horses', issued.data.token))).status, 401)
  blocked = false
  employee.employmentStatus = 'Inactive'
  check((await proxy(request('GET', '/api/horses', issued.data.token))).status, 401)
  employee.employmentStatus = 'Active'
  employee.isApproved = false
  check((await proxy(request('GET', '/api/horses', issued.data.token))).status, 401)
  employee.isApproved = true
  employee.designation = 'Groom'
  check((await proxy(request('GET', '/api/horses', issued.data.token))).status, 401)
  employee.designation = 'Super Admin'
  const other = auth.generateIntegrationToken({ ...employee, id: 'someone-else', integration: { keyId: keyRow.id } })
  check((await proxy(request('GET', '/api/horses', other))).status, 401)
  unavailable = true
  check((await call({ key: rawKey })).statusCode, 503)
  check((await proxy(request('GET', '/api/horses', issued.data.token))).status, 503)
  unavailable = false
  await manageIntegrationKey(prisma, ['revoke', keyRow.id], () => {})
  check((await call({ key: rawKey })).statusCode, 401)
  check((await proxy(request('GET', '/api/horses', issued.data.token))).status, 401)
  console.log(`${checks} integration key issuance, renewal, read restrictions, revocation and legacy-auth checks passed.`)
})().catch(error => { console.error(error); process.exitCode = 1 })
