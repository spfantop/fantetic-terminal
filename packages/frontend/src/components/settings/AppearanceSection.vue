<template>
  <div v-if="settings" class="p-4 bg-background text-foreground">
    <div class="max-w-6xl mx-auto">
      <h2 class="text-xl font-semibold text-foreground mb-4 pb-2 border-b border-border">{{ $t('settings.category.appearance') }}</h2>
      <StyleCustomizer embedded />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettingsStore } from '../../stores/settings.store';
import { storeToRefs } from 'pinia';
import StyleCustomizer from '../StyleCustomizer.vue';

const settingsStore = useSettingsStore();
const { settings } = storeToRefs(settingsStore); 
</script>
