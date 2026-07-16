export type AuthBootstrapFailure = 'unauthenticated' | 'unavailable';

type HttpErrorLike = {
  response?: {
    status?: unknown;
  };
};

export const classifyAuthBootstrapFailure = (error: unknown): AuthBootstrapFailure => {
  if (typeof error !== 'object' || error === null) return 'unavailable';
  const status = (error as HttpErrorLike).response?.status;
  return status === 401 ? 'unauthenticated' : 'unavailable';
};
