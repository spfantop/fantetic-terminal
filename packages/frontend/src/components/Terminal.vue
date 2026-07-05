<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, watch, nextTick, watchEffect } from 'vue';
import { Terminal, IDisposable } from 'xterm';
import { useDeviceDetection } from '../composables/useDeviceDetection';
import { useAppearanceStore } from '../stores/appearance.store';
import { useSettingsStore } from '../stores/settings.store';
import { storeToRefs } from 'pinia';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search';
import 'xterm/css/xterm.css';
import { useWorkspaceEventEmitter, useWorkspaceEventOff, useWorkspaceEventSubscriber } from '../composables/workspaceEvents';
import type { WorkspaceEventPayloads } from '../composables/workspaceEvents';
import { debugLog } from '../composables/useDebugLog';


// 定义 props 和 emits
const props = defineProps<{
  sessionId: string; // 会话 ID
  isActive: boolean; // 标记此终端是否为活动标签页
  stream?: ReadableStream<string>; // 用于接收来自 WebSocket 的数据流 (可选)
  options?: object; // xterm 的配置选项
  terminalInputHandler?: (sessionId: string, data: string, batched?: boolean) => void;
  singleLineOutput?: boolean;
}>();



const emitWorkspaceEvent = useWorkspaceEventEmitter(); // +++ 获取事件发射器 +++
const subscribeToWorkspaceEvent = useWorkspaceEventSubscriber();
const unsubscribeFromWorkspaceEvent = useWorkspaceEventOff();

const terminalRef = ref<HTMLElement | null>(null); // xterm 挂载点的引用 (内部容器)
const terminalOuterWrapperRef = ref<HTMLElement | null>(null); // 最外层容器的引用，用于背景图
const singleLineContentWidth = ref<string | null>(null);
let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let searchAddon: SearchAddon | null = null; // *** 添加 searchAddon 变量 ***
let resizeObserver: ResizeObserver | null = null;
let observedElement: HTMLElement | null = null; // +++ Store the observed element +++
let selectionListenerDisposable: IDisposable | null = null; // +++ 提升声明并添加类型 +++
let resizeAnimationFrameId: number | null = null;
let pendingFitOptions: { forceFit: boolean; forceResizeEmit: boolean; pixelSize?: TerminalPixelSize } = { forceFit: false, forceResizeEmit: false };
let resizeEmitTimer: number | null = null;
let pendingResizeDimensions: TerminalDimensions | null = null;
let stabilizedResizeTimer: number | null = null;
let lastObservedSize: TerminalPixelSize | null = null;
let lastAppliedDimensions: TerminalDimensions | null = null;
let lastEmittedDimensions: TerminalDimensions | null = null;
let lastStableSize: TerminalPixelSize | null = null;
let cachedFitMetrics: TerminalFitMetrics | null = null;
let resizeTransactionDepth = 0;
let hasDeferredFitDuringResize = false;
let resizeTransactionSettleTimer: number | null = null;
const RESIZE_THRESHOLD = 0.5; // px
const RESIZE_EMIT_DELAY = 150;
const STABILIZED_RESIZE_DELAY = 150;
const RESIZE_TRANSACTION_SETTLE_DELAY = 80;
const SINGLE_LINE_OUTPUT_COLS = 4096;

type TerminalDimensions = {
  cols: number;
  rows: number;
};

type TerminalPixelSize = {
  width: number;
  height: number;
};

type TerminalFitMetrics = {
  cellWidth: number;
  cellHeight: number;
  paddingHorizontal: number;
  paddingVertical: number;
  scrollbarWidth: number;
};

type XtermInternalCore = {
  _renderService?: {
    dimensions?: {
      css?: {
        cell?: {
          width?: number;
          height?: number;
        };
      };
    };
  };
  viewport?: {
    scrollBarWidth?: number;
  };
};


const { isMobile } = useDeviceDetection(); // 设备检测

let initialPinchDistance = 0;
let currentFontSizeOnPinchStart = 0;

// --- Appearance Store ---
const appearanceStore = useAppearanceStore();
const {
  effectiveTerminalTheme,
  currentTerminalFontFamily,
  currentTerminalFontSize,
  // --- 文字描边和阴影状态 ---
  terminalTextStrokeEnabled,
  terminalTextStrokeWidth,
  terminalTextStrokeColor,
  terminalTextShadowEnabled,
  terminalTextShadowOffsetX,
  terminalTextShadowOffsetY,
  terminalTextShadowBlur,
  terminalTextShadowColor,
  initialAppearanceDataLoaded, 
} = storeToRefs(appearanceStore);
const terminalThemeSignature = computed(() => JSON.stringify(effectiveTerminalTheme.value));
const terminalTextStyleSignature = computed(() => [
  terminalTextStrokeEnabled.value,
  terminalTextStrokeWidth.value,
  terminalTextStrokeColor.value,
  terminalTextShadowEnabled.value,
  terminalTextShadowOffsetX.value,
  terminalTextShadowOffsetY.value,
  terminalTextShadowBlur.value,
  terminalTextShadowColor.value,
].join('|'));
 
const isTerminalDomReady = ref(false); 
 
