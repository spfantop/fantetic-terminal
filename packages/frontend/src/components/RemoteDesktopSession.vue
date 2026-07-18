<script setup lang="ts">
import { debugLog } from '../composables/useDebugLog';
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
// @ts-ignore - guacamole-common-js 缺少官方类型定义
import Guacamole from 'guacamole-common-js';
import apiClient from '../utils/apiClient';
import {
  useWorkspaceEventOff,
  useWorkspaceEventSubscriber,
  type WorkspaceEventPayloads,
} from '../composables/workspaceEvents';
import type { ConnectionInfo } from '../stores/connections.store';
import { useSettingsStore } from '../stores/settings.store';
import type { WsConnectionStatus } from '../composables/useWebSocketConnection';
import { resolveRemoteDesktopProxyWebSocketUrl } from '../utils/runtimeConfig';
import { createRemotePointerScheduler, type RemotePointerState } from '../utils/remotePointerScheduler';

const { t } = useI18n();
const settingsStore = useSettingsStore();
const { settings: applicationSettings } = storeToRefs(settingsStore);
const subscribeToWorkspaceEvent = useWorkspaceEventSubscriber();
const unsubscribeFromWorkspaceEvent = useWorkspaceEventOff();

const props = withDefaults(defineProps<{
  sessionId: string;
  connection: ConnectionInfo | null;
  isActive?: boolean;
}>(), {
  isActive: false,
});

const emit = defineEmits<{
  (e: 'status-change', payload: { status: WsConnectionStatus; message: string }): void;
}>();

const remoteSessionRootRef = ref<HTMLDivElement | null>(null);
const rdpDisplayRef = ref<HTMLDivElement | null>(null);
const rdpContainerRef = ref<HTMLDivElement | null>(null);
const guacClient = ref<any | null>(null);
const connectionStatus = ref<WsConnectionStatus>('disconnected');
const statusMessage = ref('');
const keyboard = ref<any | null>(null);
const mouse = ref<any | null>(null);
const isKeyboardDisabledForInput = ref(false);
let resizeObserver: ResizeObserver | null = null;
let resizeObserverWindow: Window | null = null;
let resizeFrameId: number | null = null;
let resizeFrameWindow: Window | null = null;
let resizeSendTimer: number | null = null;
let resizeWindow: Window | null = null;
let stableResizePending = false;
let suppressAutoResizeUntil = 0;
let pendingDisplaySize: RemoteDesktopSize | null = null;
let lastResizeSentAt = 0;
let resizeRequestVersion = 0;
let connectionResizeTimers: number[] = [];
let inputListenerCleanupList: Array<() => void> = [];
let defaultsAppliedForConnectionId: ConnectionInfo['id'] | null = null;

const DEFAULT_REMOTE_DESKTOP_WIDTH = 1024;
const DEFAULT_REMOTE_DESKTOP_HEIGHT = 768;
const MIN_REMOTE_DESKTOP_WIDTH = 100;
const MIN_REMOTE_DESKTOP_HEIGHT = 100;
const DISPLAY_SIZE_WAIT_FRAMES = 24;
const DISPLAY_SIZE_MIN_WAIT_FRAMES = 3;
const DISPLAY_SIZE_STABLE_FRAMES = 3;
const ACTIVE_RESIZE_SETTLE_MS = 220;
const ACTIVE_RESIZE_WAIT_FRAMES = 12;
const ACTIVE_RESIZE_STABLE_FRAMES = 3;
const RESIZE_SEND_MIN_INTERVAL_MS = 120;
const CONNECTION_RESIZE_CONFIRM_DELAYS_MS = [160, 420, 900];
const REMOTE_DESKTOP_RESIZE_EVENT = 'remote-desktop:resize-request';

type RemoteDesktopSize = {
  width: number;
  height: number;
};

type RemoteDesktopQualityProfile = 'smooth' | 'balanced' | 'sharp';

type RemoteDesktopQualitySettings = {
  colorDepth: '16' | '24';
  forceLossless: 'true' | 'false';
};

const QUALITY_PROFILE_OPTIONS: Array<{ value: RemoteDesktopQualityProfile; labelKey: string }> = [
  { value: 'smooth', labelKey: 'remoteDesktopModal.quality.smooth' },
  { value: 'balanced', labelKey: 'remoteDesktopModal.quality.balanced' },
  { value: 'sharp', labelKey: 'remoteDesktopModal.quality.sharp' },
];

const QUALITY_PROFILE_SETTINGS: Record<RemoteDesktopQualityProfile, RemoteDesktopQualitySettings> = {
  smooth: { colorDepth: '16', forceLossless: 'false' },
  balanced: { colorDepth: '24', forceLossless: 'false' },
  sharp: { colorDepth: '24', forceLossless: 'true' },
};

