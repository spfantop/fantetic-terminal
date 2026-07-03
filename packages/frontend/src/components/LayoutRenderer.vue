<script setup lang="ts">
import type { ConnectionInfo } from '../stores/connections.store';
import { computed, defineAsyncComponent, type PropType, type Component, ref, watch, onMounted, onBeforeUnmount, nextTick, type CSSProperties } from 'vue'; // Added onBeforeUnmount, nextTick and CSSProperties
import { useI18n } from 'vue-i18n';
import { useWorkspaceEventEmitter, useWorkspaceEventSubscriber, useWorkspaceEventOff, type WorkspaceEventPayloads } from '../composables/workspaceEvents';
import '@fortawesome/fontawesome-free/css/all.min.css';
import { Splitpanes, Pane } from 'splitpanes';
import { useLayoutStore, type LayoutNode, type PaneName } from '../stores/layout.store';
import { useSessionStore } from '../stores/session.store';
import { useFileEditorStore } from '../stores/fileEditor.store'; 
import { useSettingsStore } from '../stores/settings.store';
import { useAppearanceStore } from '../stores/appearance.store'; // +++ Import appearance store +++
import { useSidebarResize } from '../composables/useSidebarResize';
import { beginGlobalDragSelectionGuard } from '../composables/useGlobalDragSelectionGuard';
import { debugLog } from '../composables/useDebugLog';
import { storeToRefs } from 'pinia';


// --- Props ---
const props = defineProps({
  layoutNode: {
    type: Object as PropType<LayoutNode>,
    required: true,
  },
  // 标识是否为顶层渲染器
  isRootRenderer: {
    type: Boolean,
    default: false,
  },
  // 传递必要的上下文数据，避免在递归中重复获取
  activeSessionId: {
    type: String as PropType<string | null>,
    required: false, // 改为非必需
    default: null,   // 提供默认值 null
  },
  // *** 接收编辑器相关 props ***
  editorTabs: {
    type: Array as PropType<any[]>, // 使用 any[] 简化，或导入具体类型
    default: () => [],
  },
  activeEditorTabId: {
    type: String as PropType<string | null>,
    default: null,
  },
  // +++ Add layoutLocked prop +++
  layoutLocked: {
    type: Boolean,
    default: false,
  },
  poppedOutSessionIds: {
    type: Array as PropType<string[]>,
    required: false,
    default: () => [],
  },
  includedSessionId: {
    type: String as PropType<string | null>,
    required: false,
    default: null,
  },
  includedSessionIds: {
    type: Array as PropType<string[] | null>,
    required: false,
    default: null,
  },
  workspaceSplitActive: {
    type: Boolean,
    default: false,
  },
  workspaceSplitSessionIds: {
    type: Array as PropType<string[]>,
    default: () => [],
  },
  externalTerminalSessionId: {
    type: String as PropType<string | null>,
    required: false,
    default: null,
  },
  terminalInputHandler: {
    type: Function as PropType<(sessionId: string, data: string, batched?: boolean) => void>,
    required: false,
    default: null,
  },
});



const layoutStore = useLayoutStore();
const sessionStore = useSessionStore();
const fileEditorStore = useFileEditorStore(); 
const settingsStore = useSettingsStore(); 
const { t } = useI18n();
const subscribeToWorkspaceEvent = useWorkspaceEventSubscriber();
const unsubscribeFromWorkspaceEvent = useWorkspaceEventOff();
const emitWorkspaceEvent = useWorkspaceEventEmitter();

// +++ Appearance Store Refs +++
const appearanceStore = useAppearanceStore();
const {
  terminalBackgroundImage,
  isTerminalBackgroundEnabled,
  currentTerminalBackgroundOverlayOpacity,
  terminalCustomHTML,
} = storeToRefs(appearanceStore);

const { workspaceSidebarPersistentBoolean, getSidebarPaneWidth } = storeToRefs(settingsStore);
const { sidebarPanes } = storeToRefs(layoutStore);
const { orderedTabs: editorTabsFromStore, activeTabId: activeEditorTabIdFromStore } = storeToRefs(fileEditorStore); // <-- Get editor state

// --- Sidebar State ---
const activeLeftSidebarPane = ref<PaneName | null>(null);
const activeRightSidebarPane = ref<PaneName | null>(null);
const leftSidebarPanelRef = ref<HTMLElement | null>(null); // +++ Ref for left panel +++
const rightSidebarPanelRef = ref<HTMLElement | null>(null); // +++ Ref for right panel +++
const leftResizeHandleRef = ref<HTMLElement | null>(null); // +++ Ref for left handle +++
const rightResizeHandleRef = ref<HTMLElement | null>(null); // +++ Ref for right handle +++
const customHtmlLayerRef = ref<HTMLElement | null>(null); // +++ Ref for custom HTML layer +++

// --- Component Mapping ---
// 使用 defineAsyncComponent 优化加载，并映射 PaneName 到实际组件
const componentMap: Record<PaneName, Component> = {
  connections: defineAsyncComponent(() => import('./WorkspaceConnectionList.vue')),
  terminal: defineAsyncComponent(() => import('./Terminal.vue')),
  commandBar: defineAsyncComponent(() => import('./CommandInputBar.vue')),
  fileManager: defineAsyncComponent(() => import('./FileManager.vue')),
  editor: defineAsyncComponent(() => import('./FileEditorContainer.vue')),
  statusMonitor: defineAsyncComponent(() => import('./StatusMonitor.vue')),
  commandHistory: defineAsyncComponent(() => import('../views/CommandHistoryView.vue')),
  quickCommands: defineAsyncComponent(() => import('../views/QuickCommandsView.vue')),
  dockerManager: defineAsyncComponent(() => import('./DockerManager.vue')), // <--- 添加 dockerManager 映射
  suspendedSshSessions: defineAsyncComponent(() => import('../views/SuspendedSshSessionsView.vue')),
};

// --- Computed ---
// 获取当前节点对应的组件实例 (用于主布局)
const currentMainComponent = computed(() => {
  if (props.layoutNode.type === 'pane' && props.layoutNode.component) {
    return componentMap[props.layoutNode.component] || null;
  }
  return null;
});

// 获取当前激活的左侧侧栏组件实例
const currentLeftSidebarComponent = computed(() => {
  return activeLeftSidebarPane.value ? componentMap[activeLeftSidebarPane.value] : null;
});

// 获取当前激活的右侧侧栏组件实例
const currentRightSidebarComponent = computed(() => {
  return activeRightSidebarPane.value ? componentMap[activeRightSidebarPane.value] : null;
});

const scopedActiveSession = computed(() => (
  props.activeSessionId ? sessionStore.sessions.get(props.activeSessionId) ?? null : null
));

const terminalPaneSessionId = computed(() => (
  props.layoutNode.component === 'terminal' && Object.prototype.hasOwnProperty.call(props.layoutNode, 'sessionId')
    ? props.layoutNode.sessionId ?? null
    : props.activeSessionId
));

const shouldRenderSession = (sessionId: string) => {
  if (props.layoutNode.component === 'terminal' && Object.prototype.hasOwnProperty.call(props.layoutNode, 'sessionId')) {
    return props.layoutNode.sessionId === sessionId;
  }
  if (props.includedSessionIds !== null) {
    return props.includedSessionIds.includes(sessionId);
  }
  if (props.includedSessionId !== null) {
    return sessionId === props.includedSessionId;
  }
  return true;
};

const isTerminalSessionVisible = (sessionId: string) => {
  if (props.layoutNode.component === 'terminal' && Object.prototype.hasOwnProperty.call(props.layoutNode, 'sessionId')) {
    return props.layoutNode.sessionId === sessionId;
  }
  if (props.poppedOutSessionIds.includes(sessionId)) {
    return true;
  }
  if (props.workspaceSplitActive) {
    return props.workspaceSplitSessionIds.includes(sessionId);
  }
  if (props.includedSessionIds !== null) {
    return sessionId === props.activeSessionId;
  }
  if (props.includedSessionId !== null) {
    return sessionId === props.activeSessionId;
  }
  return sessionId === props.activeSessionId;
};