// --- Settings Store ---
const settingsStore = useSettingsStore(); // +++ 实例化设置 store +++
const {
  autoCopyOnSelectBoolean,
  terminalScrollbackLimitNumber, 
  terminalEnableRightClickPasteBoolean, 
} = storeToRefs(settingsStore); 

// 防抖函数
const debounce = (func: Function, delay: number) => {
  let timeoutId: number | null = null; // Use a local variable for the timeout ID
  return (...args: any[]) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = window.setTimeout(() => {
      func(...args);
      timeoutId = null;
    }, delay);
  };
};

const isSameDimensions = (a: TerminalDimensions | null, b: TerminalDimensions | null) => (
  !!a && !!b && a.cols === b.cols && a.rows === b.rows
);

const isSamePixelSize = (a: TerminalPixelSize | null, b: TerminalPixelSize | null) => (
  !!a && !!b && Math.abs(a.width - b.width) < RESIZE_THRESHOLD && Math.abs(a.height - b.height) < RESIZE_THRESHOLD
);

const readTerminalPixelSize = (): TerminalPixelSize | null => {
  const element = terminalOuterWrapperRef.value ?? terminalRef.value;
  if (!element) return null;

  const width = element.clientWidth;
  const height = element.clientHeight;
  if (width <= 0 || height <= 0) return null;

  return { width, height };
};

const readCssPixelValue = (style: CSSStyleDeclaration, propertyName: string) => {
  const value = Number.parseFloat(style.getPropertyValue(propertyName));
  return Number.isFinite(value) ? value : 0;
};

const readTerminalCore = (): XtermInternalCore | null => {
  if (!terminal) return null;
  return (terminal as unknown as { _core?: XtermInternalCore })._core ?? null;
};

const invalidateTerminalFitMetrics = () => {
  cachedFitMetrics = null;
};

const refreshTerminalFitMetrics = (): TerminalFitMetrics | null => {
  if (!terminal?.element) return null;

  const core = readTerminalCore();
  const cell = core?._renderService?.dimensions?.css?.cell;
  const cellWidth = Number(cell?.width ?? 0);
  const cellHeight = Number(cell?.height ?? 0);
  if (cellWidth <= 0 || cellHeight <= 0) return null;

  const elementStyle = window.getComputedStyle(terminal.element);
  const paddingHorizontal = readCssPixelValue(elementStyle, 'padding-left') + readCssPixelValue(elementStyle, 'padding-right');
  const paddingVertical = readCssPixelValue(elementStyle, 'padding-top') + readCssPixelValue(elementStyle, 'padding-bottom');
  const scrollbarWidth = terminal.options.scrollback === 0 ? 0 : Math.max(0, core?.viewport?.scrollBarWidth ?? 0);

  cachedFitMetrics = {
    cellWidth,
    cellHeight,
    paddingHorizontal,
    paddingVertical,
    scrollbarWidth,
  };
  return cachedFitMetrics;
};

const proposeDimensionsFromCachedMetrics = (pixelSize: TerminalPixelSize, forceRefreshMetrics = false): TerminalDimensions | null => {
  const metrics = forceRefreshMetrics || !cachedFitMetrics ? refreshTerminalFitMetrics() : cachedFitMetrics;
  if (!metrics) return fitAddon?.proposeDimensions() ?? null;

  const availableWidth = Math.max(0, pixelSize.width - metrics.paddingHorizontal - metrics.scrollbarWidth);
  const availableHeight = Math.max(0, pixelSize.height - metrics.paddingVertical);
  const visibleCols = Math.max(2, Math.floor(availableWidth / metrics.cellWidth));

  return {
    cols: props.singleLineOutput ? Math.max(SINGLE_LINE_OUTPUT_COLS, visibleCols) : visibleCols,
    rows: Math.max(1, Math.floor(availableHeight / metrics.cellHeight)),
  };
};

const resizeTerminalToDimensions = (dimensions: TerminalDimensions) => {
  if (!terminal || isNaN(dimensions.cols) || isNaN(dimensions.rows)) return;

  terminal.resize(dimensions.cols, dimensions.rows);
};

const updateSingleLineContentWidth = () => {
  if (!props.singleLineOutput || !terminal || !terminalRef.value) {
    singleLineContentWidth.value = null;
    return;
  }

  const metrics = cachedFitMetrics ?? refreshTerminalFitMetrics();
  if (!metrics) return;

  const visibleWidth = terminalOuterWrapperRef.value?.clientWidth ?? terminalRef.value.clientWidth;
  const contentWidth = Math.ceil((terminal.cols * metrics.cellWidth) + metrics.paddingHorizontal + metrics.scrollbarWidth);
  singleLineContentWidth.value = `${Math.max(visibleWidth, contentWidth)}px`;
};

const clearPendingResizeEmit = () => {
  if (resizeEmitTimer !== null) {
    window.clearTimeout(resizeEmitTimer);
    resizeEmitTimer = null;
  }
  pendingResizeDimensions = null;
};