const isResolutionPanelOpen = ref(false);
const isManualResolutionEnabled = ref(false);
const manualResolutionWidth = ref(DEFAULT_REMOTE_DESKTOP_WIDTH);
const manualResolutionHeight = ref(DEFAULT_REMOTE_DESKTOP_HEIGHT);
const selectedQualityProfile = ref<RemoteDesktopQualityProfile>('balanced');
const activeResolution = ref<RemoteDesktopSize>({
  width: DEFAULT_REMOTE_DESKTOP_WIDTH,
  height: DEFAULT_REMOTE_DESKTOP_HEIGHT,
});
let lastSentSize: RemoteDesktopSize | null = null;

const updateStatus = (status: WsConnectionStatus, message: string) => {
  connectionStatus.value = status;
  statusMessage.value = message;
  emit('status-change', { status, message });
};

const getDisplayWindow = () => rdpContainerRef.value?.ownerDocument?.defaultView ?? window;
const getDisplayClipboard = () => getDisplayWindow().navigator.clipboard;

const waitForAnimationFrame = () => new Promise<void>((resolve) => {
  getDisplayWindow().requestAnimationFrame(() => resolve());
});

const measureDisplaySize = () => {
  const rect = rdpContainerRef.value?.getBoundingClientRect();
  const width = Math.floor(rect?.width ?? rdpContainerRef.value?.clientWidth ?? 0);
  const height = Math.floor(rect?.height ?? rdpContainerRef.value?.clientHeight ?? 0);
  return { width, height };
};

const normalizeDisplaySize = ({ width, height }: RemoteDesktopSize): RemoteDesktopSize => ({
  width: width > 0 ? Math.max(MIN_REMOTE_DESKTOP_WIDTH, width) : DEFAULT_REMOTE_DESKTOP_WIDTH,
  height: height > 0 ? Math.max(MIN_REMOTE_DESKTOP_HEIGHT, height) : DEFAULT_REMOTE_DESKTOP_HEIGHT,
});

const normalizeResolutionValue = (value: unknown, min: number, fallback: number) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return Math.max(min, Math.floor(numericValue));
};

const normalizeQualityProfile = (value: unknown): RemoteDesktopQualityProfile => {
  return QUALITY_PROFILE_OPTIONS.some((option) => option.value === value)
    ? value as RemoteDesktopQualityProfile
    : 'balanced';
};

const readDisplaySize = () => {
  return normalizeDisplaySize(measureDisplaySize());
};

const getManualDisplaySize = () => normalizeDisplaySize({
  width: normalizeResolutionValue(manualResolutionWidth.value, MIN_REMOTE_DESKTOP_WIDTH, DEFAULT_REMOTE_DESKTOP_WIDTH),
  height: normalizeResolutionValue(manualResolutionHeight.value, MIN_REMOTE_DESKTOP_HEIGHT, DEFAULT_REMOTE_DESKTOP_HEIGHT),
});

const getQualitySettings = () => QUALITY_PROFILE_SETTINGS[selectedQualityProfile.value] ?? QUALITY_PROFILE_SETTINGS.balanced;

const applyRemoteDesktopDefaults = (connection: ConnectionInfo) => {
  const prefix = connection.type === 'VNC' ? 'vnc' : 'rdp';
  const currentSettings = applicationSettings.value;

  isManualResolutionEnabled.value = currentSettings[`${prefix}DefaultFixedResolution`] === 'true';
  manualResolutionWidth.value = normalizeResolutionValue(
    currentSettings[`${prefix}DefaultWidth`],
    MIN_REMOTE_DESKTOP_WIDTH,
    DEFAULT_REMOTE_DESKTOP_WIDTH,
  );
  manualResolutionHeight.value = normalizeResolutionValue(
    currentSettings[`${prefix}DefaultHeight`],
    MIN_REMOTE_DESKTOP_HEIGHT,
    DEFAULT_REMOTE_DESKTOP_HEIGHT,
  );
  selectedQualityProfile.value = normalizeQualityProfile(currentSettings[`${prefix}DefaultQuality`]);

  if (isManualResolutionEnabled.value) {
    updateActiveResolution(getManualDisplaySize());
  }
};

const ensureRemoteDesktopDefaultsApplied = (connection: ConnectionInfo) => {
  if (defaultsAppliedForConnectionId === connection.id) {
    return;
  }
  applyRemoteDesktopDefaults(connection);
  defaultsAppliedForConnectionId = connection.id;
};

