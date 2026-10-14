import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
function key(): Buffer {
  const value = process.env.TOKEN_ENCRYPTION_KEY || '';
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 32 || decoded.toString('base64') !== value) throw new Error('TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  return decoded;
}
export function encryptToken(token: string, clubId: string): string {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(clubId));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(v => v.toString('base64')).join('.');
}
export function decryptToken(value: string, clubId: string): string {
  const [iv, tag, ciphertext] = value.split('.').map(v => Buffer.from(v, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key(), iv); decipher.setAAD(Buffer.from(clubId)); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function tokenExpiry(token: string): Date | null {
  // Display/scheduling hint only. EFM verifies authenticity through auth/me.
  try { const { exp } = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return typeof exp === 'number' && Number.isFinite(exp) && exp > 0 && exp < 253402300800 ? new Date(exp * 1000) : null;
  } catch { return null; }
}
