import crypto from 'node:crypto';
import { Database } from 'sqlite3';

import { allDb, getDb as getDbRow, getDbInstance, runDb, withTransaction } from '../database/connection';
import { AuditLogActionType, AuditLogEntry } from '../types/audit.types';
import type { AuditContext } from './audit-context';

type DbAuditLogRow = AuditLogEntry;
type ChainRow = AuditLogEntry & { previous_hash: string | null; entry_hash: string | null };
const AUDIT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

const readMaxAuditEntries = (): number => {
  const value = Number(process.env.AUDIT_MAX_ENTRIES ?? 50000);
  return Number.isInteger(value) && value >= 1000 && value <= 10_000_000 ? value : 50000;
};

type HashInput = Omit<ChainRow, 'id' | 'entry_hash'>;

const normalizeHashValue = (value: unknown): string | number | null => (
  value === undefined ? null : value as string | number | null
);

/**
 * A fixed field order makes the chain portable across SQLite versions and avoids
 * hashes changing because an object happened to be constructed differently.
 */
export const calculateAuditEntryHash = (entry: HashInput): string => {
  const content = JSON.stringify([
    normalizeHashValue(entry.previous_hash),
    normalizeHashValue(entry.timestamp),
    normalizeHashValue(entry.action_type),
    normalizeHashValue(entry.details),
    normalizeHashValue(entry.request_id),
    normalizeHashValue(entry.actor_user_id),
    normalizeHashValue(entry.actor_username),
    normalizeHashValue(entry.actor_role),
    normalizeHashValue(entry.source_ip),
    normalizeHashValue(entry.asset_id),
    normalizeHashValue(entry.session_id),
    normalizeHashValue(entry.result),
  ]);
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
};

export type AuditChainVerification = {
  valid: boolean;
  checkedEntries: number;
  legacyEntries: number;
  error?: string;
};

export type AuditSearchPlan =
  | { kind: 'fts'; matchExpression: string }
  | { kind: 'like'; value: string };

/**
 * FTS5 accepts its own query grammar. Restrict its fast path to portable
 * alphanumeric tokens and keep all other input on the parameterised LIKE
 * fallback, preserving Chinese and punctuation-heavy searches.
 */
export const createAuditSearchPlan = (searchTerm?: string): AuditSearchPlan | undefined => {
  const normalized = searchTerm?.trim();
  if (!normalized) return undefined;
  const tokenList = normalized.match(/[A-Za-z0-9_]{2,}/g) ?? [];
  if (tokenList.length > 0 && tokenList.join(' ').length >= 2) {
    return { kind: 'fts', matchExpression: tokenList.map(token => `${token}*`).join(' AND ') };
  }
  return { kind: 'like', value: `%${normalized}%` };
};

/**
 * Verifies the in-database append-only chain. Records written before migration
 * 26 remain readable as legacy entries; the first signed record deliberately
 * starts a new chain rather than rewriting historical evidence.
 */
export const verifyAuditLogChain = async (db: Database): Promise<AuditChainVerification> => {
  const rowList = await allDb<ChainRow>(db, `
    SELECT id, timestamp, action_type, details, request_id, actor_user_id,
      actor_username, actor_role, source_ip, asset_id, session_id, result,
      previous_hash, entry_hash
    FROM audit_logs ORDER BY id ASC
  `);
  let legacyEntries = 0;
  let checkedEntries = 0;
  let expectedPreviousHash: string | null = null;
  let signedChainStarted = false;

  for (const row of rowList) {
    if (!row.entry_hash) {
      if (signedChainStarted) {
        return {
          valid: false, checkedEntries, legacyEntries,
          error: `unsigned audit log appears after signed chain at audit log ${row.id}`,
        };
      }
      legacyEntries += 1;
      continue;
    }
    signedChainStarted = true;
    checkedEntries += 1;
    if (row.previous_hash !== expectedPreviousHash) {
      return {
        valid: false, checkedEntries, legacyEntries,
        error: `previous hash mismatch at audit log ${row.id}`,
      };
    }
    const expectedEntryHash = calculateAuditEntryHash(row);
    if (row.entry_hash !== expectedEntryHash) {
      return {
        valid: false, checkedEntries, legacyEntries,
        error: `entry hash mismatch at audit log ${row.id}`,
      };
    }
    expectedPreviousHash = row.entry_hash;
  }
  return { valid: true, checkedEntries, legacyEntries };
};