const waitForInitialDisplaySize = async () => {
  return waitForStableDisplaySize(
    DISPLAY_SIZE_WAIT_FRAMES,
    DISPLAY_SIZE_STABLE_FRAMES,
    DISPLAY_SIZE_MIN_WAIT_FRAMES,
  );
};

const waitForStableDisplaySize = async (
  maxFrames: number,
  requiredStableFrames: number,
  minWaitFrames = 0,
) => {
  let latestValidSize: RemoteDesktopSize | null = null;
  let previousMeasuredSize: RemoteDesktopSize | null = null;
  let stableFrameCount = 0;

  for (let attempt = 0; attempt < maxFrames; attempt += 1) {
    await nextTick();
    await waitForAnimationFrame();
    const measured = measureDisplaySize();
    if (measured.width >= MIN_REMOTE_DESKTOP_WIDTH && measured.height >= MIN_REMOTE_DESKTOP_HEIGHT) {
      latestValidSize = normalizeDisplaySize(measured);
      stableFrameCount = isSameDisplaySize(previousMeasuredSize, measured) ? stableFrameCount + 1 : 1;
      previousMeasuredSize = measured;

      if (attempt >= minWaitFrames && stableFrameCount >= requiredStableFrames) {
        return latestValidSize;
      }
    }
  }

  return latestValidSize ?? readDisplaySize();
};

const getInitialSessionSize = async () => {
  if (isManualResolutionEnabled.value) {
    return getManualDisplaySize();
  }
  return waitForInitialDisplaySize();
};

const buildSessionEndpoint = (connection: ConnectionInfo, width: number, height: number) => {
  const protocol = connection.type === 'VNC' ? 'vnc' : 'rdp';
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
  });
  const qualitySettings = getQualitySettings();
  params.set('colorDepth', qualitySettings.colorDepth);
  params.set('forceLossless', qualitySettings.forceLossless);

  if (protocol === 'rdp') {
    params.set('dpi', '96');
  }

  return {
    protocol,
    url: `connections/${connection.id}/${protocol}-session?${params.toString()}`,
  };
};

const focusDisplay = () => {
  if (!props.isActive) return;
  const displayEl = guacClient.value?.getDisplay()?.getElement();
  if (displayEl && typeof displayEl.focus === 'function') {
    displayEl.focus();
  }
};

const updateActiveResolution = (size: RemoteDesktopSize) => {
  activeResolution.value = {
    width: size.width,
    height: size.height,
  };
};

const isSameDisplaySize = (left: RemoteDesktopSize | null, right: RemoteDesktopSize) => {
  return left?.width === right.width && left.height === right.height;
};

type SendDisplaySizeOptions = {
  force?: boolean;
};

const clearResizeSendTimer = () => {
  if (resizeSendTimer === null) return;
  (resizeWindow ?? getDisplayWindow()).clearTimeout(resizeSendTimer);
  resizeSendTimer = null;
};

const clearConnectionResizeTimers = () => {
  const displayWindow = getDisplayWindow();
  connectionResizeTimers.forEach(timerId => displayWindow.clearTimeout(timerId));
  connectionResizeTimers = [];
};

const sendDisplaySizeNow = (size: RemoteDesktopSize) => {
  if (!guacClient.value || connectionStatus.value !== 'connected') return;
  const normalizedSize = normalizeDisplaySize(size);
  guacClient.value.sendSize(normalizedSize.width, normalizedSize.height);
  lastSentSize = normalizedSize;
  lastResizeSentAt = getDisplayWindow().performance.now();
  updateActiveResolution(normalizedSize);
};

const flushPendingDisplaySize = () => {
  resizeSendTimer = null;
  const pendingSize = pendingDisplaySize;
  pendingDisplaySize = null;
  if (pendingSize) {
    sendDisplaySizeNow(pendingSize);
  }
};

const sendDisplaySize = (size: RemoteDesktopSize, options: SendDisplaySizeOptions = {}) => {
  if (!guacClient.value || connectionStatus.value !== 'connected') return;
  const normalizedSize = normalizeDisplaySize(size);
  if (!options.force && isSameDisplaySize(lastSentSize, normalizedSize)) {
    clearResizeSendTimer();
    pendingDisplaySize = null;
    return;
  }

  if (options.force) {
    clearResizeSendTimer();
    pendingDisplaySize = null;
    sendDisplaySizeNow(normalizedSize);
    return;
  }

  const now = getDisplayWindow().performance.now();
  const elapsed = now - lastResizeSentAt;
  if (lastResizeSentAt === 0 || elapsed >= RESIZE_SEND_MIN_INTERVAL_MS) {
    clearResizeSendTimer();
    pendingDisplaySize = null;
    sendDisplaySizeNow(normalizedSize);
    return;
  }

  pendingDisplaySize = normalizedSize;
  if (resizeSendTimer === null) {
    resizeWindow = getDisplayWindow();
    resizeSendTimer = resizeWindow.setTimeout(
      flushPendingDisplaySize,
      Math.max(RESIZE_SEND_MIN_INTERVAL_MS - elapsed, 0),
    );
  }
};

