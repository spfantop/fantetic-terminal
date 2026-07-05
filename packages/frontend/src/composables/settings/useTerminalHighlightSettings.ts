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

const DEFAULT_PREVIEW_TEXT = `peter@server:/opt/app (main)$ docker compose up -d --build
root@prod:/var/log# tail -f /var/log/nginx/access.log
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk && echo "$JAVA_HOME"
curl -X POST "https://example.com/api/login" -H 'Content-Type: application/json' --connect-timeout=5
2026-07-05 22:55:08.123 INFO  [main] c.example.App - started in 1280 ms
2026-07-05T22:55:09.181082768+09:00 ERROR request failed traceId=adMm1224399051239198720 path=/api/user/list
2026/7/5 22:55:10 WARN Deprecated config import optional:nacos:api.yaml
2026-07-05 22:55:11.456 INFO response={"code":200,"success":true,"url":"https://example.com/api?id=1","ip":"10.0.0.2","message":"JSON 内部整体同色，不拆 URL / IP / ERROR"} cost=35ms
{"code":500,"success":false,"message":"整行 JSON 应该全部一种颜色","data":null,"traceId":"adMm1224399051239198720","ip":"192.168.1.10"}
GET /api/user/list HTTP/1.1 500 Internal Server Error
HTTP/1.1 302 Found
HTTP/1.1 200 OK
java.lang.NullPointerException: test exception
    at com.example.App.main(App.java:42)
Caused by: java.sql.SQLNonTransientConnectionException: Too many connections
==> Preparing: SELECT id,name FROM sys_user WHERE status = ? ORDER BY id DESC limit 10
git commit -m "feat: update terminal highlight" && git push origin main
`;

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
