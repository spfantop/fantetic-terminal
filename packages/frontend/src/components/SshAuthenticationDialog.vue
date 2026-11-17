<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SshAuthChallenge } from '@fantetic-terminal/contracts';
import { useDialogFocus } from '../composables/useDialogFocus';

const props = defineProps<{ challenge: SshAuthChallenge; connectionName: string; ownerDocument?: Document }>();
const emit = defineEmits<{ answer: [requestId: string, answers: string[] | null] }>();
const { t } = useI18n();
const dialogRef = ref<HTMLElement | null>(null);
const answers = ref<string[]>([]);
const submitted = ref(false);
watch(() => props.challenge.requestId, () => {
  answers.value = props.challenge.prompts.map(() => '');
  submitted.value = false;
}, { immediate: true });
const cancel = () => {
  if (submitted.value) return;
  submitted.value = true;
  answers.value = [];
  emit('answer', props.challenge.requestId, null);
};
const submit = () => {
  if (submitted.value) return;
  submitted.value = true;
  emit('answer', props.challenge.requestId, [...answers.value]);
  answers.value = [];
};
useDialogFocus({ isOpen: computed(() => true), dialogRef, onEscape: cancel, ownerDocument: props.ownerDocument });
onBeforeUnmount(cancel);
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
    <form ref="dialogRef" role="dialog" aria-modal="true" :aria-label="t('sshAuth.title')" tabindex="-1"
      class="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-lg border border-border bg-background p-6 text-foreground shadow-xl space-y-4"
      @submit.prevent="submit">
      <h2 class="text-lg font-semibold">{{ t('sshAuth.title') }}</h2>
      <p class="break-words">{{ connectionName }} · {{ challenge.username }}</p>
      <p v-if="challenge.name" class="whitespace-pre-wrap break-words">{{ challenge.name }}</p>
      <p v-if="challenge.instructions" class="whitespace-pre-wrap break-words">{{ challenge.instructions }}</p>
      <label v-for="(prompt, index) in challenge.prompts" :key="index" class="block space-y-1">
        <span class="block whitespace-pre-wrap break-words">{{ prompt.prompt || t('sshAuth.response') }}</span>
        <input v-model="answers[index]" :type="prompt.echo ? 'text' : 'password'" autocomplete="off" :spellcheck="false" autocapitalize="off"
          :disabled="submitted" maxlength="4096"
          class="w-full rounded border border-border bg-background px-3 py-2 text-foreground focus:ring-2 focus:ring-primary" />
      </label>
      <p class="text-sm text-text-secondary">{{ t('sshAuth.ephemeral') }}</p>
      <div class="flex justify-end gap-3">
        <button type="button" :disabled="submitted" class="rounded border border-border px-4 py-2" @click="cancel">{{ t('common.cancel') }}</button>
        <button type="submit" :disabled="submitted" class="rounded bg-primary px-4 py-2 text-white disabled:opacity-50">{{ t('common.confirm') }}</button>
      </div>
    </form>
  </div>
</template>
