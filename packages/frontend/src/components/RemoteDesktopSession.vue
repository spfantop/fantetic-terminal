<script setup lang="ts">
import { debugLog } from '../composables/useDebugLog';
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
// @ts-ignore - guacamole-common-js 缺少官方类型定义
import Guacamole from 'guacamole-common-js';
import apiClient from '../utils/apiClient';
import type { ConnectionInfo } from '../stores/connections.store';
import type { WsConnectionStatus } from '../composables/useWebSocketConnection';

const { t } = useI18n();

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

const rdpDisplayRef = ref<HTMLDivElement | null>(null);
const rdpContainerRef = ref<HTMLDivElement | null>(null);
const guacClient = ref<any | null>(null);
const connectionStatus = ref<WsConnectionStatus>('disconnected');
const statusMessage = ref('');
const keyboard = ref<any | null>(null);
const mouse = ref<any | null>(null);
const isKeyboardDisabledForInput = ref(false);
let resizeObserver: ResizeObserver | null = null;

const LOCAL_BACKEND_URL = 'ws://localhost:3001';
const backendBaseUrl = window.location.hostname === 'localhost'
  ? LOCAL_BACKEND_URL
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

const updateStatus = (status: WsConnectionStatus, message: string) => {
  connectionStatus.value = status;
  statusMessage.value = message;
  emit('status-change', { status, message });
};

const readDisplaySize = () => {
  const width = Math.max(100, rdpContainerRef.value?.clientWidth ?? 800);
  const height = Math.max(100, (rdpContainerRef.value?.clientHeight ?? 600) - 1);
  return { width, height };
};

const focusDisplay = () => {
  if (!props.isActive) return;
  const displayEl = guacClient.value?.getDisplay()?.getElement();
  if (displayEl && typeof displayEl.focus === 'function') {
    displayEl.focus();
  }
};

const sendCurrentSize = () => {
  if (!guacClient.value || connectionStatus.value !== 'connected') return;
  const { width, height } = readDisplaySize();
  if (width > 0 && height > 0) {
    guacClient.value.sendSize(width, height);
  }
};

const trySyncClipboardOnDisplayFocus = async () => {
  if (!guacClient.value) return;
  try {
    const currentClipboardText = await navigator.clipboard.readText();
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
    const displayEl = guacClient.value.getDisplay().getElement() as HTMLElement;
    displayEl.tabIndex = 0;

    const handleRdpDisplayClick = () => {
      const activeElement = document.activeElement as HTMLElement;
      if (activeElement && (activeElement.id === 'modal-width' || activeElement.id === 'modal-height')) {
        activeElement.blur();
      }
      focusDisplay();
    };
    displayEl.addEventListener('click', handleRdpDisplayClick);

    const handleMouseEnter = () => {
      displayEl.style.cursor = 'none';
    };
    const handleMouseLeave = () => {
      displayEl.style.cursor = 'default';
    };
    displayEl.addEventListener('mouseenter', handleMouseEnter);
    displayEl.addEventListener('mouseleave', handleMouseLeave);

    // @ts-ignore
    mouse.value = new Guacamole.Mouse(displayEl);
    const display = guacClient.value.getDisplay();
    display.showCursor(true);

    const cursorLayer = display.getCursorLayer();
    const cursorElement = cursorLayer?.getElement?.();
    if (cursorElement) {
      cursorElement.style.zIndex = '1000';
    }

    // @ts-ignore
    mouse.value.onmousedown = mouse.value.onmouseup = mouse.value.onmousemove = (mouseState: any) => {
      guacClient.value?.sendMouseState(mouseState);
    };

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
          await navigator.clipboard.writeText(text);
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
  removeInputListeners();
  isKeyboardDisabledForInput.value = false;
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

  disconnectGuacamole();
  updateStatus('connecting', t('remoteDesktopModal.status.fetchingToken'));

  try {
    if (props.connection.type !== 'RDP') {
      throw new Error(`Unsupported connection type: ${props.connection.type}`);
    }

    const response = await apiClient.post<{ token: string }>(`connections/${props.connection.id}/rdp-session`);
    const token = response.data?.token;
    if (!token) {
      throw new Error('RDP Token not found in API response');
    }

    updateStatus('connecting', t('remoteDesktopModal.status.connectingWs'));
    await nextTick();
    const { width, height } = readDisplaySize();
    const tunnelUrl = `${backendBaseUrl}/rdp-proxy?token=${encodeURIComponent(token)}&width=${width}&height=${height}&dpi=96`;

    // @ts-ignore
    const tunnel = new Guacamole.WebSocketTunnel(tunnelUrl);
    tunnel.onerror = (status: any) => {
      const errorMessage = status.message || 'Unknown tunnel error';
      const errorCode = status.code || 'N/A';
      updateStatus('error', `${t('remoteDesktopModal.errors.tunnelError')} (${errorCode}): ${errorMessage}`);
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
          i18nKeyPart = 'connectingRdp';
          currentStatus = 'connecting';
          break;
        case 2:
          i18nKeyPart = 'waiting';
          currentStatus = 'connecting';
          break;
        case 3:
          i18nKeyPart = 'connected';
          currentStatus = 'connected';
          setupInputListeners();
          nextTick(() => {
            focusDisplay();
            sendCurrentSize();
          });
          break;
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

    guacClient.value.onerror = (status: any) => {
      const errorMessage = status.message || 'Unknown client error';
      updateStatus('error', `${t('remoteDesktopModal.errors.clientError')}: ${errorMessage}`);
      disconnectGuacamole(true);
    };

    guacClient.value.connect('');
  } catch (error: any) {
    updateStatus('error', `${t('remoteDesktopModal.errors.connectionFailed')}: ${error.response?.data?.message || error.message || String(error)}`);
    disconnectGuacamole(true);
  }
};

watch(() => props.connection?.id, (newConnectionId, oldConnectionId) => {
  if (newConnectionId && newConnectionId !== oldConnectionId) {
    nextTick(() => handleConnection());
  } else if (!newConnectionId) {
    disconnectGuacamole();
    updateStatus('error', t('remoteDesktopModal.errors.noConnection'));
  }
});

watch(() => props.isActive, (active) => {
  if (active) {
    nextTick(() => {
      focusDisplay();
      sendCurrentSize();
    });
  }
});

onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    sendCurrentSize();
  });
  if (rdpContainerRef.value) {
    resizeObserver.observe(rdpContainerRef.value);
  }

  if (props.connection) {
    nextTick(() => handleConnection());
  } else {
    updateStatus('error', t('remoteDesktopModal.errors.noConnection'));
  }
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  disconnectGuacamole();
});
</script>

<template>
  <div
    class="remote-desktop-session h-full w-full overflow-hidden bg-black"
    :data-terminal-session-id="props.sessionId"
    tabindex="0"
  >
    <div ref="rdpContainerRef" class="relative h-full w-full overflow-hidden bg-black">
      <div ref="rdpDisplayRef" class="rdp-display-container h-full w-full"></div>
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
.rdp-display-container {
  overflow: hidden;
  position: relative;
}

.rdp-display-container :deep(canvas) {
  z-index: 999;
}
</style>
