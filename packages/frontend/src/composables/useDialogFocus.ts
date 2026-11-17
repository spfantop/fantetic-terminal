import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export const useDialogFocus = ({
  isOpen,
  dialogRef,
  initialFocusRef,
  onEscape,
  ownerDocument = document,
}: {
  isOpen: Readonly<Ref<boolean>>;
  dialogRef: Readonly<Ref<HTMLElement | null | undefined>>;
  initialFocusRef?: Readonly<Ref<HTMLElement | null | undefined>>;
  onEscape: () => void;
  ownerDocument?: Document;
}) => {
  let restoreFocusElement: Element | null = null;

  const readFocusableElements = (): HTMLElement[] => (
    dialogRef.value
      ? Array.from(dialogRef.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
      : []
  );
  const handleKeydown = (event: KeyboardEvent): void => {
    if (!isOpen.value) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onEscape();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusableElements = readFocusableElements();
    if (focusableElements.length === 0) {
      event.preventDefault();
      dialogRef.value?.focus();
      return;
    }
    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && ownerDocument.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && ownerDocument.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  const deactivate = (): void => {
    ownerDocument.removeEventListener('keydown', handleKeydown);
    const target = restoreFocusElement;
    restoreFocusElement = null;
    if (target && 'focus' in target && typeof target.focus === 'function') target.focus();
  };

  watch(isOpen, async open => {
    if (!open) {
      deactivate();
      return;
    }
    restoreFocusElement = ownerDocument.activeElement;
    ownerDocument.addEventListener('keydown', handleKeydown);
    await nextTick();
    initialFocusRef?.value?.focus();
    if (!initialFocusRef?.value) readFocusableElements()[0]?.focus();
  }, { immediate: true });

  onBeforeUnmount(deactivate);
};
