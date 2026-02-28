/**
 * Structured audit log for gateway operations.
 *
 * Logs all exec and fs operations to ~/.asm/audit.log as newline-delimited JSON.
 * Each entry includes timestamp, operation type, details, and result (allowed/denied).
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { logError } from './logger';

const ASM_DIR = join(homedir(), '.asm');
const AUDIT_LOG_PATH = process.env['GATEWAY_AUDIT_LOG'] ?? join(ASM_DIR, 'audit.log');

interface AuditEntry {
  timestamp: string;
  type: 'exec' | 'fs' | 'tunnel' | 'auth';
  action: string;
  details: Record<string, unknown>;
  result: 'allowed' | 'denied';
  reason?: string;
}

let initialized = false;

async function ensureDir(): Promise<void> {
  if (initialized) return;
  try {
    await mkdir(ASM_DIR, { recursive: true });
    initialized = true;
  } catch {
    // ignore
  }
}

export async function audit(entry: Omit<AuditEntry, 'timestamp'>): Promise<void> {
  try {
    await ensureDir();
    const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n';
    await appendFile(AUDIT_LOG_PATH, line);
  } catch (err) {
    logError('[audit] Failed to write audit log:', err);
  }
}
