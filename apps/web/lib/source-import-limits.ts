export const maxSourceImportBytes = 50 * 1024 * 1024;
export const sourceImportLimitLabel = "50 MB";

export function isSourceImportTooLarge(byteLength: number): boolean {
  return byteLength > maxSourceImportBytes;
}

export function sourceImportTooLargeMessage(): string {
  return `Import content must be ${sourceImportLimitLabel} or smaller.`;
}