const getDynamicTerminalLayout = (count: number) => {
  const layouts: Record<number, [number, number]> = {
    1: [1, 1],
    2: [1, 2],
    3: [2, 2],
    4: [2, 2],
    5: [3, 2],
    6: [2, 3],
  };
  const [rows, cols] = layouts[count] ?? [Math.ceil(count / Math.ceil(Math.sqrt(count))), Math.ceil(Math.sqrt(count))];
  return { rows, cols };
};

const terminalSplitLayout = computed(() => getDynamicTerminalLayout(props.workspaceSplitSessionIds.length));
const terminalGridRef = ref<HTMLElement | null>(null);
const terminalGridRowSizes = ref<number[]>([]);
const terminalGridCellSizes = ref<{ width: number; height: number }[][]>([]);
const isTerminalGridResizing = ref(false);
const terminalGridResizeDirection = ref<'vertical' | 'horizontal' | null>(null);
let cleanupTerminalGridResizeListeners: (() => void) | null = null;
let releaseSplitpaneResizeGuard: (() => void) | null = null;
let splitpaneResizeDocument: Document | null = null;
let splitpaneResizeBridgeCleanup: (() => void) | null = null;
let terminalGridResizeDocument: Document | null = null;
let terminalGridResizeFrameId: number | null = null;
let pendingTerminalGridResizeUpdate: (() => void) | null = null;

const readEventDocument = (event: Event) => {
  const target = event.target as (EventTarget & { ownerDocument?: Document }) | null;
  return target?.ownerDocument ?? document;
};

const bridgePopupPointerEventsToMainDocument = (sourceDocument: Document) => {
  if (sourceDocument === document) return () => {};
  const sourceWindow = sourceDocument.defaultView;
  if (!sourceWindow) return () => {};

  const forwardMouseEvent = (event: MouseEvent) => {
    document.dispatchEvent(new MouseEvent(event.type, {
      bubbles: true,
      cancelable: true,
      view: window,
      screenX: event.screenX,
      screenY: event.screenY,
      clientX: event.clientX,
      clientY: event.clientY,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      button: event.button,
      buttons: event.buttons,
      relatedTarget: null,
    }));
  };

  const forwardTouchEvent = (event: TouchEvent) => {
    document.dispatchEvent(new TouchEvent(event.type, {
      bubbles: true,
      cancelable: true,
      view: window,
      touches: Array.from(event.touches),
      targetTouches: Array.from(event.targetTouches),
      changedTouches: Array.from(event.changedTouches),
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
    }));
  };

  sourceDocument.addEventListener('mousemove', forwardMouseEvent, true);
  sourceDocument.addEventListener('mouseup', forwardMouseEvent, true);
  sourceDocument.addEventListener('touchmove', forwardTouchEvent, { capture: true, passive: false });
  sourceDocument.addEventListener('touchend', forwardTouchEvent, true);
  sourceDocument.addEventListener('touchcancel', forwardTouchEvent, true);

  return () => {
    sourceDocument.removeEventListener('mousemove', forwardMouseEvent, true);
    sourceDocument.removeEventListener('mouseup', forwardMouseEvent, true);
    sourceDocument.removeEventListener('touchmove', forwardTouchEvent, true);
    sourceDocument.removeEventListener('touchend', forwardTouchEvent, true);
    sourceDocument.removeEventListener('touchcancel', forwardTouchEvent, true);
  };
};
const scheduleTerminalGridResizeUpdate = (update: () => void) => {
  pendingTerminalGridResizeUpdate = update;
  if (terminalGridResizeFrameId !== null) return;

  terminalGridResizeFrameId = window.requestAnimationFrame(() => {
    terminalGridResizeFrameId = null;
    pendingTerminalGridResizeUpdate?.();
    pendingTerminalGridResizeUpdate = null;
    emitWorkspaceEvent('ui:resizeTransaction', { phase: 'live', source: 'terminal-grid' });
  });
};

const initializeTerminalGridSizes = () => {
  const { rows, cols } = terminalSplitLayout.value;
  terminalGridRowSizes.value = Array.from({ length: rows }, () => 1);
  terminalGridCellSizes.value = Array.from({ length: rows }, (_, rowIndex) => {
    const sessionsInRow = Math.min(cols, props.workspaceSplitSessionIds.length - rowIndex * cols);
    return Array.from({ length: Math.max(0, sessionsInRow) }, () => ({ width: 1, height: 1 }));
  });
};

const getTerminalRowSizes = () => {
  const { rows } = terminalSplitLayout.value;
  return Array.from({ length: rows }, (_, index) => terminalGridRowSizes.value[index] ?? 1);
};

const getTerminalRowCellWidths = (rowIndex: number, sessionsInRow: number) => {
  const rowCells = terminalGridCellSizes.value[rowIndex] ?? [];
  return Array.from({ length: sessionsInRow }, (_, index) => rowCells[index]?.width ?? 1);
};

watch([() => props.workspaceSplitActive, () => props.workspaceSplitSessionIds.length], () => {
  if (props.workspaceSplitActive) {
    initializeTerminalGridSizes();
  } else {
    terminalGridRowSizes.value = [];
    terminalGridCellSizes.value = [];
    cleanupTerminalGridResizeListeners?.();
  }
}, { immediate: true });

const terminalGridResizers = computed(() => {
  if (!props.workspaceSplitActive || props.workspaceSplitSessionIds.length <= 1) return [];

  const { rows, cols } = terminalSplitLayout.value;
  const rowSizes = getTerminalRowSizes();
  const totalRowHeight = rowSizes.reduce((sum, size) => sum + size, 0) || rows;
  const dividerSize = 3;
  const halfDivider = dividerSize / 2;
  const resizers: Array<{
    key: string;
    direction: 'vertical' | 'horizontal';
    index: number;
    rowIndex: number | null;
    style: CSSProperties;
  }> = [];

  let accumulatedHeight = 0;
  for (let rowIndex = 0; rowIndex < rows - 1; rowIndex += 1) {
    accumulatedHeight += (rowSizes[rowIndex] || 1) / totalRowHeight;
    resizers.push({
      key: `h-${rowIndex}`,
      direction: 'horizontal',
      index: rowIndex,
      rowIndex: null,
      style: {
        position: 'absolute',
        top: `calc(${accumulatedHeight * 100}% - ${halfDivider}px)`,
        left: 0,
        height: `${dividerSize}px`,
        width: '100%',
        cursor: 'row-resize',
        zIndex: 10,
      },
    });
  }

  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    const sessionsInRow = Math.min(cols, props.workspaceSplitSessionIds.length - rowIndex * cols);
    const rowCellWidths = getTerminalRowCellWidths(rowIndex, sessionsInRow);
    const totalRowWidth = rowCellWidths.reduce((sum, width) => sum + width, 0) || sessionsInRow;
    const rowStart = rowIndex > 0
      ? rowSizes.slice(0, rowIndex).reduce((sum, size) => sum + size, 0) / totalRowHeight
      : 0;
    const rowHeight = (rowSizes[rowIndex] || 1) / totalRowHeight;
    let accumulatedWidth = 0;

    for (let colIndex = 0; colIndex < sessionsInRow - 1; colIndex += 1) {
      accumulatedWidth += (rowCellWidths[colIndex] || 1) / totalRowWidth;
      resizers.push({
        key: `v-${rowIndex}-${colIndex}`,
        direction: 'vertical',
        index: colIndex,
        rowIndex,
        style: {
          position: 'absolute',
          left: `calc(${accumulatedWidth * 100}% - ${halfDivider}px)`,
          top: `${rowStart * 100}%`,
          width: `${dividerSize}px`,
          height: `${rowHeight * 100}%`,
          cursor: 'col-resize',
          zIndex: 10,
        },
      });
    }
  }

  return resizers;
});

