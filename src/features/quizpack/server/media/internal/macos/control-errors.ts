export class MacControlError extends Error {
  constructor(readonly code: "BUSY" | "ISOLATION_UNAVAILABLE") {
    super(code);
  }
}