interface AuditRepositoryDependencies {
  getDatabase: () => Promise<Database>;
  execute: (db: Database, sql: string, params?: any[]) => Promise<{ lastID: number; changes: number }>;
  readCount: (db: Database, sql: string) => Promise<{ total: number } | undefined>;
  readLatestHash: (db: Database) => Promise<{ entry_hash: string } | undefined>;
  transaction: <T>(db: Database, callback: (transactionDb: Database) => Promise<T>) => Promise<T>;
  now: () => number;
  reportCleanupFailure: (error: Error) => void;
  reportRetentionThreshold: (total: number, maximum: number) => void;
}

export interface AuditRepositoryWriteResult {
  cleanup: 'skipped' | 'succeeded' | 'failed';
  cleanupError?: Error;
}

export class AuditLogRepository {
  private lastCleanupAt = 0;
  private readonly dependencies: AuditRepositoryDependencies;

  constructor(dependencies: Partial<AuditRepositoryDependencies> = {}) {
    this.dependencies = {
      getDatabase: getDbInstance,
      execute: runDb,
      readCount: (db, sql) => getDbRow<{ total: number }>(db, sql),
      readLatestHash: db => getDbRow<{ entry_hash: string }>(db, `
        SELECT entry_hash FROM audit_logs
        WHERE entry_hash IS NOT NULL
        ORDER BY id DESC LIMIT 1
      `),
      transaction: (db, callback) => withTransaction(db, callback, { mode: 'immediate' }),
      now: Date.now,
      reportCleanupFailure: error => console.error('[审计日志] 审计保留检查失败:', error),
      reportRetentionThreshold: (total, maximum) => console.error(
        `[审计日志] 审计记录数量 (${total}) 超过软阈值 (${maximum})；append-only 策略禁止本地删除，请归档至外部不可篡改存储。`,
      ),
      ...dependencies,
    };
  }

