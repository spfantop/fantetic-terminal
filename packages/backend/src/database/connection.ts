
import sqlite3, { OPEN_READWRITE, OPEN_CREATE } from 'sqlite3';
import path from 'path';
import { tableDefinitions } from './schema.registry';
import { runMigrations } from './migrations'; // +++ Import runMigrations +++
import { getAppDataPath } from '../config/app-data-path';

const dbFilename = 'fantetic-terminal.db';

const verboseSqlite3 = sqlite3.verbose();
let dbInstancePromise: Promise<sqlite3.Database> | null = null;

interface RunResult {
    lastID: number;
    changes: number;
}

const describeDatabaseError = (sql: string, parameterCount: number, error: Error): string => {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim();
    const statement = normalizedSql.slice(0, 160);
    return `[数据库错误] SQL: ${statement}${normalizedSql.length > 160 ? '...' : ''}; 参数数量: ${parameterCount}; 错误: ${error.message}`;
};


export const runDb = (db: sqlite3.Database, sql: string, params: any[] = []): Promise<RunResult> => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err: Error | null) {
            if (err) {
                console.error(describeDatabaseError(sql, params.length, err));
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
                console.error(describeDatabaseError(sql, params.length, err));
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
                console.error(describeDatabaseError(sql, params.length, err));
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
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
        console.error('[DB Init] 数据库初始化序列失败:', error);
        throw error;
    }
};


export const getDbInstance = (): Promise<sqlite3.Database> => {
    if (!dbInstancePromise) {
        const dbPath = path.join(getAppDataPath(), dbFilename);
        dbInstancePromise = new Promise((resolve, reject) => {
        
            const db = new verboseSqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, async (err) => { // Mark callback as async

                if (err) {
                    console.error(`[数据库连接] 打开数据库文件 ${dbPath} 时出错:`, err.message);
                    dbInstancePromise = null;
                    reject(err);
                    return;
                }


        
                try {

                    // 运行初始表创建
                    await runDatabaseInitializations(db);
                    // +++ 运行数据库迁移 +++
                    await runMigrations(db);
                    console.log('[数据库] 初始化和迁移完成。'); 
                    resolve(db);
                } catch (initError) {
                    console.error('[数据库] 连接后初始化失败，正在关闭连接...');
                    dbInstancePromise = null;
                    db.close((closeErr) => {
                        if (closeErr) console.error('[数据库] 初始化失败后关闭连接时出错:', closeErr.message);
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


