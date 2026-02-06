/**
 * Drizzle RLS Proxy
 *
 * Creates proxied Drizzle instances that wrap every query in a short-lived
 * transaction with SET LOCAL config. This guarantees the config and query
 * always run on the same connection, making it safe with connection pooling.
 */

import { sql } from "drizzle-orm";
import type { Database } from "./client";

type SetConfigSQL = ReturnType<typeof sql>;

function buildSetConfig(key: string, value: string): SetConfigSQL {
  return sql`SELECT set_config(${key}, ${value}, true)`;
}

/**
 * Query methods that return a thenable builder chain.
 * We intercept these to replay the chain inside a transaction.
 */
const QUERY_METHODS = ["select", "insert", "update", "delete"] as const;

/**
 * Create a proxy that records method calls on a builder chain,
 * then replays them inside a transaction when awaited.
 */
function createChainRecorder(
  db: Database,
  configSql: SetConfigSQL,
  method: string,
  args: unknown[],
): unknown {
  const calls: Array<{ prop: string; args: unknown[] }> = [];

  const replay = () =>
    db.transaction(async (tx) => {
      await tx.execute(configSql);
      // Start the chain: tx.select(...), tx.insert(...), etc.
      // biome-ignore lint/suspicious/noExplicitAny: dynamic proxy requires runtime method dispatch
      let chain: any = (tx as any)[method](...args);
      // Replay recorded calls: .from(...), .where(...), .values(...), etc.
      for (const call of calls) {
        chain = chain[call.prop](...call.args);
      }
      return chain;
    });

  // biome-ignore lint/suspicious/noExplicitAny: proxy must masquerade as a Drizzle query builder
  const proxy: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          // When awaited, execute the chain inside a transaction
          // biome-ignore lint/suspicious/noExplicitAny: thenable protocol requires untyped resolve/reject
          return (resolve: any, reject: any) => replay().then(resolve, reject);
        }
        if (prop === "catch") {
          // biome-ignore lint/suspicious/noExplicitAny: thenable protocol
          return (reject: any) => replay().catch(reject);
        }
        if (prop === "finally") {
          // biome-ignore lint/suspicious/noExplicitAny: thenable protocol
          return (cb: any) => replay().finally(cb);
        }
        // Record the chained call and return the proxy for further chaining
        return (...callArgs: unknown[]) => {
          calls.push({ prop: prop as string, args: callArgs });
          return proxy;
        };
      },
    },
  );

  return proxy;
}

/**
 * Create a proxied Drizzle instance where every operation runs inside
 * a transaction with the given SET LOCAL config.
 */
function createProxy(db: Database, configSql: SetConfigSQL): Database {
  return new Proxy(db, {
    get(target, prop, receiver) {
      // Intercept transaction() — inject config before user callback
      if (prop === "transaction") {
        // biome-ignore lint/suspicious/noExplicitAny: must match Drizzle's transaction signature
        return (fn: (tx: any) => Promise<any>, ...rest: any[]) =>
          target.transaction(
            async (tx) => {
              await tx.execute(configSql);
              return fn(tx);
            },
            ...rest,
          );
      }

      // Intercept select/insert/update/delete — return chain recorder
      if (
        typeof prop === "string" &&
        QUERY_METHODS.includes(prop as (typeof QUERY_METHODS)[number])
      ) {
        return (...args: unknown[]) =>
          createChainRecorder(target, configSql, prop, args);
      }

      // Intercept execute() — wrap raw SQL in transaction
      if (prop === "execute") {
        // biome-ignore lint/suspicious/noExplicitAny: accepts any SQL query
        return (query: any) =>
          target.transaction(async (tx) => {
            await tx.execute(configSql);
            return tx.execute(query);
          });
      }

      // Intercept query (relational API) — return nested proxy
      if (prop === "query") {
        const queryObj = target.query;
        return new Proxy(queryObj, {
          get(qTarget, tableName) {
            // biome-ignore lint/suspicious/noExplicitAny: dynamic table access by name
            const tableApi = (qTarget as any)[tableName];
            if (!tableApi || typeof tableApi !== "object") {
              return tableApi;
            }
            // Proxy each table's findFirst/findMany
            return new Proxy(tableApi, {
              get(tTarget, methodName) {
                const original = tTarget[methodName];
                if (typeof original !== "function") {
                  return original;
                }
                return (...args: unknown[]) =>
                  target.transaction(async (tx) => {
                    await tx.execute(configSql);
                    // biome-ignore lint/suspicious/noExplicitAny: dynamic table access by name
                    return (tx.query as any)[tableName][methodName](...args);
                  });
              },
            });
          },
        });
      }

      return Reflect.get(target, prop, receiver);
    },
  }) as Database;
}

export interface RLSDrizzle {
  /** Returns a proxied db scoped to the given organization */
  attach(organizationId: string): Database;
  /** Returns a proxied db that bypasses RLS */
  bypass(): Database;
}

/**
 * Factory that creates an RLS-aware Drizzle wrapper.
 *
 * Usage:
 * ```ts
 * const rls = createRLSDrizzle(db);
 * const scopedDb = rls.attach(orgId);   // queries scoped to org
 * const bypassDb = rls.bypass();        // queries bypass RLS
 * ```
 */
export function createRLSDrizzle(db: Database): RLSDrizzle {
  return {
    attach(organizationId: string): Database {
      return createProxy(
        db,
        buildSetConfig("app.organization_id", organizationId),
      );
    },
    bypass(): Database {
      return createProxy(db, buildSetConfig("app.bypass_rls", "on"));
    },
  };
}
