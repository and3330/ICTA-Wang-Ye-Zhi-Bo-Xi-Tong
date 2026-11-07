/** Browser-policy-safe autoplay; a rejection leaves the manual play button usable. */
export async function autoplayRoomMuted(
  player: { setMuted: (muted: boolean) => Promise<void>; play: () => Promise<void> },
  canStart: () => boolean,
): Promise<boolean> {
  if (!canStart()) return false;
  try {
    await player.setMuted(true);
    if (!canStart()) return false;
    await player.play();
    return true;
  } catch {
    return false;
  }
}
