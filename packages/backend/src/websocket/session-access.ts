import { AuthenticatedWebSocket, ClientState } from './types';

export const readOwnedClientState = (
  states: ReadonlyMap<string, ClientState>,
  ws: AuthenticatedWebSocket,
  sessionId: string,
): ClientState | undefined => {
  const state = states.get(sessionId);
  if (!state || state.ws !== ws || !ws.userId || state.ws.userId !== ws.userId) return undefined;
  return state;
};
