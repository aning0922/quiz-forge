import { describe, expect, it, vi } from "vitest";
import {
  awaitDisplayTask,
  DisplayClientError,
  withDisplayDeadline,
} from "./display-task";

describe("shared display cancellation and absolute budgets", () => {
  it("never extends a supplied deadline, including nested work, and retains signal ownership", async () => {
    const controller = new AbortController();
    const deadline = performance.now() + 500;
    let owned: AbortSignal | undefined;
    const result = await withDisplayDeadline(
      controller.signal,
      async (active, limit) => {
        owned = active;
        expect(limit).toBe(deadline);
        return withDisplayDeadline(
          active,
          async (_child, childLimit) => {
            expect(childLimit).toBe(deadline);
            return "done";
          },
          limit,
        );
      },
      deadline,
    );
    expect(result).toBe("done");
    expect(controller.signal.aborted).toBe(false);
    expect(owned?.aborted).toBe(true);
    await withDisplayDeadline(
      controller.signal,
      async (_active, limit) => {
        expect(limit).toBeLessThanOrEqual(performance.now() + 15000);
      },
      performance.now() + 60000,
    );
  });
  it("expired or aborted work cannot start new transport work", async () => {
    const task = vi.fn();
    await expect(
      withDisplayDeadline(
        new AbortController().signal,
        task,
        performance.now() - 1,
      ),
    ).rejects.toThrow("PREVIEW_TIMEOUT");
    expect(task).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    await expect(withDisplayDeadline(controller.signal, task)).rejects.toThrow(
      "PREVIEW_CANCELLED",
    );
    expect(task).not.toHaveBeenCalled();
  });
  it("a pending task settles on cancellation and preserves the shared error type", async () => {
    const controller = new AbortController();
    let finish: ((value: string) => void) | undefined;
    const task = awaitDisplayTask(
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
      controller.signal,
    );
    controller.abort();
    await expect(task).rejects.toBeInstanceOf(DisplayClientError);
    finish!("late");
  });
  it("retains typed failures and the legacy unexpected-failure code", async () => {
    const signal = new AbortController().signal;
    const failure = new DisplayClientError("FONT_COVERAGE");
    await expect(
      withDisplayDeadline(signal, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    await expect(
      withDisplayDeadline(signal, async () => {
        throw Error("not exposed");
      }),
    ).rejects.toThrow("STUDIO_UNAVAILABLE");
  });
});
