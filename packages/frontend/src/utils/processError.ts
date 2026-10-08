export function resolveProcessErrorMessage(message: string | undefined, translatedFallback: string): string {
  return !message || message === 'PROCESS_STATISTICS_UNAVAILABLE' ? translatedFallback : message;
}