const sendCurrentSize = (options: SendDisplaySizeOptions = {}) => {
  if (!guacClient.value || connectionStatus.value !== 'connected') return;
  syncResizeWindowListener();
  if (isManualResolutionEnabled.value) {
    sendDisplaySize(getManualDisplaySize(), options);
    return;
  }

  const measured = measureDisplaySize();
  if (measured.width <= 0 || measured.height <= 0) return;
  sendDisplaySize(measured, options);
};

const scheduleCurrentSize = () => {
  if (resizeFrameId !== null) return;

  resizeFrameWindow = getDisplayWindow();
  resizeFrameId = resizeFrameWindow.requestAnimationFrame(() => {
    resizeFrameId = null;
    resizeFrameWindow = null;
    sendCurrentSize();
  });
};

const scheduleStableCurrentSize = () => {
  if (stableResizePending) return;

  stableResizePending = true;
  const currentResizeRequestVersion = resizeRequestVersion;
  void (async () => {
    const stableSize = await waitForStableDisplaySize(
      ACTIVE_RESIZE_WAIT_FRAMES,
      ACTIVE_RESIZE_STABLE_FRAMES,
    );
    if (currentResizeRequestVersion !== resizeRequestVersion) return;
    stableResizePending = false;

    if (isManualResolutionEnabled.value) {
      sendCurrentSize({ force: true });
      return;
    }
    sendDisplaySize(stableSize, { force: true });
  })();
};

const handleResizeSignal = () => {
  if (!props.isActive) return;
  if (isManualResolutionEnabled.value) return;
  if (getDisplayWindow().performance.now() < suppressAutoResizeUntil) {
    scheduleStableCurrentSize();
    return;
  }
  scheduleCurrentSize();
};

const syncResizeWindowListener = () => {
  const nextWindow = rdpContainerRef.value?.ownerDocument?.defaultView ?? window;
  if (resizeWindow === nextWindow) return;

  resizeWindow?.removeEventListener('resize', handleResizeSignal);
  resizeWindow = nextWindow;
  resizeWindow.addEventListener('resize', handleResizeSignal);
};

const syncResizeObserver = () => {
  const displayContainer = rdpContainerRef.value;
  if (!displayContainer) return;

  const nextResizeObserverWindow = getDisplayWindow();
  if (resizeObserver && resizeObserverWindow === nextResizeObserverWindow) return;

  resizeObserver?.disconnect();
  resizeObserverWindow = nextResizeObserverWindow;
  const ResizeObserverConstructor = getDisplayWindow().ResizeObserver ?? ResizeObserver;
  resizeObserver = new ResizeObserverConstructor(() => {
    handleResizeSignal();
  });
  resizeObserver.observe(displayContainer);
};

const handleResizeTransaction = (payload: WorkspaceEventPayloads['ui:resizeTransaction']) => {
  if (payload.phase === 'start') return;
  handleResizeSignal();
};

const applyManualResolution = () => {
  const normalizedSize = getManualDisplaySize();
  manualResolutionWidth.value = normalizedSize.width;
  manualResolutionHeight.value = normalizedSize.height;
  updateActiveResolution(normalizedSize);
  sendCurrentSize({ force: true });
  focusDisplay();
};

const handleManualResolutionModeChange = () => {
  if (isManualResolutionEnabled.value) {
    const currentSize = readDisplaySize();
    manualResolutionWidth.value = currentSize.width;
    manualResolutionHeight.value = currentSize.height;
    updateActiveResolution(currentSize);
  }
  sendCurrentSize({ force: true });
  focusDisplay();
};

const handleQualityProfileChange = () => {
  isKeyboardDisabledForInput.value = false;
  if (!props.connection) return;
  void nextTick(() => handleConnection());
};

const handleExternalResizeRequest = () => {
  syncResizeWindowListener();
  syncResizeObserver();
  handleResizeSignal();
};

const sendConnectionConfirmedSize = () => {
  sendCurrentSize({ force: true });
  if (!isManualResolutionEnabled.value) {
    scheduleStableCurrentSize();
  }
};