const handleTerminalGridResizerMouseDown = (
  event: MouseEvent,
  type: 'vertical' | 'horizontal',
  index: number,
  rowIndex: number | null = null,
) => {
  event.preventDefault();
  event.stopPropagation();

  const layoutElement = terminalGridRef.value;
  if (!layoutElement) return;

  cleanupTerminalGridResizeListeners?.();
  isTerminalGridResizing.value = true;
  terminalGridResizeDirection.value = type;
  emitWorkspaceEvent('ui:resizeTransaction', { phase: 'start', source: 'terminal-grid' });
  terminalGridResizeDocument = readEventDocument(event);
  const releaseTerminalGridSelectionGuard = beginGlobalDragSelectionGuard(type === 'vertical' ? 'col-resize' : 'row-resize', terminalGridResizeDocument);

  const layoutRect = layoutElement.getBoundingClientRect();
  const totalSize = type === 'vertical' ? layoutRect.width : layoutRect.height;
  const layoutStart = type === 'vertical' ? layoutRect.left : layoutRect.top;
  const initialCellSizes = terminalGridCellSizes.value.map(row => row.map(cell => ({ ...cell })));
  const initialRowSizes = getTerminalRowSizes();
  const totalRowSize = initialRowSizes.reduce((sum, size) => sum + size, 0) || 1;

  const handleMouseMove = (moveEvent: MouseEvent) => {
    moveEvent.preventDefault();
    const currentPosition = type === 'vertical' ? moveEvent.clientX : moveEvent.clientY;
    const relativePosition = Math.max(0, Math.min(totalSize, currentPosition - layoutStart));
    const mouseRatio = relativePosition / totalSize;

    if (type === 'vertical' && rowIndex !== null) {
      const newSizes = initialCellSizes.map(row => row.map(cell => ({ ...cell })));
      const rowCells = newSizes[rowIndex];
      if (!rowCells || index >= rowCells.length - 1) return;

      const totalRowWidth = rowCells.reduce((sum, cell) => sum + cell.width, 0);
      const widthsBefore = rowCells.slice(0, index).reduce((sum, cell) => sum + cell.width, 0);
      const twoCellWidth = rowCells[index].width + rowCells[index + 1].width;
      const targetWidth = (mouseRatio * totalRowWidth) - widthsBefore;
      const clampedWidth = Math.max(0.15, Math.min(twoCellWidth - 0.15, targetWidth));

      scheduleTerminalGridResizeUpdate(() => {
        rowCells[index].width = clampedWidth;
        rowCells[index + 1].width = twoCellWidth - clampedWidth;
        terminalGridCellSizes.value = newSizes;
      });
      return;
    }

    if (type === 'horizontal') {
      const newSizes = [...initialRowSizes];
      if (index >= newSizes.length - 1) return;

      const heightsBefore = initialRowSizes.slice(0, index).reduce((sum, size) => sum + size, 0);
      const twoRowTotal = initialRowSizes[index] + initialRowSizes[index + 1];
      const targetFirstRow = (mouseRatio * totalRowSize) - heightsBefore;
      const clampedFirstRow = Math.max(0.15, Math.min(twoRowTotal - 0.15, targetFirstRow));

      scheduleTerminalGridResizeUpdate(() => {
        newSizes[index] = clampedFirstRow;
        newSizes[index + 1] = twoRowTotal - clampedFirstRow;
        terminalGridRowSizes.value = newSizes;
      });
    }
  };

  const handleMouseUp = () => {
    isTerminalGridResizing.value = false;
    terminalGridResizeDirection.value = null;
    const dragDocument = terminalGridResizeDocument ?? document;
    dragDocument.removeEventListener('mousemove', handleMouseMove);
    dragDocument.removeEventListener('mouseup', handleMouseUp);
    terminalGridResizeDocument = null;
    releaseTerminalGridSelectionGuard();
    emitWorkspaceEvent('ui:resizeTransaction', { phase: 'end', source: 'terminal-grid' });
    cleanupTerminalGridResizeListeners = null;
  };

  terminalGridResizeDocument.addEventListener('mousemove', handleMouseMove);
  terminalGridResizeDocument.addEventListener('mouseup', handleMouseUp);
  cleanupTerminalGridResizeListeners = handleMouseUp;
};

const releaseSplitpaneResizeSelectionGuard = () => {
  const hadActiveGuard = !!releaseSplitpaneResizeGuard;
  const dragDocument = splitpaneResizeDocument ?? document;
  splitpaneResizeBridgeCleanup?.();
  splitpaneResizeBridgeCleanup = null;
  releaseSplitpaneResizeGuard?.();
  releaseSplitpaneResizeGuard = null;
  splitpaneResizeDocument = null;
  if (hadActiveGuard) {
    emitWorkspaceEvent('ui:resizeTransaction', { phase: 'end', source: 'workspace-layout' });
  }
  dragDocument.removeEventListener('mouseup', releaseSplitpaneResizeSelectionGuard, true);
  dragDocument.removeEventListener('touchend', releaseSplitpaneResizeSelectionGuard, true);
  dragDocument.removeEventListener('touchcancel', releaseSplitpaneResizeSelectionGuard, true);
};

const handleSplitpaneResizePointerDown = (event: MouseEvent | TouchEvent) => {
  if (props.layoutLocked) return;

  const target = event.target as HTMLElement | null;
  if (!target?.closest?.('.splitpanes__splitter')) return;

  releaseSplitpaneResizeSelectionGuard();
  const isHorizontal = props.layoutNode.direction === 'vertical';
  splitpaneResizeDocument = readEventDocument(event);
  splitpaneResizeBridgeCleanup = bridgePopupPointerEventsToMainDocument(splitpaneResizeDocument);
  releaseSplitpaneResizeGuard = beginGlobalDragSelectionGuard(isHorizontal ? 'row-resize' : 'col-resize', splitpaneResizeDocument);
  emitWorkspaceEvent('ui:resizeTransaction', { phase: 'start', source: 'workspace-layout' });
  splitpaneResizeDocument.addEventListener('mouseup', releaseSplitpaneResizeSelectionGuard, true);
  splitpaneResizeDocument.addEventListener('touchend', releaseSplitpaneResizeSelectionGuard, true);
  splitpaneResizeDocument.addEventListener('touchcancel', releaseSplitpaneResizeSelectionGuard, true);
};

