import { computed, nextTick, ref } from 'vue';
import type { ComposerTranslation } from 'vue-i18n';
import { useAppearanceStore } from '../stores/appearance.store';
import { useUiNotificationsStore } from '../stores/uiNotifications.store';

const THEME_REVEAL_DURATION = 680;

type ViewTransitionLike = {
  ready: Promise<void>;
  finished: Promise<void>;
  updateCallbackDone: Promise<void>;
  skipTransition: () => void;
};

type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => ViewTransitionLike;
};

type ThemeMode = 'default' | 'dark';

const shouldReduceThemeMotion = () => {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

const getThemeRevealOrigin = (event?: MouseEvent) => {
  const target = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  if (event && event.detail > 0) {
    return { x: event.clientX, y: event.clientY };
  }

  if (target) {
    const rect = target.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  return {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  };
};

const getThemeRevealClipPath = (x: number, y: number) => {
  const farthestX = Math.max(x, window.innerWidth - x);
  const farthestY = Math.max(y, window.innerHeight - y);
  const radius = Math.ceil(Math.hypot(farthestX, farthestY));

  return {
    from: `circle(0px at ${x}px ${y}px)`,
    to: `circle(${radius}px at ${x}px ${y}px)`,
  };
};

const runThemeRevealTransition = async <T,>(event: MouseEvent | undefined, updateTheme: () => Promise<T>) => {
  const transitionDocument = document as DocumentWithViewTransition;
  if (!transitionDocument.startViewTransition || shouldReduceThemeMotion()) {
    return updateTheme();
  }

  const { x, y } = getThemeRevealOrigin(event);
  const { from, to } = getThemeRevealClipPath(x, y);
  const root = document.documentElement;
  let updateResult: T | undefined;
  const transitionAnimationOptions: KeyframeAnimationOptions & { pseudoElement?: string } = {
    duration: THEME_REVEAL_DURATION,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    pseudoElement: '::view-transition-new(root)',
  };

  root.classList.add('theme-radial-reveal-active');
  const transition = transitionDocument.startViewTransition(async () => {
    updateResult = await updateTheme();
    await nextTick();
  });

  const revealAnimation = transition.ready
    .then(() => root.animate({ clipPath: [from, to] }, transitionAnimationOptions).finished)
    .catch(() => undefined);

  try {
    await transition.updateCallbackDone;
    await revealAnimation;
    await transition.finished.catch(() => undefined);
  } finally {
    root.classList.remove('theme-radial-reveal-active');
  }

  return updateResult as T;
};

export const useThemeToggle = (t: ComposerTranslation) => {
  const appearanceStore = useAppearanceStore();
  const uiNotificationsStore = useUiNotificationsStore();
  const isSwitchingTheme = ref(false);

  const isDarkUiThemeActive = computed(() => {
    return appearanceStore.currentUiThemeMode === 'dark';
  });

  const themeToggleLabel = computed(() => (
    isDarkUiThemeActive.value
      ? t('dock.themeToDefault', '默认模式')
      : t('dock.themeToDark', '暗黑模式')
  ));

  const applyThemeToggle = async (): Promise<ThemeMode> => {
    if (isDarkUiThemeActive.value) {
      await appearanceStore.setUiThemeMode('default');
      return 'default';
    }

    await appearanceStore.setUiThemeMode('dark');
    return 'dark';
  };

  const toggleTheme = async (event?: MouseEvent) => {
    if (isSwitchingTheme.value) return;

    isSwitchingTheme.value = true;
    try {
      const appliedMode = await runThemeRevealTransition(event, applyThemeToggle);
      if (appliedMode === 'default') {
        uiNotificationsStore.showInfo(t('dock.defaultThemeApplied', '已切换到默认模式'));
      } else {
        uiNotificationsStore.showSuccess(t('dock.darkThemeApplied', '已切换到暗黑模式'));
      }
    } catch (error: any) {
      console.error('[ThemeToggle] Failed to toggle theme:', error);
      uiNotificationsStore.showError(t('styleCustomizer.themeModeSwitchFailed', { message: error.message || t('common.error', '未知错误') }));
    } finally {
      isSwitchingTheme.value = false;
    }
  };

  return {
    isDarkUiThemeActive,
    isSwitchingTheme,
    themeToggleLabel,
    toggleTheme,
  };
};
