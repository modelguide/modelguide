/**
 * Shared input resolution for commands that accept --from or positional args.
 */

import type { z } from "zod";
import { log } from "./logger";
import { parseKvArgs } from "./parse-kv";
import { loadYaml } from "./yaml-loader";

/**
 * Resolve input items from --from YAML file or positional KV args.
 * Exits with error if neither is provided.
 */
export function resolveInput<T>(
  opts: { from?: string },
  entries: string[],
  fileSchema: z.ZodTypeAny,
  itemSchema: z.ZodTypeAny,
  fileKey: string,
): T[] {
  if (opts.from) {
    const data = loadYaml(opts.from, fileSchema);
    return data[fileKey] as T[];
  }
  if (entries.length > 0) {
    const kvs = parseKvArgs(entries);
    return kvs.map((kv) => itemSchema.parse(kv)) as T[];
  }
  log.error("Provide entries as args or --from <file>");
  process.exit(1);
}