const getTerminalSessionStyle = (sessionId: string): CSSProperties => {
  const baseHiddenStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    zIndex: -1,
    opacity: 0,
    pointerEvents: 'none',
  };

  if (props.poppedOutSessionIds.includes(sessionId)) {
    return {
      ...baseHiddenStyle,
      zIndex: 3,
      opacity: 1,
      pointerEvents: 'auto',
    };
  }

  if (!props.workspaceSplitActive) {
    const visible = isTerminalSessionVisible(sessionId);
    return {
      ...baseHiddenStyle,
      zIndex: visible ? 3 : -1,
      opacity: visible ? 1 : 0,
      pointerEvents: visible ? 'auto' : 'none',
    };
  }

  const gridIndex = props.workspaceSplitSessionIds.indexOf(sessionId);
  if (gridIndex === -1) return baseHiddenStyle;

  const { rows, cols } = terminalSplitLayout.value;
  const rowIndex = Math.floor(gridIndex / cols);
  const colIndex = gridIndex % cols;
  const rowSizes = getTerminalRowSizes();
  const totalRowHeight = rowSizes.reduce((sum, size) => sum + size, 0) || rows;
  const rowHeight = (rowSizes[rowIndex] || 1) / totalRowHeight * 100;
  const rowStart = rowIndex > 0
    ? rowSizes.slice(0, rowIndex).reduce((sum, size) => sum + size, 0) / totalRowHeight * 100
    : 0;
  const sessionsInRow = Math.min(cols, props.workspaceSplitSessionIds.length - rowIndex * cols);
  const rowCellWidths = getTerminalRowCellWidths(rowIndex, sessionsInRow);
  const totalRowWidth = rowCellWidths.reduce((sum, width) => sum + width, 0) || sessionsInRow;
  const spanFull = gridIndex === props.workspaceSplitSessionIds.length - 1
    && rowIndex === rows - 1
    && props.workspaceSplitSessionIds.length - (rows - 1) * cols === 1;
  const colWidth = spanFull ? 100 : (rowCellWidths[colIndex] || 1) / totalRowWidth * 100;
  const colStart = spanFull
    ? 0
    : rowCellWidths.slice(0, colIndex).reduce((sum, width) => sum + width, 0) / totalRowWidth * 100;
  const gapSize = 3;
  const isFirstRow = rowIndex === 0;
  const isLastRow = rowIndex === rows - 1;
  const isFirstCol = colIndex === 0 || spanFull;
  const isLastCol = spanFull || colIndex === sessionsInRow - 1;
  const topAdjust = isFirstRow ? 0 : gapSize / 2;
  const bottomAdjust = isLastRow ? 0 : gapSize / 2;
  const leftAdjust = isFirstCol ? 0 : gapSize / 2;
  const rightAdjust = isLastCol ? 0 : gapSize / 2;

  return {
    position: 'absolute',
    top: `calc(${rowStart}% + ${topAdjust}px)`,
    left: `calc(${colStart}% + ${leftAdjust}px)`,
    width: `calc(${colWidth}% - ${leftAdjust + rightAdjust}px)`,
    height: `calc(${rowHeight}% - ${topAdjust + bottomAdjust}px)`,
    zIndex: 3,
    opacity: 1,
    pointerEvents: 'auto',
  };
};

const getTerminalSessionClasses = (sessionId: string) => [
  'terminal-instance-wrapper absolute overflow-hidden',
  props.workspaceSplitActive ? 'workspace-terminal-grid-cell' : 'inset-0 w-full h-full',
  { 'terminal-transparent': shouldUseTerminalBackgroundLayers },
];

const isTerminalSessionActiveForLayout = (sessionId: string) => (
  props.poppedOutSessionIds.includes(sessionId)
    ? true
    : (props.workspaceSplitActive ? props.workspaceSplitSessionIds.includes(sessionId) : isTerminalSessionVisible(sessionId))
);

const activateTerminalSession = (sessionId: string) => {
  if (sessionId !== props.activeSessionId) {
    sessionStore.activateSession(sessionId);
  }
};

const readTerminalSessionIdFromEvent = (event: Event): string | null => {
  const target = event.target instanceof Element ? event.target : null;
  const terminalElement = target?.closest<HTMLElement>('[data-terminal-session-id], [data-external-terminal-session-id]');
  return terminalElement?.dataset.terminalSessionId ?? terminalElement?.dataset.externalTerminalSessionId ?? null;
};

const handleTerminalPaneFocusActivation = (event: Event) => {
  if (!props.workspaceSplitActive) return;

  const sessionId = readTerminalSessionIdFromEvent(event);
  if (sessionId) {
    activateTerminalSession(sessionId);
  }
};

const shouldUseTerminalBackgroundLayers = computed(() => (
  isTerminalBackgroundEnabled.value
  && props.layoutNode.component === 'terminal'
  && (Boolean(terminalBackgroundImage.value) || Boolean(terminalCustomHTML.value))
));

const hasSshSessions = computed(() => {
 // Check if any session has a terminalManager (indicates SSH)
 for (const [sessionId, sessionState] of sessionStore.sessions) {
   if (!shouldRenderSession(sessionId)) continue;
   if (sessionState.terminalManager) {
     return true;
   }
 }
 return false;
});

// 面板标签 (Similar to LayoutConfigurator)
const paneLabels = computed(() => ({
  connections: t('layout.pane.connections', '连接列表'),
  terminal: t('layout.pane.terminal', '终端'),
  commandBar: t('layout.pane.commandBar', '命令栏'),
  fileManager: t('layout.pane.fileManager', '文件管理器'),
  editor: t('layout.pane.editor', '编辑器'),
  statusMonitor: t('layout.pane.statusMonitor', '状态监视器'),
  commandHistory: t('layout.pane.commandHistory', '命令历史'),
  quickCommands: t('layout.pane.quickCommands', '快捷指令'),
  dockerManager: t('layout.pane.dockerManager', 'Docker 管理器'),
  suspendedSshSessions: t('layout.panes.suspendedSshSessions', '挂起会话管理'),
}));


// 为特定组件计算需要传递的 Props (主布局)
// 注意：这是一个简化示例，实际可能需要更复杂的逻辑来传递正确的 props
const componentProps = computed(() => {
  const componentName = props.layoutNode.component;
  const currentActiveSession = scopedActiveSession.value;

  if (!componentName) return {};

  switch (componentName) {
    // --- 为需要转发事件的组件添加事件绑定 ---
    // 'terminal' case removed as props are now passed directly in the v-for loop
    case 'fileManager':
      // 仅当有活动会话时才返回实际 props，否则返回空对象
      if (!currentActiveSession) return {};
      // 传递 instanceId (使用布局节点的 ID), sessionId, dbConnectionId
      // 移除 sftpManager 和 wsDeps
      // +++ 提供 instanceId 的备用值 +++
      const instanceId = props.layoutNode.id || `fm-main-${props.activeSessionId ?? 'unknown'}`;
      return {
         sessionId: props.activeSessionId ?? '', // 确保 sessionId 不为 null
         instanceId: instanceId, // 使用计算出的 instanceId (包含备用值)
         dbConnectionId: currentActiveSession.connectionId,
         // sftpManager: currentActiveSession.sftpManager, // 移除 sftpManager，因为它现在由 FileManager 内部管理
         wsDeps: { // 恢复 wsDeps
           sendMessage: currentActiveSession.wsManager.sendMessage,
           onMessage: currentActiveSession.wsManager.onMessage,
           isConnected: currentActiveSession.wsManager.isConnected, // 恢复 isConnected
           isSftpReady: currentActiveSession.wsManager.isSftpReady // 恢复 isSftpReady
         },
         class: 'pane-content', // class 可以保留，或者在模板中处理
         // FileManager 可能也需要转发事件，例如文件操作相关的，暂时省略
      };
    case 'statusMonitor':
       // 始终渲染，传递 activeSessionId
       return {
         activeSessionId: props.activeSessionId, // 传递 activeSessionId
         class: 'pane-content',
       };
    case 'editor':
      // FileEditorContainer 需要 tabs, activeTabId, sessionId, 并转发事件
      return {
        tabs: props.editorTabs, // 从 WorkspaceView 传入
        activeTabId: props.activeEditorTabId, // 从 WorkspaceView 传入
        sessionId: props.activeSessionId,
        class: 'pane-content',
        // --- 移除事件转发 ---
      };
    case 'commandBar':
       return {
         class: 'pane-content',
         targetSessionId: props.activeSessionId,
         // --- 移除事件转发 ---
       };
    case 'connections':
       return {
         class: 'pane-content',
         // --- 移除事件转发 ---
       };
     case 'commandHistory':
    case 'quickCommands':
       return {
         class: 'flex flex-col flex-grow h-full overflow-auto', // 移除 pane-content，保留填充类
         // --- 移除事件转发 ---
       };
   case 'dockerManager':
     // DockerManager 可能不需要 session 信息
     return {
       class: 'flex-grow h-full overflow-hidden', // <-- 修改：添加 flex-grow 和 h-full，并保留 overflow-hidden
       // 假设 DockerManager 会发出 'docker-command' 事件
       // onDockerCommand: (payload: { containerId: string; command: 'up' | 'down' | 'restart' | 'stop' }) => emit('dockerCommand', payload),
       // 暂时不添加事件转发，等组件实现后再确定
     };
   case 'suspendedSshSessions':
     return {
       class: 'flex flex-col flex-grow h-full overflow-auto', // 与 quickCommands 类似
     };
   default:
     return { class: 'pane-content' };
 }
});

