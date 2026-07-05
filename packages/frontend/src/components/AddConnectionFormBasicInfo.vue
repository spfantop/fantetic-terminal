<script setup lang="ts">
import { ref, nextTick, Teleport, computed, onBeforeUnmount, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ConnectionFolderInfo } from '../stores/connections.store';
import ServerIcon from './ServerIcon.vue';
import {
  getServerIconOption,
  searchServerIconOptions,
  serverIconOptions,
  type ServerIconOption,
} from '../utils/serverIcons';

// Define Props. formData is expected to be a reactive object from the parent composable.
const props = defineProps<{
  formData: {
    name: string;
    type: 'SSH' | 'RDP' | 'VNC';
    folder_id: number | null;
    icon: string;
    host: string;
    port: number;
  };
  folders: ConnectionFolderInfo[];
  isFolderLoading: boolean;
}>();

const { t } = useI18n();
const iconChooserRef = ref<HTMLElement | null>(null);
const iconSearchInputRef = ref<HTMLInputElement | null>(null);
const isIconChooserOpen = ref(false);
const iconSearchTerm = ref('');
const filteredIconOptions = ref<ServerIconOption[]>(serverIconOptions);

const selectedIconOption = computed(() =>
  getServerIconOption(props.formData.icon, props.formData.type)
);

const toggleIconChooser = async () => {
  isIconChooserOpen.value = !isIconChooserOpen.value;
  if (isIconChooserOpen.value) {
    await nextTick();
    iconSearchInputRef.value?.focus();
  }
};

const selectIcon = (iconKey: string) => {
  props.formData.icon = iconKey;
  iconSearchTerm.value = '';
  isIconChooserOpen.value = false;
};

const closeIconChooserOnOutsideClick = (event: MouseEvent) => {
  if (!isIconChooserOpen.value) return;
  const target = event.target as Node | null;
  if (target && iconChooserRef.value?.contains(target)) return;
  isIconChooserOpen.value = false;
};

watch(isIconChooserOpen, (open) => {
  if (open) {
    document.addEventListener('click', closeIconChooserOnOutsideClick, true);
  } else {
    document.removeEventListener('click', closeIconChooserOnOutsideClick, true);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('click', closeIconChooserOnOutsideClick, true);
});

watch(iconSearchTerm, async (term) => {
  const result = await searchServerIconOptions(term);
  if (iconSearchTerm.value === term) {
    filteredIconOptions.value = result;
  }
}, { immediate: true });

const folderOptions = computed(() => {
  const folderMap = new Map(props.folders.map(folder => [folder.id, folder]));
  const childrenByParent = new Map<number | null, ConnectionFolderInfo[]>();
  props.folders.forEach((folder) => {
    const parentId = folder.parent_id ?? null;
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), folder]);
  });
  childrenByParent.forEach(children => {
    children.sort((a, b) => {
      const orderA = typeof a.sort_order === 'number' ? a.sort_order : Number.MAX_SAFE_INTEGER;
      const orderB = typeof b.sort_order === 'number' ? b.sort_order : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    });
  });

  const options: Array<{ id: number; label: string }> = [];
  const visited = new Set<number>();
  const appendChildren = (parentId: number | null, depth: number) => {
    (childrenByParent.get(parentId) ?? []).forEach((folder) => {
      if (visited.has(folder.id)) return;
      visited.add(folder.id);
      options.push({
        id: folder.id,
        label: `${'　'.repeat(depth)}${depth > 0 ? '└ ' : ''}${folder.name}`,
      });
      appendChildren(folder.id, depth + 1);
    });
  };

  appendChildren(null, 0);
  props.folders
    .filter(folder => !visited.has(folder.id) && (!folder.parent_id || !folderMap.has(folder.parent_id)))
    .forEach(folder => {
      visited.add(folder.id);
      options.push({ id: folder.id, label: folder.name });
      appendChildren(folder.id, 1);
    });

  return options;
});

// Tooltip state and refs for the host input
const showHostTooltip = ref(false);
const hostTooltipStyle = ref({});
const hostIconRef = ref<HTMLElement | null>(null);
const hostTooltipContentRef = ref<HTMLElement | null>(null);

const handleHostIconMouseEnter = async () => {
  showHostTooltip.value = true;
  await nextTick(); // Wait for DOM update so tooltipRect can be calculated

  if (hostIconRef.value && hostTooltipContentRef.value) {
    const iconRect = hostIconRef.value.getBoundingClientRect();
    const tooltipRect = hostTooltipContentRef.value.getBoundingClientRect();

    let top = iconRect.top - tooltipRect.height - 8; // 8px offset above the icon
    let left = iconRect.left + (iconRect.width / 2) - (tooltipRect.width / 2); // Center the tooltip

    // Boundary checks to keep tooltip within viewport
    if (top < 0) { // If not enough space on top, show below
      top = iconRect.bottom + 8;
    }
    if (left < 0) {
      left = 0;
    }
    if (left + tooltipRect.width > window.innerWidth) {
      left = window.innerWidth - tooltipRect.width;
    }

    hostTooltipStyle.value = {
      position: 'fixed', // Ensure positioning is relative to viewport
      top: `${top}px`,
      left: `${left}px`,
    };
  }
};

