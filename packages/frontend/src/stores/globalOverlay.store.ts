import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ConnectionInfo } from './connections.store';
import { isRemoteDesktopFeatureAvailable } from '../utils/runtimeConfig';

export type PopupFileInfo = {
  filePath: string;
  sessionId: string;
};

export const useGlobalOverlayStore = defineStore('globalOverlay', () => {
  const popupFileInfo = ref<PopupFileInfo | null>(null);
  const popupTrigger = ref(0);
  const isRdpModalOpen = ref(false);
  const rdpConnectionInfo = ref<ConnectionInfo | null>(null);
  const isVncModalOpen = ref(false);
  const vncConnectionInfo = ref<ConnectionInfo | null>(null);

  const openFileEditor = (filePath: string, sessionId: string) => {
    popupFileInfo.value = { filePath, sessionId };
    popupTrigger.value += 1;
  };

  const notifyFileEditor = () => {
    popupTrigger.value += 1;
  };

  const openRdpModal = (connection: ConnectionInfo) => {
    if (!isRemoteDesktopFeatureAvailable()) return false;
    rdpConnectionInfo.value = connection;
    isRdpModalOpen.value = true;
    return true;
  };

  const closeRdpModal = () => {
    isRdpModalOpen.value = false;
    rdpConnectionInfo.value = null;
  };

  const openVncModal = (connection: ConnectionInfo) => {
    if (!isRemoteDesktopFeatureAvailable()) return false;
    vncConnectionInfo.value = connection;
    isVncModalOpen.value = true;
    return true;
  };

  const closeVncModal = () => {
    isVncModalOpen.value = false;
    vncConnectionInfo.value = null;
  };

  return {
    popupFileInfo,
    popupTrigger,
    isRdpModalOpen,
    rdpConnectionInfo,
    isVncModalOpen,
    vncConnectionInfo,
    openFileEditor,
    notifyFileEditor,
    openRdpModal,
    closeRdpModal,
    openVncModal,
    closeVncModal,
  };
});