// --- New computed property for sidebar component props and events ---
// 修改以接收 side 参数，用于确定 instanceId
const sidebarProps = computed(() => (paneName: PaneName | null, side: 'left' | 'right') => {
 if (!paneName) return {};

 const baseProps = { class: 'sidebar-pane-content' }; // Base props for all sidebar components

 switch (paneName) {
   case 'editor':
     return {
       ...baseProps,
       tabs: editorTabsFromStore.value, // Access .value for refs from storeToRefs
       activeTabId: activeEditorTabIdFromStore.value, // Access .value
       sessionId: props.activeSessionId,
       // --- 移除事件转发 ---
     };
   case 'connections':
     return {
       ...baseProps,
       // --- 移除事件转发 ---
     };
   case 'fileManager':
     // Only provide props if there's an active session
     if (scopedActiveSession.value) {
       // 传递 instanceId (根据 side), sessionId, dbConnectionId
       // 移除 sftpManager 和 wsDeps
       const instanceId = side === 'left' ? 'sidebar-left' : 'sidebar-right';
       return {
         ...baseProps,
         sessionId: scopedActiveSession.value.sessionId,
         instanceId: instanceId, // 使用 'sidebar-left' 或 'sidebar-right'
         dbConnectionId: scopedActiveSession.value.connectionId,
         // sftpManager: activeSession.value.sftpManager, // 移除 sftpManager
         wsDeps: { // 恢复 wsDeps
           sendMessage: scopedActiveSession.value.wsManager.sendMessage,
           onMessage: scopedActiveSession.value.wsManager.onMessage,
           isConnected: scopedActiveSession.value.wsManager.isConnected, // 直接传递 ref
           isSftpReady: scopedActiveSession.value.wsManager.isSftpReady  // 直接传递 ref
         },
       };
     } else {
       return baseProps; // Return only base props if no active session
     }
   case 'statusMonitor':
     // 始终渲染，传递 activeSessionId
     return {
       ...baseProps,
       activeSessionId: props.activeSessionId, // 传递 activeSessionId
     };
    // Add cases for other components if they need specific props or event forwarding in the sidebar
    // case 'commandHistory': return { ...baseProps, onExecuteCommand: (cmd: string) => emit('sendCommand', cmd) };
    // case 'quickCommands': return { ...baseProps, onExecuteCommand: (cmd: string) => emit('sendCommand', cmd) };
    default:
      return baseProps; // Return only base props for other components
  }
});


// --- Methods ---
// 处理 Splitpanes 大小调整事件
const handlePaneResizing = () => {
  if (props.layoutLocked) return;
  emitWorkspaceEvent('ui:resizeTransaction', { phase: 'live', source: 'workspace-layout' });
};

const handlePaneResize = (eventData: { panes: Array<{ size: number; [key: string]: any }> }) => {
  // +++ 更详细的日志 +++
  // +++ Log the entire layoutNode object if ID is undefined +++
  if (props.layoutNode && typeof props.layoutNode.id === 'undefined') {
    console.warn(`[LayoutRenderer DEBUG] handlePaneResize triggered but props.layoutNode.id is undefined. Full layoutNode prop:`, JSON.parse(JSON.stringify(props.layoutNode)));
  }
  // console.log(`[LayoutRenderer DEBUG] handlePaneResize triggered for node ID: ${props.layoutNode?.id}, direction: ${props.layoutNode?.direction ?? 'N/A'}`); // Use optional chaining for safety
  // console.log('[LayoutRenderer DEBUG] Splitpanes resized event object:', eventData);
  const paneSizes = eventData.panes; // 从事件对象中提取 panes 数组

  // console.log('[LayoutRenderer DEBUG] Extracted paneSizes:', paneSizes); // 打印提取出的数组

  // +++ Use optional chaining for safety +++
  if (props.layoutNode?.type === 'container' && props.layoutNode?.children) {
    // 确保 paneSizes 是一个数组
    if (!Array.isArray(paneSizes)) {
      console.error('[LayoutRenderer] handlePaneResize: 从事件对象提取的 panes 不是数组:', paneSizes);
      return;
    }
    // 构建传递给 store action 的数据结构
    const childrenSizes = paneSizes.map((paneInfo, index) => ({
        index: index,
        size: paneInfo.size
    }));

    // +++ 调用 store action 前的日志 +++
    // console.log(`[LayoutRenderer DEBUG] Calling layoutStore.updateNodeSizes for node ID: ${props.layoutNode.id} with sizes:`, JSON.parse(JSON.stringify(childrenSizes)));
    // 调用 store action 来更新节点大小
    layoutStore.updateNodeSizes(props.layoutNode.id, childrenSizes);
  } else {
    // console.log(`[LayoutRenderer DEBUG] handlePaneResize ignored for node ID: ${props.layoutNode.id} (type: ${props.layoutNode.type})`);
  }
};

// 打开/切换侧栏面板
const toggleSidebarPane = (side: 'left' | 'right', paneName: PaneName) => {
  if (side === 'left') {
    activeLeftSidebarPane.value = activeLeftSidebarPane.value === paneName ? null : paneName;
    if (activeLeftSidebarPane.value) activeRightSidebarPane.value = null; // Close other side
  } else {
    activeRightSidebarPane.value = activeRightSidebarPane.value === paneName ? null : paneName;
    if (activeRightSidebarPane.value) activeLeftSidebarPane.value = null; // Close other side
  }
};

// 关闭所有侧栏
const closeSidebars = () => {
  activeLeftSidebarPane.value = null;
  activeRightSidebarPane.value = null;
};

// 监听 activeSessionId 的变化，如果会话切换，则关闭侧栏 (可选行为)
watch(() => props.activeSessionId, () => {
    // closeSidebars(); // 取消注释以在切换会话时关闭侧栏
});

// +++ 新方法：处理主内容区域点击，用于非固定模式下关闭侧边栏 +++
const handleMainAreaClick = () => {
  // 仅当侧边栏激活且不处于固定模式时才关闭
  if ((activeLeftSidebarPane.value || activeRightSidebarPane.value) && !workspaceSidebarPersistentBoolean.value) {
    closeSidebars();
  }
};


// --- Icon Helper ---
const getIconClasses = (paneName: PaneName): string[] => {
  switch (paneName) {
    case 'connections': return ['fas', 'fa-network-wired'];
    case 'fileManager': return ['fas', 'fa-folder-open'];
    case 'commandHistory': return ['fas', 'fa-history'];
    case 'quickCommands': return ['fas', 'fa-bolt'];
    case 'dockerManager': return ['fab', 'fa-docker']; // Use 'fab' for Docker
    case 'editor': return ['fas', 'fa-file-alt'];
    case 'statusMonitor': return ['fas', 'fa-tachometer-alt'];
    case 'suspendedSshSessions': return ['fas', 'fa-pause-circle']; // 图标：暂停圈
    // Add other specific icons here if needed
    default: return ['fas', 'fa-question-circle']; // Default icon
  }
};