const handleHostIconMouseLeave = () => {
  showHostTooltip.value = false;
};
</script>

<template>
  <Teleport to="body">
    <div
      v-if="showHostTooltip"
      ref="hostTooltipContentRef"
      :style="hostTooltipStyle"
      class="fixed w-max max-w-xs p-2 text-xs text-white bg-gray-800 rounded shadow-lg z-[1000] whitespace-pre-wrap pointer-events-none"
      role="tooltip"
    >
      {{ t('connections.form.hostTooltip', '支持 IP 范围, 例如 192.168.1.10~192.168.1.15 (仅限添加模式)') }}
    </div>
  </Teleport>
  <!-- Basic Info Section -->
  <div class="space-y-4 p-4 border border-border rounded-md bg-header/30">
    <h4 class="text-base font-semibold mb-3 pb-2 border-b border-border/50">{{ t('connections.form.sectionBasic', '基本信息') }}</h4>
    <div>
      <label for="conn-name" class="block text-sm font-medium text-text-secondary mb-1">{{ t('connections.form.name') }} ({{ t('connections.form.optional') }})</label>
      <input type="text" id="conn-name" v-model="props.formData.name"
             class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary" />
    </div>
    <div>
      <label for="conn-folder" class="block text-sm font-medium text-text-secondary mb-1">{{ t('connections.form.folder', '文件夹') }} ({{ t('connections.form.optional') }})</label>
      <select
        id="conn-folder"
        v-model="props.formData.folder_id"
        :disabled="props.isFolderLoading"
        class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
      >
        <option :value="null">{{ t('connections.folders.noFolder', '默认文件夹') }}</option>
        <option v-for="folder in folderOptions" :key="folder.id" :value="folder.id">
          {{ folder.label }}
        </option>
      </select>
    </div>
    <div>
      <label class="block text-sm font-medium text-text-secondary mb-1">{{ t('connections.form.icon', '图标') }}</label>
      <div ref="iconChooserRef" class="server-icon-chooser">
        <button
          type="button"
          class="server-icon-chooser__trigger"
          :title="selectedIconOption.fallbackLabel"
          @click="toggleIconChooser"
        >
          <span class="server-icon-chooser__selected">
            <ServerIcon :icon="selectedIconOption.key" />
            <span>{{ selectedIconOption.fallbackLabel }}</span>
          </span>
          <i class="fas fa-chevron-down server-icon-chooser__chevron"></i>
        </button>

        <div v-if="isIconChooserOpen" class="server-icon-chooser__dropdown">
          <div class="server-icon-chooser__search">
            <i class="fas fa-search"></i>
            <input
              ref="iconSearchInputRef"
              v-model="iconSearchTerm"
              type="text"
              :placeholder="t('common.iconChooser.searchIcons', '搜索图标')"
              @keydown.esc.prevent="isIconChooserOpen = false"
            />
            <button
              v-if="iconSearchTerm"
              type="button"
              class="server-icon-chooser__clear"
              @click="iconSearchTerm = ''"
            >
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div class="server-icon-chooser__label">
            {{
              iconSearchTerm
                ? t('common.iconChooser.searchResults', '搜索结果')
                : t('common.iconChooser.popularIcons', '常用图标')
            }}
            ({{ filteredIconOptions.length }})
          </div>
          <div class="server-icon-chooser__grid">
            <button
              v-for="iconOption in filteredIconOptions"
              :key="iconOption.key"
              type="button"
              :class="[
                'server-icon-chooser__item',
                props.formData.icon === iconOption.key ? 'server-icon-chooser__item--selected' : ''
              ]"
              :title="iconOption.fallbackLabel"
              @click="selectIcon(iconOption.key)"
            >
              <ServerIcon :icon="iconOption.key" />
            </button>
            <div v-if="filteredIconOptions.length === 0" class="server-icon-chooser__empty">
              {{ t('common.iconChooser.noResults', '没有找到匹配的图标') }}
            </div>
          </div>
        </div>
      </div>
    </div>
    <!-- Connection Type -->
    <div>
      <label class="block text-sm font-medium text-text-secondary mb-1">{{ t('connections.form.connectionType', '连接类型') }}</label>
      <div class="flex rounded-md shadow-sm">
        <button type="button"
                @click="props.formData.type = 'SSH'"
                :class="['flex-1 px-3 py-2 border border-border text-sm font-medium focus:outline-none',
                         props.formData.type === 'SSH' ? 'bg-primary text-white' : 'bg-background text-foreground hover:bg-border',
                         'rounded-l-md']">
          {{ t('connections.form.typeSsh', 'SSH') }}
        </button>
        <button type="button"
                @click="props.formData.type = 'RDP'"
                :class="['flex-1 px-3 py-2 border-t border-b border-r border-border text-sm font-medium focus:outline-none -ml-px',
                         props.formData.type === 'RDP' ? 'bg-primary text-white' : 'bg-background text-foreground hover:bg-border']">
          {{ t('connections.form.typeRdp', 'RDP') }}
        </button>
        <button type="button"
                @click="props.formData.type = 'VNC'"
                :class="['flex-1 px-3 py-2 border border-border text-sm font-medium focus:outline-none -ml-px',
                         props.formData.type === 'VNC' ? 'bg-primary text-white' : 'bg-background text-foreground hover:bg-border',
                         'rounded-r-md']">
          {{ t('connections.form.typeVnc', 'VNC') }}
        </button>
      </div>
    </div>
    <!-- Host and Port Row -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="md:col-span-2">
        <label for="conn-host" class="block text-sm font-medium text-text-secondary mb-1">
          {{ t('connections.form.host') }}
          <span class="relative ml-1" @mouseenter="handleHostIconMouseEnter" @mouseleave="handleHostIconMouseLeave">
            <i ref="hostIconRef" class="fas fa-exclamation-circle text-text-secondary cursor-help"></i>
          </span>
        </label>
        <input type="text" id="conn-host" v-model="props.formData.host" required
               class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary" />
      </div>
      <div>
        <label for="conn-port" class="block text-sm font-medium text-text-secondary mb-1">{{ t('connections.form.port') }}</label>
        <input type="number" id="conn-port" v-model.number="props.formData.port" required min="1" max="65535"
               class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.server-icon-chooser {
  position: relative;
  user-select: none;
}

