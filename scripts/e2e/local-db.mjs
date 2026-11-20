/**
 * Direct SQL access to the LOCAL Supabase stack, for the few things the JS client
 * cannot see: the `auth` schema, and the migration ledger.
 *
 * WHY THIS EXISTS (2026-08-06). `npm run test:db` and `npm run audit:app:seed` are
 * meant to run back to back, and they could not: the probe suite left rows in
 * `auth.users` whose GoTrue-owned token columns were NULL, and GoTrue's
 * `GET /admin/users` cannot scan NULL into a Go `string` — it answers 500
 * "Database error finding users". The seed called `listUsers()` first, so the
 * failure landed immediately after a GREEN db gate and named nothing useful.
 * See docs/handoffs/authed-ui-pass-2026-08-06.md defect 4.
 *
 * The probes are fixed (they write '' now) and the seed no longer depends on
 * `listUsers()`, but neither fix can prove a stack someone else poisoned is clean.
 * `assertStackHealthy()` is that proof, and it runs BEFORE the seed touches
 * anything so a poisoned stack is named as a poisoned stack.
 *
 * There is no `pg` dependency in this repo, and no host `psql` on the dev Mac, so
 * this shells into the running `supabase_db_*` container the same way
 * scripts/test-db.sh does — one mechanism, already proven on this machine.
 *
 * LOCAL ONLY. Every entry point re-checks that the target is loopback before it
 * runs a statement; there is no code path here that can reach the prod project.
 */
import { execFileSync } from 'node:child_process';

const LOCAL_DB_URL = process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function assertLocal(url) {
  if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
    throw new Error(`Refusing to run SQL against ${url} — this helper is local-only.`);
  }
}

function hasHostPsql() {
  try {
    execFileSync('psql', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function dbContainer() {
  try {
    const names = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
    return names.split('\n').find((n) => n.startsWith('supabase_db_')) || null;
  } catch {
    return null;
  }
}

/**
 * Run one statement and return the rows as arrays of column strings.
 * `-tA` is the machine format: no header, no padding, `|` separated.
 */
export function query(sql) {
  assertLocal(LOCAL_DB_URL);
  // stderr is captured, not inherited: a healthy local stack emits a collation-version
  // WARNING on every single connection, and letting that through trains the operator to
  // skim past this script's output. It is re-attached to any error that is actually thrown.
  const opts = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  let out;
  try {
    if (hasHostPsql()) {
      out = execFileSync('psql', [LOCAL_DB_URL, '-tA', '-v', 'ON_ERROR_STOP=1', '-c', sql], opts);
    } else {
      const container = dbContainer();
      if (!container) {
        throw new Error(
          'No host psql and no running supabase_db_* container.\n' +
          '  Start the stack:  npx supabase start -x studio\n' +
          '  (-x studio is REQUIRED: Studio segfaults and the CLI tears the whole healthy stack down with it — docs/commands.md)'
        );
      }
      out = execFileSync(
        'docker',
        ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', sql],
        opts
      );
    }
  } catch (e) {
    const detail = (e.stderr || '').toString().split('\n').filter((l) => !/collation version|Rebuild all objects|The database was created using/.test(l)).join('\n').trim();
    throw new Error(`Local SQL failed: ${detail || e.message}\n  statement: ${sql.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  return out.split('\n').filter((l) => l !== '').map((l) => l.split('|'));
}

/**
 * The `auth.users` columns GoTrue scans into a non-pointer Go `string`. A NULL in
 * any of them makes `GET /admin/users` (and every admin API call that pages users)
 * answer 500 for the WHOLE table, not just the offending row — which is why one
 * stray probe row takes the entire seed down.
 *
 * Kept as an explicit list, intersected with what the live schema actually has, so
 * a GoTrue upgrade that adds or drops a column degrades to "checks fewer columns"
 * rather than "crashes on a column that no longer exists".
 */
const GOTRUE_STRING_COLUMNS = [
  'confirmation_token',
  'recovery_token',
  'email_change_token_new',
  'email_change',
  'email_change_token_current',
  'phone_change',
  'phone_change_token',
  'reauthentication_token',
];

export function gotrueStringColumns() {
  const present = query(
    `select column_name from information_schema.columns
      where table_schema = 'auth' and table_name = 'users'`
  ).map((r) => r[0]);
  return GOTRUE_STRING_COLUMNS.filter((c) => present.includes(c));
}

/**
 * Throw with a diagnosis if the local stack is in a state the admin API cannot
 * survive. Loud and specific beats a downstream `Seed failed: {}`.
 *
 * `{ repair: true }` applies the one-line fix instead of refusing. Off by default:
 * the honest default is to say what is wrong, because silently healing a poisoned
 * stack is how the poisoning survives to the next person.
 */
export function assertStackHealthy({ repair = false } = {}) {
  const cols = gotrueStringColumns();
  if (cols.length === 0) return { checked: [], poisoned: [] };

  const predicate = cols.map((c) => `${c} is null`).join(' or ');
  const rows = query(
    `select count(*)::text, coalesce(string_agg(distinct email, ', ' order by email), '')
       from auth.users where ${predicate}`
  );
  const count = Number(rows[0]?.[0] ?? 0);
  if (count === 0) return { checked: cols, poisoned: [] };

  const emails = (rows[0]?.[1] ?? '').split(', ').filter(Boolean);
  const fix = `update auth.users set ${cols.map((c) => `${c} = coalesce(${c}, '')`).join(', ')};`;

  if (repair) {
    query(fix);
    return { checked: cols, poisoned: emails, repaired: true };
  }

  throw new Error(
    `POISONED LOCAL STACK: ${count} row(s) in auth.users have a NULL GoTrue token column.\n` +
    `  Rows: ${emails.join(', ') || '(no email)'}\n` +
    `  Columns checked: ${cols.join(', ')}\n` +
    '\n' +
    '  GoTrue scans these into a Go `string`, so a single NULL makes the admin user API\n' +
    '  answer 500 "Database error finding users" for EVERY caller. Nothing downstream of\n' +
    '  this can work, and the failure it produces will not point here.\n' +
    '\n' +
    '  Cause: a SQL fixture inserted into auth.users without those columns. Every probe in\n' +
    '  supabase/tests/ that commits now writes \'\' (2026-08-06) — a poisoned stack today\n' +
    '  means either a stale database from before that fix, or a NEW fixture that skipped it.\n' +
    '\n' +
    '  Fix, cheapest first:\n' +
    `    npx supabase db reset --local        # clean slate, and what CI does\n` +
    `    -- or, in place:  ${fix}\n`
  );
}

/**
 * Cheap DDL-drift check for the failure defect 5 recorded: a migration recorded in
 * `supabase_migrations.schema_migrations` whose DDL is NOT in the database.
 * `content_reports.chk_content_type` was the 7-value pre-20260825 shape while
 * 20260825010000 was stamped as applied — a stamped migration is not evidence the
 * DDL ran, and every gate downstream trusted the stamp.
 *
 * This does not (and cannot cheaply) verify every migration. It verifies the
 * CHECK-constraint surface, which is where the observed drift was and where the
 * repo already keeps exact-set drift guards, and it names what it did NOT check.
 */
export function checkConstraintFingerprints() {
  return query(
    `select rel.relname, con.conname, pg_get_constraintdef(con.oid)
       from pg_constraint con
       join pg_class rel on rel.oid = con.conrelid
       join pg_namespace ns on ns.oid = rel.relnamespace
      where ns.nspname = 'public' and con.contype = 'c'
      order by rel.relname, con.conname`
  ).map(([table, name, def]) => ({ table, name, def }));
}
