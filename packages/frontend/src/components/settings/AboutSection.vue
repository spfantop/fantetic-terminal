<template>
  <div class="bg-background border border-border rounded-lg shadow-sm overflow-hidden">
    <h2 class="text-lg font-semibold text-foreground px-6 py-4 border-b border-border bg-header/50">
      {{ $t('settings.category.about') }}
    </h2>
    <div class="p-6 space-y-4">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-text-secondary">
        <span class="font-medium">{{ $t('settings.about.version') }}: {{ appVersion }}</span>
        <span v-if="isCheckingVersion" class="inline-block text-xs px-2 py-0.5 rounded-full bg-primary text-white italic">
          {{ $t('settings.about.checkingUpdate') }}
        </span>
        <span
          v-else-if="versionCheckError"
          class="inline-block text-xs px-2 py-0.5 rounded-full bg-error text-white"
          :title="versionCheckError"
        >
          {{ $t('settings.about.error.checkFailedShort') }}
        </span>
        <span
          v-else-if="!isUpdateAvailable && latestVersion"
          class="inline-block text-xs px-2 py-0.5 rounded-full bg-success text-white"
        >
          {{ $t('settings.about.latestVersion') }}
        </span>
        <a
          v-else-if="isUpdateAvailable && latestVersion"
          :href="`${GITHUB_REPO_URL}/releases/tag/${latestVersion}`"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-warning text-white hover:bg-warning/80"
        >
          <i class="fas fa-download mr-1"></i>
          {{ $t('settings.about.updateAvailable', { version: latestVersion }) }}
        </a>
        <span class="opacity-50">|</span>
        <a :href="GITHUB_REPO_URL" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline inline-flex items-center">
          <i class="fab fa-github mr-1"></i>
          spfantop/fantetic-terminal
        </a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useVersionCheck } from '../../composables/settings/useVersionCheck';
import { GITHUB_REPO_URL } from '../../utils/constants';

const {
  appVersion,
  latestVersion,
  isCheckingVersion,
  versionCheckError,
  isUpdateAvailable,
  checkLatestVersion,
} = useVersionCheck();

onMounted(() => {
  void checkLatestVersion();
});
</script>