const emitResizeDimensions = (dimensions: TerminalDimensions, force = false) => {
  if (force) {
    clearPendingResizeEmit();
  }
  if (!props.isActive || (!force && isSameDimensions(lastEmittedDimensions, dimensions))) return;

  lastEmittedDimensions = { ...dimensions };
  emitWorkspaceEvent('terminal:resize', { sessionId: props.sessionId, dims: dimensions });
};

const scheduleResizeEmit = (dimensions: TerminalDimensions, force = false) => {
  clearPendingResizeEmit();
  pendingResizeDimensions = { ...dimensions };
  resizeEmitTimer = window.setTimeout(() => {
    if (pendingResizeDimensions) {
      emitResizeDimensions(pendingResizeDimensions, force);
    }
    pendingResizeDimensions = null;
    resizeEmitTimer = null;
  }, RESIZE_EMIT_DELAY);
};

const emitStabilizedResize = (size: TerminalPixelSize, force = false) => {
  if (!props.isActive || (!force && isSamePixelSize(lastStableSize, size))) return;

  lastStableSize = { ...size };
  emitWorkspaceEvent('terminal:stabilizedResize', {
    sessionId: props.sessionId,
    width: Math.round(size.width),
    height: Math.round(size.height),
  });
};

const scheduleStabilizedResize = (size: TerminalPixelSize) => {
  if (stabilizedResizeTimer !== null) {
    window.clearTimeout(stabilizedResizeTimer);
    stabilizedResizeTimer = null;
  }

  const nextSize = { ...size };
  stabilizedResizeTimer = window.setTimeout(() => {
    emitStabilizedResize(nextSize);
    stabilizedResizeTimer = null;
  }, STABILIZED_RESIZE_DELAY);
};

const fitTerminalToContainer = (options: { forceFit?: boolean; forceResizeEmit?: boolean; emitStabilizedNow?: boolean; pixelSize?: TerminalPixelSize } = {}) => {
  if (!terminal || !fitAddon || !terminalRef.value) return;

  const pixelSize = options.pixelSize ?? readTerminalPixelSize();
  if (!pixelSize) return;

  try {
    const proposedDimensions = proposeDimensionsFromCachedMetrics(pixelSize, !!options.forceFit);
    if (!proposedDimensions || proposedDimensions.cols <= 0 || proposedDimensions.rows <= 0) return;

    const nextDimensions = { cols: proposedDimensions.cols, rows: proposedDimensions.rows };
    const dimensionsChanged = !isSameDimensions(lastAppliedDimensions, nextDimensions)
      || terminal.cols !== nextDimensions.cols
      || terminal.rows !== nextDimensions.rows;

    // 借鉴 pretext 的热路径思路：resize 中先做纯尺寸计算，只有网格尺寸变化时才触发 xterm 重排。
    if (dimensionsChanged) {
      resizeTerminalToDimensions(nextDimensions);
    }

    const currentDimensions = { cols: terminal.cols, rows: terminal.rows };
    lastAppliedDimensions = { ...currentDimensions };
    updateSingleLineContentWidth();

    if (dimensionsChanged || options.forceResizeEmit) {
      if (options.forceResizeEmit) {
        emitResizeDimensions(currentDimensions, true);
      } else {
        scheduleResizeEmit(currentDimensions);
      }
    }

    if (options.emitStabilizedNow) {
      emitStabilizedResize(pixelSize, true);
    } else {
      scheduleStabilizedResize(pixelSize);
    }
  } catch (error) {
    console.warn(`[Terminal ${props.sessionId}] fit failed:`, error);
  }
};

const scheduleTerminalFit = (options: { forceFit?: boolean; forceResizeEmit?: boolean; pixelSize?: TerminalPixelSize } = {}) => {
  if (resizeTransactionDepth > 0 && !options.forceFit && !options.forceResizeEmit) {
    hasDeferredFitDuringResize = true;
  }

  pendingFitOptions.forceFit = pendingFitOptions.forceFit || !!options.forceFit;
  pendingFitOptions.forceResizeEmit = pendingFitOptions.forceResizeEmit || !!options.forceResizeEmit;
  if (options.pixelSize) {
    pendingFitOptions.pixelSize = { ...options.pixelSize };
  }

  if (resizeAnimationFrameId !== null) return;

  resizeAnimationFrameId = window.requestAnimationFrame(() => {
    resizeAnimationFrameId = null;
    const nextOptions = { ...pendingFitOptions };
    pendingFitOptions = { forceFit: false, forceResizeEmit: false };
    fitTerminalToContainer(nextOptions);
  });
};

// 立即执行 Fit 并发送 Resize 的函数
const fitAndEmitResizeNow = (term: Terminal) => {
  if (!term || term !== terminal) return;
  fitTerminalToContainer({ forceFit: true, forceResizeEmit: true, emitStabilizedNow: true });
};

