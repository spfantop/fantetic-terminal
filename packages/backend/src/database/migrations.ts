import { Database } from 'sqlite3';
import {
    addUserAuthenticationEpochSQL,
    migrateLegacyResourcesToAccessControlSQL,
    migrateQuickCommandTagsToOwnerScopedNamesSQL,
    migrateTerminalThemesToOwnerScopedNamesSQL,
    migrateTagsToOwnerScopedNamesSQL,
    migrateUserPrivateResourcesSQL,
} from '../access-control/access-control.schema';
import { createLogger } from '../logging/logger';

const logger = createLogger('DatabaseMigrations');

// 1. 定义 migrations 表 SQL
const createMigrationsTableSQL = `
CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY, -- 迁移的版本号
    name TEXT NOT NULL,     -- 迁移的描述性名称
    applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')) -- 应用迁移的时间戳
);
`;

// 2. 定义迁移列表
// 注意：这里的迁移应该代表数据库模式从某个已知状态到下一个状态的变化。
// 初始模式通常在 database.ts 中通过 schema.registry.ts 创建。
// 这里的迁移应该从版本 1 开始，代表初始模式创建后的第一个变更。
interface Migration {
    id: number;
    name: string;
    sql: string; // 可以是多条 SQL 语句，用 ; 分隔。db.exec 会处理。
    check?: (db: Database) => Promise<boolean>; // 可选的前置检查函数
    apply?: (db: Database) => Promise<void>; // 需要按对象精确修复的迁移使用自定义执行逻辑
}

// 辅助函数：检查表是否存在
const tableExists = async (db: Database, tableName: string): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        db.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [tableName], (err, row) => {
            if (err) reject(err);
            else resolve(!!row);
        });
    });
};

// 辅助函数：检查列是否存在
const columnExists = async (db: Database, tableName: string, columnName: string): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        db.all(`PRAGMA table_info(${tableName})`, (err, columns: any[]) => {
            if (err) reject(err);
            else resolve(columns.some(col => col.name === columnName));
        });
    });
};

const indexExists = async (db: Database, indexName: string): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        db.get("SELECT name FROM sqlite_master WHERE type='index' AND name=?", [indexName], (err, row) => {
            if (err) reject(err);
            else resolve(!!row);
        });
    });
};

const triggerExists = async (db: Database, triggerName: string): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        db.get("SELECT name FROM sqlite_master WHERE type='trigger' AND name=?", [triggerName], (err, row) => {
            if (err) reject(err);
            else resolve(!!row);
        });
    });
};

const execMigrationSql = async (db: Database, sql: string): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
        db.exec(sql, error => error ? reject(error) : resolve());
    });
};

