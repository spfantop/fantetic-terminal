import { getDbInstance, runDb, getDb as getDbRow, allDb } from '../database/connection';
import { SidebarConfig, LayoutNode, PaneName } from '../types/settings.types';
import { CaptchaSettings } from '../types/settings.types';
import * as sqlite3 from 'sqlite3';

const SIDEBAR_CONFIG_KEY = 'sidebarConfig';
const CAPTCHA_CONFIG_KEY = 'captchaConfig';
const DEFAULT_TERMINAL_HIGHLIGHT_RULES_JSON = JSON.stringify([
  {
    id: 'preset-error',
    name: 'error',
    enabled: true,
    pattern: '\\b(ERROR|FAIL(?:ED)?|FATAL|Exception)\\b',
    flags: 'gi',
    foreground: '#ef4444',
    bold: true,
    priority: 100,
    presetId: 'error',
  },
  {
    id: 'preset-warning',
    name: 'warning',
    enabled: true,
    pattern: '\\b(WARN(?:ING)?|DEPRECATED)\\b',
    flags: 'gi',
    foreground: '#f59e0b',
    bold: true,
    priority: 90,
    presetId: 'warning',
  },
  {
    id: 'preset-success',
    name: 'success',
    enabled: true,
    pattern: '\\b(SUCCESS|SUCCEEDED|PASS(?:ED)?|OK|DONE)\\b',
    flags: 'gi',
    foreground: '#22c55e',
    priority: 80,
    presetId: 'success',
  },
  {
    id: 'preset-info',
    name: 'info',
    enabled: true,
    pattern: '\\b(INFO|NOTICE)\\b',
    flags: 'gi',
    foreground: '#38bdf8',
    priority: 70,
    presetId: 'info',
  },
  {
    id: 'preset-http-error',
    name: 'httpError',
    enabled: true,
    pattern: '\\bHTTP/[0-9.]+\\s+[45][0-9]{2}\\b|\\b[45][0-9]{2}\\s+(?:Error|Failed|Failure)\\b',
    flags: 'gi',
    foreground: '#fb7185',
    bold: true,
    priority: 95,
    presetId: 'httpError',
  },
  {
    id: 'preset-url',
    name: 'url',
    enabled: true,
    pattern: 'https?://[^\\s]+',
    flags: 'gi',
    foreground: '#60a5fa',
    underline: true,
    priority: 40,
    presetId: 'url',
  },
  {
    id: 'preset-ip',
    name: 'ip',
    enabled: false,
    pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b',
    flags: 'g',
    foreground: '#a78bfa',
    priority: 30,
    presetId: 'ip',
  },
  {
    id: 'preset-timestamp',
    name: 'timestamp',
    enabled: false,
    pattern: '\\b\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?\\b',
    flags: 'g',
    foreground: '#94a3b8',
    priority: 20,
    presetId: 'timestamp',
  },
]);

export interface Setting {
  key: string;
  value: string;
}

type DbSettingRow = Setting;

export const settingsRepository = {
  async getAllSettings(): Promise<Setting[]> {
    try {
      const db = await getDbInstance();
      const rows = await allDb<DbSettingRow>(db, 'SELECT key, value FROM settings');
      return rows;
    } catch (err: any) {
      console.error('[Repository] 获取所有设置时出错:', err.message);
      throw new Error('获取设置失败');
    }
  },

  async getSetting(key: string): Promise<string | null> {
    // console.log(`[仓库] 尝试获取键为 ${key} 的设置`);
    try {
      const db = await getDbInstance();
      const row = await getDbRow<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', [key]);
      const value = row ? row.value : null;
      // console.log(`[仓库] 找到键 ${key} 的值:`, value);
      return value;
    } catch (err: any) {
      console.error(`[Repository] 获取设置项 ${key} 时出错:`, err.message);
      throw new Error(`获取设置项 ${key} 失败`);
    }
  },

  async setSetting(key: string, value: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const sql = `INSERT INTO settings (key, value, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`;
    const params = [key, value, now, now];

    try {
      const db = await getDbInstance();
      const result = await runDb(db, sql, params);
    } catch (err: any) {
      console.error(`[Repository] 设置设置项 ${key} 时出错:`, err.message);
      throw new Error(`设置设置项 ${key} 失败`);
    }
  },

  async deleteSetting(key: string): Promise<boolean> {
    // console.log(`[仓库] 尝试删除键为 ${key} 的设置`);
    const sql = 'DELETE FROM settings WHERE key = ?';
    try {
      const db = await getDbInstance();
      const result = await runDb(db, sql, [key]);
      // console.log(`[仓库] 成功删除键为 ${key} 的设置。影响行数: ${result.changes}`);
      return result.changes > 0;
    } catch (err: any) {
      console.error(`[Repository] 删除设置项 ${key} 时出错:`, err.message);
      throw new Error(`删除设置项 ${key} 失败`);
    }
  },

  async setMultipleSettings(settings: Record<string, string>): Promise<void> {
    // console.log('[仓库] 调用 setMultipleSettings，参数:', JSON.stringify(settings));
    const promises = Object.entries(settings).map(([key, value]) =>
      this.setSetting(key, value)
    );
    try {
        await Promise.all(promises);
        // console.log('[仓库] setMultipleSettings 成功完成。');
    } catch (error) {
        console.error('[仓库] setMultipleSettings 失败:', error);
        throw new Error('批量设置失败');
    }
  },
};