const handleResizeTransaction = (payload: WorkspaceEventPayloads['ui:resizeTransaction']) => {
  if (payload.phase === 'start') {
    if (resizeTransactionSettleTimer !== null) {
      window.clearTimeout(resizeTransactionSettleTimer);
      resizeTransactionSettleTimer = null;
    }
    resizeTransactionDepth += 1;
    hasDeferredFitDuringResize = true;
    return;
  }

  if (payload.phase === 'live') {
    if (resizeTransactionDepth > 0 && props.isActive) {
      scheduleTerminalFit();
    }
    return;
  }

  resizeTransactionDepth = Math.max(0, resizeTransactionDepth - 1);
  if (resizeTransactionDepth > 0 || !hasDeferredFitDuringResize) return;

  hasDeferredFitDuringResize = false;
  resizeTransactionSettleTimer = window.setTimeout(() => {
    resizeTransactionSettleTimer = null;
    if (resizeTransactionDepth === 0 && props.isActive) {
      const deferredPixelSize = pendingFitOptions.pixelSize;
      pendingFitOptions = { forceFit: false, forceResizeEmit: false };
      fitTerminalToContainer({ forceFit: true, forceResizeEmit: true, emitStabilizedNow: true, pixelSize: deferredPixelSize });
    }
  }, RESIZE_TRANSACTION_SETTLE_DELAY);
};

const emitTerminalInput = (data: string) => {
  if (!data) return;

  if (props.terminalInputHandler) {
    props.terminalInputHandler(props.sessionId, data, true);
    return;
  }
  emitWorkspaceEvent('terminal:input', { sessionId: props.sessionId, data, batched: true });
};
// 创建防抖版的字体大小保存函数 (区分设备)
const debouncedSaveFontSize = debounce(async (size: number) => {
    try {
        if (isMobile.value) {
            await appearanceStore.setTerminalFontSizeMobile(size);
            debugLog(`[Terminal ${props.sessionId}] Debounced MOBILE font size saved: ${size}`);
        } else {
            await appearanceStore.setTerminalFontSize(size);
            debugLog(`[Terminal ${props.sessionId}] Debounced DESKTOP font size saved: ${size}`);
        }
    } catch (error) {
        console.error(`[Terminal ${props.sessionId}] Debounced font size save failed:`, error);
        // Optionally show an error to the user
    }
}, 500); // 500ms 防抖延迟，可以调整

//  Helper function to convert setting value to xterm scrollback value
const getScrollbackValue = (limit: number): number => {
  if (limit === 0) {
    return Infinity; // 0 means unlimited for xterm
  }
  return Math.max(0, limit); // Ensure non-negative, return the number otherwise
};

// --- 右键粘贴功能 ---
const handleContextMenuPaste = async (event: MouseEvent) => {
  event.preventDefault(); // 阻止默认右键菜单
  try {
    const text = await navigator.clipboard.readText();
    if (text && terminal) {
      const processedText = text.replace(/\r\n?/g, '\n');
      emitTerminalInput(processedText);
    }
  } catch (err) {
    console.error('[Terminal] Failed to paste via Right Click:', err);
  }
};

const addContextMenuListener = () => {
  if (terminalRef.value) {
    terminalRef.value.addEventListener('contextmenu', handleContextMenuPaste);
  }
};

const removeContextMenuListener = () => {
  if (terminalRef.value) {
    terminalRef.value.removeEventListener('contextmenu', handleContextMenuPaste);
  }
};


// --- 移动端模式下通过双指放大缩小终端字号 ---
const getDistanceBetweenTouches = (touches: TouchList): number => {
  const touch1 = touches[0];
  const touch2 = touches[1];
  return Math.sqrt(
    Math.pow(touch2.clientX - touch1.clientX, 2) +
    Math.pow(touch2.clientY - touch1.clientY, 2)
  );
};

const handleTouchStart = (event: TouchEvent) => {
  if (event.touches.length === 2 && terminal) {
    event.preventDefault(); 
    initialPinchDistance = getDistanceBetweenTouches(event.touches);
    currentFontSizeOnPinchStart = terminal.options.fontSize || currentTerminalFontSize.value;
  }
};

const handleTouchMove = (event: TouchEvent) => {
  if (event.touches.length === 2 && terminal && initialPinchDistance > 0) {
    event.preventDefault();
    const currentDistance = getDistanceBetweenTouches(event.touches);
    if (currentDistance > 0) {
      const scale = currentDistance / initialPinchDistance;
      let newSize = Math.round(currentFontSizeOnPinchStart * scale);
      newSize = Math.max(8, Math.min(newSize, 72)); 

      const currentTerminalOptFontSize = terminal.options.fontSize ?? currentTerminalFontSize.value;
      if (newSize !== currentTerminalOptFontSize) {
        terminal.options.fontSize = newSize;
        invalidateTerminalFitMetrics();
        fitAndEmitResizeNow(terminal);
        debouncedSaveFontSize(newSize); // 使用新的区分设备的保存函数
      }
    }
  }
};

const handleTouchEnd = (event: TouchEvent) => {
  if (event.touches.length < 2) {
    initialPinchDistance = 0; // Reset pinch distance
  }
};

