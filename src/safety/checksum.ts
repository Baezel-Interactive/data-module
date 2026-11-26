import { createHash } from 'node:crypto';

export function migrationChecksum(source: string): string {
  return createHash('sha256').update(source.replace(/\r\n?/g, '\n')).digest('hex');
}