const scheduleConnectionResizeConfirmation = () => {
  clearConnectionResizeTimers();
  nextTick(() => {
    sendConnectionConfirmedSize();
    CONNECTION_RESIZE_CONFIRM_DELAYS_MS.forEach((delay) => {
      const timerId = getDisplayWindow().setTimeout(sendConnectionConfirmedSize, delay);
      connectionResizeTimers.push(timerId);
    });
  });
};

const trySyncClipboardOnDisplayFocus = async () => {
  if (!guacClient.value) return;
  try {
    const currentClipboardText = await getDisplayClipboard().readText();
    if (!currentClipboardText || !guacClient.value) return;

    // @ts-ignore
    const stream = guacClient.value.createClipboardStream('text/plain');
    // @ts-ignore
    const writer = new Guacamole.StringWriter(stream);
    writer.sendText(currentClipboardText);
    writer.sendEnd();
    debugLog('[RemoteDesktopSession] Sent clipboard to RDP on display focus:', currentClipboardText.substring(0, 50) + (currentClipboardText.length > 50 ? '...' : ''));
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'NotAllowedError')) {
      console.warn('[RemoteDesktopSession] Could not read clipboard on display focus:', err);
    }
  }
};

const setupInputListeners = () => {
  if (!guacClient.value || !rdpDisplayRef.value) return;

  try {
    removeInputListeners();
    const displayEl = guacClient.value.getDisplay().getElement() as HTMLElement;
    displayEl.tabIndex = 0;

    const handleRdpDisplayClick = () => {
      const activeElement = displayEl.ownerDocument.activeElement as HTMLElement | null;
      if (activeElement?.dataset.remoteResolutionInput === 'true') {
        activeElement.blur();
      }
      focusDisplay();
    };
    displayEl.addEventListener('click', handleRdpDisplayClick);
    inputListenerCleanupList.push(() => displayEl.removeEventListener('click', handleRdpDisplayClick));

    const handleMouseEnter = () => {
      displayEl.style.cursor = 'none';
    };
    const handleMouseLeave = () => {
      displayEl.style.cursor = 'default';
    };
    displayEl.addEventListener('mouseenter', handleMouseEnter);
    displayEl.addEventListener('mouseleave', handleMouseLeave);
    inputListenerCleanupList.push(() => displayEl.removeEventListener('mouseenter', handleMouseEnter));
    inputListenerCleanupList.push(() => displayEl.removeEventListener('mouseleave', handleMouseLeave));

    // @ts-ignore
    mouse.value = new Guacamole.Mouse(displayEl);
    const display = guacClient.value.getDisplay();
    display.showCursor(true);

    const cursorLayer = display.getCursorLayer();
    const cursorElement = cursorLayer?.getElement?.();
    if (cursorElement) {
      cursorElement.style.zIndex = '1000';
    }

    const pointerScheduler = createRemotePointerScheduler<RemotePointerState>({
      send: (mouseState) => guacClient.value?.sendMouseState(mouseState),
      animationFrame: displayEl.ownerDocument.defaultView ?? window,
    });
    mouse.value.onmousemove = (mouseState: RemotePointerState) => {
      pointerScheduler.move(mouseState);
    };
    mouse.value.onmousedown = mouse.value.onmouseup = (mouseState: RemotePointerState) => {
      pointerScheduler.sendNow(mouseState);
    };
    inputListenerCleanupList.push(pointerScheduler.dispose);

    // @ts-ignore
    keyboard.value = new Guacamole.Keyboard(displayEl);
    keyboard.value.onkeydown = (keysym: number) => {
      if (guacClient.value && !isKeyboardDisabledForInput.value) {
        guacClient.value.sendKeyEvent(1, keysym);
      }
    };
    keyboard.value.onkeyup = (keysym: number) => {
      if (guacClient.value && !isKeyboardDisabledForInput.value) {
        guacClient.value.sendKeyEvent(0, keysym);
      }
    };

    displayEl.addEventListener('focus', trySyncClipboardOnDisplayFocus);
    inputListenerCleanupList.push(() => displayEl.removeEventListener('focus', trySyncClipboardOnDisplayFocus));

    // @ts-ignore
    guacClient.value.onclipboard = async (stream, mimetype) => {
      if (mimetype !== 'text/plain') return;

      // @ts-ignore
      const reader = new Guacamole.StringReader(stream);
      let text = '';
      reader.ontext = (chunk: string) => {
        text += chunk;
      };
    reader.onend = async () => {
      try {
          await getDisplayClipboard().writeText(text);
          debugLog('[RemoteDesktopSession] Received clipboard from RDP and wrote to host:', text.substring(0, 50) + (text.length > 50 ? '...' : ''));
        } catch (err) {
          console.warn('[RemoteDesktopSession] Could not write to host clipboard:', err);
        }
      };
    };
  } catch (inputError) {
    console.error('[RemoteDesktopSession] Error setting up input listeners:', inputError);
    updateStatus('error', t('remoteDesktopModal.errors.inputError'));
  }
};

