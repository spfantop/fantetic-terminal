
import sqlite3, { OPEN_READWRITE, OPEN_CREATE } from 'sqlite3';
import path from 'path';
import { tableDefinitions } from './schema.registry';
import { runMigrations } from './migrations'; // +++ Import runMigrations +++
import { getAppDataPath } from '../config/app-data-path';
import { createLogger } from '../logging/logger';
import { backendMetrics } from '../observability/metrics';

const dbFilename = 'fantetic-terminal.db';
const logger = createLogger('Database');

const verboseSqlite3 = sqlite3.verbose();
let dbInstancePromise: Promise<sqlite3.Database> | null = null;
const transactionTailMap = new WeakMap<sqlite3.Database, Promise<void>>();

interface RunResult {
    lastID: number;
    changes: number;
}

type BackupCapableDatabase = sqlite3.Database & {
    // sqlite3 exposes this API at runtime, but the bundled legacy typings omit it.
    backup(filename: string): {
        step(pages: number, callback: (error: Error | null) => void): void;
        finish(callback: (error: Error | null) => void): void;
    };
};

const describeDatabaseError = (sql: string, parameterCount: number, error: Error): string => {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim();
    const statement = normalizedSql.slice(0, 160);
    return `[数据库错误] SQL: ${statement}${normalizedSql.length > 160 ? '...' : ''}; 参数数量: ${parameterCount}; 错误: ${error.message}`;
};


export const runDb = (db: sqlite3.Database, sql: string, params: any[] = []): Promise<RunResult> => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err: Error | null) {
            if (err) {
                observeSqliteError(err);
                logger.error(describeDatabaseError(sql, params.length, err));
                reject(err);
            } else {
                resolve({ lastID: this.lastID, changes: this.changes });
            }
        });
    });
};


export const getDb = <T = any>(db: sqlite3.Database, sql: string, params: any[] = []): Promise<T | undefined> => {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err: Error | null, row: T) => {
            if (err) {
                observeSqliteError(err);
                logger.error(describeDatabaseError(sql, params.length, err));
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
};


export const allDb = <T = any>(db: sqlite3.Database, sql: string, params: any[] = []): Promise<T[]> => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err: Error | null, rows: T[]) => {
            if (err) {
                observeSqliteError(err);
                logger.error(describeDatabaseError(sql, params.length, err));
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
};

const observeSqliteError = (error: Error): void => {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') backendMetrics.recordSqliteBusyError();
};

export interface TransactionOptions {
    mode?: 'deferred' | 'immediate';
    reportRollbackFailure?: (rollbackError: Error, originalError: unknown) => void;
}

export const withTransaction = async <T>(
    db: sqlite3.Database,
    callback: (transactionDb: sqlite3.Database) => Promise<T>,
    {
        mode = 'deferred',
        reportRollbackFailure = (rollbackError, originalError) => {
            logger.error('数据库事务回滚失败，保留原始业务错误', { rollbackError, originalError });
        },
    }: TransactionOptions = {},
): Promise<T> => {
    const previousTail = transactionTailMap.get(db) ?? Promise.resolve();
    let releaseTurn!: () => void;
    const turn = new Promise<void>(resolve => { releaseTurn = resolve; });
    const currentTail = previousTail.then(() => turn);
    transactionTailMap.set(db, currentTail);

    await previousTail;
    try {
        await runDb(db, mode === 'immediate' ? 'BEGIN IMMEDIATE TRANSACTION' : 'BEGIN TRANSACTION');
        try {
            const result = await callback(db);
            await runDb(db, 'COMMIT');
            return result;
        } catch (error) {
            try {
                await runDb(db, 'ROLLBACK');
            } catch (rollbackError) {
                reportRollbackFailure(
                    rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)),
                    error,
                );
            }
            throw error;
        }
    } finally {
        releaseTurn();
        if (transactionTailMap.get(db) === currentTail) transactionTailMap.delete(db);
    }
};


export const configureDatabaseRuntime = async (db: sqlite3.Database): Promise<void> => {
    await runDb(db, 'PRAGMA foreign_keys = ON');
    await getDb(db, 'PRAGMA journal_mode = WAL');
    await runDb(db, 'PRAGMA synchronous = NORMAL');
    await runDb(db, 'PRAGMA busy_timeout = 5000');
    await runDb(db, 'PRAGMA wal_autocheckpoint = 1000');
    await runDb(db, 'PRAGMA journal_size_limit = 67108864');
    await runDb(db, 'PRAGMA cache_size = -20000');
};

const runDatabaseInitializations = async (db: sqlite3.Database): Promise<void> => {
    try {
        await configureDatabaseRuntime(db);
        for (const tableDef of tableDefinitions) {
            await runDb(db, tableDef.sql);
            if (tableDef.init) {
                await tableDef.init(db);
            }
        }
    } catch (error) {
        logger.error('数据库初始化序列失败', { error });
        throw error;
    }
};


export const getDbInstance = (): Promise<sqlite3.Database> => {
    if (!dbInstancePromise) {
        const dbPath = path.join(getAppDataPath(), dbFilename);
        dbInstancePromise = new Promise((resolve, reject) => {
        
            const db = new verboseSqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, async (err) => { // Mark callback as async

                if (err) {
                    logger.error('打开数据库文件时出错', { error: err, dbFilename });
                    dbInstancePromise = null;
                    reject(err);
                    return;
                }


        
                try {

                    // 运行初始表创建
                    await runDatabaseInitializations(db);
                    // +++ 运行数据库迁移 +++
                    await runMigrations(db);
                    logger.info('数据库初始化和迁移完成');
                    resolve(db);
                } catch (initError) {
                    logger.error('数据库连接后初始化失败，正在关闭连接', { error: initError });
                    dbInstancePromise = null;
                    db.close((closeErr) => {
                        if (closeErr) logger.error('初始化失败后关闭连接时出错', { error: closeErr });
                        reject(initError);
                    });

                }
            });
        });
    }
    return dbInstancePromise;
};

export const closeDbInstance = async (): Promise<void> => {
    const currentPromise = dbInstancePromise;
    if (!currentPromise) return;
    const db = await currentPromise;
    await new Promise<void>((resolve, reject) => {
        db.close((error) => error ? reject(error) : resolve());
    });
    if (dbInstancePromise === currentPromise) dbInstancePromise = null;
};

export const backupDatabaseTo = async (targetPath: string): Promise<void> => {
    const db = await getDbInstance();
    await new Promise<void>((resolve, reject) => {
        const backup = (db as BackupCapableDatabase).backup(targetPath);
        backup.step(-1, stepError => {
            if (stepError) {
                backup.finish(() => reject(stepError));
                return;
            }
            backup.finish(finishError => finishError ? reject(finishError) : resolve());
        });
    });
};

export const readDatabaseSchemaVersion = async (): Promise<number> => {
    const db = await getDbInstance();
    const row = await getDb<{ version: number | null }>(db, 'SELECT MAX(id) AS version FROM migrations');
    return row?.version ?? 0;
};


