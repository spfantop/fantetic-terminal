<template>
  <div class="settings-section-content">
    <h3 class="text-base font-semibold text-foreground mb-3">{{ t('settings.terminalHighlight.title') }}</h3>
    <form @submit.prevent="handleUpdateTerminalHighlightRules" class="space-y-4">
      <div class="flex items-center">
        <input
          id="terminalHighlightEnabled"
          v-model="terminalHighlightEnabledLocal"
          type="checkbox"
          class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
        >
        <label for="terminalHighlightEnabled" class="text-sm text-foreground cursor-pointer select-none">
          {{ t('settings.terminalHighlight.enableLabel') }}
        </label>
      </div>
      <p class="text-xs text-text-secondary mt-1">{{ t('settings.terminalHighlight.description') }}</p>

      <div class="inline-flex rounded-md border border-border overflow-hidden">
        <button
          type="button"
          :class="[
            'px-3 py-1.5 text-sm transition-colors',
            !terminalHighlightJsonMode ? 'bg-button text-button-text' : 'bg-background text-foreground hover:bg-border',
          ]"
          @click="terminalHighlightJsonMode = false"
        >
          {{ t('settings.terminalHighlight.formMode') }}
        </button>
        <button
          type="button"
          :class="[
            'px-3 py-1.5 text-sm border-l border-border transition-colors',
            terminalHighlightJsonMode ? 'bg-button text-button-text' : 'bg-background text-foreground hover:bg-border',
          ]"
          @click="terminalHighlightJsonMode = true"
        >
          {{ t('settings.terminalHighlight.jsonMode') }}
        </button>
      </div>

      <div v-if="terminalHighlightJsonMode" class="space-y-3">
        <div>
          <label for="terminalHighlightRulesJson" class="block text-sm font-medium text-text-secondary mb-1">
            {{ t('settings.terminalHighlight.jsonLabel') }}
          </label>
          <textarea
            id="terminalHighlightRulesJson"
            v-model="terminalHighlightRulesJson"
            rows="14"
            spellcheck="false"
            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground font-mono text-xs leading-5 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          ></textarea>
          <p class="text-xs text-text-secondary mt-1">{{ t('settings.terminalHighlight.jsonHint') }}</p>
          <p v-if="terminalHighlightRulesJsonError" class="text-xs text-error mt-1">{{ terminalHighlightRulesJsonError }}</p>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <button
            type="button"
            class="px-4 py-2 border border-border text-foreground rounded-md hover:bg-border transition-colors text-sm font-medium"
            @click="formatTerminalHighlightRulesJson"
          >
            {{ t('settings.terminalHighlight.formatJson') }}
          </button>
          <button
            type="button"
            class="px-4 py-2 border border-border text-foreground rounded-md hover:bg-border transition-colors text-sm font-medium"
            @click="applyTerminalHighlightRulesJson"
          >
            {{ t('settings.terminalHighlight.applyJson') }}
          </button>
          <button
            type="button"
            class="px-4 py-2 border border-border text-foreground rounded-md hover:bg-border transition-colors text-sm font-medium"
            @click="resetTerminalHighlightRules"
          >
            {{ t('settings.terminalHighlight.resetPresets') }}
          </button>
        </div>
      </div>

      <template v-else>
        <div class="space-y-3">
          <div
            v-for="(rule, index) in terminalHighlightRulesLocal"
            :key="rule.id || index"
            class="rounded-md border border-border/70 p-3 space-y-3"
          >
            <div class="flex items-center justify-between gap-3">
              <label class="inline-flex items-center text-sm text-foreground cursor-pointer select-none">
                <input
                  v-model="rule.enabled"
                  type="checkbox"
                  class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
                >
                {{ t('settings.terminalHighlight.ruleEnabled') }}
              </label>
              <button
                type="button"
                class="inline-flex items-center justify-center px-2.5 py-1.5 rounded border border-border text-text-secondary hover:text-error hover:border-error transition-colors"
                :title="t('common.delete')"
                @click="removeTerminalHighlightRule(index)"
              >
                <i class="fas fa-trash-alt text-xs"></i>
              </button>
            </div>

            <div class="grid gap-3 md:grid-cols-3">
              <label class="block text-sm font-medium text-text-secondary">
                {{ t('settings.terminalHighlight.ruleName') }}
                <input
                  v-model="rule.name"
                  type="text"
                  class="mt-1 w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                >
              </label>
              <label class="block text-sm font-medium text-text-secondary md:col-span-2">
                {{ t('settings.terminalHighlight.pattern') }}
                <input
                  v-model="rule.pattern"
                  type="text"
                  class="mt-1 w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                  placeholder="\bERROR\b"
                >
              </label>
            </div>

            <div class="grid gap-3 md:grid-cols-6">
              <label class="block text-sm font-medium text-text-secondary">
                {{ t('settings.terminalHighlight.flags') }}
                <input
                  v-model="rule.flags"
                  type="text"
                  maxlength="6"
                  class="mt-1 w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                  placeholder="gi"
                >
              </label>
              <label class="block text-sm font-medium text-text-secondary">
                {{ t('settings.terminalHighlight.foreground') }}
                <input
                  v-model="rule.foreground"
                  type="color"
                  class="mt-1 h-10 w-full px-1 py-1 border border-border rounded-md shadow-sm bg-background cursor-pointer"
                >
              </label>
              <label class="block text-sm font-medium text-text-secondary">
                {{ t('settings.terminalHighlight.background') }}
                <input
                  v-model="rule.background"
                  type="text"
                  class="mt-1 w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                  placeholder="#000000"
                >
              </label>
              <label class="block text-sm font-medium text-text-secondary">
                {{ t('settings.terminalHighlight.priority') }}
                <input
                  v-model.number="rule.priority"
                  type="number"
                  step="1"
                  class="mt-1 w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                >
              </label>
              <label class="inline-flex items-center text-sm text-foreground cursor-pointer select-none pt-7">
                <input
                  v-model="rule.bold"
                  type="checkbox"
                  class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
                >
                {{ t('settings.terminalHighlight.bold') }}
              </label>
              <label class="inline-flex items-center text-sm text-foreground cursor-pointer select-none pt-7">
                <input
                  v-model="rule.underline"
                  type="checkbox"
                  class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer"
                >
                {{ t('settings.terminalHighlight.underline') }}
              </label>
            </div>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <button
            type="button"
            class="px-4 py-2 border border-border text-foreground rounded-md hover:bg-border transition-colors text-sm font-medium"
            @click="addTerminalHighlightRule"
          >
            {{ t('settings.terminalHighlight.addRule') }}
          </button>
          <button
            type="button"
            class="px-4 py-2 border border-border text-foreground rounded-md hover:bg-border transition-colors text-sm font-medium"
            @click="resetTerminalHighlightRules"
          >
            {{ t('settings.terminalHighlight.resetPresets') }}
          </button>
        </div>
      </template>

      <div>
        <label for="terminalHighlightPreviewText" class="block text-sm font-medium text-text-secondary mb-1">
          {{ t('settings.terminalHighlight.previewText') }}
        </label>
        <textarea
          id="terminalHighlightPreviewText"
          v-model="terminalHighlightPreviewText"
          rows="3"
          class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
        ></textarea>
        <div class="mt-2 rounded-md border border-border bg-background p-3 font-mono text-sm whitespace-pre-wrap break-words">
          <span
            v-for="(segment, segmentIndex) in terminalHighlightPreviewSegments"
            :key="segmentIndex"
            :style="getTerminalHighlightPreviewSegmentStyle(segment)"
          >{{ segment.text }}</span>
        </div>
      </div>

      <div class="flex items-center justify-between pt-2">
        <button
          type="submit"
          :disabled="terminalHighlightLoading"
          class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
        >
          {{ t('common.save') }}
        </button>
        <p v-if="terminalHighlightMessage" :class="['text-sm', terminalHighlightSuccess ? 'text-success' : 'text-error']">{{ terminalHighlightMessage }}</p>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useTerminalHighlightSettings } from '../../composables/settings/useTerminalHighlightSettings';
import type { TerminalHighlightPreviewSegment } from '../../utils/terminalOutputHighlighter';

const { t } = useI18n();

const {
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
} = useTerminalHighlightSettings();

const getTerminalHighlightPreviewSegmentStyle = (segment: TerminalHighlightPreviewSegment) => ({
  color: segment.foreground,
  backgroundColor: segment.background,
  fontWeight: segment.bold ? '700' : undefined,
  textDecoration: segment.underline ? 'underline' : undefined,
});
</script>
