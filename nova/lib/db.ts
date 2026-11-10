/** Anything that runs a parameterized SQL query: a `pg` Pool, or PGlite. */
export interface SqlClient {
	query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** A database that can also run several statements as one transaction: either all of them happen or none. PGlite already has this shape. */
export interface Db extends SqlClient {
	transaction<T>(run: (tx: SqlClient) => Promise<T>): Promise<T>;
}

declare global {
	var __proteaDb: Db | undefined;
}

/** The one connection pool this process uses, or undefined when DATABASE_URL is not set. */
export async function database(env: Record<string, string | undefined> = process.env): Promise<Db | undefined> {
	if (globalThis.__proteaDb) return globalThis.__proteaDb;
	if (!env.DATABASE_URL) return undefined;
	const { default: pg } = await import("pg");
	const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 3, ...(env.DATABASE_SSL === "1" ? { ssl: { rejectUnauthorized: false } } : {}) });
	return (globalThis.__proteaDb = {
		query: (text, params) => pool.query(text, params),
		async transaction(run) {
			const client = await pool.connect();
			try {
				await client.query("begin");
				const result = await run({ query: (text, params) => client.query(text, params) });
				await client.query("commit");
				return result;
			} catch (error) {
				await client.query("rollback").catch(() => {});
				throw error;
			} finally {
				client.release();
			}
		},
	});
}
