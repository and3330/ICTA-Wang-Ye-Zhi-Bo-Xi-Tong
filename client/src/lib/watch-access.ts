export type WatchState = {
  registrationId?: string;
  /** The name the viewer registered with, used to prefill the chat name. */
  viewerName?: string | null;
  selectedSession?: string | null;
  waitUntil?: string | null;
  vimeoUrl?: string | null;
  playback?: {
    provider: "vimeo" | "bunny";
    url?: string;
    embedUrl?: string;
    videoId?: string;
    libraryId?: string;
    expiresAt?: string;
    assetId?: string;
  } | null;
  canWatch: boolean;
  accessRevoked?: boolean;
};

export async function fetchWatchState(webinarId: string, watchToken: string): Promise<WatchState> {
  const response = await fetch(
    `/api/webinars/${encodeURIComponent(webinarId)}/watch-state?watchToken=${encodeURIComponent(watchToken)}`,
    { credentials: "include" },
  );
  if ([401, 403, 404].includes(response.status)) {
    return { canWatch: false, accessRevoked: true };
  }
  if (!response.ok) throw new Error("Unable to verify webinar access");
  return response.json();
}

const tokenKey = (webinarId: string) => `icta_watch_token_${webinarId}`;
const stateKey = (webinarId: string) => `icta_watch_state_${webinarId}`;

export function saveWatchAccess(webinarId: string, response: any) {
  try {
    if (response?.watchToken) sessionStorage.setItem(tokenKey(webinarId), response.watchToken);
    if (response?.watchState) sessionStorage.setItem(stateKey(webinarId), JSON.stringify(response.watchState));
  } catch {
    // Storage is only a convenience cache. The success page retains the new
    // token in memory and explicitly includes it in the viewer navigation.
  }
}

export function getWatchToken(webinarId?: string) {
  if (!webinarId) return null;
  const urlToken = new URLSearchParams(window.location.search).get("watchToken");
  if (urlToken) return urlToken;
  try { return sessionStorage.getItem(tokenKey(webinarId)); }
  catch { return null; }
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