export function calculateReplayViewportScale(
  hostWidth: number,
  hostHeight: number,
  contentWidth: number,
  contentHeight: number,
): number {
  if (hostWidth <= 0 || hostHeight <= 0 || contentWidth <= 0 || contentHeight <= 0) return 1;
  return Math.min(1, hostWidth / contentWidth, hostHeight / contentHeight);
}

export function clearTerminalReplayViewport(host: HTMLElement | undefined): void {
  const xtermElement = host?.querySelector<HTMLElement>('.xterm');
  if (!xtermElement) return;
  xtermElement.style.width = '';
  xtermElement.style.height = '';
  xtermElement.style.position = '';
  xtermElement.style.left = '';
  xtermElement.style.top = '';
  xtermElement.style.transform = '';
  xtermElement.style.transformOrigin = '';
}

/**
 * Keeps the recorded terminal grid intact and scales its rendered viewport
 * into the available dialog content box. Resizing the logical grid would alter
 * wrapping and cursor-addressed output from the original session.
 */
export function fitTerminalReplayViewport(host: HTMLElement): void {
  const xtermElement = host.querySelector<HTMLElement>('.xterm');
  const screenElement = host.querySelector<HTMLElement>('.xterm-screen');
  if (!xtermElement || !screenElement) return;

  clearTerminalReplayViewport(host);

  const hostStyle = getComputedStyle(host);
  const hostWidth = host.clientWidth
    - Number.parseFloat(hostStyle.paddingLeft || '0')
    - Number.parseFloat(hostStyle.paddingRight || '0');
  const hostHeight = host.clientHeight
    - Number.parseFloat(hostStyle.paddingTop || '0')
    - Number.parseFloat(hostStyle.paddingBottom || '0');
  const contentWidth = Math.max(screenElement.offsetWidth, screenElement.scrollWidth);
  const contentHeight = Math.max(screenElement.offsetHeight, screenElement.scrollHeight);
  if (hostWidth <= 0 || hostHeight <= 0 || contentWidth <= 0 || contentHeight <= 0) return;

  const scale = calculateReplayViewportScale(hostWidth, hostHeight, contentWidth, contentHeight);
  xtermElement.style.width = `${contentWidth}px`;
  xtermElement.style.height = `${contentHeight}px`;
  xtermElement.style.position = 'absolute';
  xtermElement.style.left = '50%';
  xtermElement.style.top = '50%';
  xtermElement.style.transform = `translate(-50%, -50%) scale(${scale})`;
  xtermElement.style.transformOrigin = 'center';
}