// 初始化终端
onMounted(() => {
  subscribeToWorkspaceEvent('ui:resizeTransaction', handleResizeTransaction);

  // xterm 挂载到 terminalRef (内部容器)
  if (terminalRef.value) {
    terminal = new Terminal({
      cursorBlink: true,
      fontSize: currentTerminalFontSize.value, 
      fontFamily: currentTerminalFontFamily.value, // 使用 store 中的字体设置
      theme: effectiveTerminalTheme.value, // 使用 store 中的当前 xterm 主题 (now effectiveTerminalTheme)
      rows: 24, // 初始行数
      cols: 80, // 初始列数
      allowTransparency: true,
      disableStdin: false,
      convertEol: true,
      scrollback: getScrollbackValue(terminalScrollbackLimitNumber.value), //  Use setting from store
      scrollOnUserInput: true, // 输入时滚动到底部
      ...props.options, // 合并外部传入的选项
    });
    
    // 注意: 终端数据的解码已在useSshTerminal.ts中进行处理

    // 加载插件
    fitAddon = new FitAddon();
    searchAddon = new SearchAddon(); // *** 创建 SearchAddon 实例 ***
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.loadAddon(searchAddon); // *** 加载 SearchAddon ***

    // 将终端附加到 DOM
    terminal.open(terminalRef.value);
    // terminal.open() 同步执行完毕后，可以认为 Xterm 已尝试附加到 DOM
    isTerminalDomReady.value = true; // +++ 直接在此处设置 DOM 准备就绪状态 +++
    debugLog(`[Terminal ${props.sessionId}] Xterm open() called, considering DOM ready for initial style checks.`);
 
    fitTerminalToContainer({ forceFit: true, forceResizeEmit: true, emitStabilizedNow: true }); // 触发初始 resize 事件

    // 监听用户输入
    terminal.onData((data) => {
      emitTerminalInput(data);
    });

    // 监听终端大小变化 (通过 ResizeObserver) - 主要处理浏览器窗口大小变化等
    // ResizeObserver 观察内部容器 terminalRef
    if (terminalRef.value) {
        observedElement = terminalOuterWrapperRef.value ?? terminalRef.value;
        resizeObserver = new ResizeObserver((entries) => {
            if (!props.isActive || !terminal || !terminalRef.value) return;

            const entry = entries[0];
            const size = { width: entry.contentRect.width, height: entry.contentRect.height };
            if (size.width <= 0 || size.height <= 0 || isSamePixelSize(lastObservedSize, size)) return;

            lastObservedSize = { ...size };
            scheduleTerminalFit({ pixelSize: size });
        });
        // Observe only if initially active (or becomes active later)
        if (props.isActive) {
            resizeObserver.observe(observedElement);
            debugLog(`[Terminal ${props.sessionId}] Initial observe.`);
        }
    }


    // 监听 isActive prop 的变化
    watch(() => props.isActive, (newValue, oldValue) => {
        debugLog(`[Terminal ${props.sessionId}] isActive changed from ${oldValue} to ${newValue}`);
        if (resizeObserver && observedElement) {
            if (newValue) {
                // --- Become Active ---
                debugLog(`[Terminal ${props.sessionId}] Becoming active. Observing element and fitting.`);
                // Start observing
                try {
                    resizeObserver.observe(observedElement);
                } catch (e) {
                     console.warn(`[Terminal ${props.sessionId}] Error observing element:`, e);
                }
                // Perform fit after a delay to ensure visibility and layout stability
                nextTick(() => {
                    setTimeout(() => {
                        // 检查内部容器 terminalRef
                        if (props.isActive && terminal && terminalRef.value && terminalRef.value.offsetHeight > 0) {
                            scheduleTerminalFit({ forceFit: true, forceResizeEmit: true });
                            // Also ensure focus when becoming active
                            terminal.focus();
                        } else {
                            debugLog(`[Terminal ${props.sessionId}] Skipped delayed fit (inactive, destroyed, or not visible).`);
                        }
                    }, 50); // 50ms delay
                });
            } else {
                // --- Become Inactive ---
                debugLog(`[Terminal ${props.sessionId}] Becoming inactive. Unobserving element.`);
                // Stop observing
                try {
                    resizeObserver.unobserve(observedElement);
                } catch (e) {
                     console.warn(`[Terminal ${props.sessionId}] Error unobserving element:`, e);
                }
 
            }
        } else {
            console.warn(`[Terminal ${props.sessionId}] Cannot handle isActive change: resizeObserver or observedElement missing.`);
        }
    });

    watch(() => props.singleLineOutput, () => {
      if (!terminal) return;
      if (!props.singleLineOutput) {
        singleLineContentWidth.value = null;
      }
      invalidateTerminalFitMetrics();
      nextTick(() => {
        fitTerminalToContainer({ forceFit: true, forceResizeEmit: true, emitStabilizedNow: true });
      });
    });



    // 处理传入的数据流 (如果提供了 stream prop)
    watch(() => props.stream, async (newStream) => {
      if (newStream) {
        const reader = newStream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (terminal && value) {
              terminal.write(value); // 将流数据写入终端
              // 移除此处不必要的 fit() 调用
            }
          }
        } catch (error) {
          console.error('读取终端流时出错:', error);
        } finally {
          reader.releaseLock();
        }
      }
    }, { immediate: true }); // 立即执行一次 watch

    // 触发 ready 事件，传递 sessionId, terminal 和 searchAddon 实例
    if (terminal) {
        emitWorkspaceEvent('terminal:ready', { sessionId: props.sessionId, terminal: terminal, searchAddon: searchAddon });
    }

    // --- 监听并处理选中即复制 ---
    let currentSelection = ''; // 存储当前选区内容，避免重复复制空内容
    const handleSelectionChange = () => {
        if (terminal && autoCopyOnSelectBoolean.value) {
            const newSelection = terminal.getSelection();
            // 仅在选区内容发生变化且不为空时执行复制
            if (newSelection && newSelection !== currentSelection) {
                currentSelection = newSelection;
                navigator.clipboard.writeText(newSelection).then(() => {
                }).catch(err => {
                    console.error('[Terminal] 自动复制到剪贴板失败:', err);
                    // 可以在这里向用户显示一个短暂的错误提示
                });
            } else if (!newSelection) {
                // 如果新选区为空，重置 currentSelection
                currentSelection = '';
            }
        } else {
            // 如果设置关闭，也重置 currentSelection
            currentSelection = '';
        }
    };

    // 添加防抖以避免过于频繁地触发 handleSelectionChange
    const debouncedSelectionChange = debounce(handleSelectionChange, 50); // 50ms 防抖

    // 监听 xterm 的 selectionChange 事件
    selectionListenerDisposable = terminal.onSelectionChange(debouncedSelectionChange); // Assign to outer variable

    // 监听设置变化，如果关闭了自动复制，确保清除可能存在的旧选区状态
    watch(autoCopyOnSelectBoolean, (newValue) => {
        if (!newValue) {
            currentSelection = '';
        }
    });

    // --- 监听外观变化 ---
    watch(terminalThemeSignature, () => { // Changed from currentTerminalTheme
      if (terminal) {
        debugLog(`[Terminal ${props.sessionId}] 应用新终端主题 (effective)。`);
        // 直接修改 options 对象
        terminal.options.theme = effectiveTerminalTheme.value;
        // 修改选项后需要刷新终端才能生效
        try {
            // 刷新整个视口
            terminal.refresh(0, terminal.rows - 1);
            debugLog(`[Terminal ${props.sessionId}] 终端已刷新以应用新主题。`);
        } catch (e) {
            console.warn(`[Terminal ${props.sessionId}] 刷新终端以应用主题时出错:`, e);
        }
      }
    });
    watch(currentTerminalFontFamily, (newFontFamily) => {
        if (terminal) {
            debugLog(`[Terminal ${props.sessionId}] 应用新终端字体: ${newFontFamily}`);
            terminal.options.fontFamily = newFontFamily;
            invalidateTerminalFitMetrics();
            // 字体变化可能影响尺寸，重新 fit
            fitAndEmitResizeNow(terminal);
        }
    });

    // 监听字体大小变化
    watch(currentTerminalFontSize, (newSize) => {
        if (terminal) {
            debugLog(`[Terminal ${props.sessionId}] 应用新终端字体大小: ${newSize}`);
            terminal.options.fontSize = newSize;
            invalidateTerminalFitMetrics();
            // 字体大小变化需要重新 fit
            fitAndEmitResizeNow(terminal);
        }
    });

    watch(terminalScrollbackLimitNumber, (newLimit) => {
        if (terminal) {
            debugLog(`[Terminal ${props.sessionId}] 应用新终端滚动缓冲行数: ${newLimit}`);
            terminal.options.scrollback = getScrollbackValue(newLimit);
            invalidateTerminalFitMetrics();
            scheduleTerminalFit({ forceFit: true, forceResizeEmit: true });
        }
    });

    // 聚焦终端 (添加 null check)
    if (terminal) {
        terminal.focus();
    }

    // --- 添加 Ctrl+Shift+C/V 复制粘贴 ---
    if (terminal && terminal.textarea) { // 确保 terminal 和 textarea 存在
        terminal.textarea.addEventListener('keydown', async (event: KeyboardEvent) => {
            // Ctrl+Shift+C for Copy
            if (event.ctrlKey && event.shiftKey && event.code === 'KeyC') {
                event.preventDefault(); // 阻止默认行为 (例如浏览器开发者工具)
                event.stopPropagation(); // 阻止事件冒泡
                const selection = terminal?.getSelection();
                if (selection) {
                    try {
                        await navigator.clipboard.writeText(selection);
                        debugLog('[Terminal] Copied via Ctrl+Shift+C:', selection);
                    } catch (err) {
                        console.error('[Terminal] Failed to copy via Ctrl+Shift+C:', err);
                        // 可以考虑添加 UI 提示
                    }
                }
            }
            // Ctrl+Shift+V for Paste
            else if (event.ctrlKey && event.shiftKey && event.code === 'KeyV') {
                event.preventDefault();
                event.stopPropagation();
                try {
                    const text = await navigator.clipboard.readText();
                    if (text) {
                        const processedText = text.replace(/\r\n?/g, '\n');
                        emitTerminalInput(processedText);
                    }
                } catch (err) {
                    console.error('[Terminal] Failed to paste via Ctrl+Shift+V:', err);
                    // 检查权限问题，例如 navigator.clipboard.readText 需要用户授权或安全上下文
                    // 可以考虑添加 UI 提示
                }
            }
        });
    }

    // 根据初始设置添加监听器
    if (terminalEnableRightClickPasteBoolean.value) {
      addContextMenuListener();
    }

    // 监听设置变化
    watch(terminalEnableRightClickPasteBoolean, (newValue) => {
      if (newValue) {
        addContextMenuListener();
      } else {
        removeContextMenuListener();
      }
    });


    // 重新添加鼠标滚轮缩放功能到内部容器 terminalRef
    if (terminalRef.value) {
      terminalRef.value.addEventListener('wheel', (event: WheelEvent) => {
        if (event.ctrlKey) {
          event.preventDefault(); // 阻止默认的滚动行为

          if (terminal) {
            let newSize;
            const currentSize = terminal.options.fontSize ?? currentTerminalFontSize.value;
            if (event.deltaY < 0) {
              // 向上滚动，增大字体
              newSize = Math.min(currentSize + 1, 40);
            } else {
              // 向下滚动，减小字体
              newSize = Math.max(currentSize - 1, 8);
            }

            if (newSize !== currentSize) { // 仅在字体大小实际改变时执行
                debugLog(`[Terminal ${props.sessionId}] Font size changed via wheel: ${newSize}`);
                terminal.options.fontSize = newSize; // 先更新选项
                invalidateTerminalFitMetrics();
                fitAndEmitResizeNow(terminal); // 调用统一函数

                // 调用防抖函数来保存设置
                debouncedSaveFontSize(newSize); // 使用新的区分设备的保存函数
            }
          }
        }
      });
    }

    // Add touch listeners for pinch zoom on mobile
    if (isMobile.value && terminalRef.value && terminal) {
      debugLog(`[Terminal ${props.sessionId}] Adding touch listeners for mobile pinch zoom.`);
      terminalRef.value.addEventListener('touchstart', handleTouchStart, { passive: false });
      terminalRef.value.addEventListener('touchmove', handleTouchMove, { passive: false });
      terminalRef.value.addEventListener('touchend', handleTouchEnd, { passive: false });
      terminalRef.value.addEventListener('touchcancel', handleTouchEnd, { passive: false }); // Also handle cancel
    }


  }
});

