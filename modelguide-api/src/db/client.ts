import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/env";

const queryClient = postgres(env.DATABASE_URL);

export const db = drizzle(queryClient);

export async function closeDatabase(): Promise<void> {
  await queryClient.end();
}