/**
 * 获取侧栏配置
 */
export const getSidebarConfig = async (): Promise<SidebarConfig> => {
    const defaultValue: SidebarConfig = { left: [], right: [] };
    try {
        const jsonString = await settingsRepository.getSetting(SIDEBAR_CONFIG_KEY);
        if (jsonString) {
            try {
                const config = JSON.parse(jsonString);
                if (config && Array.isArray(config.left) && Array.isArray(config.right)) {
                    return config as SidebarConfig;
                }
                console.warn(`[设置仓库] 在数据库中发现无效的 sidebarConfig 格式: ${jsonString}。返回默认值。`);
            } catch (parseError) {
                console.error(`[设置仓库] 从数据库解析 sidebarConfig JSON 失败: ${jsonString}`, parseError);
            }
        }
    } catch (error) {
        console.error(`[设置仓库] 获取侧边栏配置设置时出错 (键: ${SIDEBAR_CONFIG_KEY}):`, error);
    }
    return defaultValue;
};

/**
 * 设置侧栏配置
 */
export const setSidebarConfig = async (config: SidebarConfig): Promise<void> => {
    try {
        if (!config || typeof config !== 'object' || !Array.isArray(config.left) || !Array.isArray(config.right)) {
             throw new Error('提供了无效的侧边栏配置对象。');
        }
        const jsonString = JSON.stringify(config);
        await settingsRepository.setSetting(SIDEBAR_CONFIG_KEY, jsonString);
    } catch (error) {
        console.error(`[设置仓库] 设置侧边栏配置时出错 (键: ${SIDEBAR_CONFIG_KEY}):`, error);
        throw new Error('保存侧边栏配置失败。');
    }
};

/**
 * 获取 CAPTCHA 配置
 * @returns Promise<CaptchaSettings> - 返回解析后的配置或默认值
 */
export const getCaptchaConfig = async (): Promise<CaptchaSettings> => {
    const defaultValue: CaptchaSettings = {
        enabled: false,
        provider: 'none',
        hcaptchaSiteKey: '',
        hcaptchaSecretKey: '',
        recaptchaSiteKey: '',
        recaptchaSecretKey: '',
    };
    try {
        const jsonString = await settingsRepository.getSetting(CAPTCHA_CONFIG_KEY);
        if (jsonString) {
            try {
                const config = JSON.parse(jsonString);
                if (config && typeof config.enabled === 'boolean' && typeof config.provider === 'string') {
                     return {
                        enabled: config.enabled ?? defaultValue.enabled,
                        provider: config.provider ?? defaultValue.provider,
                        hcaptchaSiteKey: config.hcaptchaSiteKey ?? defaultValue.hcaptchaSiteKey,
                        hcaptchaSecretKey: config.hcaptchaSecretKey ?? defaultValue.hcaptchaSecretKey,
                        recaptchaSiteKey: config.recaptchaSiteKey ?? defaultValue.recaptchaSiteKey,
                        recaptchaSecretKey: config.recaptchaSecretKey ?? defaultValue.recaptchaSecretKey,
                     } as CaptchaSettings;
                }
                console.warn(`[设置仓库] 在数据库中发现无效的 captchaConfig 格式: ${jsonString}。返回默认值。`);
            } catch (parseError) {
                console.error(`[设置仓库] 从数据库解析 captchaConfig JSON 失败: ${jsonString}`, parseError);
            }
        }
    } catch (error) {
        console.error(`[设置仓库] 获取 CAPTCHA 配置设置时出错 (键: ${CAPTCHA_CONFIG_KEY}):`, error);
    }
    return defaultValue;
};

/**
 * 设置 CAPTCHA 配置
 */
