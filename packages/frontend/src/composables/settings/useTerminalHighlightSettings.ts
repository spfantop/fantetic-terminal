import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '../../stores/settings.store';
import {
  cloneDefaultTerminalHighlightRules,
  normalizeTerminalHighlightRules,
  parseTerminalHighlightRulesDocument,
  previewTerminalHighlightSegments,
  serializeTerminalHighlightRules,
  type TerminalHighlightRule,
} from '../../utils/terminalOutputHighlighter';

const DEFAULT_PREVIEW_TEXT = '2026-07-05 10:30:15 INFO service started\n2026-07-05 10:31:02 WARN retrying request\n2026-07-05 10:31:10 ERROR request failed https://example.com/api 500 Error';

const createTerminalHighlightRulesDocument = (rules: TerminalHighlightRule[]) => {
  return JSON.stringify({ rules: normalizeTerminalHighlightRules(rules) }, null, 2);
};

export function useTerminalHighlightSettings() {
  const settingsStore = useSettingsStore();
  const { t } = useI18n();
  const {
    terminalHighlightEnabledBoolean,
    terminalHighlightRulesList,
  } = storeToRefs(settingsStore);

  const terminalHighlightEnabledLocal = ref(false);
  const terminalHighlightRulesLocal = ref<TerminalHighlightRule[]>([]);
  const terminalHighlightLoading = ref(false);
  const terminalHighlightMessage = ref('');
  const terminalHighlightSuccess = ref(false);
  const terminalHighlightJsonMode = ref(false);
  const terminalHighlightRulesJson = ref('');
  const terminalHighlightRulesJsonError = ref('');
  const terminalHighlightPreviewText = ref(DEFAULT_PREVIEW_TEXT);
  const terminalHighlightPreviewSegments = computed(() => previewTerminalHighlightSegments(
    terminalHighlightPreviewText.value,
    {
      enabled: terminalHighlightEnabledLocal.value,
      rules: terminalHighlightRulesLocal.value,
    },
  ));

  const cloneTerminalHighlightRule = (rule: TerminalHighlightRule): TerminalHighlightRule => ({ ...rule });

  const syncTerminalHighlightRulesJsonFromLocal = () => {
    terminalHighlightRulesJson.value = createTerminalHighlightRulesDocument(terminalHighlightRulesLocal.value);
    terminalHighlightRulesJsonError.value = '';
  };

  const createTerminalHighlightRule = (): TerminalHighlightRule => ({
    id: `custom-${Date.now()}-${terminalHighlightRulesLocal.value.length + 1}`,
    name: t('settings.terminalHighlight.newRuleName', '自定义规则'),
    enabled: true,
    pattern: 'TODO',
    flags: 'g',
    foreground: '#f59e0b',
    background: undefined,
    bold: false,
    underline: false,
    priority: 0,
    stopOnMatch: false,
  });

  const syncTerminalHighlightRulesFromStore = () => {
    terminalHighlightRulesLocal.value = terminalHighlightRulesList.value.map(cloneTerminalHighlightRule);
    if (!terminalHighlightJsonMode.value) {
      syncTerminalHighlightRulesJsonFromLocal();
    }
  };

  const addTerminalHighlightRule = () => {
    terminalHighlightRulesLocal.value = [
      ...terminalHighlightRulesLocal.value,
      createTerminalHighlightRule(),
    ];
    if (!terminalHighlightJsonMode.value) {
      syncTerminalHighlightRulesJsonFromLocal();
    }
  };

  const removeTerminalHighlightRule = (index: number) => {
    terminalHighlightRulesLocal.value = terminalHighlightRulesLocal.value.filter((_, ruleIndex) => ruleIndex !== index);
    if (!terminalHighlightJsonMode.value) {
      syncTerminalHighlightRulesJsonFromLocal();
    }
  };

  const resetTerminalHighlightRules = () => {
    terminalHighlightRulesLocal.value = cloneDefaultTerminalHighlightRules();
    terminalHighlightMessage.value = '';
    terminalHighlightSuccess.value = false;
    syncTerminalHighlightRulesJsonFromLocal();
  };

  const formatTerminalHighlightRulesJson = () => {
    try {
      const parsedRules = parseTerminalHighlightRulesDocument(terminalHighlightRulesJson.value);
      terminalHighlightRulesJson.value = createTerminalHighlightRulesDocument(parsedRules);
      terminalHighlightRulesJsonError.value = '';
      return true;
    } catch {
      terminalHighlightRulesJsonError.value = t('settings.terminalHighlight.error.invalidJson', '请输入有效的高亮规则 JSON。');
      terminalHighlightSuccess.value = false;
      return false;
    }
  };

  const applyTerminalHighlightRulesJson = () => {
    try {
      const parsedRules = parseTerminalHighlightRulesDocument(terminalHighlightRulesJson.value);
      terminalHighlightRulesLocal.value = parsedRules;
      terminalHighlightRulesJson.value = createTerminalHighlightRulesDocument(parsedRules);
      terminalHighlightRulesJsonError.value = '';
      return true;
    } catch {
      terminalHighlightRulesJsonError.value = t('settings.terminalHighlight.error.invalidJson', '请输入有效的高亮规则 JSON。');
      terminalHighlightSuccess.value = false;
      return false;
    }
  };

  const handleUpdateTerminalHighlightRules = async () => {
    terminalHighlightMessage.value = '';
    terminalHighlightSuccess.value = false;

    if (terminalHighlightJsonMode.value && !applyTerminalHighlightRulesJson()) {
      terminalHighlightMessage.value = terminalHighlightRulesJsonError.value;
      return;
    }

    terminalHighlightLoading.value = true;
    try {
      await settingsStore.updateMultipleSettings({
        terminalHighlightEnabled: terminalHighlightEnabledLocal.value ? 'true' : 'false',
        terminalHighlightRules: serializeTerminalHighlightRules(terminalHighlightRulesLocal.value),
      });
      terminalHighlightRulesLocal.value = terminalHighlightRulesList.value.map(cloneTerminalHighlightRule);
      syncTerminalHighlightRulesJsonFromLocal();
      terminalHighlightMessage.value = t('settings.terminalHighlight.success.saved', '终端日志高亮设置已保存。');
      terminalHighlightSuccess.value = true;
    } catch (error: any) {
      console.error('更新终端日志高亮设置失败:', error);
      terminalHighlightMessage.value = error.message || t('settings.terminalHighlight.error.saveFailed', '保存终端日志高亮设置失败。');
      terminalHighlightSuccess.value = false;
    } finally {
      terminalHighlightLoading.value = false;
    }
  };

  watch(terminalHighlightEnabledBoolean, (newValue) => { terminalHighlightEnabledLocal.value = newValue; }, { immediate: true });
  watch(terminalHighlightRulesList, syncTerminalHighlightRulesFromStore, { immediate: true });
  watch(terminalHighlightJsonMode, (enabled) => {
    if (enabled) {
      syncTerminalHighlightRulesJsonFromLocal();
    }
  });

  return {
    terminalHighlightEnabledLocal,
    terminalHighlightRulesLocal,
    terminalHighlightLoading,
    terminalHighlightMessage,
    terminalHighlightSuccess,
    terminalHighlightJsonMode,
    terminalHighlightRulesJson,
    terminalHighlightRulesJsonError,
    terminalHighlightPreviewText,
    terminalHighlightPreviewSegments,
    addTerminalHighlightRule,
    removeTerminalHighlightRule,
    resetTerminalHighlightRules,
    formatTerminalHighlightRulesJson,
    applyTerminalHighlightRulesJson,
    handleUpdateTerminalHighlightRules,
  };
}