const addColumnIfMissing = async (
    db: Database,
    tableName: string,
    columnName: string,
    columnDefinition: string,
): Promise<void> => {
    if (!(await columnExists(db, tableName, columnName))) {
        await execMigrationSql(db, `ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
    }
};

// 辅助函数：获取表的创建 SQL
const getTableCreateSQL = async (db: Database, tableName: string): Promise<string | null> => {
    return new Promise((resolve, reject) => {
        db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", [tableName], (err, row: any) => {
            if (err) reject(err);
            else resolve(row ? row.sql : null);
        });
    });
};


const definedMigrations: Migration[] = [
    {
        id: 1,
        name: 'Add ssh_keys table and update connections table for SSH key management',
        check: async (db: Database): Promise<boolean> => {
            const sshKeysTableExists = await tableExists(db, 'ssh_keys');
            const connectionsTableExists = await tableExists(db, 'connections'); // 确保 connections 表存在再检查列
            const sshKeyIdColumnExists = connectionsTableExists ? await columnExists(db, 'connections', 'ssh_key_id') : false;
            // 如果 ssh_keys 表不存在 或 connections 表的 ssh_key_id 列不存在，则需要运行迁移
            return !sshKeysTableExists || !sshKeyIdColumnExists;
        },
        sql: `
            -- 创建 ssh_keys 表 (使用 IF NOT EXISTS 保证幂等性)
            CREATE TABLE IF NOT EXISTS ssh_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                encrypted_private_key TEXT NOT NULL,
                encrypted_passphrase TEXT NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            );

            -- 为 connections 表添加 ssh_key_id 列及外键。
            -- check 会在列已存在时跳过此单列 ALTER。
            ALTER TABLE connections ADD COLUMN ssh_key_id INTEGER NULL REFERENCES ssh_keys(id) ON DELETE SET NULL;

            -- 可选: 对旧数据进行清理或更新
            -- UPDATE connections SET encrypted_private_key = NULL WHERE encrypted_private_key = ''; -- 示例
            -- UPDATE connections SET encrypted_passphrase = NULL WHERE encrypted_passphrase = ''; -- 示例
        `
    },
    // --- Quick Command Tags Migrations ---
    {
        id: 2,
        name: 'Create quick_command_tags table',
        check: async (db: Database): Promise<boolean> => {
            const tableAlreadyExists = await tableExists(db, 'quick_command_tags');
            return !tableAlreadyExists; // Only run if the table does NOT exist
        },
        sql: `
            CREATE TABLE IF NOT EXISTS quick_command_tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            );
        `
    },
    {
        id: 3,
        name: 'Create quick_command_tag_associations table',
        check: async (db: Database): Promise<boolean> => {
            const tableAlreadyExists = await tableExists(db, 'quick_command_tag_associations');
            return !tableAlreadyExists; // Only run if the table does NOT exist
        },
        sql: `
            CREATE TABLE IF NOT EXISTS quick_command_tag_associations (
                quick_command_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY (quick_command_id, tag_id),
                FOREIGN KEY (quick_command_id) REFERENCES quick_commands(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES quick_command_tags(id) ON DELETE CASCADE
            );
        `
    }
,
{
        id: 4,
        name: 'Add notes column to connections table',
        check: async (db: Database): Promise<boolean> => {
            const notesColumnExists = await columnExists(db, 'connections', 'notes');
            return !notesColumnExists;
        },
        sql: `
            -- Add the notes column to the connections table, allowing NULL values
            ALTER TABLE connections ADD COLUMN notes TEXT NULL;
        `
    },
    {
        id: 5,
        name: 'Update connections table to allow VNC type in CHECK constraint',
        check: async (db: Database): Promise<boolean> => {
            const createSQL = await getTableCreateSQL(db, 'connections');
            if (createSQL) {
                // 检查 CHECK 约束是否已经包含了 VNC
                // 这会检查 'VNC' 是否是允许的类型之一
                // 例如: CHECK(type IN ('SSH', 'RDP', 'VNC'))
                const constraintRegex = /CHECK\s*\(\s*LOWER\(type\)\s+IN\s*\(([^)]+)\)\s*\)/i; // 兼容大小写不敏感的检查
                const constraintRegexStrict = /CHECK\s*\(\s*type\s+IN\s*\(([^)]+)\)\s*\)/i;
                
                let match = createSQL.match(constraintRegex);
                if (!match) {
                    match = createSQL.match(constraintRegexStrict);
                }

                if (match && match[1]) {
                    const allowedTypes = match[1].split(',').map(t => t.trim().replace(/'/g, "").toLowerCase());
                    return !allowedTypes.includes('vnc'); // 如果 'vnc' 不在允许类型中，则需要运行迁移
                }
                // 如果没有找到明确的 CHECK 约束或格式不匹配，保守地运行迁移
                logger.warn('无法解析 connections.type 的 VNC CHECK 约束，将执行迁移');
                return true;
            }
            logger.warn('无法读取 connections 表定义，将执行 VNC 迁移');
            return true; // 如果表不存在或无法获取 SQL，则运行迁移
        },
        sql: `
            PRAGMA foreign_keys=off;

            -- 步骤 1: 重命名旧表
            ALTER TABLE connections RENAME TO connections_old_for_vnc_constraint_update;
            ALTER TABLE connection_tags RENAME TO connection_tags_old_for_vnc_constraint_update;

            -- 步骤 2: 创建新表 (与 schema.ts 中的定义一致)
            CREATE TABLE connections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NULL,
                type TEXT NOT NULL CHECK(type IN ('SSH', 'RDP', 'VNC')) DEFAULT 'SSH',
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                username TEXT NOT NULL,
                auth_method TEXT NOT NULL CHECK(auth_method IN ('password', 'key')),
                encrypted_password TEXT NULL,
                encrypted_private_key TEXT NULL,
                encrypted_passphrase TEXT NULL,
                proxy_id INTEGER NULL,
                ssh_key_id INTEGER NULL,
                notes TEXT NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                last_connected_at INTEGER NULL,
                FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE SET NULL,
                FOREIGN KEY (ssh_key_id) REFERENCES ssh_keys(id) ON DELETE SET NULL
            );

            CREATE TABLE connection_tags (
                connection_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY (connection_id, tag_id),
                FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            );

            -- 步骤 3: 从旧表复制数据到新表
            INSERT INTO connections (
                id, name, type, host, port, username, auth_method,
                encrypted_password, encrypted_private_key, encrypted_passphrase,
                proxy_id, ssh_key_id, notes, created_at, updated_at, last_connected_at
            )
            SELECT
                id, name,
                CASE
                    WHEN UPPER(type) = 'RDP' THEN 'RDP'
                    WHEN UPPER(type) = 'SSH' THEN 'SSH'
                    WHEN UPPER(type) = 'VNC' THEN 'VNC'
                    ELSE 'SSH'
                END,
                host, port, username, auth_method,
                encrypted_password, encrypted_private_key, encrypted_passphrase,
                proxy_id, ssh_key_id, notes, created_at, updated_at, last_connected_at
            FROM connections_old_for_vnc_constraint_update;

            INSERT INTO connection_tags (connection_id, tag_id)
            SELECT connection_id, tag_id FROM connection_tags_old_for_vnc_constraint_update;

            -- 步骤 4: 删除旧表
            DROP TABLE connections_old_for_vnc_constraint_update;
            DROP TABLE connection_tags_old_for_vnc_constraint_update;

            PRAGMA foreign_keys=on;

            ANALYZE; -- 重新分析数据库模式
        `
    },
    {
        id: 6,
        name: 'Create passkeys table for WebAuthn credentials',
        check: async (db: Database): Promise<boolean> => {
            const passkeysTableAlreadyExists = await tableExists(db, 'passkeys');
            return !passkeysTableAlreadyExists;
        },
        sql: `
            CREATE TABLE IF NOT EXISTS passkeys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                credential_id TEXT UNIQUE NOT NULL, -- Base64URL encoded
                public_key TEXT NOT NULL, -- COSE public key, stored as Base64URL or HEX
                counter INTEGER NOT NULL,
                transports TEXT, -- JSON array of transports e.g. ["usb", "nfc", "ble", "internal"]
                name TEXT NULL, -- User-friendly name for the passkey
                backed_up BOOLEAN NOT NULL DEFAULT FALSE, -- Stored as 0 or 1
                last_used_at INTEGER NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        `
    },
    {
        id: 7,
        name: 'Create path_history table',
        check: async (db: Database): Promise<boolean> => {
            const tableAlreadyExists = await tableExists(db, 'path_history');
            return !tableAlreadyExists;
        },
        sql: `
            CREATE TABLE IF NOT EXISTS path_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL,
                timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            );
        `
    },
    {
        id: 8,
        name: 'Create favorite_paths table',
        check: async (db: Database): Promise<boolean> => {
            const tableAlreadyExists = await tableExists(db, 'favorite_paths');
            return !tableAlreadyExists; // Only run if the table does NOT exist
        },
        sql: `
            CREATE TABLE IF NOT EXISTS favorite_paths (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NULL,
                path TEXT NOT NULL,
                last_used_at INTEGER NULL;
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            );
        `
    },
    {
        id: 9,
        name: 'Add jump_chain and proxy_type columns to connections table',
        sql: `
            ALTER TABLE connections ADD COLUMN jump_chain TEXT NULL;
            ALTER TABLE connections ADD COLUMN proxy_type TEXT NULL;
        `,
        check: async (db: Database): Promise<boolean> => {
            const jumpChainColumnExists = await columnExists(db, 'connections', 'jump_chain');
            const proxyTypeColumnExists = await columnExists(db, 'connections', 'proxy_type');
            return !jumpChainColumnExists || !proxyTypeColumnExists;
        },
        apply: async (db: Database): Promise<void> => {
            await addColumnIfMissing(db, 'connections', 'jump_chain', 'jump_chain TEXT NULL');
            await addColumnIfMissing(db, 'connections', 'proxy_type', 'proxy_type TEXT NULL');
        },
    },
    {
        id: 10,
        name: 'Add variables column to quick_commands table',
        check: async (db: Database): Promise<boolean> => {
            const columnAlreadyExists = await columnExists(db, 'quick_commands', 'variables');
            return !columnAlreadyExists;
        },
        sql: `
            ALTER TABLE quick_commands ADD COLUMN variables TEXT NULL;
        `
    },
    {
        id: 11,
        name: 'Create connection folders table and add folder column to connections',
        check: async (db: Database): Promise<boolean> => {
            const foldersTableExists = await tableExists(db, 'connection_folders');
            const folderColumnExists = await columnExists(db, 'connections', 'folder_id');
            return !foldersTableExists || !folderColumnExists;
        },
        sql: `
            CREATE TABLE IF NOT EXISTS connection_folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            );

            ALTER TABLE connections ADD COLUMN folder_id INTEGER NULL REFERENCES connection_folders(id) ON DELETE SET NULL;
        `,
        apply: async (db: Database): Promise<void> => {
            await execMigrationSql(db, `
                CREATE TABLE IF NOT EXISTS connection_folders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL,
                    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
                );
            `);
            await addColumnIfMissing(
                db,
                'connections',
                'folder_id',
                'folder_id INTEGER NULL REFERENCES connection_folders(id) ON DELETE SET NULL',
            );
        },
    },
    {
        id: 12,
        name: 'Add icon column to connections table',
        check: async (db: Database): Promise<boolean> => {
            const iconColumnExists = await columnExists(db, 'connections', 'icon');
            return !iconColumnExists;
        },
        sql: `
            ALTER TABLE connections ADD COLUMN icon TEXT NULL;
        `
    },
    {
        id: 13,
        name: 'Add sort order columns to connections and connection folders',
        check: async (db: Database): Promise<boolean> => {
            const connectionSortColumnExists = await columnExists(db, 'connections', 'sort_order');
            const folderSortColumnExists = await columnExists(db, 'connection_folders', 'sort_order');
            return !connectionSortColumnExists || !folderSortColumnExists;
        },
        sql: `
            ALTER TABLE connections ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE connection_folders ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

            UPDATE connections
            SET sort_order = id
            WHERE sort_order = 0;

            UPDATE connection_folders
            SET sort_order = id
            WHERE sort_order = 0;
        `,
        apply: async (db: Database): Promise<void> => {
            await addColumnIfMissing(db, 'connections', 'sort_order', 'sort_order INTEGER NOT NULL DEFAULT 0');
            await addColumnIfMissing(
                db,
                'connection_folders',
                'sort_order',
                'sort_order INTEGER NOT NULL DEFAULT 0',
            );
            await execMigrationSql(db, `
                UPDATE connections SET sort_order = id WHERE sort_order = 0;
                UPDATE connection_folders SET sort_order = id WHERE sort_order = 0;
            `);
        },
    },
    {
        id: 14,
        name: 'Add parent column to connection folders',
        check: async (db: Database): Promise<boolean> => {
            const folderParentColumnExists = await columnExists(db, 'connection_folders', 'parent_id');
            return !folderParentColumnExists;
        },
        sql: `
            ALTER TABLE connection_folders ADD COLUMN parent_id INTEGER NULL REFERENCES connection_folders(id) ON DELETE SET NULL;
        `
    },
    {
        id: 15,
        name: 'Update connections table to allow TELNET type',
        check: async (db: Database): Promise<boolean> => {
            const createSQL = await getTableCreateSQL(db, 'connections');
            return createSQL ? !createSQL.includes("'TELNET'") : true;
        },
        sql: `
            PRAGMA foreign_keys=off;

            ALTER TABLE connections RENAME TO connections_old_for_telnet_constraint_update;
            ALTER TABLE connection_tags RENAME TO connection_tags_old_for_telnet_constraint_update;

            CREATE TABLE connections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NULL,
                type TEXT NOT NULL CHECK(type IN ('SSH', 'RDP', 'VNC', 'TELNET')) DEFAULT 'SSH',
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                username TEXT NOT NULL,
                auth_method TEXT NOT NULL CHECK(auth_method IN ('password', 'key')),
                encrypted_password TEXT NULL,
                encrypted_private_key TEXT NULL,
                encrypted_passphrase TEXT NULL,
                proxy_id INTEGER NULL,
                ssh_key_id INTEGER NULL,
                folder_id INTEGER NULL,
                icon TEXT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                notes TEXT NULL,
                jump_chain TEXT NULL,
                proxy_type TEXT NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                last_connected_at INTEGER NULL,
                FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE SET NULL,
                FOREIGN KEY (ssh_key_id) REFERENCES ssh_keys(id) ON DELETE SET NULL,
                FOREIGN KEY (folder_id) REFERENCES connection_folders(id) ON DELETE SET NULL
            );

            CREATE TABLE connection_tags (
                connection_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY (connection_id, tag_id),
                FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            );

            INSERT INTO connections (
                id, name, type, host, port, username, auth_method,
                encrypted_password, encrypted_private_key, encrypted_passphrase,
                proxy_id, ssh_key_id, folder_id, icon, sort_order, notes,
                jump_chain, proxy_type, created_at, updated_at, last_connected_at
            )
            SELECT
                id, name,
                CASE
                    WHEN UPPER(type) = 'RDP' THEN 'RDP'
                    WHEN UPPER(type) = 'VNC' THEN 'VNC'
                    WHEN UPPER(type) = 'TELNET' THEN 'TELNET'
                    ELSE 'SSH'
                END,
                host, port, username, auth_method,
                encrypted_password, encrypted_private_key, encrypted_passphrase,
                proxy_id, ssh_key_id, folder_id, icon, sort_order, notes,
                jump_chain, proxy_type, created_at, updated_at, last_connected_at
            FROM connections_old_for_telnet_constraint_update;

            INSERT INTO connection_tags (connection_id, tag_id)
            SELECT connection_id, tag_id FROM connection_tags_old_for_telnet_constraint_update;

            DROP TABLE connections_old_for_telnet_constraint_update;
            DROP TABLE connection_tags_old_for_telnet_constraint_update;

            PRAGMA foreign_keys=on;
        `
    },
    {
        id: 16,
        name: 'Repair connection_tags foreign key after TELNET migration',
        check: async (db: Database): Promise<boolean> => {
            const createSQL = await getTableCreateSQL(db, 'connection_tags');
            return createSQL ? createSQL.includes('connections_old_for_telnet_constraint_update') : true;
        },
        sql: `
            PRAGMA foreign_keys=off;

            ALTER TABLE connection_tags RENAME TO connection_tags_old_for_telnet_fk_repair;

            CREATE TABLE connection_tags (
                connection_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY (connection_id, tag_id),
                FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            );

            INSERT INTO connection_tags (connection_id, tag_id)
            SELECT connection_id, tag_id FROM connection_tags_old_for_telnet_fk_repair;

            DROP TABLE connection_tags_old_for_telnet_fk_repair;

            PRAGMA foreign_keys=on;
        `
    },
    {
        id: 17,
        name: 'Add multi-user group access control and resource ownership',
        check: async (db: Database): Promise<boolean> => {
            const groupsExist = await tableExists(db, 'user_groups');
            const connectionOwnerExists = await columnExists(db, 'connections', 'owner_user_id');
            return !groupsExist || !connectionOwnerExists;
        },
        sql: migrateLegacyResourcesToAccessControlSQL,
    },
    {
        id: 18,
        name: 'Add ownership for user-private resources and preferences',
        check: async (db: Database): Promise<boolean> => {
            const requiredColumnList: Array<[string, string]> = [
                ['command_history', 'owner_user_id'],
                ['path_history', 'owner_user_id'],
                ['quick_commands', 'owner_user_id'],
                ['quick_command_tags', 'owner_user_id'],
                ['favorite_paths', 'owner_user_id'],
                ['terminal_themes', 'owner_user_id'],
                ['audit_logs', 'actor_user_id'],
            ];
            const columnExistenceList = await Promise.all(
                requiredColumnList.map(([tableName, columnName]) => columnExists(db, tableName, columnName)),
            );
            const tableExistenceList = await Promise.all([
                tableExists(db, 'user_settings'),
                tableExists(db, 'user_appearance_settings'),
            ]);
            const indexExistenceList = await Promise.all([
                'idx_command_history_owner',
                'idx_path_history_owner',
                'idx_quick_commands_owner',
                'idx_favorite_paths_owner',
                'idx_terminal_themes_owner',
                'idx_audit_logs_actor',
            ].map(indexName => indexExists(db, indexName)));
            return columnExistenceList.some(exists => !exists)
                || tableExistenceList.some(exists => !exists)
                || indexExistenceList.some(exists => !exists);
        },
        sql: migrateUserPrivateResourcesSQL,
        apply: async (db: Database): Promise<void> => {
            await addColumnIfMissing(
                db,
                'command_history',
                'owner_user_id',
                'owner_user_id INTEGER NULL REFERENCES users(id) ON DELETE CASCADE',
            );
            await addColumnIfMissing(
                db,
                'path_history',
                'owner_user_id',
                'owner_user_id INTEGER NULL REFERENCES users(id) ON DELETE CASCADE',
            );
            await addColumnIfMissing(
                db,
                'quick_commands',
                'owner_user_id',
                'owner_user_id INTEGER NULL REFERENCES users(id) ON DELETE CASCADE',
            );
            await addColumnIfMissing(
                db,
                'quick_command_tags',
                'owner_user_id',
                'owner_user_id INTEGER NULL REFERENCES users(id) ON DELETE CASCADE',
            );
            await addColumnIfMissing(
                db,
                'favorite_paths',
                'owner_user_id',
                'owner_user_id INTEGER NULL REFERENCES users(id) ON DELETE CASCADE',
            );
            await addColumnIfMissing(
                db,
                'terminal_themes',
                'owner_user_id',
                'owner_user_id INTEGER NULL REFERENCES users(id) ON DELETE CASCADE',
            );
            await addColumnIfMissing(
                db,
                'audit_logs',
                'actor_user_id',
                'actor_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL',
            );
            await execMigrationSql(db, `
                UPDATE command_history SET owner_user_id = (SELECT MIN(id) FROM users) WHERE owner_user_id IS NULL;
                UPDATE path_history SET owner_user_id = (SELECT MIN(id) FROM users) WHERE owner_user_id IS NULL;
                UPDATE quick_commands SET owner_user_id = (SELECT MIN(id) FROM users) WHERE owner_user_id IS NULL;
                UPDATE quick_command_tags SET owner_user_id = (SELECT MIN(id) FROM users) WHERE owner_user_id IS NULL;
                UPDATE favorite_paths SET owner_user_id = (SELECT MIN(id) FROM users) WHERE owner_user_id IS NULL;
                UPDATE terminal_themes SET owner_user_id = (SELECT MIN(id) FROM users)
                WHERE owner_user_id IS NULL AND theme_type = 'user';

                CREATE TABLE IF NOT EXISTS user_settings (
                    user_id INTEGER NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT NOT NULL,
                    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                    PRIMARY KEY (user_id, key),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS user_appearance_settings (
                    user_id INTEGER NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT NOT NULL,
                    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                    PRIMARY KEY (user_id, key),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                INSERT OR IGNORE INTO user_settings(user_id, key, value, created_at, updated_at)
                SELECT users.id, settings.key, settings.value,
                       COALESCE(settings.created_at, strftime('%s', 'now')),
                       COALESCE(settings.updated_at, strftime('%s', 'now'))
                FROM users CROSS JOIN settings
                WHERE users.id = (SELECT MIN(id) FROM users);
                INSERT OR IGNORE INTO user_appearance_settings(user_id, key, value, created_at, updated_at)
                SELECT users.id, appearance.key, appearance.value,
                       COALESCE(appearance.created_at, strftime('%s', 'now')),
                       COALESCE(appearance.updated_at, strftime('%s', 'now'))
                FROM users CROSS JOIN appearance_settings appearance
                WHERE users.id = (SELECT MIN(id) FROM users);

                CREATE INDEX IF NOT EXISTS idx_command_history_owner ON command_history(owner_user_id, timestamp);
                CREATE INDEX IF NOT EXISTS idx_path_history_owner ON path_history(owner_user_id, timestamp);
                CREATE INDEX IF NOT EXISTS idx_quick_commands_owner ON quick_commands(owner_user_id);
                CREATE INDEX IF NOT EXISTS idx_favorite_paths_owner ON favorite_paths(owner_user_id);
                CREATE INDEX IF NOT EXISTS idx_terminal_themes_owner ON terminal_themes(owner_user_id, theme_type);
                CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id, timestamp);
            `);
        },
    },
    {
        id: 19,
        name: 'Scope tag names to their owning user',
        check: async (db: Database): Promise<boolean> => {
            const tableSql = await getTableCreateSQL(db, 'tags');
            return !!tableSql && /name\s+TEXT[^,\n]*\bUNIQUE\b/i.test(tableSql);
        },
        sql: migrateTagsToOwnerScopedNamesSQL,
    },
    {
        id: 20,
        name: 'Scope quick command tag names to their owning user',
        check: async (db: Database): Promise<boolean> => {
            const tableSql = await getTableCreateSQL(db, 'quick_command_tags');
            return !!tableSql && /name\s+TEXT[^,\n]*\bUNIQUE\b/i.test(tableSql);
        },
        sql: migrateQuickCommandTagsToOwnerScopedNamesSQL,
    },
    {
        id: 21,
        name: 'Scope terminal theme names to their owning user',
        check: async (db: Database): Promise<boolean> => {
            const tableSql = await getTableCreateSQL(db, 'terminal_themes');
            return !!tableSql && /name\s+TEXT[^,\n]*\bUNIQUE\b/i.test(tableSql);
        },
        sql: migrateTerminalThemesToOwnerScopedNamesSQL,
    },
    {
        id: 22,
        name: 'Add user authentication epoch for session revocation',
        check: async (db: Database): Promise<boolean> => !(await columnExists(db, 'users', 'auth_epoch')),
        sql: addUserAuthenticationEpochSQL,
    },
    {
        id: 23,
        name: 'Add structured audit event fields',
        check: async (db: Database): Promise<boolean> => {
            const columnNameList = [
                'request_id',
                'actor_username',
                'actor_role',
                'source_ip',
                'asset_id',
                'session_id',
                'result',
            ];
            const existenceList = await Promise.all(
                columnNameList.map(columnName => columnExists(db, 'audit_logs', columnName)),
            );
            const indexNameList = [
                'idx_audit_logs_actor_time',
                'idx_audit_logs_asset_time',
                'idx_audit_logs_session',
                'idx_audit_logs_request',
            ];
            const indexExistenceList = await Promise.all(indexNameList.map(indexName => indexExists(db, indexName)));
            return existenceList.some(exists => !exists) || indexExistenceList.some(exists => !exists);
        },
        sql: `
            ALTER TABLE audit_logs ADD COLUMN request_id TEXT NULL;
            ALTER TABLE audit_logs ADD COLUMN actor_username TEXT NULL;
            ALTER TABLE audit_logs ADD COLUMN actor_role TEXT NULL;
            ALTER TABLE audit_logs ADD COLUMN source_ip TEXT NULL;
            ALTER TABLE audit_logs ADD COLUMN asset_id INTEGER NULL;
            ALTER TABLE audit_logs ADD COLUMN session_id TEXT NULL;
            ALTER TABLE audit_logs ADD COLUMN result TEXT NOT NULL DEFAULT 'success';
            CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_time ON audit_logs(actor_user_id, timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_audit_logs_asset_time ON audit_logs(asset_id, timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_audit_logs_session ON audit_logs(session_id);
            CREATE INDEX IF NOT EXISTS idx_audit_logs_request ON audit_logs(request_id);
        `,
        apply: async (db: Database): Promise<void> => {
            await addColumnIfMissing(db, 'audit_logs', 'request_id', 'request_id TEXT NULL');
            await addColumnIfMissing(db, 'audit_logs', 'actor_username', 'actor_username TEXT NULL');
            await addColumnIfMissing(db, 'audit_logs', 'actor_role', 'actor_role TEXT NULL');
            await addColumnIfMissing(db, 'audit_logs', 'source_ip', 'source_ip TEXT NULL');
            await addColumnIfMissing(db, 'audit_logs', 'asset_id', 'asset_id INTEGER NULL');
            await addColumnIfMissing(db, 'audit_logs', 'session_id', 'session_id TEXT NULL');
            await addColumnIfMissing(db, 'audit_logs', 'result', "result TEXT NOT NULL DEFAULT 'success'");
            await execMigrationSql(db, `
                CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_time ON audit_logs(actor_user_id, timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_audit_logs_asset_time ON audit_logs(asset_id, timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_audit_logs_session ON audit_logs(session_id);
                CREATE INDEX IF NOT EXISTS idx_audit_logs_request ON audit_logs(request_id);
            `);
        },
    },
    {
        id: 24,
        name: 'Add encrypted terminal session recording index',
        check: async (db: Database): Promise<boolean> => !(await tableExists(db, 'session_recordings')),
        sql: `
            CREATE TABLE IF NOT EXISTS session_recordings (
                id TEXT PRIMARY KEY,
                user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                username TEXT NULL,
                connection_id INTEGER NOT NULL,
                connection_name TEXT NOT NULL,
                protocol TEXT NOT NULL CHECK(protocol IN ('SSH', 'TELNET')),
                started_at INTEGER NOT NULL,
                ended_at INTEGER NULL,
                status TEXT NOT NULL CHECK(status IN ('active', 'completed', 'incomplete', 'failed')),
                relative_path TEXT NOT NULL UNIQUE,
                event_count INTEGER NOT NULL DEFAULT 0,
                byte_count INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_session_recordings_user_time
                ON session_recordings(user_id, started_at DESC);
            CREATE INDEX IF NOT EXISTS idx_session_recordings_asset_time
                ON session_recordings(connection_id, started_at DESC);
        `,
    },
    {
        id: 25,
        name: 'Repair user-private settings tables after partial migration',
        check: async (db: Database): Promise<boolean> => (
            !(await tableExists(db, 'user_settings')) || !(await tableExists(db, 'user_appearance_settings'))
        ),
        sql: `
            CREATE TABLE IF NOT EXISTS user_settings (
                user_id INTEGER NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                PRIMARY KEY (user_id, key),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS user_appearance_settings (
                user_id INTEGER NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                PRIMARY KEY (user_id, key),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        `,
    },
    {
        id: 26,
        name: 'Add append-only audit hash chain',
        sql: '',
        check: async (db: Database): Promise<boolean> => {
            if (!(await tableExists(db, 'audit_logs'))) return false;
            const existenceList = await Promise.all([
                columnExists(db, 'audit_logs', 'previous_hash'),
                columnExists(db, 'audit_logs', 'entry_hash'),
                triggerExists(db, 'audit_logs_prevent_update'),
                triggerExists(db, 'audit_logs_prevent_delete'),
            ]);
            return existenceList.some(exists => !exists);
        },
        apply: async (db: Database): Promise<void> => {
            await addColumnIfMissing(db, 'audit_logs', 'previous_hash', 'previous_hash TEXT NULL');
            await addColumnIfMissing(db, 'audit_logs', 'entry_hash', 'entry_hash TEXT NULL');
            await execMigrationSql(db, `
                CREATE INDEX IF NOT EXISTS idx_audit_logs_entry_hash ON audit_logs(entry_hash);
                CREATE TRIGGER IF NOT EXISTS audit_logs_prevent_update
                BEFORE UPDATE ON audit_logs
                BEGIN
                    SELECT RAISE(ABORT, 'audit_logs are append-only');
                END;
                CREATE TRIGGER IF NOT EXISTS audit_logs_prevent_delete
                BEFORE DELETE ON audit_logs
                BEGIN
                    SELECT RAISE(ABORT, 'audit_logs are append-only');
                END;
            `);
        },
    },
    {
        id: 27,
        name: 'Allow encrypted Guacamole protocol recordings for remote desktop sessions',
        sql: '',
        check: async (db: Database): Promise<boolean> => {
            const tableSql = await getTableCreateSQL(db, 'session_recordings');
            return !tableSql || !(/protocol\s+TEXT[^)]*'RDP'[^)]*'VNC'/i.test(tableSql));
        },
        apply: async (db: Database): Promise<void> => {
            if (!(await tableExists(db, 'session_recordings'))) {
                await execMigrationSql(db, `
                    CREATE TABLE session_recordings (
                        id TEXT PRIMARY KEY,
                        user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                        username TEXT NULL,
                        connection_id INTEGER NOT NULL,
                        connection_name TEXT NOT NULL,
                        protocol TEXT NOT NULL CHECK(protocol IN ('SSH', 'TELNET', 'RDP', 'VNC')),
                        started_at INTEGER NOT NULL,
                        ended_at INTEGER NULL,
                        status TEXT NOT NULL CHECK(status IN ('active', 'completed', 'incomplete', 'failed')),
                        relative_path TEXT NOT NULL UNIQUE,
                        event_count INTEGER NOT NULL DEFAULT 0,
                        byte_count INTEGER NOT NULL DEFAULT 0
                    );
                    CREATE INDEX idx_session_recordings_user_time
                        ON session_recordings(user_id, started_at DESC);
                    CREATE INDEX idx_session_recordings_asset_time
                        ON session_recordings(connection_id, started_at DESC);
                `);
                return;
            }
            await execMigrationSql(db, `
                CREATE TABLE session_recordings_next (
                    id TEXT PRIMARY KEY,
                    user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
                    username TEXT NULL,
                    connection_id INTEGER NOT NULL,
                    connection_name TEXT NOT NULL,
                    protocol TEXT NOT NULL CHECK(protocol IN ('SSH', 'TELNET', 'RDP', 'VNC')),
                    started_at INTEGER NOT NULL,
                    ended_at INTEGER NULL,
                    status TEXT NOT NULL CHECK(status IN ('active', 'completed', 'incomplete', 'failed')),
                    relative_path TEXT NOT NULL UNIQUE,
                    event_count INTEGER NOT NULL DEFAULT 0,
                    byte_count INTEGER NOT NULL DEFAULT 0
                );
                INSERT INTO session_recordings_next (
                    id, user_id, username, connection_id, connection_name, protocol,
                    started_at, ended_at, status, relative_path, event_count, byte_count
                ) SELECT
                    id, user_id, username, connection_id, connection_name, protocol,
                    started_at, ended_at, status, relative_path, event_count, byte_count
                FROM session_recordings;
                DROP TABLE session_recordings;
                ALTER TABLE session_recordings_next RENAME TO session_recordings;
                CREATE INDEX idx_session_recordings_user_time
                    ON session_recordings(user_id, started_at DESC);
                CREATE INDEX idx_session_recordings_asset_time
                    ON session_recordings(connection_id, started_at DESC);
            `);
        },
    },
    {
        id: 28,
        name: 'Add full-text index for append-only audit log search',
        sql: '',
        check: async (db: Database): Promise<boolean> => {
            if (!(await tableExists(db, 'audit_logs'))) return false;
            return !(await tableExists(db, 'audit_logs_fts'))
                || !(await triggerExists(db, 'audit_logs_fts_after_insert'));
        },
        apply: async (db: Database): Promise<void> => {
            // Some early partially-applied databases recorded migration 23 even
            // though their audit table missed optional searchable columns.
            // Repair them before creating an external-content FTS index.
            await addColumnIfMissing(db, 'audit_logs', 'details', 'details TEXT NULL');
            await addColumnIfMissing(db, 'audit_logs', 'actor_username', 'actor_username TEXT NULL');
            await addColumnIfMissing(db, 'audit_logs', 'source_ip', 'source_ip TEXT NULL');
            await addColumnIfMissing(db, 'audit_logs', 'request_id', 'request_id TEXT NULL');
            await addColumnIfMissing(db, 'audit_logs', 'session_id', 'session_id TEXT NULL');
            await execMigrationSql(db, `
                CREATE VIRTUAL TABLE IF NOT EXISTS audit_logs_fts USING fts5(
                    details,
                    actor_username,
                    source_ip,
                    request_id,
                    session_id,
                    content='audit_logs',
                    content_rowid='id'
                );
                INSERT INTO audit_logs_fts(
                    rowid, details, actor_username, source_ip, request_id, session_id
                )
                SELECT id, details, actor_username, source_ip, request_id, session_id
                FROM audit_logs
                WHERE NOT EXISTS (SELECT 1 FROM audit_logs_fts LIMIT 1);
                CREATE TRIGGER IF NOT EXISTS audit_logs_fts_after_insert
                AFTER INSERT ON audit_logs
                BEGIN
                    INSERT INTO audit_logs_fts(
                        rowid, details, actor_username, source_ip, request_id, session_id
                    ) VALUES (
                        NEW.id, NEW.details, NEW.actor_username, NEW.source_ip, NEW.request_id, NEW.session_id
                    );
                END;
            `);
        },
    },
    {
        id: 29,
        name: 'Anchor session recording batch hash chains in the recording index',
        sql: '',
        check: async (db: Database): Promise<boolean> => {
            if (!(await tableExists(db, 'session_recordings'))) return false;
            const columnList = await Promise.all([
                columnExists(db, 'session_recordings', 'recording_chain_hash'),
                columnExists(db, 'session_recordings', 'recording_batch_count'),
            ]);
            return columnList.some(exists => !exists);
        },
        apply: async (db: Database): Promise<void> => {
            await addColumnIfMissing(db, 'session_recordings', 'recording_chain_hash', 'recording_chain_hash TEXT NULL');
            await addColumnIfMissing(db, 'session_recordings', 'recording_batch_count', 'recording_batch_count INTEGER NOT NULL DEFAULT 0');
        },
    }
];

/**
 * 运行数据库迁移。
 * 检查当前数据库版本，并按顺序应用所有新的迁移。
 * @param db 数据库实例
 */
export const runMigrations = (db: Database): Promise<void> => {
    return new Promise((resolve, reject) => {
        logger.info('开始检查和应用数据库迁移');

        db.serialize(() => {
            // 步骤 1: 确保 migrations 表存在
            db.run(createMigrationsTableSQL, (err) => {
                if (err) {
                    logger.error('创建 migrations 表失败', { error: err });
                    return reject(new Error(`创建 migrations 表失败: ${err.message}`));
                }
                logger.info('migrations 表已确保存在');

                // 步骤 2: 读取全部已应用迁移。不能仅依赖最大 ID；历史恢复可能缺少中间记录。
                db.all('SELECT id FROM migrations', (err, rowList: Array<{ id: number }>) => {
                    if (err) {
                        logger.error('查询当前数据库版本失败', { error: err });
                        return reject(new Error(`查询当前数据库版本失败: ${err.message}`));
                    }

                    const appliedMigrationIdSet = new Set(rowList.map(row => row.id));
                    const currentVersion = Math.max(0, ...appliedMigrationIdSet);
                    // Early releases recorded only their latest baseline version. Preserve that
                    // format while still detecting every gap introduced after the baseline.
                    const legacyBaselineVersion = rowList.length > 0
                        ? Math.min(...appliedMigrationIdSet)
                        : 0;
                    logger.info('当前数据库版本', { currentVersion });

                    // 步骤 3: 确定需要应用的迁移
                    const migrationsToApply = definedMigrations
                        .filter(m => m.id > legacyBaselineVersion && !appliedMigrationIdSet.has(m.id))
                        .sort((a, b) => a.id - b.id); // 确保按 ID 升序应用

                    if (migrationsToApply.length === 0) {
                        logger.info('数据库已是最新版本，无需迁移');
                        return resolve();
                    }

                    logger.info('发现待应用迁移', {
                        count: migrationsToApply.length,
                        migrationList: migrationsToApply.map(m => ({ id: m.id, name: m.name })),
                    });

                    // 步骤 4: 使用 async/await 方式按顺序应用迁移
                    const applyMigrationsSequentially = async () => {
                        for (const migration of migrationsToApply) { // 使用 for...of 循环
                            logger.info('应用迁移', { migrationId: migration.id, migrationName: migration.name });

                            // 开始事务
                            await new Promise<void>((resolveTx, rejectTx) => {
                                db.run('BEGIN TRANSACTION', (beginErr) => {
                                    if (beginErr) {
                                        logger.error('开始迁移事务失败', { migrationId: migration.id, error: beginErr });
                                        rejectTx(new Error(`开始迁移 #${migration.id} 事务失败: ${beginErr.message}`));
                                    } else {
                                        resolveTx();
                                    }
                                });
                            });

                            try {
                                // 步骤 4.1: 执行前置检查 (如果存在)
                                let needsSqlExecution = true;
                                if (migration.check) {
                                    logger.info('执行迁移前置检查', { migrationId: migration.id });
                                    needsSqlExecution = await migration.check(db);
                                    logger.info('迁移前置检查完成', { migrationId: migration.id, needsSqlExecution });
                                }

                                if (needsSqlExecution) {
                                    // 步骤 4.2: 执行迁移 SQL
                                    logger.info('执行迁移 SQL', { migrationId: migration.id });
                                    try {
                                        if (migration.apply) await migration.apply(db);
                                        else await execMigrationSql(db, migration.sql);
                                    } catch (execError) {
                                        logger.error('执行迁移 SQL 失败', { migrationId: migration.id, error: execError });
                                        throw execError;
                                    }
                                }

                                // 步骤 4.3: 记录迁移到 migrations 表
                                logger.info('记录迁移到 migrations 表', { migrationId: migration.id });
                                const insertSQL = 'INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, strftime(\'%s\', \'now\'))';
                                await new Promise<void>((resolveInsert, rejectInsert) => {
                                    db.run(insertSQL, [migration.id, migration.name], (insertErr) => {
                                        if (insertErr) {
                                            logger.error('记录迁移到 migrations 表失败', { migrationId: migration.id, error: insertErr });
                                            rejectInsert(insertErr);
                                        } else {
                                            resolveInsert();
                                        }
                                    });
                                });

                                // 步骤 4.4: 提交事务
                                logger.info('提交迁移事务', { migrationId: migration.id });
                                await new Promise<void>((resolveCommit, rejectCommit) => {
                                    db.run('COMMIT', (commitErr) => {
                                        if (commitErr) {
                                            logger.error('提交迁移事务失败', { migrationId: migration.id, error: commitErr });
                                            rejectCommit(commitErr);
                                        } else {
                                            logger.info('迁移应用成功', { migrationId: migration.id, migrationName: migration.name });
                                            resolveCommit();
                                        }
                                    });
                                });

                            } catch (migrationStepError: any) {
                                // 捕获 check, exec, insert 或 commit 中的任何错误
                                logger.error('迁移步骤失败，正在回滚事务', { migrationId: migration.id, error: migrationStepError });
                                await new Promise<void>((resolveRollback) => { // No reject needed for rollback itself
                                    db.run('ROLLBACK', (rollbackErr) => {
                                        if (rollbackErr) logger.error('回滚迁移事务失败', { migrationId: migration.id, error: rollbackErr });
                                        // 拒绝整个迁移过程
                                        reject(new Error(`迁移 #${migration.id} 失败: ${migrationStepError.message}`));
                                        resolveRollback(); // Indicate rollback attempt finished
                                    });
                                });
                                return; // 停止应用后续迁移
                            }
                        } 

                        // 所有迁移成功应用
                        logger.info('所有新迁移已成功应用');
                        resolve();

                    };

                    // 开始按顺序应用迁移
                    applyMigrationsSequentially().catch(reject); // 将 applyMigrationsSequentially 的拒绝传递给外层 Promise

                });
            });
        });
    });
};
