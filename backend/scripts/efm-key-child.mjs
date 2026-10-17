// Runs inside the EFM backend directory with EFM's own environment (spawned by link-efm-club.ts).
// Writes one JSON line to stdout for the parent pipe; never prints the key to a terminal.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const [command, value, name] = process.argv.slice(2);
const efmDir = process.cwd();
const cli = await import(pathToFileURL(join(efmDir, 'scripts/integration-key.mjs')).href);
cli.loadIntegrationEnvironment();
const { PrismaClient } = createRequire(join(efmDir, 'package.json'))('@prisma/client');
const prisma = new PrismaClient();
try {
  let result;
  await cli.manageIntegrationKey(prisma, command === 'create' ? ['create', value, name] : ['revoke', value], out => {
    if (command === 'create') {
      const id = /Key ID: (\S+)/.exec(out)?.[1];
      const key = /(efm_live_[A-Za-z0-9_-]+)/.exec(out)?.[1];
      if (!id || !key) throw new Error('Unexpected key output');
      result = { id, key };
    } else result = { revoked: true };
  });
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  process.stderr.write(`EFM key ${command} failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
