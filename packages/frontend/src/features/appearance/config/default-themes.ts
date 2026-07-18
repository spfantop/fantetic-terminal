import type { ITheme } from '@xterm/xterm';

// 默认 xterm 主题
// (与 backend/src/config/default-themes.ts 中的定义保持一致)
export const defaultXtermTheme: ITheme = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  selectionBackground: '#264f78', // 使用 selectionBackground
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5'
};

export const darkXtermTheme: ITheme = defaultXtermTheme;

export const lightXtermTheme: ITheme = {
  background: '#ffffff',
  foreground: '#1f2937',
  cursor: '#111827',
  selectionBackground: '#bfdbfe',
  black: '#000000',
  red: '#b91c1c',
  green: '#047857',
  yellow: '#a16207',
  blue: '#1d4ed8',
  magenta: '#7e22ce',
  cyan: '#0e7490',
  white: '#e5e7eb',
  brightBlack: '#4b5563',
  brightRed: '#dc2626',
  brightGreen: '#059669',
  brightYellow: '#ca8a04',
  brightBlue: '#2563eb',
  brightMagenta: '#9333ea',
  brightCyan: '#0891b2',
  brightWhite: '#f9fafb',
};

// 默认 UI 主题 (CSS 变量)
// (与 backend/src/config/default-themes.ts 中的定义保持一致)
export const defaultUiTheme: Record<string, string> = {
  '--app-bg-color': '#ffffff',
  '--text-color': '#333333',
  '--text-color-secondary': '#666666',
  '--border-color': '#d1d5db',
  '--link-color': '#1f2937',
  '--link-hover-color': '#374151',
  '--link-active-color': '#111827',
  '--link-active-bg-color': '#f3f4f6',
  '--nav-item-active-bg-color': 'var(--link-active-bg-color)', /* Added */
  '--header-bg-color': '#f8fafc',
  '--footer-bg-color': '#f8fafc',
  '--button-bg-color': '#111827',
  '--button-text-color': '#ffffff',
  '--button-hover-bg-color': '#374151',
  '--icon-color': 'var(--text-color-secondary)', // 图标颜色
  '--icon-hover-color': 'var(--link-hover-color)', // 图标悬停颜色 (自动更新)
  '--split-line-color': 'var(--border-color)', /* 分割线颜色 */
  '--split-line-hover-color': 'var(--border-color)', /* 分割线悬停颜色 */
  '--input-focus-border-color': 'var(--link-active-color)', /* 输入框聚焦边框颜色 (自动更新) */
  '--input-focus-glow': 'var(--link-active-color)', /* 输入框聚焦光晕值 (自动更新) */
  '--overlay-bg-color': 'rgba(0, 0, 0, 0.6)', /* Added Overlay Background - 恢复 rgba 以支持透明度 */
  '--font-family-sans-serif': 'sans-serif',
  '--base-padding': '1rem',
  '--base-margin': '0.5rem',
};

export const darkUiTheme: Record<string, string> = {
  '--app-bg-color': '#050505',
  '--text-color': '#f5f5f5',
  '--text-color-secondary': '#a3a3a3',
  '--border-color': '#262626',
  '--link-color': '#d4d4d4',
  '--link-hover-color': '#93c5fd',
  '--link-active-color': '#2563eb',
  '--link-active-bg-color': 'rgba(37, 99, 235, 0.18)',
  '--nav-item-active-bg-color': 'var(--link-active-bg-color)',
  '--header-bg-color': '#111111',
  '--footer-bg-color': '#111111',
  '--button-bg-color': '#2563eb',
  '--button-text-color': '#ffffff',
  '--button-hover-bg-color': '#1d4ed8',
  '--icon-color': 'var(--text-color-secondary)',
  '--icon-hover-color': 'var(--link-hover-color)',
  '--split-line-color': 'var(--border-color)',
  '--split-line-hover-color': 'var(--border-color)',
  '--input-focus-border-color': 'var(--link-active-color)',
  '--input-focus-glow': 'var(--link-active-color)',
  '--overlay-bg-color': 'rgba(0, 0, 0, 0.86)',
  '--color-success': '#22c55e',
  '--color-error': '#ef4444',
  '--color-warning': '#f59e0b',
  '--font-family-sans-serif': 'sans-serif',
  '--base-padding': '1rem',
  '--base-margin': '0.5rem',
};
