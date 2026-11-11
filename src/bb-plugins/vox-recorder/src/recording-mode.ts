import { stat } from 'node:fs/promises';
import { join } from 'node:path';

/** The marker follows the recording through renames and retranscription. */
export async function isRecordOnly(dir: string): Promise<boolean> {
  try { await stat(join(dir, 'record-only')); return true; }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}
