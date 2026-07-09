<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDraggableDialog } from '../../composables/useDraggableDialog';

interface Props {
  visible: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isLoading?: boolean;
  teleportTarget?: string | HTMLElement;
}

const props = defineProps<Props>();
const emit = defineEmits(['confirm', 'cancel', 'update:visible']);

const { t } = useI18n();

const dialogVisible = ref(props.visible);
const dialogRootRef = ref<HTMLElement | null>(null);
const dialogContentRef = ref<HTMLElement | null>(null);
let activeDialogDocument: Document | null = null;
const { centerDialog, startDialogDrag } = useDraggableDialog({
  rootRef: dialogRootRef,
  dialogRef: dialogContentRef,
  disabled: () => props.isLoading === true,
});

const resolvedTeleportTarget = computed(() => props.teleportTarget ?? 'body');

const resolveDialogDocument = () => {
  if (dialogRootRef.value?.ownerDocument) return dialogRootRef.value.ownerDocument;
  if (typeof props.teleportTarget !== 'string') return props.teleportTarget?.ownerDocument ?? document;
  return document;
};

watch(() => props.visible, (newValue) => {
  dialogVisible.value = newValue;
});

watch(dialogVisible, (newValue) => {
  if (newValue !== props.visible) {
    emit('update:visible', newValue);
  }
});

const handleConfirm = () => {
  if (props.isLoading) return;
  emit('confirm');
};

const handleCancel = () => {
  if (props.isLoading) return;
  emit('cancel');
  // 通常取消也应关闭对话框，如果store管理visible，则由store处理
  // emit('update:visible', false); 
};

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && dialogVisible.value && !props.isLoading) {
    handleCancel();
  }
};

watch(dialogVisible, (isVisible) => {
  activeDialogDocument?.removeEventListener('keydown', handleKeydown);
  activeDialogDocument = null;
  if (isVisible) {
    centerDialog();
    nextTick(() => {
      activeDialogDocument = resolveDialogDocument();
      activeDialogDocument.addEventListener('keydown', handleKeydown);
    });
  }
});

onBeforeUnmount(() => {
  activeDialogDocument?.removeEventListener('keydown', handleKeydown);
  activeDialogDocument = null;
});

</script>

<template>
  <teleport :to="resolvedTeleportTarget">
    <div
      ref="dialogRootRef"
      v-if="dialogVisible"
      class="fixed inset-0 z-[9999] flex items-center justify-center bg-overlay p-4"
      @mousedown.self="handleCancel"
    >
      <div
        ref="dialogContentRef"
        class="bg-background text-foreground p-5 rounded-lg shadow-xl border border-border w-full max-w-md flex flex-col"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="props.title"
      >
        <h3 class="text-xl font-semibold mb-4 text-center flex-shrink-0 cursor-move select-none" :id="props.title" @pointerdown="startDialogDrag">
          {{ props.title }}
        </h3>
        <div class="flex-grow mb-6 text-sm">
          <p class="text-text-secondary text-center whitespace-pre-wrap">
            {{ props.message }}
          </p>
        </div>
        <div class="flex justify-end gap-3 flex-shrink-0">
          <button
            @click="handleCancel"
            :disabled="props.isLoading"
            type="button"
            class="px-4 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 dark:focus:ring-offset-background-dark text-sm font-medium transition-colors duration-150 bg-background border border-border/50 text-text-secondary hover:bg-border hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {{ props.cancelText || t('common.cancel', '取消') }}
          </button>
          <button
            @click="handleConfirm"
            :disabled="props.isLoading"
            type="button"
            class="px-4 py-2 text-sm font-medium text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-background-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center bg-primary hover:bg-primary-hover focus:ring-primary"
          >
            <svg
              v-if="props.isLoading"
              class="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
              ></circle>
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            {{ props.confirmText || t('common.confirm', '确认') }}
          </button>
        </div>
      </div>
    </div>
  </teleport>
</template>