.server-icon-chooser__trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  min-height: 2.5rem;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--app-bg-color);
  color: var(--text-color);
  padding: 0.55rem 0.75rem;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.server-icon-chooser__trigger:hover,
.server-icon-chooser__trigger:focus-visible {
  border-color: var(--link-active-color);
  background: var(--header-bg-color);
  outline: none;
}

.server-icon-chooser__selected {
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
  min-width: 0;
}

.server-icon-chooser__selected :deep(svg),
.server-icon-chooser__item :deep(svg) {
  width: 1.15rem;
  height: 1.15rem;
}

.server-icon-chooser__selected span {
  overflow: hidden;
  color: var(--text-color-secondary);
  font-size: 0.86rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-icon-chooser__chevron {
  color: var(--text-color-secondary);
  font-size: 0.75rem;
}

.server-icon-chooser__dropdown {
  position: absolute;
  z-index: 80;
  top: calc(100% + 0.4rem);
  left: 0;
  width: min(23rem, 100%);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--app-bg-color);
  box-shadow: var(--shadow-lg, 0 16px 40px rgba(0, 0, 0, 0.22));
  padding: 0.5rem;
}

.server-icon-chooser__search {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  border-bottom: 1px solid var(--border-color);
  padding: 0.45rem 0.5rem 0.65rem;
}

.server-icon-chooser__search > i {
  color: var(--text-color-secondary);
  font-size: 0.82rem;
}

.server-icon-chooser__search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--text-color);
  font-size: 0.88rem;
  outline: none;
}

.server-icon-chooser__search input::placeholder {
  color: var(--text-color-secondary);
}

.server-icon-chooser__clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 6px;
  color: var(--text-color-secondary);
}

.server-icon-chooser__clear:hover {
  background: var(--header-bg-color);
  color: var(--text-color);
}

.server-icon-chooser__label {
  color: var(--text-color-secondary);
  font-size: 0.72rem;
  font-weight: 700;
  padding: 0.55rem 0.4rem 0.35rem;
}

.server-icon-chooser__grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0.38rem;
  max-height: 17.5rem;
  overflow-y: auto;
  padding: 0.25rem;
}

.server-icon-chooser__item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--text-color);
  transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}

.server-icon-chooser__item:hover,
.server-icon-chooser__item:focus-visible {
  background: var(--header-bg-color);
  outline: none;
}

.server-icon-chooser__item--selected {
  border-color: var(--link-active-color);
  background: color-mix(in srgb, var(--link-active-color) 15%, transparent);
  color: var(--link-active-color);
}

.server-icon-chooser__empty {
  grid-column: 1 / -1;
  padding: 1.5rem 0.75rem;
  color: var(--text-color-secondary);
  font-size: 0.84rem;
  text-align: center;
}
</style>
