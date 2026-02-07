import { type ZodTypeAny, z } from "zod";

interface JsonSchemaProperty {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  items?: JsonSchemaProperty;
}

interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

function convertProperty(prop: JsonSchemaProperty): ZodTypeAny {
  let schema: ZodTypeAny;

  switch (prop.type) {
    case "string":
      schema = z.string();
      break;
    case "number":
    case "integer":
      schema = z.number();
      break;
    case "boolean":
      schema = z.boolean();
      break;
    case "array":
      schema = prop.items
        ? z.array(convertProperty(prop.items))
        : z.array(z.any());
      break;
    case "object":
      if (prop.properties) {
        const shape: Record<string, ZodTypeAny> = {};
        const required = new Set(prop.required ?? []);
        for (const [key, value] of Object.entries(prop.properties)) {
          const fieldSchema = convertProperty(value);
          shape[key] = required.has(key) ? fieldSchema : fieldSchema.optional();
        }
        schema = z.object(shape);
      } else {
        schema = z.record(z.any());
      }
      break;
    default:
      schema = z.any();
  }

  if (prop.description) {
    schema = schema.describe(prop.description);
  }

  return schema;
}

/**
 * Converts a JSON Schema object to a Zod raw shape suitable for MCP SDK registration.
 */
export function jsonSchemaToZod(
  schema: Record<string, unknown>,
): Record<string, ZodTypeAny> {
  const typed = schema as JsonSchema;
  const properties = typed.properties ?? {};
  const required = new Set(typed.required ?? []);
  const shape: Record<string, ZodTypeAny> = {};

  for (const [key, value] of Object.entries(properties)) {
    const fieldSchema = convertProperty(value);
    shape[key] = required.has(key) ? fieldSchema : fieldSchema.optional();
  }

  return shape;
}
