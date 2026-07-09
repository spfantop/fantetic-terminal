<script setup lang="ts">
import { ref, watch } from 'vue';
import { getServerIconPath, readServerIconOption } from '../utils/serverIcons';

const props = defineProps<{
  icon?: string | null;
  type?: 'SSH' | 'RDP' | 'VNC' | 'TELNET';
  title?: string;
}>();

const iconPath = ref(getServerIconPath(props.icon, props.type));

watch(
  () => [props.icon, props.type] as const,
  async ([icon, type]) => {
    iconPath.value = getServerIconPath(icon, type);
    const option = await readServerIconOption(icon, type);
    if (props.icon === icon && props.type === type) {
      iconPath.value = option.path;
    }
  },
  { immediate: true }
);
</script>

<template>
  <svg
    class="server-mdi-icon"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <title v-if="title">{{ title }}</title>
    <path :d="iconPath" />
  </svg>
</template>

<style scoped>
.server-mdi-icon {
  display: block;
  width: 1em;
  height: 1em;
  fill: currentColor;
  flex-shrink: 0;
}
</style>
