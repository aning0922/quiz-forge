export interface LinuxFiles {
  hash(bytes: Uint8Array | string): string;
  privateDir(path: string): Promise<void>;
  writePrivate(path: string, bytes: Uint8Array | string): Promise<void>;
  readPrivate(path: string, limit?: number): Promise<Buffer>;
}
export function createLinuxFiles(location: {
  checkoutRoot: string;
  stateRoot: string;
}): LinuxFiles;