// --- Sidebar Resize Logic ---
onMounted(() => {
  const handleStabilizedTerminalResize = ({ sessionId, width, height }: { sessionId: string; width: number; height: number }) => {
    if (props.layoutNode.component === 'terminal' && sessionId === props.activeSessionId && customHtmlLayerRef.value) {
      customHtmlLayerRef.value.style.width = `${width}px`;
      customHtmlLayerRef.value.style.height = `${height}px`;
    }
  };
  subscribeToWorkspaceEvent('terminal:stabilizedResize', handleStabilizedTerminalResize);



  // Left Sidebar Resize
  useSidebarResize({
    sidebarRef: leftSidebarPanelRef,
    handleRef: leftResizeHandleRef,
    side: 'left',
    onResizeEnd: (newWidth) => {
      debugLog(`Left sidebar resize ended. New width: ${newWidth}px`);
      // +++ Update specific pane width +++
      if (activeLeftSidebarPane.value) {
        settingsStore.updateSidebarPaneWidth(activeLeftSidebarPane.value, `${newWidth}px`);
      }
    },
  });

  // Right Sidebar Resize
  useSidebarResize({
    sidebarRef: rightSidebarPanelRef,
    handleRef: rightResizeHandleRef,
    side: 'right',
    onResizeEnd: (newWidth) => {
      debugLog(`Right sidebar resize ended. New width: ${newWidth}px`);
      // +++ Update specific pane width +++
      if (activeRightSidebarPane.value) {
        settingsStore.updateSidebarPaneWidth(activeRightSidebarPane.value, `${newWidth}px`);
      }
    },
  });
});

