export const createAccessControlTablesSQL = `
CREATE TABLE IF NOT EXISTS user_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT NULL,
    created_by INTEGER NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS user_group_members (
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'operator', 'viewer')),
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS connection_group_permissions (
    connection_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    permission TEXT NOT NULL CHECK(permission IN ('view', 'connect', 'manage')),
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (connection_id, group_id),
    FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_group_members_user_id
    ON user_group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_connection_group_permissions_group_id
    ON connection_group_permissions(group_id);
`;

export const migrateLegacyResourcesToAccessControlSQL = `
ALTER TABLE users ADD COLUMN system_role TEXT NOT NULL DEFAULT 'user'
    CHECK(system_role IN ('super_admin', 'admin', 'user', 'auditor'));
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active', 'disabled'));

ALTER TABLE connections ADD COLUMN owner_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE proxies ADD COLUMN owner_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ssh_keys ADD COLUMN owner_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE connection_folders ADD COLUMN owner_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tags ADD COLUMN owner_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL;

UPDATE users SET system_role = 'super_admin'
WHERE id = (SELECT MIN(id) FROM users);
UPDATE connections SET owner_user_id = (SELECT MIN(id) FROM users) WHERE owner_user_id IS NULL;
UPDATE proxies SET owner_user_id = (SELECT MIN(id) FROM users) WHERE owner_user_id IS NULL;
UPDATE ssh_keys SET owner_user_id = (SELECT MIN(id) FROM users) WHERE owner_user_id IS NULL;
UPDATE connection_folders SET owner_user_id = (SELECT MIN(id) FROM users) WHERE owner_user_id IS NULL;
UPDATE tags SET owner_user_id = (SELECT MIN(id) FROM users) WHERE owner_user_id IS NULL;

${createAccessControlTablesSQL}
`;

export const migrateUserPrivateResourcesSQL = `
ALTER TABLE command_history ADD COLUMN owner_user_id INTEGER NULL REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE path_history ADD COLUMN owner_user_id INTEGER NULL REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE quick_commands ADD COLUMN owner_user_id INTEGER NULL REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE quick_command_tags ADD COLUMN owner_user_id INTEGER NULL REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE favorite_paths ADD COLUMN owner_user_id INTEGER NULL REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE terminal_themes ADD COLUMN owner_user_id INTEGER NULL REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE audit_logs ADD COLUMN actor_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL;

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
`;

export const migrateTagsToOwnerScopedNamesSQL = `
ALTER TABLE connection_tags RENAME TO connection_tags_before_owner_scope;
ALTER TABLE tags RENAME TO tags_before_owner_scope;

CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    owner_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
INSERT INTO tags(id, name, owner_user_id, created_at, updated_at)
SELECT id, name, owner_user_id, created_at, updated_at FROM tags_before_owner_scope;
CREATE UNIQUE INDEX ux_tags_owner_name ON tags(COALESCE(owner_user_id, 0), name);
CREATE INDEX idx_tags_owner ON tags(owner_user_id, name);

CREATE TABLE connection_tags (
    connection_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (connection_id, tag_id),
    FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
INSERT INTO connection_tags(connection_id, tag_id)
SELECT connection_id, tag_id FROM connection_tags_before_owner_scope;
DROP TABLE connection_tags_before_owner_scope;
DROP TABLE tags_before_owner_scope;
`;

export const migrateQuickCommandTagsToOwnerScopedNamesSQL = `
ALTER TABLE quick_command_tag_associations RENAME TO quick_command_tag_associations_before_owner_scope;
ALTER TABLE quick_command_tags RENAME TO quick_command_tags_before_owner_scope;

CREATE TABLE quick_command_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    owner_user_id INTEGER NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
INSERT INTO quick_command_tags(id, name, owner_user_id, created_at, updated_at)
SELECT id, name, owner_user_id, created_at, updated_at FROM quick_command_tags_before_owner_scope;
CREATE UNIQUE INDEX ux_quick_command_tags_owner_name
    ON quick_command_tags(COALESCE(owner_user_id, 0), name);
CREATE INDEX idx_quick_command_tags_owner ON quick_command_tags(owner_user_id, name);

CREATE TABLE quick_command_tag_associations (
    quick_command_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (quick_command_id, tag_id),
    FOREIGN KEY (quick_command_id) REFERENCES quick_commands(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES quick_command_tags(id) ON DELETE CASCADE
);
INSERT INTO quick_command_tag_associations(quick_command_id, tag_id)
SELECT quick_command_id, tag_id FROM quick_command_tag_associations_before_owner_scope;
DROP TABLE quick_command_tag_associations_before_owner_scope;
DROP TABLE quick_command_tags_before_owner_scope;
`;

export const migrateTerminalThemesToOwnerScopedNamesSQL = `
ALTER TABLE terminal_themes RENAME TO terminal_themes_before_owner_scope;
CREATE TABLE terminal_themes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    theme_type TEXT NOT NULL CHECK(theme_type IN ('preset', 'user')),
    foreground TEXT, background TEXT, cursor TEXT, cursor_accent TEXT,
    selection_background TEXT, black TEXT, red TEXT, green TEXT, yellow TEXT,
    blue TEXT, magenta TEXT, cyan TEXT, white TEXT, bright_black TEXT,
    bright_red TEXT, bright_green TEXT, bright_yellow TEXT, bright_blue TEXT,
    bright_magenta TEXT, bright_cyan TEXT, bright_white TEXT,
    owner_user_id INTEGER NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
INSERT INTO terminal_themes(
    id, name, theme_type, foreground, background, cursor, cursor_accent,
    selection_background, black, red, green, yellow, blue, magenta, cyan, white,
    bright_black, bright_red, bright_green, bright_yellow, bright_blue,
    bright_magenta, bright_cyan, bright_white, owner_user_id, created_at, updated_at
)
SELECT id, name, theme_type, foreground, background, cursor, cursor_accent,
    selection_background, black, red, green, yellow, blue, magenta, cyan, white,
    bright_black, bright_red, bright_green, bright_yellow, bright_blue,
    bright_magenta, bright_cyan, bright_white, owner_user_id, created_at, updated_at
FROM terminal_themes_before_owner_scope;
CREATE UNIQUE INDEX ux_terminal_themes_preset_name
    ON terminal_themes(name) WHERE theme_type = 'preset';
CREATE UNIQUE INDEX ux_terminal_themes_user_owner_name
    ON terminal_themes(owner_user_id, name) WHERE theme_type = 'user';
CREATE INDEX idx_terminal_themes_owner_type
    ON terminal_themes(owner_user_id, theme_type, name);
DROP TABLE terminal_themes_before_owner_scope;
`;

export const addUserAuthenticationEpochSQL = `
ALTER TABLE users ADD COLUMN auth_epoch INTEGER NOT NULL DEFAULT 0;
`;
