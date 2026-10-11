/** Browser preparation only. The server independently meters and hashes all bytes. */
export async function prepareArchive(file: Blob, maxBytes: number) {
  if (file.size < 1 || file.size > maxBytes)
    throw new Error("ARCHIVE_SIZE_INVALID");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return {
    file,
    idempotencyKey: crypto.randomUUID(),
    input: {
      expectedArchiveSha256: Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
      expectedArchiveBytes: file.size,
      target: { kind: "new-draft" as const },
    },
  };
}
export type PendingArchive = Awaited<ReturnType<typeof prepareArchive>>;
