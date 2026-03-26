/**
 * Load a YAML file and validate against a Zod schema.
 */

import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import type { z } from "zod";

export function loadYaml<S extends z.ZodTypeAny>(
  filePath: string,
  schema: S,
): z.output<S> {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = yaml.load(raw);
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i: z.ZodIssue) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Validation failed for ${filePath}:\n${issues}`);
  }
  return result.data;
}