const removeInputListeners = () => {
  inputListenerCleanupList.forEach((cleanup) => {
    try {
      cleanup();
    } catch (error) {
      console.warn('[RemoteDesktopSession] Could not remove input listener:', error);
    }
  });
  inputListenerCleanupList = [];

  if (guacClient.value) {
    try {
      const displayEl = guacClient.value.getDisplay()?.getElement();
      if (displayEl) {
        displayEl.style.cursor = 'default';
        displayEl.removeEventListener('focus', trySyncClipboardOnDisplayFocus);
      }
    } catch (e) {
      console.warn('[RemoteDesktopSession] Could not reset cursor or remove listeners:', e);
    }
  }

  if (keyboard.value) {
    keyboard.value.onkeydown = null;
    keyboard.value.onkeyup = null;
    keyboard.value = null;
  }
  if (mouse.value) {
    mouse.value.onmousedown = null;
    mouse.value.onmouseup = null;
    mouse.value.onmousemove = null;
    mouse.value = null;
  }
  if (guacClient.value) {
    // @ts-ignore
    guacClient.value.onclipboard = null;
  }
};

const disconnectGuacamole = (preserveError = false) => {
  resizeRequestVersion += 1;
  stableResizePending = false;
  clearConnectionResizeTimers();
  clearResizeSendTimer();
  pendingDisplaySize = null;
  removeInputListeners();
  isKeyboardDisabledForInput.value = false;
  lastSentSize = null;
  lastResizeSentAt = 0;
  if (resizeFrameId !== null) {
    (resizeFrameWindow ?? window).cancelAnimationFrame(resizeFrameId);
    resizeFrameId = null;
    resizeFrameWindow = null;
  }
  if (guacClient.value) {
    guacClient.value.disconnect();
    guacClient.value = null;
  }
  if (rdpDisplayRef.value) {
    while (rdpDisplayRef.value.firstChild) {
      rdpDisplayRef.value.removeChild(rdpDisplayRef.value.firstChild);
    }
  }
  if (!preserveError) {
    updateStatus('disconnected', t('remoteDesktopModal.status.disconnected'));
  }
};

const handleConnection = async () => {
  if (!props.connection || !rdpDisplayRef.value) {
    updateStatus('error', t('remoteDesktopModal.errors.missingInfo'));
    return;
  }

  ensureRemoteDesktopDefaultsApplied(props.connection);
  disconnectGuacamole();
  updateStatus('connecting', t('remoteDesktopModal.status.fetchingToken'));

  try {
    if (props.connection.type !== 'RDP' && props.connection.type !== 'VNC') {
      throw new Error(`Unsupported connection type: ${props.connection.type}`);
    }

    const { width, height } = await getInitialSessionSize();
    updateActiveResolution({ width, height });
    const { protocol, url } = buildSessionEndpoint(props.connection, width, height);
    const response = await apiClient.post<{ token: string }>(url);
    const token = response.data?.token;
    if (!token) {
      throw new Error(`${protocol.toUpperCase()} Token not found in API response`);
    }

    updateStatus('connecting', t('remoteDesktopModal.status.connectingWs'));
    const tunnelUrl = resolveRemoteDesktopProxyWebSocketUrl(token, width, height);

    // @ts-ignore
    const tunnel = new Guacamole.WebSocketTunnel(tunnelUrl);
    tunnel.onerror = () => {
      updateStatus('error', t('remoteDesktopModal.errors.tunnelError'));
      disconnectGuacamole(true);
    };

    // @ts-ignore
    guacClient.value = new Guacamole.Client(tunnel);
    guacClient.value.keepAliveFrequency = 3000;
    rdpDisplayRef.value.appendChild(guacClient.value.getDisplay().getElement());

    guacClient.value.onstatechange = (state: number) => {
      let currentStatus: WsConnectionStatus = 'disconnected';
      let i18nKeyPart = 'unknownState';

      switch (state) {
        case 0:
          i18nKeyPart = 'idle';
          currentStatus = 'disconnected';
          break;
        case 1:
          i18nKeyPart = protocol === 'vnc' ? 'connectingVnc' : 'connectingRdp';
          currentStatus = 'connecting';
          break;
        case 2:
          i18nKeyPart = 'waiting';
          currentStatus = 'connecting';
          break;
        case 3:
          i18nKeyPart = 'connected';
          currentStatus = 'connected';
          updateStatus(currentStatus, t(`remoteDesktopModal.status.${i18nKeyPart}`, { state }));
          setupInputListeners();
          nextTick(() => {
            focusDisplay();
            scheduleConnectionResizeConfirmation();
          });
          return;
        case 4:
          i18nKeyPart = 'disconnecting';
          currentStatus = 'disconnected';
          break;
        case 5:
          i18nKeyPart = 'disconnected';
          currentStatus = 'disconnected';
          break;
      }

      updateStatus(currentStatus, t(`remoteDesktopModal.status.${i18nKeyPart}`, { state }));
    };

    guacClient.value.onerror = () => {
      updateStatus('error', t('remoteDesktopModal.errors.clientError'));
      disconnectGuacamole(true);
    };

    guacClient.value.connect('');
  } catch {
    updateStatus('error', t('remoteDesktopModal.errors.connectionFailed'));
    disconnectGuacamole(true);
  }
};

