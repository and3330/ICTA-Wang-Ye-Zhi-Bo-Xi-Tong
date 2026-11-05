/**
 * Browsers send multipart filenames as UTF-8, but the upload parser reads them
 * as Latin-1, so "活動.png" arrives as "æ´»å\u008b\u0095.png". Turn such a name
 * back into the text the person saw. Names that are already fine, or that do
 * not decode cleanly, are returned unchanged.
 */
export function repairUtf8Name(name: string): string {
  if (!name || !/[\u0080-ÿ]/.test(name) || /[^\u0000-ÿ]/.test(name)) return name;
  try {
    const bytes = Uint8Array.from(name, (ch) => ch.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return name;
  }
}
