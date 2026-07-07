<script setup lang="ts">
import { useRouter } from 'vue-router';
import ConnectionsView from './ConnectionsView.vue';
import SettingsView from './SettingsView.vue';

const router = useRouter();

const closeSettingsOverlay = () => {
  void router.push({ name: 'Connections' });
};
</script>

<template>
  <div class="settings-overlay-view">
    <ConnectionsView />
    <SettingsView is-dialog @close="closeSettingsOverlay" />
  </div>
</template>

<style scoped>
.settings-overlay-view {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
</style>
