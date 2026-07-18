// packages/frontend/src/stores/session/actions/modalActions.ts

import type { ConnectionInfo } from '../../connections.store'; // 路径: packages/frontend/src/stores/connections.store.ts
import { useGlobalOverlayStore } from '../../globalOverlay.store';

// --- RDP Modal Actions ---
export const openRdpModal = (connection: ConnectionInfo) => {
  if (!useGlobalOverlayStore().openRdpModal(connection)) {
    console.warn('[ModalActions] Electron App 未内置 guacd，已禁用 RDP 弹窗。');
  }
};

export const closeRdpModal = () => {
  useGlobalOverlayStore().closeRdpModal();
};

// --- VNC Modal Actions ---
export const openVncModal = (connection: ConnectionInfo) => {
  if (!useGlobalOverlayStore().openVncModal(connection)) {
    console.warn('[ModalActions] Electron App 未内置 guacd，已禁用 VNC 弹窗。');
  }
};

export const closeVncModal = () => {
  useGlobalOverlayStore().closeVncModal();
};