// +++ Background Image Style +++
const terminalBackgroundImageStyle = computed((): CSSProperties => {
  if (isTerminalBackgroundEnabled.value && terminalBackgroundImage.value && props.layoutNode.component === 'terminal') {
    const backendUrl = import.meta.env.VITE_API_BASE_URL || '';
    const imagePath = terminalBackgroundImage.value;
    const fullImageUrl = `${backendUrl}${imagePath}`;
    return {
      backgroundImage: `url(${fullImageUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      zIndex: 0, // Base layer for background
    };
  }
  return {
    backgroundImage: 'none',
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    zIndex: 0,
  };
});

// +++ Function to execute scripts (migrated from Terminal.vue) +++
const executeScriptsInElement = (container: HTMLElement) => {
  if (!container) return;
  const scripts = Array.from(container.getElementsByTagName('script'));
  scripts.forEach((oldScript) => {
    const newScript = document.createElement('script');
    Array.from(oldScript.attributes).forEach(attr => {
      newScript.setAttribute(attr.name, attr.value);
    });
    if (oldScript.textContent) {
      newScript.textContent = oldScript.textContent;
    }
    if (oldScript.parentNode) {
      oldScript.parentNode.replaceChild(newScript, oldScript);
    } else {
       container.appendChild(newScript); // Fallback, though less likely if script was in container
    }
  });
};

// +++ Watch for changes in terminalCustomHTML and execute scripts (migrated) +++
watch(terminalCustomHTML, (newHtmlContent, oldHtmlContent) => {
  if (props.layoutNode.component !== 'terminal') return; // Only for terminal panes

  if (newHtmlContent === oldHtmlContent && oldHtmlContent !== undefined) {
    return;
  }
  nextTick(() => {
    const container = customHtmlLayerRef.value;
    if (container) {
      if (newHtmlContent) {
        executeScriptsInElement(container);
      }
    }
  });
}, { immediate: true });


onBeforeUnmount(() => {
  if (terminalGridResizeFrameId !== null) {
    window.cancelAnimationFrame(terminalGridResizeFrameId);
    terminalGridResizeFrameId = null;
  }
  pendingTerminalGridResizeUpdate = null;
  cleanupTerminalGridResizeListeners?.();
  releaseSplitpaneResizeSelectionGuard();
  const handleStabilizedTerminalResizeHandler = ({ sessionId, width, height }: { sessionId: string; width: number; height: number }) => {
    if (props.layoutNode.component === 'terminal' && sessionId === props.activeSessionId && customHtmlLayerRef.value) {
      customHtmlLayerRef.value.style.width = `${width}px`;
      customHtmlLayerRef.value.style.height = `${height}px`;
    }
  };
  unsubscribeFromWorkspaceEvent('terminal:stabilizedResize', handleStabilizedTerminalResizeHandler); // Use the same handler reference if possible
});



</script>

<template>
  <div class="relative flex h-full min-h-0 w-full min-w-0 overflow-hidden">
    <!-- Left Sidebar Buttons -->
    <div class="flex flex-col bg-sidebar py-1 z-10 flex-shrink-0 border-r border-border" v-if="isRootRenderer && sidebarPanes.left.length > 0">
        <button
            v-for="pane in sidebarPanes.left"
            :key="`left-${pane}`"
            @click="toggleSidebarPane('left', pane)"
            :class="['flex items-center justify-center w-10 h-10 mb-1 text-text-secondary hover:bg-hover hover:text-foreground transition-colors duration-150 cursor-pointer text-lg',
                     { 'bg-primary text-white hover:bg-primary-dark': activeLeftSidebarPane === pane }]"
            :title="paneLabels[pane] || pane"
        >
            <i :class="getIconClasses(pane)"></i>
        </button>
    </div>

    <!-- Main Layout Area -->
    <div class="relative flex-grow h-full min-h-0 min-w-0 overflow-hidden" @click="handleMainAreaClick">
        <div class="flex flex-col h-full min-h-0 w-full min-w-0 overflow-hidden" :data-node-id="layoutNode.id">
            <!-- Container Node -->
            <template v-if="layoutNode.type === 'container' && layoutNode.children && layoutNode.children.length > 0">
              <splitpanes
                  :horizontal="layoutNode.direction === 'vertical'"
                  :class="['default-theme flex-grow min-h-0 min-w-0', { 'layout-locked': props.layoutLocked }]"
                  @resize="handlePaneResizing"
                  @resized="handlePaneResize"
                  @resized.capture="releaseSplitpaneResizeSelectionGuard"
                  @mousedown.capture="handleSplitpaneResizePointerDown"
                  @touchstart.capture="handleSplitpaneResizePointerDown"
                  :push-other-panes="false"
                  :dbl-click-splitter="!props.layoutLocked"
              >
                  <pane
                    v-for="childNode in layoutNode.children"
                    :key="childNode.id"
                    :size="childNode.size ?? (100 / layoutNode.children.length)"
                    :min-size="5"
                    class="flex flex-col h-full min-h-0 min-w-0 overflow-hidden bg-background"
                  >
                    <LayoutRenderer
                        :layout-node="childNode"
                        :is-root-renderer="false"
                        :active-session-id="activeSessionId"
                        :popped-out-session-ids="poppedOutSessionIds"
                        :included-session-id="includedSessionId"
                        :included-session-ids="includedSessionIds"
                        :workspace-split-active="workspaceSplitActive"
                        :workspace-split-session-ids="workspaceSplitSessionIds"
                        :external-terminal-session-id="externalTerminalSessionId"
                        :editor-tabs="editorTabs"
                        :active-editor-tab-id="activeEditorTabId"
                        :terminal-input-handler="terminalInputHandler"
                        class="flex-grow min-h-0 min-w-0 overflow-hidden"
                    />
                  </pane>
              </splitpanes>
            </template>

            <!-- Pane Node -->
            <template v-else-if="layoutNode.type === 'pane'">
                <!-- Terminal Pane: Render ALL SSH sessions, show only the active one -->
               <template v-if="layoutNode.component === 'terminal'">
                   <div
                       ref="terminalGridRef"
                       :class="[
                         'terminal-pane-container relative flex-grow overflow-hidden',
                         {
                           'workspace-terminal-grid': workspaceSplitActive,
                           'resizing': isTerminalGridResizing,
                           [`resizing-${terminalGridResizeDirection}`]: isTerminalGridResizing && terminalGridResizeDirection,
                           'has-global-terminal-background': shouldUseTerminalBackgroundLayers,
                           'bg-background': !shouldUseTerminalBackgroundLayers,
                         },
                       ]"
                       @pointerdown.capture="handleTerminalPaneFocusActivation"
                       @focusin.capture="handleTerminalPaneFocusActivation"
                   >
                       <!-- Shared Background Layers -->
                       <div
                           v-if="shouldUseTerminalBackgroundLayers"
                           class="shared-terminal-background-layers"
                           style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 0;"
                       >
                           <!-- Background Image -->
                           <div
                               class="terminal-background-image-layer"
                               :style="terminalBackgroundImageStyle"
                           ></div>
                           <!-- Color Overlay -->
                           <div
                               class="terminal-background-overlay-layer"
                               :style="{
                                   position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
                                   backgroundColor: `rgba(0, 0, 0, ${currentTerminalBackgroundOverlayOpacity})`,
                                   zIndex: 1, pointerEvents: 'none'
                               }"
                           ></div>
                           <!-- Custom HTML -->
                           <div
                               ref="customHtmlLayerRef"
                               v-if="terminalCustomHTML"
                               class="terminal-custom-html-layer"
                               style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2;"
                               v-html="terminalCustomHTML"
                           ></div>
                       </div>

                       <!-- Terminal Instances -->
                       <template v-for="[sessionId, sessionState] in sessionStore.sessions" :key="sessionId">
                           <template v-if="sessionState.terminalManager && shouldRenderSession(sessionId)">
                               <keep-alive v-if="sessionId !== externalTerminalSessionId">
                                    <component
                                        :is="componentMap.terminal"
                                        :session-id="sessionId"
                                        :is-active="isTerminalSessionActiveForLayout(sessionId)"
                                        :class="getTerminalSessionClasses(sessionId)"
                                        :style="getTerminalSessionStyle(sessionId)"
                                        :options="{}"
                                        :terminal-input-handler="terminalInputHandler"
                                        @click="activateTerminalSession(sessionId)"
                                    />
                                </keep-alive>
                                <div
                                    v-else
                                    :data-external-terminal-session-id="sessionId"
                                    :class="getTerminalSessionClasses(sessionId)"
                                    :style="getTerminalSessionStyle(sessionId)"
                                ></div>
                           </template>
                        </template>
                        <div
                            v-for="resizer in terminalGridResizers"
                            :key="resizer.key"
                            :class="['workspace-terminal-grid-resizer', resizer.direction]"
                            :style="resizer.style"
                            @mousedown="handleTerminalGridResizerMouseDown($event, resizer.direction, resizer.index, resizer.rowIndex)"
                        ></div>
                        <!-- Placeholder -->
                        <div v-if="!terminalPaneSessionId || !hasSshSessions"
                             class="absolute inset-0 flex justify-center items-center text-center text-text-secondary bg-header text-sm p-4"
                             :style="{ zIndex: 4 }">
                            <div class="flex flex-col items-center justify-center p-8 w-full h-full">
                                <i class="fas fa-plug text-4xl mb-3 text-text-secondary"></i>
                                <span class="text-lg font-medium text-text-secondary mb-2">{{ terminalPaneSessionId ? t('layout.noSshSessionActive.title', '无活动的 SSH 会话') : t('layout.noActiveSession.title') }}</span>
                                <div class="text-xs text-text-secondary mt-2">{{ terminalPaneSessionId ? t('layout.noSshSessionActive.message', '请激活一个 SSH 会话以使用此终端面板。') : t('layout.noActiveSession.message') }}</div>
                            </div>
                        </div>
                   </div>
               </template>
                 <!-- FileManager -->
                 <template v-else-if="layoutNode.component === 'fileManager'">
                        <component
                          :is="currentMainComponent"
                          :key="layoutNode.id"
                          v-bind="componentProps"
                          class="flex-grow overflow-auto"
                          v-if="scopedActiveSession"
                        >
                        </component>
                     <div v-if="!scopedActiveSession" class="flex-grow flex justify-center items-center text-center text-text-secondary bg-header text-sm p-4">
                      <div class="flex flex-col items-center justify-center p-8 w-full h-full">
                        <i class="fas fa-plug text-4xl mb-3 text-text-secondary"></i>
                        <span class="text-lg font-medium text-text-secondary mb-2">{{ t('layout.noActiveSession.title') }}</span>
                        <div class="text-xs text-text-secondary mt-2">{{ t('layout.noActiveSession.message') }}</div>
                      </div>
                    </div>
                </template>
                <!-- StatusMonitor -->
                <template v-else-if="layoutNode.component === 'statusMonitor'">
                     <keep-alive v-if="activeSessionId">
                        <component
                          :is="currentMainComponent"
                          v-bind="componentProps"
                          class="flex-grow overflow-auto"
                        />
                     </keep-alive>
                     <div v-else class="flex-grow flex justify-center items-center text-center text-text-secondary bg-header text-sm p-4">
                      <div class="flex flex-col items-center justify-center p-8 w-full h-full">
                        <i class="fas fa-plug text-4xl mb-3 text-text-secondary"></i>
                        <span class="text-lg font-medium text-text-secondary mb-2">{{ t('layout.noActiveSession.title') }}</span>
                        <div class="text-xs text-text-secondary mt-2">{{ t('layout.noActiveSession.message') }}</div>
                      </div>
                    </div>
                </template>
                <!-- Other Panes -->
                <template v-else-if="currentMainComponent">
                     <component
                      :is="currentMainComponent"
                      v-bind="componentProps"
                      :class="['flex-grow overflow-auto', componentProps.class]"
                    />
                </template>
                <!-- Invalid Pane Component -->
                <div v-else class="flex-grow flex justify-center items-center text-center text-red-600 bg-red-100 text-sm p-4">
                    无效面板组件: {{ layoutNode.component || '未指定' }} (ID: {{ layoutNode.id }})
                </div>
            </template>

             <!-- Invalid Node Type -->
             <template v-else>
               <div class="flex-grow flex justify-center items-center text-center text-red-600 bg-red-100 text-sm p-4">
                 无效布局节点 (ID: {{ layoutNode.id }})
               </div>
             </template>
        </div>
    </div>

    <!-- Sidebar Overlay -->
    <div
        :class="['fixed inset-0 bg-transparent pointer-events-none z-[100] transition-opacity duration-300 ease-in-out',
                 {'opacity-100 visible': activeLeftSidebarPane || activeRightSidebarPane, 'opacity-0 invisible': !(activeLeftSidebarPane || activeRightSidebarPane)}]"
    ></div>

    <!-- Left Sidebar Panel -->
    <div ref="leftSidebarPanelRef"
         :class="['fixed top-0 bottom-0 left-0 max-w-[80vw] bg-background z-[110] transition-transform duration-300 ease-in-out flex flex-col overflow-hidden border-r border-border',
                  {'translate-x-0': !!activeLeftSidebarPane, '-translate-x-full': !activeLeftSidebarPane}]"
         :style="{ width: getSidebarPaneWidth(activeLeftSidebarPane) }">
        <div ref="leftResizeHandleRef" class="absolute top-0 bottom-0 w-2 cursor-col-resize z-[120] bg-transparent transition-colors duration-200 ease-in-out hover:bg-primary-light right-[-4px]"></div>
        <button class="absolute top-1 right-2 p-1 text-text-secondary hover:text-foreground cursor-pointer text-2xl leading-none z-10" @click="closeSidebars" title="Close Sidebar">&times;</button>
        <KeepAlive>
            <div :key="`left-sidebar-content-${activeLeftSidebarPane ?? 'none'}`" class="relative flex flex-col flex-grow overflow-hidden pt-10"> <!-- Added pt-10 -->
                <component
      
                        v-if="currentLeftSidebarComponent && activeLeftSidebarPane && (activeLeftSidebarPane === 'statusMonitor' || activeLeftSidebarPane !== 'fileManager' || scopedActiveSession)"
                        :is="currentLeftSidebarComponent"
                        :key="`left-comp-${activeLeftSidebarPane}`"
                        v-bind="sidebarProps(activeLeftSidebarPane, 'left')"
                        class="flex flex-col flex-grow">
                    </component>
                     <!-- 'fileManager' 且无 activeSession 的提示 -->
                    <div v-else-if="activeLeftSidebarPane === 'fileManager' && !scopedActiveSession" class="flex flex-col flex-grow justify-center items-center text-center text-text-secondary p-4">
                      <div class="flex flex-col items-center justify-center p-8">
                        <i class="fas fa-plug text-4xl mb-3 text-text-secondary"></i>
                        <span class="text-lg font-medium mb-2">{{ t('layout.noActiveSession.title') }}</span>
                        <div class="text-xs mt-2">{{ t('layout.noActiveSession.fileManagerSidebar') }}</div>
                      </div>
                    </div>
                    <!-- 移除 statusMonitor 的 v-else-if -->
                 <div v-else class="flex flex-col flex-grow">
                 </div>
            </div>
        </KeepAlive>
    </div>

    <!-- Right Sidebar Panel -->
     <div ref="rightSidebarPanelRef"
          :class="['fixed top-0 bottom-0 right-0 max-w-[80vw] bg-background z-[110] transition-transform duration-300 ease-in-out flex flex-col overflow-hidden border-l border-border',
                   {'translate-x-0': !!activeRightSidebarPane, 'translate-x-full': !activeRightSidebarPane}]"
          :style="{ width: getSidebarPaneWidth(activeRightSidebarPane) }">
        <div ref="rightResizeHandleRef" class="absolute top-0 bottom-0 w-2 cursor-col-resize z-[120] bg-transparent transition-colors duration-200 ease-in-out hover:bg-primary-light left-[-4px]"></div>
        <button class="absolute top-1 right-2 p-1 text-text-secondary hover:text-foreground cursor-pointer text-2xl leading-none z-10" @click="closeSidebars" title="Close Sidebar">&times;</button>
        <KeepAlive>
            <div :key="`right-sidebar-content-${activeRightSidebarPane ?? 'none'}`" class="relative flex flex-col flex-grow overflow-hidden pt-10"> <!-- Added pt-10 -->
                <component
                        v-if="currentRightSidebarComponent && activeRightSidebarPane && (activeRightSidebarPane === 'statusMonitor' || activeRightSidebarPane !== 'fileManager' || scopedActiveSession)"
                        :is="currentRightSidebarComponent"
                        :key="`right-comp-${activeRightSidebarPane}`"
                        v-bind="sidebarProps(activeRightSidebarPane, 'right')"
                        class="flex flex-col flex-grow">
                    </component>
                     <!-- 'fileManager' 且无 activeSession 的提示 -->
                    <div v-else-if="activeRightSidebarPane === 'fileManager' && !scopedActiveSession" class="flex flex-col flex-grow justify-center items-center text-center text-text-secondary p-4">
                      <div class="flex flex-col items-center justify-center p-8">
                        <i class="fas fa-plug text-4xl mb-3 text-text-secondary"></i>
                        <span class="text-lg font-medium mb-2">{{ t('layout.noActiveSession.title') }}</span>
                        <div class="text-xs mt-2">{{ t('layout.noActiveSession.fileManagerSidebar') }}</div>
                      </div>
                    </div>
                    <!-- 移除 statusMonitor 的 v-else-if -->
                 <div v-else class="flex flex-col flex-grow">
                 </div>
            </div>
        </KeepAlive>
    </div>

     <!-- Right Sidebar Buttons -->
    <div class="flex flex-col bg-sidebar py-1 z-10 flex-shrink-0 border-l border-border" v-if="isRootRenderer && sidebarPanes.right.length > 0">
         <button
             v-for="pane in sidebarPanes.right"
            :key="`right-${pane}`"
            @click="toggleSidebarPane('right', pane)"
            :class="['flex items-center justify-center w-10 h-10 mb-1 text-text-secondary hover:bg-hover hover:text-foreground transition-colors duration-150 cursor-pointer text-lg',
                     { 'bg-primary text-white hover:bg-primary-dark': activeRightSidebarPane === pane }]"
            :title="paneLabels[pane] || pane"
        >
             <i :class="getIconClasses(pane)"></i>
        </button>
    </div>

  </div>
</template>



<style>

.splitpanes.default-theme .splitpanes__splitter {
  background-image: none !important; /* Ensure no background image in normal state */
  z-index: 5; /* Ensure splitter is above terminal content and its overlays */
}
.splitpanes.default-theme .splitpanes__splitter:hover { /* Apply hover style to the pseudo-element */
  background-color: transparent !important; /* Make splitter transparent on hover */
  background-image: none !important; /* Ensure no background image on hover */
  position: relative;
  box-sizing: border-box;
}

.splitpanes.default-theme .splitpanes__splitter:hover::before {
  background-color: var(--primary-color-light) !important; /* Highlight on hover */
}
.splitpanes__splitter:before {
  content: ""; /* Ensure content for pseudo-element */
  display: block; /* Ensure it takes space */
  width: 100%; /* Fill splitter width */
  height: 100%; /* Fill splitter height */
  background-color: var(--border-color); /* Set background to border color */
  border: none !important; /* Ensure no extra borders */
  /* Ensure it still occupies space and has cursor */
  position: relative;
  box-sizing: border-box;
  transition: background-color 0.1s ease-in-out;
}

/* Ensure ::after pseudo-element doesn't interfere */
.splitpanes.default-theme .splitpanes__splitter::after {
  display: none !important;
}

/* Vertical splitter width */
.splitpanes--vertical > .splitpanes__splitter {
  border-color: var(--border-color) !important;
  width: 1px !important;
  z-index: 5 !important; /* Ensure z-index for vertical splitters */
}
/* Horizontal splitter height */
.splitpanes--horizontal > .splitpanes__splitter {
  border-color: var(--border-color) !important;
  height: 1px !important;
  z-index: 5 !important; /* Ensure z-index for horizontal splitters */
}

/* --- Styles for Locked Layout --- */
.splitpanes.layout-locked .splitpanes__splitter {
  pointer-events: none !important; /* Disable dragging */
  cursor: default !important; /* Change cursor */
  background-color: var(--border-color) !important; /* Ensure no hover effect */
}

.splitpanes.layout-locked .splitpanes__splitter:hover {
  background-color: var(--border-color) !important; /* Override hover effect */
}

.workspace-terminal-grid {
  background-color: var(--app-bg-color);
}

.workspace-terminal-grid-cell {
  background-color: var(--app-bg-color);
}

.workspace-terminal-grid.resizing .terminal-instance-wrapper {
  pointer-events: none !important;
  user-select: none !important;
}

.workspace-terminal-grid.resizing-vertical,
.workspace-terminal-grid.resizing-vertical * {
  cursor: col-resize !important;
}

.workspace-terminal-grid.resizing-horizontal,
.workspace-terminal-grid.resizing-horizontal * {
  cursor: row-resize !important;
}

.workspace-terminal-grid-resizer {
  background: var(--border-color);
  opacity: 0.18;
  transition: opacity 0.15s ease, background-color 0.15s ease;
  touch-action: none;
  user-select: none;
}

.workspace-terminal-grid-resizer:hover,
.workspace-terminal-grid.resizing .workspace-terminal-grid-resizer {
  opacity: 0.75;
  background: var(--link-active-color);
}

.workspace-terminal-grid-resizer.vertical {
  cursor: col-resize;
}

.workspace-terminal-grid-resizer.horizontal {
  cursor: row-resize;
}

.terminal-pane-container.has-global-terminal-background .terminal-outer-wrapper.terminal-transparent {
  background-color: transparent !important; /* 使 Terminal.vue 的最外层容器背景透明 */
}

.terminal-pane-container.has-global-terminal-background .terminal-outer-wrapper.terminal-transparent .terminal-inner-container .xterm-viewport,
.terminal-pane-container.has-global-terminal-background .terminal-outer-wrapper.terminal-transparent .terminal-inner-container .xterm-screen {
  background-color: transparent !important;
}


</style>

