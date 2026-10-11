/** Browser preparation only. The server independently meters and hashes all bytes. */
export async function prepareArchiveInput(file: Blob, maxBytes: number) {
  if (file.size < 1 || file.size > maxBytes)
    throw new Error("ARCHIVE_SIZE_INVALID");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return {
    expectedArchiveSha256: Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
    expectedArchiveBytes: file.size,
    target: { kind: "new-draft" as const },
  };
}
export async function prepareArchive(file: Blob, maxBytes: number) {
  const input = await prepareArchiveInput(file, maxBytes);
  return { file, idempotencyKey: crypto.randomUUID(), input };
}
export type PendingArchive = Awaited<ReturnType<typeof prepareArchive>>;