export const setCaptchaConfig = async (config: CaptchaSettings): Promise<void> => {
    try {
        if (!config || typeof config !== 'object' || typeof config.enabled !== 'boolean' || typeof config.provider !== 'string') {
             throw new Error('提供了无效的 CAPTCHA 配置对象。');
        }
        config.hcaptchaSecretKey = config.hcaptchaSecretKey || '';
        config.recaptchaSecretKey = config.recaptchaSecretKey || '';
        config.hcaptchaSiteKey = config.hcaptchaSiteKey || '';
        config.recaptchaSiteKey = config.recaptchaSiteKey || '';

        const jsonString = JSON.stringify(config);
        await settingsRepository.setSetting(CAPTCHA_CONFIG_KEY, jsonString);
    } catch (error) {
        console.error(`[设置仓库] 设置 CAPTCHA 配置时出错 (键: ${CAPTCHA_CONFIG_KEY}):`, error);
        throw new Error('保存 CAPTCHA 配置失败。');
    }
};

/**
 * 确保设置表中存在默认设置。
 * 此函数应在数据库初始化期间调用。
 */
export const ensureDefaultSettingsExist = async (db: sqlite3.Database): Promise<void> => {
    type OmitIdRecursive<T> = T extends object
      ? { [K in keyof Omit<T, 'id'>]: OmitIdRecursive<T[K]> }
      : T;

    const defaultLayoutTreeStructure: OmitIdRecursive<LayoutNode> = {
      type: "container",
      direction: "horizontal",
      children: [
        {
          type: "container",
          direction: "vertical",
          size: 77.75542049934297,
          children: [
            { type: "pane", component: "terminal", size: 94.00342561521252 },
            { type: "pane", component: "commandBar", size: 5.996574384787479 }
          ]
        },
        {
          type: "container",
          direction: "vertical",
          children: [
            { type: "pane", component: "statusMonitor", size: 100 }
          ],
          size: 22.244579500657025
        }
      ]
    };

    const defaultSidebarPanesStructure: SidebarConfig = {
      left: [],
      right: ["fileManager", "commandHistory", "quickCommands", "suspendedSshSessions", "dockerManager"]
    };

    const defaultCaptchaSettings: CaptchaSettings = {
        enabled: false,
        provider: 'none',
        hcaptchaSiteKey: '',
        hcaptchaSecretKey: '',
        recaptchaSiteKey: '',
        recaptchaSecretKey: '',
    };

    const defaultSettings: Record<string, string> = {
        ipWhitelistEnabled: 'false',
        ipWhitelist: '',
        maxLoginAttempts: '5',
        loginBanDuration: '300',
        focusSwitcherSequence: JSON.stringify(["quickCommandsSearch", "commandHistorySearch", "fileManagerSearch", "commandInput", "terminalSearch"]),
        navBarVisible: 'true',
        layoutTree: JSON.stringify(defaultLayoutTreeStructure),
        autoCopyOnSelect: 'false',
        showPopupFileEditor: 'false',
        shareFileEditorTabs: 'true',
        layoutLocked: 'false',
        dockerManagerEnabled: 'true',
        dockerStatusIntervalSeconds: '5',
        dockerDefaultExpand: 'false',
        statusMonitorEnabled: 'true',
        statusMonitorIntervalSeconds: '3',
        [SIDEBAR_CONFIG_KEY]: JSON.stringify(defaultSidebarPanesStructure),
        [CAPTCHA_CONFIG_KEY]: JSON.stringify(defaultCaptchaSettings),
        timezone: 'UTC', // 时区默认值
        terminalScrollbackLimit: '5000', // 终端回滚行数默认值
        terminalEnableRightClickPaste: 'true', // 终端右键粘贴默认值
        terminalHighlightEnabled: 'false',
        terminalHighlightRules: DEFAULT_TERMINAL_HIGHLIGHT_RULES_JSON,
        rdpDefaultFixedResolution: 'false',
        rdpDefaultWidth: '1024',
        rdpDefaultHeight: '768',
        rdpDefaultQuality: 'balanced',
        vncDefaultFixedResolution: 'false',
        vncDefaultWidth: '1024',
        vncDefaultHeight: '768',
        vncDefaultQuality: 'balanced',
    };
    const nowSeconds = Math.floor(Date.now() / 1000);
    const sqlInsertOrIgnore = `INSERT OR IGNORE INTO settings (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)`;

    try {
        for (const [key, value] of Object.entries(defaultSettings)) {
            await runDb(db, sqlInsertOrIgnore, [key, value, nowSeconds, nowSeconds]);
        }
    } catch (err: any) {
        console.error(`[设置仓库] 确保默认设置时出错:`, err.message);
        throw new Error(`确保默认设置失败: ${err.message}`);
    }
};
