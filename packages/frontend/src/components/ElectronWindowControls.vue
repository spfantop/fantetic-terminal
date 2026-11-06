<script setup lang="ts">
import { readRuntimeConfigEnv } from '../utils/runtimeConfig';
import { useI18n } from 'vue-i18n';

type ElectronWindowApi = {
  minimizeWindow?: () => void;
  toggleMaximizeWindow?: () => void;
  closeWindow?: () => void;
};

const electronApi = (window as Window & { electronAPI?: ElectronWindowApi }).electronAPI;
const isElectron = readRuntimeConfigEnv().isElectron;
const { t } = useI18n();

const minimizeWindow = () => electronApi?.minimizeWindow?.();
const toggleMaximizeWindow = () => electronApi?.toggleMaximizeWindow?.();
const closeWindow = () => electronApi?.closeWindow?.();
</script>

<template>
  <div v-if="isElectron" class="electron-window-controls" :aria-label="t('common.windowControls')">
    <div class="electron-window-drag-region" aria-hidden="true"></div>
    <button type="button" class="electron-window-button" :aria-label="t('common.minimize')" :title="t('common.minimize')" @click="minimizeWindow">
      <span aria-hidden="true">−</span>
    </button>
    <button type="button" class="electron-window-button" :aria-label="t('common.maximize')" :title="t('common.maximize')" @click="toggleMaximizeWindow">
      <span aria-hidden="true">□</span>
    </button>
    <button type="button" class="electron-window-button electron-window-close" :aria-label="t('common.close')" :title="t('common.close')" @click="closeWindow">
      <span aria-hidden="true">×</span>
    </button>
  </div>
</template>

<style scoped>
.electron-window-controls {
  position: relative;
  z-index: 2000;
  display: flex;
  flex: 0 0 2rem;
  height: 2rem;
  background: var(--app-bg-color);
  color: var(--text-color);
  -webkit-app-region: no-drag;
}

.electron-window-drag-region {
  flex: 1;
  min-width: 0;
  -webkit-app-region: drag;
}

.electron-window-button {
  display: grid;
  width: 2.75rem;
  height: 2rem;
  place-items: center;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text-color-secondary);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  -webkit-app-region: no-drag;
}

.electron-window-button:hover,
.electron-window-button:focus-visible {
  background: var(--nav-item-active-bg-color);
  color: var(--text-color);
  outline: none;
}

.electron-window-close:hover,
.electron-window-close:focus-visible {
  background: #c42b1c;
  color: #fff;
}
</style>
