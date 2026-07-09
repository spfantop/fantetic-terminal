<script setup lang="ts">
import { computed, defineProps, defineEmits, watch, onMounted, onUnmounted, ref } from 'vue';
import SuspendedSshSessionsView from '../views/SuspendedSshSessionsView.vue'; // 导入视图
import { useWorkspaceEventSubscriber, useWorkspaceEventOff } from '../composables/workspaceEvents'; // 导入事件订阅器和取消订阅器
import { useI18n } from 'vue-i18n';
import { useDraggableDialog } from '../composables/useDraggableDialog';
import { debugLog } from '../composables/useDebugLog';

const props = defineProps<{
  isVisible: boolean;
  teleportTarget?: string | HTMLElement;
  isMobile?: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { t } = useI18n();
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
});
const isMobileViewport = computed(() => (
  props.isMobile || ((modalRootRef.value?.ownerDocument.defaultView ?? window).innerWidth <= 768)
));
const mobileModalContentStyle = {
  width: 'min(100%, calc(100dvw - 2rem))',
  maxWidth: 'calc(100dvw - 2rem)',
  height: 'min(86dvh, calc(100dvh - 2rem))',
  maxHeight: 'calc(100dvh - 2rem)',
};
const modalContentStyle = computed(() => (
  isMobileViewport.value ? mobileModalContentStyle : undefined
));

const closeModal = () => {
  emit('close');
};

// 键盘监听 Esc 关闭
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

const onWorkspaceEvent = useWorkspaceEventSubscriber();
const offWorkspaceEvent = useWorkspaceEventOff(); // 获取取消订阅函数

// 定义事件处理函数
const handleSuspendedSessionActionCompleted = () => {
  debugLog('[SuspendedSshSessionsModal] Received suspendedSession:actionCompleted event, closing modal.');
  closeModal();
};

onMounted(() => {
  // 监听 suspendedSession:actionCompleted 事件以关闭模态框
  onWorkspaceEvent('suspendedSession:actionCompleted', handleSuspendedSessionActionCompleted);
});

onUnmounted(() => {
  activeModalDocument?.removeEventListener('keydown', handleKeydown);
  activeModalDocument = null;
  // 组件卸载时取消订阅
  offWorkspaceEvent('suspendedSession:actionCompleted', handleSuspendedSessionActionCompleted);
});

</script>

<template>
  <teleport :to="resolvedTeleportTarget">
    <div ref="modalRootRef" v-if="isVisible" class="fixed inset-0 bg-overlay flex justify-center items-center z-50 p-4" @click.self="closeModal">
      <div ref="modalContentRef" class="bg-background text-foreground p-4 rounded-lg shadow-xl border border-border w-full max-w-2xl max-h-[85vh] flex flex-col relative min-w-0 overflow-hidden" :style="modalContentStyle">
        <!-- Close Button -->
        <button class="absolute top-2 right-2 p-1 text-text-secondary hover:text-foreground z-10" @pointerdown.stop @click="closeModal" :title="t('close', '关闭')">
           <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
             <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
           </svg>
        </button>
        <!-- Title -->
        <h3 class="text-lg font-semibold text-center mb-3 flex-shrink-0 cursor-move select-none" @pointerdown="startDialogDrag">{{ t('suspendedSshSessions.modalTitle', '挂起的 SSH 会话') }}</h3>
        <!-- Suspended SSH Sessions View Embedded -->
        <div class="flex-grow overflow-y-auto border border-border rounded">
          <SuspendedSshSessionsView />
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.bg-overlay {
  background-color: rgba(0, 0, 0, 0.6);
}
</style>
