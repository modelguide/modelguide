/**
 * Drizzle RLS Proxy
 *
 * Creates proxied Drizzle instances that wrap every query in a short-lived
 * transaction with SET LOCAL config. This guarantees the config and query
 * always run on the same connection, making it safe with connection pooling.
 */

import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Database } from "./client";

const QUERY_METHODS = new Set(["select", "insert", "update", "delete"]);

/**
 * Records method calls on a Drizzle builder chain, then replays them
 * inside a transaction when the chain is awaited.
 */
function createChainRecorder(
  db: Database,
  configSql: SQL,
  method: string,
  args: unknown[],
): unknown {
  const calls: Array<{ prop: string; args: unknown[] }> = [];

  const replay = () =>
    db.transaction(async (tx) => {
      await tx.execute(configSql);
      // biome-ignore lint/suspicious/noExplicitAny: dynamic proxy requires runtime method dispatch
      let chain: any = (tx as any)[method](...args);
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
        if (typeof prop === "symbol") return undefined;

        if (prop === "then") {
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
function createProxy(db: Database, configSql: SQL): Database {
  let cachedQueryProxy: typeof db.query | null = null;

  return new Proxy(db, {
    get(target, prop, receiver) {
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

      if (typeof prop === "string" && QUERY_METHODS.has(prop)) {
        return (...args: unknown[]) =>
          createChainRecorder(target, configSql, prop, args);
      }

      if (prop === "execute") {
        // biome-ignore lint/suspicious/noExplicitAny: accepts any SQL query
        return (query: any) =>
          target.transaction(async (tx) => {
            await tx.execute(configSql);
            return tx.execute(query);
          });
      }

      if (prop === "query") {
        if (cachedQueryProxy) return cachedQueryProxy;
        const queryObj = target.query;
        cachedQueryProxy = new Proxy(queryObj, {
          get(qTarget, tableName) {
            // biome-ignore lint/suspicious/noExplicitAny: dynamic table access by name
            const tableApi = (qTarget as any)[tableName];
            if (!tableApi || typeof tableApi !== "object") return tableApi;

            return new Proxy(tableApi, {
              get(tTarget, methodName) {
                const original = tTarget[methodName];
                if (typeof original !== "function") return original;

                return (...args: unknown[]) =>
                  target.transaction(async (tx) => {
                    await tx.execute(configSql);
                    // biome-ignore lint/suspicious/noExplicitAny: dynamic table access by name
                    return (tx.query as any)[tableName][methodName](...args);
                  });
              },
            });
          },
        }) as typeof db.query;
        return cachedQueryProxy;
      }

      return Reflect.get(target, prop, receiver);
    },
  }) as Database;
}

/** Returns a proxied db scoped to the given organization. */
export function createOrgProxy(db: Database, organizationId: string): Database {
  return createProxy(
    db,
    sql`SELECT set_config('app.organization_id', ${organizationId}, true)`,
  );
}

/** Returns a proxied db that bypasses RLS. */
export function createBypassProxy(db: Database): Database {
  return createProxy(db, sql`SELECT set_config('app.bypass_rls', 'on', true)`);
}
