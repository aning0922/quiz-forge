import { expect, it } from "vitest";
import type { Stats } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  measuredStorageQuota,
  requireQuota,
  requireStorageCapacity,
  type HeldStorageRow,
} from "../import/quota";
import { storageScanKey, type Scan } from "../import/storage";
import { VALIDATION_RESERVATION_BYTES } from "./limits";
const hash = "e".repeat(64);
function scan(): Scan {
  return { bytes: 0, entries: 3, files: new Map() };
}
function row(
  namespace: "imports" | "validation",
  id: string = randomUUID(),
): HeldStorageRow {
  return {
    namespace,
    id,
    reservedBytes: VALIDATION_RESERVATION_BYTES,
    attempts: [
      {
        attemptId: id,
        reservationBytes: VALIDATION_RESERVATION_BYTES,
        disposition: "held",
      },
    ],
    assetBlobHashes: null,
  };
}
function fact(file: string, size: number) {
  return { file, size, inode: {} as Stats };
}
it("same UUID and same attempt in another namespace cannot offset held reservation", () => {
  const imports = row("imports"),
    validation = row("validation", imports.id),
    value = scan();
  value.files.set(storageScanKey("imports", imports.id), [
    fact(`attempt-${imports.id}.partial`, 100),
  ]);
  value.bytes = 100;
  expect(measuredStorageQuota(value, [imports, validation])).toBe(
    2 * VALIDATION_RESERVATION_BYTES,
  );
  expect(measuredStorageQuota(value, [validation])).toBe(
    VALIDATION_RESERVATION_BYTES + 100,
  );
});
it("shared blobs and orphan files count as bytes, never as another attempt's partial", () => {
  const validation = row("validation"),
    value = scan();
  value.files.set(storageScanKey("blobs", hash), [fact(`${hash}.blob`, 100)]);
  value.bytes = 100;
  expect(measuredStorageQuota(value, [validation])).toBe(
    VALIDATION_RESERVATION_BYTES + 100,
  );
  expect(measuredStorageQuota(value, [])).toBe(100);
  expect(() =>
    requireQuota(
      measuredStorageQuota(
        value,
        Array.from({ length: 4 }, () => row("validation")),
      ),
    ),
  ).toThrow("RECEIVE_QUOTA_EXCEEDED");
  // Reconciliation can still measure an over-cap ledger without invoking admission.
  expect(
    measuredStorageQuota(
      value,
      Array.from({ length: 4 }, () => row("validation")),
    ),
  ).toBeGreaterThan(536870912);
});
it("unlanded unknown validation holds 64 future names against receive admission", () => {
  const value = scan(),
    held = row("validation");
  for (let i = 0; i < 4032; i++)
    value.files.set(
      storageScanKey("blobs", i.toString(16).padStart(64, "0")),
      [],
    );
  requireStorageCapacity(value, [held], {
    namespace: "imports",
    id: randomUUID(),
    assetBlobHashes: null,
  });
  value.files.set(storageScanKey("blobs", hash), []);
  expect(() =>
    requireStorageCapacity(value, [held], {
      namespace: "imports",
      id: randomUUID(),
      assetBlobHashes: null,
    }),
  ).toThrow("RECEIVE_SCAN_LIMIT");
});
it("known plans union blob names but do not discount byte reservations", () => {
  const value = scan(),
    first = { ...row("validation"), assetBlobHashes: [hash] },
    second = { ...row("validation"), assetBlobHashes: [hash] };
  for (let i = 0; i < 4095; i++)
    value.files.set(
      storageScanKey("blobs", i.toString(16).padStart(64, "0")),
      [],
    );
  requireStorageCapacity(value, [first, second], {
    namespace: "imports",
    id: randomUUID(),
    assetBlobHashes: null,
  });
  expect(measuredStorageQuota(value, [first, second])).toBe(
    2 * VALIDATION_RESERVATION_BYTES,
  );
  value.files.set(storageScanKey("blobs", hash), []);
  requireStorageCapacity(value, [first, second], {
    namespace: "validation",
    id: randomUUID(),
    assetBlobHashes: [hash],
  });
  expect(() =>
    requireStorageCapacity(value, [first, second], {
      namespace: "validation",
      id: randomUUID(),
      assetBlobHashes: null,
    }),
  ).toThrow("VALIDATION_SCAN_LIMIT");
});
it("holds unseen directories separately and reserves receipt/partial names plus total entries", () => {
  const value = scan();
  for (let i = 0; i < 1023; i++)
    value.files.set(storageScanKey("validation", randomUUID()), []);
  const held = row("validation");
  requireStorageCapacity(value, [held], {
    namespace: "imports",
    id: held.id,
    assetBlobHashes: null,
  });
  expect(() =>
    requireStorageCapacity(value, [held], {
      namespace: "validation",
      id: randomUUID(),
      assetBlobHashes: null,
    }),
  ).toThrow("VALIDATION_SCAN_LIMIT");
  const exact = { ...scan(), entries: 8124 };
  requireStorageCapacity(exact, [], {
    namespace: "validation",
    id: randomUUID(),
    assetBlobHashes: null,
  });
  expect(() =>
    requireStorageCapacity({ ...exact, entries: 8125 }, [], {
      namespace: "validation",
      id: randomUUID(),
      assetBlobHashes: null,
    }),
  ).toThrow("VALIDATION_SCAN_LIMIT");
});
it("duplicate held rows and inconsistent reservations fail closed", () => {
  const held = row("validation");
  expect(() => measuredStorageQuota(scan(), [held, held])).toThrow(
    "RECEIVE_STORAGE_CONFLICT",
  );
  expect(() =>
    measuredStorageQuota(scan(), [
      { ...held, reservedBytes: held.reservedBytes - 1 },
    ]),
  ).toThrow("RECEIVE_STORAGE_CONFLICT");
});
