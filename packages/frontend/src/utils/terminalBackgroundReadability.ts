export interface TerminalBackgroundReadabilityOptions {
  enabled: boolean;
  hasVisualBackground: boolean;
  configuredOverlayOpacity: number;
  terminalThemeBackground?: string;
  hasUserTextEffect: boolean;
}

export interface TerminalBackgroundReadability {
  overlayOpacity: number;
  highlightBackground: string;
  useAutomaticTextShadow: boolean;
}

const MINIMUM_VISUAL_BACKGROUND_OVERLAY_OPACITY = 0.45;
const VISUAL_BACKGROUND_HIGHLIGHT_REFERENCE = '#1e1e1e';

export function resolveTerminalBackgroundReadability(
  options: TerminalBackgroundReadabilityOptions,
): TerminalBackgroundReadability {
  const hasActiveVisualBackground = options.enabled && options.hasVisualBackground;
  const configuredOverlayOpacity = Math.min(1, Math.max(0, options.configuredOverlayOpacity));

  if (!hasActiveVisualBackground) {
    return {
      overlayOpacity: configuredOverlayOpacity,
      highlightBackground: options.terminalThemeBackground ?? VISUAL_BACKGROUND_HIGHLIGHT_REFERENCE,
      useAutomaticTextShadow: false,
    };
  }

  return {
    overlayOpacity: Math.max(configuredOverlayOpacity, MINIMUM_VISUAL_BACKGROUND_OVERLAY_OPACITY),
    highlightBackground: VISUAL_BACKGROUND_HIGHLIGHT_REFERENCE,
    useAutomaticTextShadow: !options.hasUserTextEffect,
  };
}
