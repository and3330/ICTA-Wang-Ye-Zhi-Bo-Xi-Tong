export type WatchState = {
  selectedSession?: string | null;
  waitUntil?: string | null;
  vimeoUrl?: string | null;
  canWatch: boolean;
};

const tokenKey = (webinarId: string) => `icta_watch_token_${webinarId}`;
const stateKey = (webinarId: string) => `icta_watch_state_${webinarId}`;

export function saveWatchAccess(webinarId: string, response: any) {
  if (response?.watchToken) sessionStorage.setItem(tokenKey(webinarId), response.watchToken);
  if (response?.watchState) sessionStorage.setItem(stateKey(webinarId), JSON.stringify(response.watchState));
}

export function getWatchToken(webinarId?: string) {
  if (!webinarId) return null;
  return new URLSearchParams(window.location.search).get("watchToken") || sessionStorage.getItem(tokenKey(webinarId));
}

export function getStoredWatchState(webinarId?: string): WatchState | null {
  if (!webinarId) return null;
  try {
    const value = sessionStorage.getItem(stateKey(webinarId));
    return value ? JSON.parse(value) as WatchState : null;
  } catch { return null; }
}

export function watchUrl(path: string, webinarId: string, token?: string | null) {
  const url = new URL(path, window.location.origin);
  if (token) url.searchParams.set("watchToken", token);
  return url.toString();
}