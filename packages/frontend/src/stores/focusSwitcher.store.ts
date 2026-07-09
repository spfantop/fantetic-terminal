import { defineStore } from 'pinia';
import { ref, computed, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  createEmptyFocusSwitcherConfig,
  normalizeFocusSwitcherConfig,
  normalizeFocusSwitcherShortcut,
  type FocusableInput,
  type FocusItemConfig,
  type FocusSwitcherFullConfig,
} from '../utils/focusSwitcherConfig';
// 假设有一个 API 客户端或辅助函数，这里我们直接使用 fetch
// import apiClient from '@/services/api';

export type { FocusableInput, FocusItemConfig, FocusSwitcherFullConfig };

// --- 移除 ConfigurableFocusableItem ---

// Store State 接口
interface FocusSwitcherState {
  availableInputs: FocusableInput[]; // 所有可用项的基础信息 (无 focusAction)
  sequenceOrder: string[]; // 顺序切换的 ID 列表
  itemConfigs: Record<string, FocusItemConfig>; // 所有项目的配置 (id -> config)
  isConfiguratorVisible: boolean;
  configuratorSourceDocument: Document | null;
  activateFileManagerSearchTrigger: number;
  activateTerminalSearchTrigger: number;
  // 存储注册的聚焦动作
  registeredActions: Map<string, FocusActionEntry[]>;
}

interface FocusActionOptions {
  ownerDocument?: Document;
}

interface FocusActionEntry {
  action: () => boolean | Promise<boolean | undefined>;
  ownerDocument?: Document;
}

// --- 移除 localStorage Key ---
// const LOCAL_STORAGE_KEY = 'focusSwitcherSequence';

