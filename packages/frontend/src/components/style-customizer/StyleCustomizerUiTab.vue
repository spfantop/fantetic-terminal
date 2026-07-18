<script setup lang="ts">
import { debugLog } from '../../composables/useDebugLog';
import { ref, watch, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppearanceStore } from '../../stores/appearance.store';
import { useUiNotificationsStore } from '../../stores/uiNotifications.store';
import { storeToRefs } from 'pinia';
import { readUiThemeMode, resolveActiveUiTheme } from '../../utils/uiThemeState';

const { t } = useI18n();
const appearanceStore = useAppearanceStore();
const notificationsStore = useUiNotificationsStore();
const { appearanceSettings } = storeToRefs(appearanceStore);

const editableUiTheme = ref<Record<string, string>>({});
const editableUiThemeString = ref('');
const themeParseError = ref<string | null>(null);

const initializeEditableState = () => {
  editableUiTheme.value = JSON.parse(JSON.stringify(resolveActiveUiTheme(appearanceSettings.value)));
  themeParseError.value = null;
  try {
      const themeObject = editableUiTheme.value;
      if (themeObject && typeof themeObject === 'object' && Object.keys(themeObject).length > 0) {
          const lines = Object.entries(themeObject).map(([key, value]) => `${key}: ${value}`);
          editableUiThemeString.value = lines.join('\n');
      } else {
          editableUiThemeString.value = '';
      }
  } catch (e) {
      console.error("初始化 UI 主题字符串失败:", e);
      editableUiThemeString.value = '';
  }
};

onMounted(initializeEditableState);

watch(() => [
    appearanceSettings.value.uiThemeMode,
    appearanceSettings.value.customUiTheme,
    appearanceSettings.value.customDarkUiTheme,
], () => {
    debugLog('[StyleCustomizerUiTab Watch] UI theme settings changed, re-initializing.');
    initializeEditableState();
}, { deep: true });


const handleSaveUiTheme = async () => {
  try {
    if (readUiThemeMode(appearanceSettings.value) === 'dark') {
      await appearanceStore.saveCustomDarkUiTheme(editableUiTheme.value);
    } else {
      await appearanceStore.saveCustomUiTheme(editableUiTheme.value);
    }
    notificationsStore.addNotification({ type: 'success', message: t('styleCustomizer.uiThemeSaved') });
  } catch (error: any) {
    console.error("保存 UI 主题失败:", error);
    notificationsStore.addNotification({ type: 'error', message: t('styleCustomizer.uiThemeSaveFailed', { message: error.message }) });
  }
};

const handleResetUiTheme = async () => {
    try {
        if (readUiThemeMode(appearanceSettings.value) === 'dark') {
            await appearanceStore.resetCustomDarkUiTheme();
        } else {
            await appearanceStore.resetCustomUiTheme();
        }
        notificationsStore.addNotification({ type: 'info', message: t('styleCustomizer.uiThemeReset') });
    } catch (error: any) {
        console.error("重置 UI 主题失败:", error);
        notificationsStore.addNotification({ type: 'error', message: t('styleCustomizer.uiThemeResetFailed', { message: error.message }) });
    }
};

const setDarkMode = async () => {
  try {
    await appearanceStore.setUiThemeMode('dark');
    notificationsStore.addNotification({ type: 'success', message: t('styleCustomizer.themeModeSwitched') });
  } catch (error: any) {
    console.error("切换黑暗模式失败:", error);
    notificationsStore.addNotification({ type: 'error', message: t('styleCustomizer.themeModeSwitchFailed', { message: error.message || '未知错误' }) });
  }
};

const setDefaultMode = async () => {
  try {
    await appearanceStore.setUiThemeMode('default');
    notificationsStore.addNotification({ type: 'success', message: t('styleCustomizer.themeModeSwitched') });
  } catch (error: any) {
    console.error("切换默认模式失败:", error);
    notificationsStore.addNotification({ type: 'error', message: t('styleCustomizer.themeModeSwitchFailed', { message: error.message || '未知错误' }) });
  }
};

const formattedEditableUiThemeJson = computed(() => {
    try {
        const themeObject = editableUiTheme.value;
        if (!themeObject || typeof themeObject !== 'object' || Object.keys(themeObject).length === 0) {
            return '';
        }
        const lines = Object.entries(themeObject).map(([key, value]) => {
            return `${key}: ${value}`;
        });
        return lines.join('\n');
    } catch (e) {
        console.error("序列化可编辑 UI 主题键值对失败:", e);
        return '';
    }
});

watch(formattedEditableUiThemeJson, (newJson) => {
    if (document.activeElement?.id !== 'uiThemeTextarea' || themeParseError.value) {
        editableUiThemeString.value = newJson;
        if (themeParseError.value && document.activeElement?.id !== 'uiThemeTextarea') {
             themeParseError.value = null;
        }
    }
});

