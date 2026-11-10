/**
 * The bank in Postgres. The tables are created on first use. The two demonstration customers are put in once, when
 * there are no customers yet, so the logins already linked to them keep working. Money is whole cents, so a balance
 * is an exact sum: the opening balance plus every transaction.
 */
import {
	checkNewCustomer,
	checkPayee,
	MAX_PAYEES,
	newCustomerId,
	newPayeeId,
	NOT_AVAILABLE,
	NOT_ENOUGH,
	openingAccounts,
	paymentReference,
	SEED_ACCOUNTS,
	SEED_CUSTOMERS,
	SEED_PAYEES,
	seedTransactions,
	type Account,
	type Bank,
	type Customer,
	type Moved,
	type Payee,
	type Transaction,
} from "./bank.ts";
import type { Db, SqlClient } from "./db.ts";

const customerOf = (r: Record<string, unknown>): Customer => ({ id: String(r.id), name: String(r.name), email: String(r.email) });
const accountOf = (r: Record<string, unknown>): Account => ({
	id: String(r.id),
	customerId: String(r.customer_id),
	name: String(r.name),
	type: r.type === "savings" ? "savings" : "cheque",
	endingDigits: String(r.ending_digits),
	openingCents: Number(r.opening_cents),
});
const transactionOf = (r: Record<string, unknown>): Transaction => ({ id: String(r.id), accountId: String(r.account_id), date: String(r.date), description: String(r.description), category: String(r.category), cents: Number(r.cents) });
const payeeOf = (r: Record<string, unknown>): Payee => ({ id: String(r.id), customerId: String(r.customer_id), name: String(r.name), endingDigits: String(r.ending_digits) });

const insertCustomer = (tx: SqlClient, c: Customer) => tx.query(`insert into nova_customers (id, name, email) values ($1, $2, $3) on conflict (id) do nothing`, [c.id, c.name, c.email]);
const insertAccount = (tx: SqlClient, a: Account) =>
	tx.query(`insert into nova_accounts (id, customer_id, name, type, ending_digits, opening_cents) values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing`, [a.id, a.customerId, a.name, a.type, a.endingDigits, a.openingCents]);
const insertTransaction = (tx: SqlClient, t: Transaction) =>
	tx.query(`insert into nova_transactions (id, account_id, date, description, category, cents) values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing`, [t.id, t.accountId, t.date, t.description, t.category, t.cents]);
const insertPayee = (tx: SqlClient, p: Payee) => tx.query(`insert into nova_payees (id, customer_id, name, ending_digits) values ($1, $2, $3, $4) on conflict (id) do nothing`, [p.id, p.customerId, p.name, p.endingDigits]);

/** The balance of an account: its opening balance plus every transaction on it. */
const balanceOf = async (q: SqlClient, account: Account): Promise<number> =>
	account.openingCents + Number((await q.query(`select coalesce(sum(cents), 0) as total from nova_transactions where account_id = $1`, [account.id])).rows[0]?.total ?? 0);

