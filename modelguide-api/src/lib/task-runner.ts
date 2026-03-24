/**
 * TaskRunner — interface for async task execution.
 *
 * v1 implementation (InProcessTaskRunner): fires a Promise, tracks status
 * in a Map, writes progress to DB. Swappable for BullMQTaskRunner later
 * without changing route or simulation logic.
 */

import { randomUUID } from "node:crypto";
import { getLogger } from "@lib/logger";

const log = getLogger();

// ============================================================================
// Types
// ============================================================================

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface TaskState<TProgress = unknown> {
  id: string;
  status: TaskStatus;
  progress?: TProgress;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface TaskRunner {
  /**
   * Enqueue a task for async execution.
   * Returns immediately with a task ID.
   */
  enqueue<TPayload, TProgress>(
    taskType: string,
    payload: TPayload,
    handler: (
      payload: TPayload,
      updateProgress: (progress: TProgress) => void,
    ) => Promise<void>,
  ): string;

  /** Get current status of a task. */
  getStatus(taskId: string): TaskState | undefined;
}

// ============================================================================
// InProcessTaskRunner
// ============================================================================

/**
 * In-process task runner — fires Promises, tracks status in a Map.
 *
 * Suitable for single-instance, low-concurrency scenarios.
 * No crash recovery — tasks in "running" state stay there if the process dies.
 */
/** How long to keep completed/failed task state before cleanup (5 minutes). */
const TASK_RETENTION_MS = 5 * 60 * 1000;

export class InProcessTaskRunner implements TaskRunner {
  private tasks = new Map<string, TaskState>();

  enqueue<TPayload, TProgress>(
    taskType: string,
    payload: TPayload,
    handler: (
      payload: TPayload,
      updateProgress: (progress: TProgress) => void,
    ) => Promise<void>,
  ): string {
    const taskId = randomUUID();

    const state: TaskState = {
      id: taskId,
      status: "pending",
    };
    this.tasks.set(taskId, state);

    // Fire and forget — run asynchronously
    this.run(taskId, taskType, payload, handler);

    return taskId;
  }

  getStatus(taskId: string): TaskState | undefined {
    return this.tasks.get(taskId);
  }

  private async run<TPayload, TProgress>(
    taskId: string,
    taskType: string,
    payload: TPayload,
    handler: (
      payload: TPayload,
      updateProgress: (progress: TProgress) => void,
    ) => Promise<void>,
  ): Promise<void> {
    const state = this.tasks.get(taskId);
    if (!state) return;

    state.status = "running";
    state.startedAt = new Date();

    log.info({ taskId, taskType }, "task started");

    const updateProgress = (progress: TProgress) => {
      state.progress = progress;
    };

    try {
      await handler(payload, updateProgress);
      state.status = "completed";
      state.completedAt = new Date();
      log.info({ taskId, taskType }, "task completed");
    } catch (err) {
      state.status = "failed";
      state.error = err instanceof Error ? err.message : "Unknown task error";
      state.completedAt = new Date();
      log.error({ taskId, taskType, err }, "task failed");
    }

    // Schedule cleanup to prevent memory leak
    setTimeout(() => this.tasks.delete(taskId), TASK_RETENTION_MS);
  }
}

/** Singleton task runner instance. */
export const taskRunner = new InProcessTaskRunner();
