import type { ToolResult } from "../types.js";

interface MockEntry {
  match?: Record<string, unknown>;
  default?: unknown;
  response?: unknown;
}

export class MockToolExecutor {
  private mocks: Record<string, MockEntry[]>;

  constructor(mocks: Record<string, MockEntry[]>) {
    this.mocks = mocks;
  }

  hasMock(toolName: string): boolean {
    return toolName in this.mocks;
  }

  execute(toolName: string, args: Record<string, unknown>): ToolResult {
    const entries = this.mocks[toolName];
    if (!entries || entries.length === 0) {
      return { success: false, error: `No mock configured for ${toolName}` };
    }

    // Find first entry where all match keys equal the args
    for (const entry of entries) {
      if (entry.match) {
        const allMatch = Object.entries(entry.match).every(
          ([key, value]) => args[key] === value,
        );
        if (allMatch && entry.response !== undefined) {
          return { success: true, data: entry.response };
        }
      }
    }

    // Fall back to default entry
    const defaultEntry = entries.find((e) => e.default !== undefined);
    if (defaultEntry) {
      const data = defaultEntry.default as Record<string, unknown>;
      if (data && typeof data === "object" && "error" in data) {
        return { success: false, error: data.error as string };
      }
      return { success: true, data };
    }

    return { success: false, error: `No matching mock for ${toolName}` };
  }
}