export function postgresBank(db: Db): Bank {
	let ready: Promise<unknown> | undefined;
	async function create() {
		await db.query(`create table if not exists nova_customers (id text primary key, name text not null, email text not null, created_at timestamptz not null default now())`);
		await db.query(
			`create table if not exists nova_accounts (id text primary key, customer_id text not null references nova_customers (id), name text not null, type text not null, ending_digits text not null, opening_cents bigint not null)`,
		);
		await db.query(`create index if not exists nova_accounts_customer on nova_accounts (customer_id)`);
		await db.query(
			`create table if not exists nova_transactions (id text primary key, account_id text not null references nova_accounts (id), date text not null, description text not null, category text not null, cents bigint not null)`,
		);
		await db.query(`create index if not exists nova_transactions_account on nova_transactions (account_id, date)`);
		await db.query(`create table if not exists nova_payees (seq bigserial, id text primary key, customer_id text not null references nova_customers (id), name text not null, ending_digits text not null)`);
		await db.query(`create index if not exists nova_payees_customer on nova_payees (customer_id)`);
		// One row per payment operation: claiming it first is what makes a retry, even a concurrent one, move the money once.
		await db.query(`create table if not exists nova_payments (operation_id text primary key, ok boolean, reference text, reason text, made_at timestamptz not null default now())`);
		if ((await db.query(`select 1 from nova_customers limit 1`)).rows.length > 0) return;
		await db.transaction(async (tx) => {
			for (const c of SEED_CUSTOMERS) await insertCustomer(tx, c);
			for (const a of SEED_ACCOUNTS) await insertAccount(tx, a);
			for (const t of seedTransactions()) await insertTransaction(tx, t);
			for (const p of SEED_PAYEES) await insertPayee(tx, p);
		});
	}
	// A failed start is tried again on the next use, not remembered.
	const schema = () => (ready ??= create().catch((error) => { ready = undefined; throw error; }));

	const accountsOf = async (customerId: string) => {
		await schema();
		return (await db.query(`select * from nova_accounts where customer_id = $1 order by id`, [customerId])).rows.map(accountOf);
	};

	return {
		async customers() {
			await schema();
			return (await db.query(`select * from nova_customers order by created_at, id`)).rows.map(customerOf);
		},
		async customer(id) {
			if (!id) return undefined;
			await schema();
			const row = (await db.query(`select * from nova_customers where id = $1`, [id])).rows[0];
			return row ? customerOf(row) : undefined;
		},
		async createCustomer(input) {
			const checked = checkNewCustomer(input.name, input.email);
			if (!checked.ok) return checked;
			await schema();
			const customer: Customer = { id: newCustomerId(), name: checked.name, email: checked.email };
			const accounts = openingAccounts(customer.id);
			// The customer and both accounts, or none: a customer with no accounts would sign in to an empty bank.
			await db.transaction(async (tx) => {
				await insertCustomer(tx, customer);
				for (const a of accounts) await insertAccount(tx, a);
			});
			return { ok: true, customer, accounts };
		},
		accountsOf,
		async balancesOf(customerId) {
			await schema();
			const rows = (
				await db.query(
					`select a.*, a.opening_cents + coalesce(sum(t.cents), 0) as balance
					 from nova_accounts a left join nova_transactions t on t.account_id = a.id
					 where a.customer_id = $1 group by a.id order by a.id`,
					[customerId],
				)
			).rows;
			return rows.map((r) => ({ ...accountOf(r), balanceCents: Number(r.balance) }));
		},
		async accountOf(customerId, accountId) {
			await schema();
			const row = (await db.query(`select * from nova_accounts where id = $1 and customer_id = $2`, [accountId, customerId])).rows[0];
			return row ? accountOf(row) : undefined;
		},
		async balanceCents(account) {
			await schema();
			return balanceOf(db, account);
		},
		async transactionsOf(account, { from, to, limit = 20 } = {}) {
			await schema();
			const rows = (
				await db.query(
					`select * from nova_transactions where account_id = $1 and ($2::text is null or date >= $2) and ($3::text is null or date <= $3)
					 order by date desc, id collate "C" desc limit $4`,
					[account.id, from ?? null, to ?? null, limit],
				)
			).rows;
			return rows.map(transactionOf);
		},
		async paymentsOf(customerId, limit) {
			await schema();
			const rows = (
				await db.query(
					`select t.* from nova_transactions t join nova_accounts a on a.id = t.account_id
					 where a.customer_id = $1 and t.category in ('payment', 'transfer') order by t.date desc, t.id collate "C" desc limit $2`,
					[customerId, limit],
				)
			).rows;
			return rows.map(transactionOf);
		},
		async payeesOf(customerId) {
			await schema();
			return (await db.query(`select * from nova_payees where customer_id = $1 order by seq`, [customerId])).rows.map(payeeOf);
		},
		async payeeOf(customerId, payeeId) {
			await schema();
			const row = (await db.query(`select * from nova_payees where id = $1 and customer_id = $2`, [payeeId, customerId])).rows[0];
			return row ? payeeOf(row) : undefined;
		},
		async addPayee(customerId, name, accountNumber) {
			const checked = checkPayee(name, accountNumber);
			if (!checked.ok) return checked;
			await schema();
			if (Number((await db.query(`select count(*) as n from nova_payees where customer_id = $1`, [customerId])).rows[0]?.n) >= MAX_PAYEES) return { ok: false, reason: `You can save up to ${MAX_PAYEES} payees.` };
			const payee: Payee = { id: newPayeeId(customerId), customerId, name: checked.name, endingDigits: checked.digits.slice(-4) };
			await insertPayee(db, payee);
			return { ok: true, payee };
		},
		async movePayment(operationId, customerId, move) {
			await schema();
			return db.transaction(async (tx): Promise<Moved> => {
				// Claim the operation first. A second run, even at the same moment, waits for the first and gets its answer.
				const claimed = await tx.query(`insert into nova_payments (operation_id) values ($1) on conflict (operation_id) do nothing returning operation_id`, [operationId]);
				if (claimed.rows.length === 0) {
					const done = (await tx.query(`select ok, reference, reason from nova_payments where operation_id = $1`, [operationId])).rows[0];
					return done?.ok ? { ok: true, reference: String(done.reference) } : { ok: false, reason: String(done?.reason ?? NOT_AVAILABLE.reason) };
				}
				// The paying account is locked for the check and the debit, so two payments cannot both spend the same money.
				const fromRow = (await tx.query(`select * from nova_accounts where id = $1 and customer_id = $2 for update`, [move.from, customerId])).rows[0];
				const toRow = move.to ? (await tx.query(`select * from nova_accounts where id = $1 and customer_id = $2`, [move.to, customerId])).rows[0] : undefined;
				let result: Moved;
				if (!fromRow || (move.to && !toRow)) result = NOT_AVAILABLE;
				else {
					const from = accountOf(fromRow);
					if ((await balanceOf(tx, from)) < move.cents) result = NOT_ENOUGH;
					else {
						const date = new Date().toISOString().slice(0, 10);
						const reference = paymentReference(operationId);
						await insertTransaction(tx, { id: `txn_${reference}_out`, accountId: from.id, date, description: move.description, category: move.category, cents: -move.cents });
						if (toRow) await insertTransaction(tx, { id: `txn_${reference}_in`, accountId: String(toRow.id), date, description: `Transfer from ${from.name} ••${from.endingDigits}`, category: "transfer", cents: move.cents });
						result = { ok: true, reference };
					}
				}
				await tx.query(`update nova_payments set ok = $2, reference = $3, reason = $4 where operation_id = $1`, [operationId, result.ok, result.ok ? result.reference : null, result.ok ? null : result.reason]);
				return result;
			});
		},
	};
}