// 组件卸载前清理资源
onBeforeUnmount(() => {
  unsubscribeFromWorkspaceEvent('ui:resizeTransaction', handleResizeTransaction);

  if (resizeAnimationFrameId !== null) {
    window.cancelAnimationFrame(resizeAnimationFrameId);
    resizeAnimationFrameId = null;
  }
  clearPendingResizeEmit();
  if (stabilizedResizeTimer !== null) {
    window.clearTimeout(stabilizedResizeTimer);
    stabilizedResizeTimer = null;
  }
  if (resizeTransactionSettleTimer !== null) {
    window.clearTimeout(resizeTransactionSettleTimer);
    resizeTransactionSettleTimer = null;
  }
  pendingResizeDimensions = null;

  // Ensure observer is cleaned up
  if (resizeObserver && observedElement) {
      try {
          resizeObserver.unobserve(observedElement);
          debugLog(`[Terminal ${props.sessionId}] Unobserved on unmount.`);
      } catch (e) {
          console.warn(`[Terminal ${props.sessionId}] Error unobserving on unmount:`, e);
      }
      resizeObserver.disconnect(); // Fully disconnect observer
      debugLog(`[Terminal ${props.sessionId}] ResizeObserver disconnected.`);
  }
  resizeObserver = null;
  observedElement = null;

  if (terminal) {
    debugLog(`[Terminal ${props.sessionId}] Disposing terminal instance.`);
    terminal.dispose();
    terminal = null;
  }

  // 在卸载前清理选择监听器
  if (selectionListenerDisposable) {
      selectionListenerDisposable.dispose();
  }

  
    // 确保在卸载时移除右键监听器
    removeContextMenuListener();

    // Remove touch listeners on unmount
    if (isMobile.value && terminalRef.value) {
        debugLog(`[Terminal ${props.sessionId}] Removing touch listeners.`);
        terminalRef.value.removeEventListener('touchstart', handleTouchStart);
        terminalRef.value.removeEventListener('touchmove', handleTouchMove);
        terminalRef.value.removeEventListener('touchend', handleTouchEnd);
        terminalRef.value.removeEventListener('touchcancel', handleTouchEnd);
    }



  });