const handleUiThemeStringChange = () => {
    themeParseError.value = null;
    let inputText = editableUiThemeString.value.trim();

    if (!inputText) {
        editableUiTheme.value = {};
        return;
    }

    let jsonStringToParse = inputText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && line.includes(':'))
        .map(line => {
            const parts = line.split(/:(.*)/s);
            if (parts.length < 2) return null;

            let key = parts[0].trim();
            let value = parts[1].trim();

            if (key.startsWith('"') && key.endsWith('"')) key = key.slice(1, -1);
            if (key.startsWith("'") && key.endsWith("'")) key = key.slice(1, -1);
            key = JSON.stringify(key);

            if (value.endsWith(',')) value = value.slice(0, -1).trim();
            let originalValue = value;
            if (value.startsWith('"') && value.endsWith('"')) originalValue = value.slice(1, -1);
            else if (value.startsWith("'") && value.endsWith("'")) originalValue = value.slice(1, -1);

            if (isNaN(Number(originalValue)) && originalValue !== 'true' && originalValue !== 'false' && originalValue !== 'null') {
                 value = JSON.stringify(originalValue);
            } else {
                value = originalValue;
            }
            return `  ${key}: ${value}`;
        })
        .filter(line => line !== null)
        .join(',\n');

    const fullJsonString = `{\n${jsonStringToParse}\n}`;

    try {
        const parsedTheme = JSON.parse(fullJsonString);
        if (typeof parsedTheme !== 'object' || parsedTheme === null || Array.isArray(parsedTheme)) {
            throw new Error(t('styleCustomizer.errorInvalidJsonObject'));
        }
        editableUiTheme.value = parsedTheme;
    } catch (error: any) {
        console.error('解析 UI 主题配置失败:', error);
        let errorMessage = error.message || t('styleCustomizer.errorInvalidJsonConfig');
        if (error instanceof SyntaxError) {
            errorMessage = `${t('styleCustomizer.errorJsonSyntax')}: ${error.message}`;
        }
        themeParseError.value = errorMessage;
    }
};

const formatLabel = (key: string): string => {
  return key
    .replace(/^--/, '')
    .replace(/-/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase());
};

const handleFocusAndSelect = (event: FocusEvent) => {
  const target = event.target;
  if (target instanceof HTMLInputElement) {
    target.select();
  }
};

defineExpose({
  handleSaveUiTheme,
  handleResetUiTheme
});

</script>

<template>
  <section>
    <h3 class="mt-0 border-b border-border pb-2 mb-4 text-lg font-semibold text-foreground">{{ t('styleCustomizer.uiStyles') }}</h3>
    <div class="grid grid-cols-1 md:grid-cols-[auto_1fr] items-start md:items-center gap-2 md:gap-3 mb-6">
        <label class="text-left text-foreground text-sm font-medium mb-1 md:mb-0">{{ t('styleCustomizer.themeModeLabel', '主题模式:') }}</label>
        <div class="flex gap-2 justify-start flex-wrap">
            <button @click="setDefaultMode" class="px-3 py-1.5 text-sm border border-border rounded bg-header hover:bg-border transition duration-200 ease-in-out whitespace-nowrap">{{ t('styleCustomizer.defaultMode', '默认模式') }}</button>
            <button @click="setDarkMode" class="px-3 py-1.5 text-sm border border-border rounded bg-header hover:bg-border transition duration-200 ease-in-out whitespace-nowrap">{{ t('styleCustomizer.darkMode', '黑暗模式') }}</button>
        </div>
    </div>
    <p class="text-text-secondary text-sm leading-relaxed mb-3">{{ t('styleCustomizer.uiDescription') }}</p>
    <div v-for="(value, key) in editableUiTheme" :key="key" class="grid grid-cols-1 md:grid-cols-[auto_1fr] items-start md:items-center gap-x-3 gap-y-1 mb-3">
      <label :for="`ui-${key}`" class="text-left text-foreground text-sm font-medium overflow-hidden text-ellipsis block w-full mb-1 md:mb-0">{{ formatLabel(key) }}:</label>
      <div class="flex items-center gap-2 w-full">
        <input
          v-if="typeof value === 'string' && (value.startsWith('#') || value.startsWith('rgb') || value.startsWith('hsl'))"
          type="color"
          :id="`ui-${key}`"
          v-model="editableUiTheme[key]"
          class="p-0.5 h-[34px] min-w-[40px] max-w-[50px] rounded border border-border flex-shrink-0 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
        />
        <input
          v-if="typeof value === 'string' && (value.startsWith('#') || value.startsWith('rgb') || value.startsWith('hsl'))"
          type="text"
          :value="editableUiTheme[key]"
          class="flex-grow min-w-[80px] bg-background cursor-text border border-border px-[0.7rem] py-2 rounded text-sm text-foreground w-full box-border transition duration-200 ease-in-out focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          @focus="handleFocusAndSelect"
          @input="editableUiTheme[key] = ($event.target as HTMLInputElement).value"
        />
        <input
          v-else
          type="text"
          :id="`ui-${key}`"
          v-model="editableUiTheme[key]"
          class="col-span-full border border-border px-[0.7rem] py-2 rounded text-sm bg-background text-foreground w-full box-border transition duration-200 ease-in-out focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
    </div>
    <hr style="margin-top: calc(var(--base-padding) * 2); margin-bottom: calc(var(--base-padding) * 2);">
    <h4 class="mt-6 mb-2 text-base font-semibold text-foreground">{{ t('styleCustomizer.uiThemeJsonEditorTitle') }}</h4>
    <p class="text-text-secondary text-sm leading-relaxed mb-3">{{ t('styleCustomizer.uiThemeJsonEditorDesc') }}</p>
    <div class="mt-4">
       <label for="uiThemeTextarea" class="sr-only">{{ t('styleCustomizer.uiThemeJsonEditorTitle') }}</label>
       <textarea
         id="uiThemeTextarea"
         v-model="editableUiThemeString"
         @blur="handleUiThemeStringChange"
         rows="15"
         :placeholder="'--app-bg-color: #ffffff\n--text-color: #333333\n...'"
         spellcheck="false"
         class="w-full font-mono text-sm leading-snug border border-border rounded p-3 bg-background text-foreground resize-y min-h-[200px] box-border whitespace-pre-wrap break-words transition duration-200 ease-in-out focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
       ></textarea>
    </div>
     <p v-if="themeParseError" class="text-error-text bg-error/10 border border-error/30 px-3 py-2 rounded text-sm mt-2">{{ themeParseError }}</p>
  </section>
</template>
