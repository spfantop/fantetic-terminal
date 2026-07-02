<template>
  <teleport to="body">
    <div
      v-if="isVisible"
      class="cpu-core-modal__overlay"
      @click.self="emit('close')"
    >
      <section class="cpu-core-modal">
        <header class="cpu-core-modal__header">
          <div>
            <h4 class="cpu-core-modal__title">{{ t('statusMonitor.cpuCoreModalTitle') }}</h4>
            <p class="cpu-core-modal__subtitle">{{ t('statusMonitor.cpuCoreModalSubtitle') }}</p>
          </div>
          <button
            type="button"
            class="cpu-core-modal__close"
            @click="emit('close')"
          >
            {{ t('common.close', '关闭') }}
          </button>
        </header>

        <div class="cpu-core-modal__summary">
          <span class="cpu-core-modal__pill">{{ t('statusMonitor.cpuCoresValue', { count: sortedItems.length }) }}</span>
          <span class="cpu-core-modal__pill">{{ t('statusMonitor.cpuCurrentStat') }} {{ `${totalCpuPercent.toFixed(1)}%` }}</span>
          <span class="cpu-core-modal__pill">{{ t('statusMonitor.cpuAverageStat') }} {{ averagePercentDisplay }}</span>
          <span v-if="busiestCore" class="cpu-core-modal__pill">
            {{ t('statusMonitor.cpuBusiestCoreStat') }} {{ busiestCore.label }} / {{ busiestCore.value }}
          </span>
        </div>

        <div v-if="sortedItems.length > 0" class="cpu-core-modal__grid">
          <article
            v-for="item in sortedItems"
            :key="item.key"
            class="cpu-core-card"
          >
            <div class="cpu-core-card__meta">
              <span class="cpu-core-card__label">{{ item.label }}</span>
              <span class="cpu-core-card__value">{{ item.value }}</span>
            </div>
            <div class="cpu-core-card__track">
              <span class="cpu-core-card__fill" :style="{ width: `${item.percent}%` }"></span>
            </div>
          </article>
        </div>
        <div v-else class="cpu-core-modal__empty">
          {{ t('statusMonitor.cpuCoreModalEmpty', '暂无核心数据') }}
        </div>
      </section>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

interface CpuCoreDisplayItem {
  key: string;
  label: string;
  value: string;
  percent: number;
}

const props = defineProps<{
  isVisible: boolean;
  cpuCoreItems: CpuCoreDisplayItem[];
  totalCpuPercent: number;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { t } = useI18n();

const sortedItems = computed(() => [...props.cpuCoreItems].sort((left, right) => right.percent - left.percent));

const averagePercentDisplay = computed(() => {
  if (sortedItems.value.length === 0) return `${props.totalCpuPercent.toFixed(1)}%`;

  const total = sortedItems.value.reduce((sum, item) => sum + item.percent, 0);
  return `${(total / sortedItems.value.length).toFixed(1)}%`;
});

const busiestCore = computed(() => sortedItems.value[0] ?? null);
</script>

<style scoped>
.cpu-core-modal__overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.58);
  backdrop-filter: blur(10px);
  padding: 20px;
}

.cpu-core-modal {
  width: min(840px, calc(100vw - 40px));
  max-height: calc(100vh - 40px);
  overflow: auto;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--border-color) 64%, transparent);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--header-bg-color) 86%, transparent), var(--app-bg-color));
  color: var(--text-color);
  padding: 20px;
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.28);
}

.cpu-core-modal__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.cpu-core-modal__title {
  margin: 0;
  color: var(--text-color);
  font-size: 1.25rem;
  font-weight: 800;
}

.cpu-core-modal__subtitle {
  margin: 8px 0 0;
  color: var(--text-color-secondary);
  font-size: 0.82rem;
}

.cpu-core-modal__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  background: color-mix(in srgb, var(--header-bg-color) 70%, transparent);
  padding: 0 12px;
  color: var(--text-color);
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
}

.cpu-core-modal__summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}

.cpu-core-modal__pill {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--link-active-color) 22%, transparent);
  background: color-mix(in srgb, var(--link-active-bg-color) 82%, transparent);
  padding: 0 12px;
  color: var(--text-color);
  font-size: 0.75rem;
  font-weight: 700;
}

.cpu-core-modal__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(148px, 1fr));
  gap: 10px;
  margin-top: 18px;
}

.cpu-core-card {
  display: grid;
  gap: 8px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--border-color) 58%, transparent);
  background: color-mix(in srgb, var(--app-bg-color) 88%, var(--header-bg-color));
  padding: 12px;
}

.cpu-core-card__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.cpu-core-card__label {
  color: var(--text-color);
  font-size: 0.78rem;
  font-weight: 700;
}

.cpu-core-card__value {
  color: var(--text-color);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.9rem;
  font-weight: 800;
}

.cpu-core-card__track {
  position: relative;
  overflow: hidden;
  height: 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--border-color) 46%, transparent);
}

.cpu-core-card__fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: linear-gradient(90deg, #7dd3fc, #2563eb);
}

.cpu-core-modal__empty {
  margin-top: 18px;
  border-radius: 8px;
  border: 1px dashed color-mix(in srgb, var(--border-color) 68%, transparent);
  padding: 16px;
  color: var(--text-color-secondary);
  text-align: center;
}

@media (max-width: 640px) {
  .cpu-core-modal {
    width: calc(100vw - 24px);
    max-height: calc(100vh - 24px);
    padding: 16px;
  }

  .cpu-core-modal__header {
    flex-direction: column;
    align-items: stretch;
  }

  .cpu-core-modal__close {
    width: 100%;
  }
}
</style>