export const useFocusSwitcherStore = defineStore('focusSwitcher', () => {
  const { t } = useI18n();

  // --- State ---
  const availableInputs = ref<FocusableInput[]>([
    // 移除 focusAction 初始化
    { id: 'commandHistorySearch', label: t('focusSwitcher.input.commandHistorySearch', '命令历史搜索') },
    { id: 'quickCommandsSearch', label: t('focusSwitcher.input.quickCommandsSearch', '快捷指令搜索') },
    { id: 'fileManagerSearch', label: t('focusSwitcher.input.fileManagerSearch', '文件管理器搜索') },
    { id: 'commandInput', label: t('focusSwitcher.input.commandInput', '命令输入') },
    { id: 'terminalSearch', label: t('focusSwitcher.input.terminalSearch', '终端内搜索') },
    { id: 'connectionListSearch', label: t('focusSwitcher.input.connectionListSearch', '连接列表搜索') },
    { id: 'fileEditorActive', label: t('focusSwitcher.input.fileEditorActive', '文件编辑器') },
    { id: 'fileManagerPathInput', label: t('focusSwitcher.input.fileManagerPathInput', '文件管理器路径编辑') },
  ]);
  const sequenceOrder = ref<string[]>([]); // +++ 存储顺序 +++
  const itemConfigs = ref<Record<string, FocusItemConfig>>({}); // +++ 存储所有配置 +++
  const isConfiguratorVisible = ref(false);
  const configuratorSourceDocument = ref<Document | null>(null);
  const activateFileManagerSearchTrigger = ref(0);
  const activateTerminalSearchTrigger = ref(0);

  // 存储注册的聚焦动作 (Map: id -> Array of actions)
  const registeredActions = ref<Map<string, FocusActionEntry[]>>(new Map());

  // --- Actions ---

  // +++ 修改：从后端加载配置（包括快捷键） +++
  async function loadConfigurationFromBackend() {
    const apiUrl = '/api/v1/settings/focus-switcher-sequence'; // 假设 API 端点不变，但返回结构改变
    // console.log(`[FocusSwitcherStore] Attempting to load full configuration (sequence & shortcuts) from backend via: ${apiUrl}`);
    try {
      const response = await fetch(apiUrl);
      // console.log(`[FocusSwitcherStore] Received response from ${apiUrl}. Status: ${response.status}`);

      if (!response.ok) {
        console.error(`[FocusSwitcherStore] HTTP error from ${apiUrl}. Status: ${response.status}`);
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const loadedFullConfig = normalizeFocusSwitcherConfig(await response.json());
      // console.log(`[FocusSwitcherStore] Raw JSON received from backend:`, JSON.stringify(loadedFullConfig));

      // --- 验证和设置 ---
      const availableIds = new Set(availableInputs.value.map(input => input.id));

      // 验证 sequence
      if (loadedFullConfig && loadedFullConfig.sequence.every(id => availableIds.has(id))) {
        sequenceOrder.value = loadedFullConfig.sequence;
        // console.log('[FocusSwitcherStore] Successfully loaded and set sequenceOrder:', JSON.stringify(sequenceOrder.value));
      } else {
        console.warn('[FocusSwitcherStore] Invalid or missing sequence in loaded config. Resetting to empty array.');
        sequenceOrder.value = [];
      }

      // 验证 shortcuts (itemConfigs)
      if (loadedFullConfig) {
        const validConfigs: Record<string, FocusItemConfig> = {};
        for (const id in loadedFullConfig.shortcuts) {
          if (availableIds.has(id)) { // 只保留有效的 ID
            const config = loadedFullConfig.shortcuts[id];
            const normalizedShortcut = normalizeFocusSwitcherShortcut(config.shortcut);
            if (config.shortcut === undefined || normalizedShortcut) {
              validConfigs[id] = normalizedShortcut ? { shortcut: normalizedShortcut } : {}; // 只保留 shortcut
            } else {
               console.warn(`[FocusSwitcherStore] Invalid shortcut config for ID ${id}. Ignoring shortcut.`);
               validConfigs[id] = {}; // 保留 ID 但清空无效快捷键
            }
          } else {
             console.warn(`[FocusSwitcherStore] Ignoring shortcut config for unknown ID: ${id}`);
          }
        }
        itemConfigs.value = validConfigs;
        // console.log('[FocusSwitcherStore] Successfully loaded and set itemConfigs:', JSON.stringify(itemConfigs.value));
      } else {
        console.warn('[FocusSwitcherStore] Invalid or missing shortcuts in loaded config. Resetting to empty object.');
        itemConfigs.value = {};
      }

    } catch (error) {
      console.error(`[FocusSwitcherStore] Failed to load or parse configuration from backend (${apiUrl}):`, error);
      const emptyConfig = createEmptyFocusSwitcherConfig();
      sequenceOrder.value = emptyConfig.sequence;
      itemConfigs.value = emptyConfig.shortcuts;
      // console.log('[FocusSwitcherStore] Reset sequenceOrder and itemConfigs due to loading error.');
    }
  }

  async function saveConfigurationToBackend() {
    const apiUrl = '/api/v1/settings/focus-switcher-sequence'; // 假设 API 端点不变，但接受结构改变
    // console.log(`[FocusSwitcherStore] Attempting to save full configuration (sequence & shortcuts) to backend via PUT: ${apiUrl}`);
    try {
      // *** 构造 FocusSwitcherFullConfig 结构发送给后端 ***
      const configToSave: FocusSwitcherFullConfig = {
        sequence: sequenceOrder.value,
        shortcuts: itemConfigs.value,
      };
      // console.log('[FocusSwitcherStore] Full configuration data to save:', JSON.stringify(configToSave));
      const response = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          // Auth headers if needed
        },
        body: JSON.stringify(configToSave), // *** 发送包含 sequence 和 shortcuts 的对象 ***
      });
      // console.log(`[FocusSwitcherStore] Received response from PUT ${apiUrl}. Status: ${response.status}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error(`[FocusSwitcherStore] Save failed. Status: ${response.status}, Error data:`, errorData);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorData.message || 'Unknown error'}`);
      }

      const result = await response.json();
      // console.log('[FocusSwitcherStore] Configuration successfully saved to backend. Response message:', result.message);
    } catch (error) {
      console.error(`[FocusSwitcherStore] Failed to save configuration to backend (${apiUrl}):`, error);
      // Notify user of failure
    }
  }


  function triggerTerminalSearchActivation() {
    activateTerminalSearchTrigger.value++;
    // console.log('[FocusSwitcherStore] Triggering Terminal search activation.');
  }

  function triggerFileManagerSearchActivation() {
    activateFileManagerSearchTrigger.value++;
    // console.log('[FocusSwitcherStore] Triggering FileManager search activation.');
  }

  function toggleConfigurator(visible?: boolean, sourceDocument?: Document | null) {
    isConfiguratorVisible.value = visible === undefined ? !isConfiguratorVisible.value : visible;
    if (isConfiguratorVisible.value) {
      configuratorSourceDocument.value = sourceDocument ?? document;
    } else {
      configuratorSourceDocument.value = null;
    }
    // console.log(`[FocusSwitcherStore] Configurator visibility set to: ${isConfiguratorVisible.value}`);
  }

  // --- 移除旧的 loadConfiguration ---
  /*
  function loadConfiguration() {
    // ... localStorage logic ...
  }
  */

  // --- 移除旧的 saveConfiguration ---
  /*
  function saveConfiguration() {
    // ... localStorage logic ...
  }
  */

  // +++ 修改：更新完整配置（包括顺序和所有快捷键） +++
  function updateConfiguration(newFullConfig: FocusSwitcherFullConfig) {
    // console.log('[FocusSwitcherStore] updateConfiguration called with new full configuration:', JSON.stringify(newFullConfig));
    const availableIds = new Set(availableInputs.value.map(input => input.id));

    // 更新 sequenceOrder (过滤无效 ID)
    if (Array.isArray(newFullConfig?.sequence)) {
      sequenceOrder.value = newFullConfig.sequence.filter(id => availableIds.has(id));
      // console.log('[FocusSwitcherStore] sequenceOrder updated locally to:', JSON.stringify(sequenceOrder.value));
    } else {
       console.warn('[FocusSwitcherStore] Invalid sequence provided in updateConfiguration. Keeping existing sequence.');
    }

    // 更新 itemConfigs (过滤无效 ID 和快捷键)
    if (typeof newFullConfig?.shortcuts === 'object' && newFullConfig.shortcuts !== null) {
        const validConfigs: Record<string, FocusItemConfig> = {};
        for (const id in newFullConfig.shortcuts) {
          if (availableIds.has(id)) {
            const config = newFullConfig.shortcuts[id];
            const normalizedShortcut = normalizeFocusSwitcherShortcut(config.shortcut);
             if (typeof config === 'object' && config !== null && (config.shortcut === undefined || normalizedShortcut)) {
               validConfigs[id] = normalizedShortcut ? { shortcut: normalizedShortcut } : {};
             } else {
                validConfigs[id] = {}; // 保留 ID 但清空无效快捷键
             }
          }
        }
        itemConfigs.value = validConfigs;
       // console.log('[FocusSwitcherStore] itemConfigs updated locally to:', JSON.stringify(itemConfigs.value));
    } else {
        console.warn('[FocusSwitcherStore] Invalid shortcuts provided in updateConfiguration. Keeping existing configs.');
    }

    // 更新后立即保存到后端
    saveConfigurationToBackend();
  }

  // 注册聚焦动作 (添加到 Map 中)
  // 返回一个注销函数，以便组件可以方便地注销自己添加的动作
  function registerFocusAction(
    id: string,
    action: () => boolean | Promise<boolean | undefined>,
    options: FocusActionOptions = {},
  ): () => void {
    if (!availableInputs.value.some(input => input.id === id)) {
      console.warn(`[FocusSwitcherStore] Attempted to register focus action for unknown ID: ${id}`);
      return () => {}; // 返回一个无操作的注销函数
    }

    const actions = registeredActions.value.get(id) || [];
    const entry: FocusActionEntry = {
      action,
      ownerDocument: options.ownerDocument,
    };
    actions.push(entry);
    registeredActions.value.set(id, actions);
    // console.log(`[FocusSwitcherStore] Registered focus action for ID: ${id}. Total actions for this ID: ${actions.length}`);

    // 返回一个用于注销此特定动作的函数
    const unregister = () => {
      const currentActions = registeredActions.value.get(id);
      if (currentActions) {
        const index = currentActions.indexOf(entry);
        if (index > -1) {
          currentActions.splice(index, 1);
          // console.log(`[FocusSwitcherStore] Unregistered a focus action for ID: ${id}. Remaining actions: ${currentActions.length}`);
          // 如果数组为空，可以从 Map 中移除该 ID
          if (currentActions.length === 0) {
            registeredActions.value.delete(id);
            // console.log(`[FocusSwitcherStore] Removed ID ${id} from registeredActions map as it has no more actions.`);
          }
        } else {
           console.warn(`[FocusSwitcherStore] Attempted to unregister an action for ID ${id} that was not found.`);
        }
      }
    };
    return unregister;
  }

  // 注销聚焦动作 (现在由 registerFocusAction 返回的函数处理)
  // 保留一个空的 unregisterFocusAction 以防万一旧代码调用，但标记为废弃或移除
  // function unregisterFocusAction(id: string) {
  //    console.warn("[FocusSwitcherStore] unregisterFocusAction(id) is deprecated. Use the function returned by registerFocusAction instead.");
  // }

  // 修改：统一的聚焦目标 Action，现在迭代 Map 中的动作数组
  async function focusTarget(id: string, targetDocument?: Document): Promise<boolean> {
    // console.log(`[FocusSwitcherStore] Attempting to focus target ID: ${id}`);
    const actions = registeredActions.value.get(id);

    if (!actions || actions.length === 0) {
      console.warn(`[FocusSwitcherStore] No focus actions registered for ID: ${id}`);
      return false;
    }

    // console.log(`[FocusSwitcherStore] Found ${actions.length} action(s) for ID: ${id}. Iterating...`);

    for (const entry of actions) {
      if (targetDocument && entry.ownerDocument && entry.ownerDocument !== targetDocument) {
        continue;
      }

      try {
        // 执行动作，可能是同步或异步的
        const result = await entry.action();

        if (result === true) {
          // 如果动作返回 true，表示成功聚焦，停止迭代并返回 true
          // console.log(`[FocusSwitcherStore] Successfully focused ${id} via one of its actions.`);
          return true;
        } else if (result === false) {
          // 如果动作返回 false，表示尝试但失败，记录日志并继续下一个动作
          // console.log(`[FocusSwitcherStore] An action for ${id} returned false (failed). Trying next action if available.`);
        } else if (result === undefined) {
          // 如果动作返回 undefined，表示跳过（例如非活动实例），记录日志并继续下一个动作
          // console.log(`[FocusSwitcherStore] An action for ${id} returned undefined (skipped). Trying next action if available.`);
        }
        // 如果 result 是其他值，也视为跳过或未处理

      } catch (error) {
        console.error(`[FocusSwitcherStore] Error executing a focus action for ${id}:`, error);
        // 即使出错，也继续尝试下一个动作
      }
    }

    // 如果遍历完所有动作都没有成功聚焦 (没有返回 true)
    // console.log(`[FocusSwitcherStore] All actions for ${id} executed, but none returned true. Focus failed.`);
    // 尝试激活搜索框（如果适用），这里的逻辑可能需要重新审视，
    // 因为激活应该由返回 false 的动作内部触发，或者由调用 focusTarget 的地方处理
    if (id === 'fileManagerSearch') {
      // triggerFileManagerSearchActivation(); // 考虑移除这里的触发，让组件内部处理失败后的激活
    } else if (id === 'terminalSearch') {
      // triggerTerminalSearchActivation(); // 同上
    }
    return false; // 返回聚焦失败
  }

  // --- 修改 Getters ---
  // +++ 修改：获取完整的已配置输入框信息（合并快捷键）+++
  // 返回类型现在包含 shortcut，所以需要调整或确认 FocusableInput 定义
  // +++ 修改：获取在序列中的输入框信息（包含快捷键）+++
  const getSequenceInputs = computed((): (FocusableInput & FocusItemConfig)[] => {
    const inputsMap = new Map(availableInputs.value.map(input => [input.id, input]));
    const configs = itemConfigs.value;
    // Step 1: Map sequenceOrder to potential objects or undefined
    const mappedInputs = sequenceOrder.value
      .map(id => {
        const baseInput = inputsMap.get(id);
        if (!baseInput) return undefined;
        const config = configs[id] || {};
        // ++ Explicitly create object with the intersection type ++
        const combinedInput: FocusableInput & FocusItemConfig = {
            ...baseInput,
            shortcut: config.shortcut,
        };
        return combinedInput; // Return the correctly typed object
      });

    // Step 2: Filter out any undefined values using the type predicate
    const filteredInputs = mappedInputs.filter(
        (input): input is FocusableInput & FocusItemConfig => input !== undefined
    );

    return filteredInputs; // Return the correctly typed array
  });

  // +++ 修改：获取配置器中“可用”的输入框列表 +++
  // +++ 修改：获取不在序列中的输入框信息（也包含快捷键，因为现在全局管理） +++
  const getAvailableInputsForConfigurator = computed((): (FocusableInput & FocusItemConfig)[] => {
    const sequenceIds = new Set(sequenceOrder.value);
    const configs = itemConfigs.value;
    return availableInputs.value
      .filter(input => !sequenceIds.has(input.id)) // 过滤掉已在序列中的
      .map(input => {
          const config = configs[input.id] || {};
          return {
              ...input,
              shortcut: config.shortcut, // 合并快捷键
          };
      });
  });

  // +++ 修改：获取序列中的下一个聚焦目标 ID +++
  // +++ 修改：根据 sequenceOrder 获取下一个聚焦目标 ID +++
  function getNextFocusTargetId(currentFocusedId: string | null): string | null {
    const order = sequenceOrder.value;
    if (order.length === 0) {
      return null;
    }
    if (currentFocusedId === null) {
      return order[0]; // 返回序列中的第一个 ID
    }
    const currentIndex = order.findIndex(id => id === currentFocusedId);
    if (currentIndex === -1) {
      return order[0]; // 如果当前 ID 不在序列中，返回第一个
    }
    const nextIndex = (currentIndex + 1) % order.length;
    return order[nextIndex]; // 返回序列中的下一个 ID
  }

  // +++ 根据快捷键获取目标 ID +++
  // +++ 修改：根据 itemConfigs 获取快捷键对应的目标 ID +++
  function getFocusTargetIdByShortcut(shortcut: string): string | null {
      const normalizedShortcut = normalizeFocusSwitcherShortcut(shortcut);
      if (!normalizedShortcut) {
          return null;
      }
      for (const id in itemConfigs.value) {
          if (normalizeFocusSwitcherShortcut(itemConfigs.value[id]?.shortcut) === normalizedShortcut) {
              return id;
          }
      }
      return null;
  }


  // --- Initialization ---
  // Store 创建时自动从后端加载配置
  // console.log('[FocusSwitcherStore] Initializing store and scheduling loadConfigurationFromBackend...'); // 使用新名称
  nextTick(() => {
    // console.log('[FocusSwitcherStore] nextTick triggered, calling loadConfigurationFromBackend.'); // 使用新名称
    loadConfigurationFromBackend(); // 调用重命名后的加载函数
  });

  return {
    // State
    availableInputs,
    sequenceOrder, // +++ 暴露新状态 +++
    itemConfigs,   // +++ 暴露新状态 +++
    isConfiguratorVisible,
    configuratorSourceDocument,
    activateFileManagerSearchTrigger,
    activateTerminalSearchTrigger,
    // Actions
    toggleConfigurator,
    triggerFileManagerSearchActivation,
    triggerTerminalSearchActivation,
    loadConfigurationFromBackend,
    saveConfigurationToBackend,
    updateConfiguration, // 已修改为接收完整配置
    // Getters / Methods
    getSequenceInputs, // +++ 重命名并修改 +++
    getAvailableInputsForConfigurator, // 已修改
    getNextFocusTargetId, // 已修改
    getFocusTargetIdByShortcut, // 已修改
    registerFocusAction, // 返回注销函数
    // unregisterFocusAction, // 废弃旧的注销函数
    focusTarget, // 已更新
  };
});