watch(() => props.connection?.id, (newConnectionId, oldConnectionId) => {
  if (newConnectionId && newConnectionId !== oldConnectionId) {
    nextTick(() => handleConnection());
  } else if (!newConnectionId) {
    defaultsAppliedForConnectionId = null;
    disconnectGuacamole();
    updateStatus('error', t('remoteDesktopModal.errors.noConnection'));
  }
});

watch(() => props.isActive, (active) => {
  if (active) {
    suppressAutoResizeUntil = getDisplayWindow().performance.now() + ACTIVE_RESIZE_SETTLE_MS;
    nextTick(() => {
      focusDisplay();
      scheduleStableCurrentSize();
    });
  }
});

onMounted(() => {
  syncResizeObserver();
  syncResizeWindowListener();
  remoteSessionRootRef.value?.addEventListener(REMOTE_DESKTOP_RESIZE_EVENT, handleExternalResizeRequest);
  subscribeToWorkspaceEvent('ui:resizeTransaction', handleResizeTransaction);

  if (props.connection) {
    nextTick(() => handleConnection());
  } else {
    updateStatus('error', t('remoteDesktopModal.errors.noConnection'));
  }
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  resizeObserverWindow = null;
  resizeWindow?.removeEventListener('resize', handleResizeSignal);
  resizeWindow = null;
  remoteSessionRootRef.value?.removeEventListener(REMOTE_DESKTOP_RESIZE_EVENT, handleExternalResizeRequest);
  unsubscribeFromWorkspaceEvent('ui:resizeTransaction', handleResizeTransaction);
  disconnectGuacamole();
});
</script>