// 暴露 write 方法给父组件 (可选)
const write = (data: string | Uint8Array) => {
    terminal?.write(data);
};

// *** 暴露搜索方法 ***
const findNext = (term: string, options?: ISearchOptions): boolean => {
  if (searchAddon) {
    return searchAddon.findNext(term, options);
  }
  return false;
};

const findPrevious = (term: string, options?: ISearchOptions): boolean => {
  if (searchAddon) {
    return searchAddon.findPrevious(term, options);
  }
  return false;
};

const clearSearch = () => {
  searchAddon?.clearDecorations();
};

// +++  clear 方法 +++
const clear = () => {
  terminal?.clear();
};

defineExpose({ write, findNext, findPrevious, clearSearch, clear }); // 暴露 clear 方法


// --- 文字描边和阴影 ---
const applyTerminalTextStyles = () => {
  if (terminalRef.value && terminal?.element) {
    const hostElement = terminalRef.value; // .terminal-inner-container

    // 清理类名
    hostElement.classList.remove('has-text-stroke', 'has-text-shadow');

    // 文字描边
    if (terminalTextStrokeEnabled.value) {
      hostElement.classList.add('has-text-stroke');
      hostElement.style.setProperty('--terminal-stroke-width', `${terminalTextStrokeWidth.value}px`);
      hostElement.style.setProperty('--terminal-stroke-color', terminalTextStrokeColor.value);
    } else {
      hostElement.style.removeProperty('--terminal-stroke-width');
      hostElement.style.removeProperty('--terminal-stroke-color');
    }

    // 文字阴影
    if (terminalTextShadowEnabled.value) {
      hostElement.classList.add('has-text-shadow');
      const shadowValue = `${terminalTextShadowOffsetX.value}px ${terminalTextShadowOffsetY.value}px ${terminalTextShadowBlur.value}px ${terminalTextShadowColor.value}`;
      hostElement.style.setProperty('--terminal-shadow', shadowValue);
    } else {
      hostElement.style.removeProperty('--terminal-shadow');
    }
    // console.log('[Terminal] Applied text styles. Stroke enabled:', terminalTextStrokeEnabled.value, 'Shadow enabled:', terminalTextShadowEnabled.value);
  }
};