  async addLog(
    actionType: AuditLogActionType,
    details?: Record<string, any> | string | null,
    metadata: Partial<AuditContext> & { assetId?: number; sessionId?: string; result?: AuditLogEntry['result'] } = {},
  ): Promise<AuditRepositoryWriteResult> {
    const timestamp = Math.floor(this.dependencies.now() / 1000);
    let detailsString: string | null = null;
    if (details) {
      try {
        detailsString = typeof details === 'string' ? details : JSON.stringify(details);
      } catch (error: any) {
        console.error(`[审计日志] 序列化操作 ${actionType} 的详情失败:`, error.message);
        detailsString = JSON.stringify({ error: 'Failed to stringify details', originalDetails: String(details) });
      }
    }

    const db = await this.dependencies.getDatabase();
    await this.dependencies.transaction(db, async transactionDb => {
      const latest = await this.dependencies.readLatestHash(transactionDb);
      const entry: HashInput = {
        previous_hash: latest?.entry_hash ?? null,
        timestamp,
        action_type: actionType,
        details: detailsString,
        request_id: metadata.requestId ?? null,
        actor_user_id: metadata.actorUserId ?? null,
        actor_username: metadata.actorUsername ?? null,
        actor_role: metadata.actorRole ?? null,
        source_ip: metadata.sourceIp ?? null,
        asset_id: metadata.assetId ?? null,
        session_id: metadata.sessionId ?? null,
        result: metadata.result ?? 'success',
      };
      const entryHash = calculateAuditEntryHash(entry);
      await this.dependencies.execute(transactionDb, `INSERT INTO audit_logs (
        timestamp, action_type, details, request_id, actor_user_id, actor_username,
        actor_role, source_ip, asset_id, session_id, result, previous_hash, entry_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        entry.timestamp, entry.action_type, entry.details, entry.request_id, entry.actor_user_id,
        entry.actor_username, entry.actor_role, entry.source_ip, entry.asset_id, entry.session_id,
        entry.result, entry.previous_hash, entryHash,
      ]);
    });

    const now = this.dependencies.now();
    if (now - this.lastCleanupAt < AUDIT_CLEANUP_INTERVAL_MS) return { cleanup: 'skipped' };
    this.lastCleanupAt = now;
    try {
      await this.checkRetentionThreshold(db);
      return { cleanup: 'succeeded' };
    } catch (error) {
      const cleanupError = error instanceof Error ? error : new Error(String(error));
      this.dependencies.reportCleanupFailure(cleanupError);
      return { cleanup: 'failed', cleanupError };
    }
  }

  /** Local retention is alert-only: deleting a chained record would break evidence. */
  private async checkRetentionThreshold(db: Database): Promise<void> {
    const maximum = readMaxAuditEntries();
    const total = (await this.dependencies.readCount(db, 'SELECT COUNT(*) as total FROM audit_logs'))?.total ?? 0;
    if (total > maximum) this.dependencies.reportRetentionThreshold(total, maximum);
  }

  async getLogs(
    limit = 50,
    offset = 0,
    actionType?: AuditLogActionType,
    startDate?: number,
    endDate?: number,
    searchTerm?: string,
    result?: AuditLogEntry['result'],
  ): Promise<{ logs: AuditLogEntry[]; total: number }> {
    let baseSql = 'SELECT * FROM audit_logs';
    let countSql = 'SELECT COUNT(*) as total FROM audit_logs';
    const whereClauses: string[] = [];
    const params: (string | number)[] = [];
    const countParams: (string | number)[] = [];
    if (actionType) { whereClauses.push('action_type = ?'); params.push(actionType); countParams.push(actionType); }
    if (startDate !== undefined) { whereClauses.push('timestamp >= ?'); params.push(startDate); countParams.push(startDate); }
    if (endDate !== undefined) { whereClauses.push('timestamp <= ?'); params.push(endDate); countParams.push(endDate); }
    if (result) { whereClauses.push('result = ?'); params.push(result); countParams.push(result); }
    const searchPlan = createAuditSearchPlan(searchTerm);
    if (searchPlan?.kind === 'fts') {
      whereClauses.push('id IN (SELECT rowid FROM audit_logs_fts WHERE audit_logs_fts MATCH ?)');
      params.push(searchPlan.matchExpression);
      countParams.push(searchPlan.matchExpression);
    } else if (searchPlan) {
      whereClauses.push('(details LIKE ? OR actor_username LIKE ? OR source_ip LIKE ? OR request_id LIKE ? OR session_id LIKE ?)');
      const searchTermLike = searchPlan.value;
      params.push(searchTermLike, searchTermLike, searchTermLike, searchTermLike, searchTermLike);
      countParams.push(searchTermLike, searchTermLike, searchTermLike, searchTermLike, searchTermLike);
    }
    if (whereClauses.length > 0) {
      const whereSql = ` WHERE ${whereClauses.join(' AND ')}`;
      baseSql += whereSql;
      countSql += whereSql;
    }
    baseSql += ' ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    try {
      const db = await this.dependencies.getDatabase();
      const countRow = await getDbRow<{ total: number }>(db, countSql, countParams);
      return { logs: await allDb<DbAuditLogRow>(db, baseSql, params), total: countRow?.total ?? 0 };
    } catch (error: any) {
      console.error(`获取审计日志时出错:`, error.message);
      throw new Error(`获取审计日志时出错: ${error.message}`);
    }
  }
}