<template>
  <div
    ref="remoteSessionRootRef"
    class="remote-desktop-session h-full w-full overflow-hidden bg-black"
    :data-terminal-session-id="props.sessionId"
    tabindex="0"
  >
    <div ref="rdpContainerRef" class="relative h-full w-full overflow-hidden bg-black">
      <div ref="rdpDisplayRef" class="rdp-display-container h-full w-full"></div>
      <div
        :class="[
          'resolution-control-anchor absolute bottom-1 right-1 z-[1200] h-12 w-12',
          { 'is-open': isResolutionPanelOpen },
        ]"
      >
        <button
          type="button"
          :class="[
            'resolution-toggle-button absolute bottom-2 right-2 z-[1201] flex h-9 w-9 items-center justify-center rounded border border-white/20 bg-black/70 text-white shadow-lg transition hover:bg-black/85 focus:outline-none focus:ring-2 focus:ring-primary',
            { 'is-open': isResolutionPanelOpen },
          ]"
          :aria-label="t('remoteDesktopModal.resolution.settings')"
          :title="t('remoteDesktopModal.resolution.settings')"
          @mousedown.stop
          @click.stop="isResolutionPanelOpen = !isResolutionPanelOpen"
        >
          <i class="fas fa-expand-arrows-alt" aria-hidden="true"></i>
        </button>
        <div
          v-if="isResolutionPanelOpen"
          class="absolute bottom-12 right-2 z-[1202] w-64 rounded border border-border bg-background/95 p-3 text-foreground shadow-xl backdrop-blur"
          @mousedown.stop
          @click.stop
        >
        <div class="flex items-center justify-between gap-3">
          <span class="text-xs font-semibold">{{ t('remoteDesktopModal.resolution.title') }}</span>
          <span class="shrink-0 text-[11px] text-text-secondary">
            {{ activeResolution.width }} x {{ activeResolution.height }}
          </span>
        </div>
        <label class="mt-3 block min-w-0 text-[11px] text-text-secondary" :for="`remote-quality-${props.sessionId}`">
          <span>{{ t('remoteDesktopModal.quality.title') }}</span>
          <select
            :id="`remote-quality-${props.sessionId}`"
            v-model="selectedQualityProfile"
            data-remote-resolution-input="true"
            class="mt-1 w-full min-w-0 rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
            @focus="isKeyboardDisabledForInput = true"
            @blur="isKeyboardDisabledForInput = false"
            @change="handleQualityProfileChange"
          >
            <option
              v-for="qualityProfile in QUALITY_PROFILE_OPTIONS"
              :key="qualityProfile.value"
              :value="qualityProfile.value"
            >
              {{ t(qualityProfile.labelKey) }}
            </option>
          </select>
        </label>
        <label class="mt-3 flex items-center gap-2 text-xs">
          <input
            v-model="isManualResolutionEnabled"
            type="checkbox"
            class="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            @change="handleManualResolutionModeChange"
          />
          <span>
            {{ t('remoteDesktopModal.resolution.manual') }}
          </span>
        </label>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <label class="min-w-0 text-[11px] text-text-secondary" :for="`remote-resolution-width-${props.sessionId}`">
            <span>{{ t('common.width') }}</span>
            <input
              :id="`remote-resolution-width-${props.sessionId}`"
              v-model.number="manualResolutionWidth"
              :disabled="!isManualResolutionEnabled"
              :min="MIN_REMOTE_DESKTOP_WIDTH"
              data-remote-resolution-input="true"
              type="number"
              class="mt-1 w-full min-w-0 rounded border border-border bg-background px-2 py-1 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              @focus="isKeyboardDisabledForInput = true"
              @blur="isKeyboardDisabledForInput = false"
              @keydown.enter.prevent="applyManualResolution"
            />
          </label>
          <label class="min-w-0 text-[11px] text-text-secondary" :for="`remote-resolution-height-${props.sessionId}`">
            <span>{{ t('common.height') }}</span>
            <input
              :id="`remote-resolution-height-${props.sessionId}`"
              v-model.number="manualResolutionHeight"
              :disabled="!isManualResolutionEnabled"
              :min="MIN_REMOTE_DESKTOP_HEIGHT"
              data-remote-resolution-input="true"
              type="number"
              class="mt-1 w-full min-w-0 rounded border border-border bg-background px-2 py-1 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              @focus="isKeyboardDisabledForInput = true"
              @blur="isKeyboardDisabledForInput = false"
              @keydown.enter.prevent="applyManualResolution"
            />
          </label>
        </div>
        <button
          type="button"
          class="mt-3 w-full rounded bg-primary px-3 py-1.5 text-xs font-medium text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-border"
          :disabled="!isManualResolutionEnabled"
          @click="applyManualResolution"
        >
          {{ t('common.apply') }}
        </button>
        </div>
      </div>
      <div
        v-if="connectionStatus === 'connecting' || connectionStatus === 'error'"
        class="absolute inset-0 z-10 flex items-center justify-center bg-black/75 p-4 text-white"
      >
        <div class="text-center">
          <i v-if="connectionStatus === 'connecting'" class="fas fa-spinner fa-spin fa-2x mb-3"></i>
          <i v-else class="fas fa-exclamation-triangle fa-2x mb-3 text-red-400"></i>
          <p class="text-sm">{{ statusMessage }}</p>
          <button
            v-if="connectionStatus === 'error'"
            class="mt-4 rounded bg-primary px-3 py-1 text-xs text-white hover:bg-primary-dark"
            @click="handleConnection"
          >
            {{ t('common.retry') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.resolution-control-anchor::before {
  content: "";
  position: absolute;
  right: 0.35rem;
  bottom: 0.35rem;
  width: 0.85rem;
  height: 0.85rem;
  border-right: 2px solid rgb(255 255 255 / 0.65);
  border-bottom: 2px solid rgb(255 255 255 / 0.65);
  border-bottom-right-radius: 0.25rem;
  opacity: 0.65;
  pointer-events: none;
  transition: opacity 0.12s ease;
}

.resolution-control-anchor:hover::before,
.resolution-control-anchor.is-open::before {
  opacity: 0;
}

.resolution-toggle-button {
  opacity: 0;
  pointer-events: auto;
  transform: translateY(4px);
}

.resolution-control-anchor:hover .resolution-toggle-button,
.resolution-toggle-button:hover,
.resolution-toggle-button:focus-visible,
.resolution-toggle-button.is-open {
  opacity: 1;
  transform: translateY(0);
}

.rdp-display-container {
  overflow: hidden;
  position: relative;
}

/* Guacamole places each layer's canvas at z-index:-1 so child layers can sit above it. */
.rdp-display-container :deep(div[style*="position: absolute"]:first-child) {
  z-index: 0;
}
</style>