// 监听文字描边和阴影设置的变化
watch(terminalTextStyleSignature, () => {
  // console.log('[Terminal] Text style settings changed, applying new styles.');
  // 这个 watch 现在主要负责响应运行时的更改
  // 初始加载由下面的 watchEffect 处理
  if (isTerminalDomReady.value && initialAppearanceDataLoaded.value) {
    nextTick(() => {
      applyTerminalTextStyles();
    });
  }
});
 // watchEffect 用于处理初始样式应用 +++
watchEffect(() => {
  if (isTerminalDomReady.value && initialAppearanceDataLoaded.value && terminalRef.value && terminal?.element) {
    debugLog(`[Terminal ${props.sessionId}] Initial style application: DOM ready and appearance data loaded. Applying text styles.`);
    nextTick(() => {
      applyTerminalTextStyles();
    });
  }
});

const terminalInnerStyle = computed(() => (
  props.singleLineOutput && singleLineContentWidth.value
    ? { width: singleLineContentWidth.value, minWidth: '100%' }
    : undefined
));
 
</script>

<template>
  <div
    ref="terminalOuterWrapperRef"
    :class="['terminal-outer-wrapper', { 'single-line-output': props.singleLineOutput }]"
    :data-terminal-session-id="props.sessionId"
  >
    <!-- xterm 实际挂载点 -->
    <div
      ref="terminalRef"
      :class="['terminal-inner-container', { 'single-line-output': props.singleLineOutput }]"
      :style="terminalInnerStyle"
    ></div>
  </div>
</template>

<style scoped>
.terminal-outer-wrapper {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
  contain: layout paint size;
}

.terminal-outer-wrapper.single-line-output {
  overflow-x: auto;
  overflow-y: hidden;
}

.terminal-inner-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
  contain: layout paint size;
  /* position: relative;  移除了 position relative */
  /* z-index 调整或移除，因为背景层不再在此组件内 */
}

.terminal-inner-container :deep(.xterm) {
  width: 100%;
  height: 100%;
}

.terminal-inner-container.single-line-output {
  min-width: 100%;
  overflow-x: visible;
  overflow-y: hidden;
}

.terminal-inner-container.single-line-output :deep(.xterm),
.terminal-inner-container.single-line-output :deep(.xterm-screen),
.terminal-inner-container.single-line-output :deep(.xterm-helpers) {
  min-width: 100%;
}

.terminal-inner-container.single-line-output :deep(.xterm-viewport) {
  overflow-x: hidden !important;
}

/* 文字描边和阴影样式 */
.terminal-inner-container.has-text-stroke :deep(.xterm-rows span),
.terminal-inner-container.has-text-stroke :deep(.xterm-rows div > span), /* 更具体地针对嵌套 span */
.terminal-inner-container.has-text-stroke :deep(.xterm-rows div) { /* 针对直接包含文本的 div */
  -webkit-text-stroke-width: var(--terminal-stroke-width);
  -webkit-text-stroke-color: var(--terminal-stroke-color);
  text-stroke-width: var(--terminal-stroke-width);
  text-stroke-color: var(--terminal-stroke-color);
  /* 确保描边在填充之下，这样填充色仍然可见 */
  paint-order: stroke fill;
  -webkit-paint-order: stroke fill; /* 兼容 WebKit */
}

.terminal-inner-container.has-text-shadow :deep(.xterm-rows span),
.terminal-inner-container.has-text-shadow :deep(.xterm-rows div > span),
.terminal-inner-container.has-text-shadow :deep(.xterm-rows div) {
  text-shadow: var(--terminal-shadow);
}

/*
  移除以下样式，因为它依赖于本组件内部管理的 .has-terminal-background 类，
  该逻辑已移至 LayoutRenderer.vue
*/
</style>

