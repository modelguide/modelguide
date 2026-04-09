/**
 * Runtime slug → UUID registry.
 * Populated as entities are created/found; used for cross-references in YAML.
 */

export type EntityType =
  | "org"
  | "user"
  | "secret"
  | "connector"
  | "agent"
  | "sop"
  | "guardrail"
  | "session"
  | "sopTemplate"
  | "catalogEntry"
  | "evalSuite"
  | "evalConfig";

export class IdRegistry {
  private map = new Map<EntityType, Map<string, string>>();

  set(type: EntityType, slug: string, id: string): void {
    if (!this.map.has(type)) {
      this.map.set(type, new Map());
    }
    this.map.get(type)!.set(slug, id);
  }

  get(type: EntityType, slug: string): string {
    const id = this.map.get(type)?.get(slug);
    if (!id) {
      throw new Error(`${type} with slug "${slug}" not found in registry`);
    }
    return id;
  }

  has(type: EntityType, slug: string): boolean {
    return this.map.get(type)?.has(slug) ?? false;
  }

  getAll(type: EntityType): Map<string, string> {
    return this.map.get(type) ?? new Map();
  }
}
