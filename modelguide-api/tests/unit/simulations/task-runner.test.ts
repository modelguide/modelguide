/**
 * Unit tests for InProcessTaskRunner.
 *
 * Tests: enqueue returns ID, getStatus returns progress,
 * handles task failure without crashing.
 */

import { describe, expect, test } from "bun:test";
import { InProcessTaskRunner } from "@lib/task-runner";

describe("InProcessTaskRunner", () => {
  test("enqueue returns a task ID", () => {
    const runner = new InProcessTaskRunner();
    const taskId = runner.enqueue("test-task", { foo: "bar" }, async () => {});
    expect(taskId).toBeTruthy();
    expect(typeof taskId).toBe("string");
    // UUID format
    expect(taskId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test("getStatus returns task state after enqueue", async () => {
    const runner = new InProcessTaskRunner();

    let resolveTask: () => void;
    const taskPromise = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });

    const taskId = runner.enqueue("test-task", {}, async () => {
      await taskPromise;
    });

    // Task should be running (the handler is awaiting the promise)
    // Give microtask queue a chance to start
    await new Promise((r) => setTimeout(r, 10));

    const status = runner.getStatus(taskId);
    expect(status).toBeDefined();
    expect(status!.id).toBe(taskId);
    expect(status!.status).toBe("running");
    expect(status!.startedAt).toBeInstanceOf(Date);

    // Let the task complete
    resolveTask!();
    await new Promise((r) => setTimeout(r, 10));

    const completed = runner.getStatus(taskId);
    expect(completed!.status).toBe("completed");
    expect(completed!.completedAt).toBeInstanceOf(Date);
  });

  test("getStatus returns undefined for unknown task ID", () => {
    const runner = new InProcessTaskRunner();
    expect(runner.getStatus("nonexistent")).toBeUndefined();
  });

  test("progress is updated via updateProgress callback", async () => {
    const runner = new InProcessTaskRunner();

    let resolveTask: () => void;
    const taskPromise = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });

    const taskId = runner.enqueue(
      "progress-task",
      {},
      async (_payload, updateProgress) => {
        updateProgress({ step: 1, total: 3 });
        await taskPromise;
      },
    );

    // Wait for handler to start and update progress
    await new Promise((r) => setTimeout(r, 10));

    const status = runner.getStatus(taskId);
    expect(status!.progress).toEqual({ step: 1, total: 3 });

    resolveTask!();
    await new Promise((r) => setTimeout(r, 10));
  });

  test("handles task failure without crashing", async () => {
    const runner = new InProcessTaskRunner();

    const taskId = runner.enqueue("failing-task", {}, async () => {
      throw new Error("Intentional test failure");
    });

    // Wait for task to fail
    await new Promise((r) => setTimeout(r, 50));

    const status = runner.getStatus(taskId);
    expect(status!.status).toBe("failed");
    expect(status!.error).toBe("Intentional test failure");
    expect(status!.completedAt).toBeInstanceOf(Date);
  });

  test("handles non-Error throws gracefully", async () => {
    const runner = new InProcessTaskRunner();

    const taskId = runner.enqueue("string-throw", {}, async () => {
      throw "string error";
    });

    await new Promise((r) => setTimeout(r, 50));

    const status = runner.getStatus(taskId);
    expect(status!.status).toBe("failed");
    expect(status!.error).toBe("Unknown task error");
  });

  test("multiple tasks run independently", async () => {
    const runner = new InProcessTaskRunner();

    const task1Id = runner.enqueue("task-1", {}, async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const task2Id = runner.enqueue("task-2", {}, async () => {
      throw new Error("Task 2 fails");
    });

    // Wait for both
    await new Promise((r) => setTimeout(r, 100));

    const status1 = runner.getStatus(task1Id);
    const status2 = runner.getStatus(task2Id);

    expect(status1!.status).toBe("completed");
    expect(status2!.status).toBe("failed");
  });
});
