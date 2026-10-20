import { fileURLToPath } from 'node:url';

export default {
  poweredByHeader: false,
  // Workspace root: hoisted node_modules and shared/ live one level up.
  outputFileTracingRoot: fileURLToPath(new URL('..', import.meta.url)),
  serverExternalPackages: ['pg', 'undici'],
  // Compile shared/*.ts (request schemas used by API and website) from outside this package.
  experimental: { externalDir: true },
  async headers() { return [{ source: '/:path*', headers: [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'Cache-Control', value: 'no-store' }
  ] }]; }
};
