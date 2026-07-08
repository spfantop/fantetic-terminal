<script setup lang="ts">
import { defineProps, defineEmits, watch, onMounted, ref, computed } from 'vue';
import QuickCommandsView from '../views/QuickCommandsView.vue'; // 导入视图
import { useWorkspaceEventSubscriber } from '../composables/workspaceEvents'; // 导入事件订阅器
import { useDraggableDialog } from '../composables/useDraggableDialog';
import { useResizable } from '../composables/useResizable';
import { debugLog } from '../composables/useDebugLog';

const props = defineProps<{
  isVisible: boolean;
  teleportTarget?: string | HTMLElement;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'execute-command', command: string): void;
}>();

const closeModal = () => {
  emit('close');
};
const modalRootRef = ref<HTMLElement | null>(null);
const modalContentRef = ref<HTMLElement | null>(null);
const resolvedTeleportTarget = computed(() => props.teleportTarget ?? 'body');
const readModalDocument = () => {
  if (modalRootRef.value?.ownerDocument) return modalRootRef.value.ownerDocument;
  if (typeof props.teleportTarget !== 'string') return props.teleportTarget?.ownerDocument ?? document;
  return document;
};
let activeModalDocument: Document | null = null;
const { centerDialog, startDialogDrag } = useDraggableDialog({
  rootRef: modalRootRef,
  dialogRef: modalContentRef,
  resizable: false,
});
const { width: modalWidth, height: modalHeight } = useResizable(modalContentRef, {
  minWidth: 420,
  minHeight: 360,
  maxWidth: () => (modalContentRef.value?.ownerDocument.defaultView ?? window).innerWidth - 24,
  maxHeight: () => (modalContentRef.value?.ownerDocument.defaultView ?? window).innerHeight - 24,
});
const modalResizeStyle = computed(() => ({
  width: modalWidth.value ? `${modalWidth.value}px` : 'min(36rem, calc(100vw - 2rem))',
  height: modalHeight.value ? `${modalHeight.value}px` : 'min(42rem, 85vh)',
}));

// 处理从 QuickCommandsView 传来的事件
const handleCommandExecute = (command: string) => {
  emit('execute-command', command);
  closeModal(); // 选择指令后自动关闭
};

// Optional: Add keyboard listener to close on Esc key
const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    closeModal();
  }
};

watch(() => props.isVisible, (newValue) => {
  if (newValue) {
    activeModalDocument?.removeEventListener('keydown', handleKeydown);
    activeModalDocument = readModalDocument();
    activeModalDocument.addEventListener('keydown', handleKeydown);
    centerDialog();
  } else {
    activeModalDocument?.removeEventListener('keydown', handleKeydown);
    activeModalDocument = null;
  }
});

const onWorkspaceEvent = useWorkspaceEventSubscriber(); // 获取事件订阅器

// Clean up listener on unmount (though v-if usually handles this)
import { onUnmounted } from 'vue';
onUnmounted(() => {
  activeModalDocument?.removeEventListener('keydown', handleKeydown);
  activeModalDocument = null;
});

onMounted(() => {
  // 监听 terminal:sendCommand 事件以关闭模态框
  onWorkspaceEvent('terminal:sendCommand', () => {
    debugLog('[QuickCommandsModal] Received terminal:sendCommand event, closing modal.');
    closeModal();
  });
});

</script>

<template>
  <teleport :to="resolvedTeleportTarget">
    <div ref="modalRootRef" v-if="isVisible" class="fixed inset-0 bg-overlay flex justify-center items-center z-50 p-4" @click.self="closeModal">
      <div ref="modalContentRef" class="bg-background text-foreground p-4 rounded-lg shadow-xl border border-border flex flex-col relative" :style="modalResizeStyle">
        <span class="quick-command-modal-resize-hint" aria-hidden="true"></span>
        <!-- Close Button -->
        <button class="absolute top-2 right-2 p-1 text-text-secondary hover:text-foreground z-10" @pointerdown.stop @click="closeModal" title="关闭">
           <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
             <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
           </svg>
        </button>
        <!-- Title -->
        <h3 class="text-lg font-semibold text-center mb-3 flex-shrink-0 cursor-move select-none" @pointerdown="startDialogDrag">快捷指令</h3>
        <!-- Quick Commands View Embedded -->
        <div class="flex-grow overflow-y-auto border border-border rounded">
          <QuickCommandsView @execute-command="handleCommandExecute" />
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
/* Add any specific modal styles if needed */
.bg-overlay {
  background-color: rgba(0, 0, 0, 0.6);
}

.quick-command-modal-resize-hint {
  position: absolute;
  right: 0.35rem;
  bottom: 0.35rem;
  width: 0.75rem;
  height: 0.75rem;
  border-right: 2px solid color-mix(in srgb, var(--text-color-secondary) 55%, transparent);
  border-bottom: 2px solid color-mix(in srgb, var(--text-color-secondary) 55%, transparent);
  pointer-events: none;
}
</style>
