<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
  type Component,
} from 'vue';
import { useI18n } from 'vue-i18n';
import type { ConnectionInfo } from '../stores/connections.store';

type ConnectionFormMode = 'single' | 'batch';

const props = withDefaults(defineProps<{
  mode: ConnectionFormMode;
  connectionToEdit?: ConnectionInfo | null;
  initialTagIds?: number[];
  initialFolderId?: number | null;
  visible?: boolean;
  connectionIds?: number[];
}>(), {
  connectionToEdit: null,
  initialTagIds: () => [],
  initialFolderId: null,
  visible: true,
  connectionIds: () => [],
});

const emit = defineEmits<{
  (event: 'close'): void;
  (event: 'connection-added'): void;
  (event: 'connection-updated'): void;
  (event: 'update:visible', visible: boolean): void;
  (event: 'saved'): void;
}>();

const { t } = useI18n();
const loadedComponent = shallowRef<Component | null>(null);
const isLoading = ref(false);
const loadFailed = ref(false);
const statePanelRef = ref<HTMLElement | null>(null);
let activeRequestId = 0;

const componentLoaderByMode: Record<ConnectionFormMode, () => Promise<{ default: Component }>> = {
  single: () => import('./AddConnectionForm.vue'),
  batch: () => import('./BatchEditConnectionForm.vue'),
};

const statusLabel = computed(() => (
  loadFailed.value ? t('common.errorOccurred') : t('common.loading')
));

const focusStatePanel = async () => {
  await nextTick();
  statePanelRef.value?.focus();
};

const loadComponent = async () => {
  const requestId = ++activeRequestId;
  loadedComponent.value = null;
  loadFailed.value = false;
  isLoading.value = true;
  await focusStatePanel();

  try {
    const module = await componentLoaderByMode[props.mode]();
    if (requestId === activeRequestId) loadedComponent.value = module.default;
  } catch {
    if (requestId === activeRequestId) {
      loadFailed.value = true;
      await focusStatePanel();
    }
  } finally {
    if (requestId === activeRequestId) isLoading.value = false;
  }
};

const dismiss = () => {
  if (props.mode === 'batch') {
    emit('update:visible', false);
  } else {
    emit('close');
  }
};

watch(() => props.mode, loadComponent, { immediate: true });
onBeforeUnmount(() => {
  activeRequestId += 1;
});
</script>

<template>
  <component
    :is="loadedComponent"
    v-if="loadedComponent && mode === 'single'"
    :connection-to-edit="connectionToEdit"
    :initial-tag-ids="initialTagIds"
    :initial-folder-id="initialFolderId"
    @close="emit('close')"
    @connection-added="emit('connection-added')"
    @connection-updated="emit('connection-updated')"
  />
  <component
    :is="loadedComponent"
    v-else-if="loadedComponent"
    :visible="visible"
    :connection-ids="connectionIds"
    @update:visible="emit('update:visible', $event)"
    @saved="emit('saved')"
  />

  <Teleport to="body">
    <div
      v-if="!loadedComponent"
      class="lazy-form-overlay"
      role="dialog"
      aria-modal="true"
      :aria-label="statusLabel"
      @click.self="dismiss"
    >
      <section
        ref="statePanelRef"
        class="lazy-form-state"
        tabindex="-1"
        @keydown.esc="dismiss"
      >
        <template v-if="isLoading">
          <i class="fas fa-spinner fa-spin lazy-form-state__icon" aria-hidden="true"></i>
          <p aria-live="polite">{{ t('common.loading') }}</p>
        </template>
        <template v-else>
          <i class="fas fa-triangle-exclamation lazy-form-state__icon lazy-form-state__icon--error" aria-hidden="true"></i>
          <p role="alert">{{ t('common.errorOccurred') }}</p>
          <div class="lazy-form-state__actions">
            <button type="button" class="lazy-form-button lazy-form-button--secondary" @click="dismiss">
              {{ t('common.cancel') }}
            </button>
            <button type="button" class="lazy-form-button lazy-form-button--primary" @click="loadComponent">
              <i class="fas fa-rotate-right" aria-hidden="true"></i>
              {{ t('common.retry') }}
            </button>
          </div>
        </template>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.lazy-form-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: var(--overlay-bg-color);
}

.lazy-form-state {
  display: grid;
  place-items: center;
  gap: 0.9rem;
  width: min(24rem, calc(100dvw - 2rem));
  min-height: 12rem;
  padding: 1.5rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--app-bg-color);
  color: var(--text-color);
  text-align: center;
  box-shadow: 0 1rem 2.5rem color-mix(in srgb, var(--text-color) 20%, transparent);
}

.lazy-form-state:focus-visible,
.lazy-form-button:focus-visible {
  outline: 2px solid var(--input-focus-border-color);
  outline-offset: 2px;
}

.lazy-form-state p {
  margin: 0;
}

.lazy-form-state__icon {
  color: var(--text-color-secondary);
  font-size: 1.5rem;
}

.lazy-form-state__icon--error {
  color: var(--color-error);
}

.lazy-form-state__actions {
  display: flex;
  justify-content: center;
  gap: 0.75rem;
}

.lazy-form-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 2.5rem;
  padding: 0.55rem 0.9rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  cursor: pointer;
}

.lazy-form-button--secondary {
  background: var(--app-bg-color);
  color: var(--text-color);
}

.lazy-form-button--primary {
  border-color: var(--button-bg-color);
  background: var(--button-bg-color);
  color: var(--button-text-color);
}

.lazy-form-button:hover {
  background: var(--button-hover-bg-color);
  color: var(--button-text-color);
}
</style>
