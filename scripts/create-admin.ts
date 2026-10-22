/**
 * First-administrator setup.
 *   Interactive:      npm run admin:create -- --email you@company.com --name "Your Name"
 *   Non-interactive:  ADMIN_PASSWORD='...' npm run admin:create -- --email you@company.com --name "Your Name"
 * There is no default account. The password is never printed or logged.
 */
import readline from 'node:readline';
import { and, eq, isNull } from 'drizzle-orm';
import { closeDb, db } from '../src/db/client';
import { users } from '../src/db/schema';
import { hashPassword, validatePasswordStrength } from '../src/lib/passwords';
import { audit } from '../src/lib/audit';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const w = (rl as unknown as { _writeToOutput: (s: string) => void });
    w._writeToOutput = (s: string) => {
      if (s.includes(question)) process.stdout.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const email = arg('email')?.trim().toLowerCase();
  const name = arg('name')?.trim();
  if (!email || !name) {
    console.error('Usage: npm run admin:create -- --email you@company.com --name "Your Name"');
    process.exit(1);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    console.error('Invalid email address.');
    process.exit(1);
  }
  const [existing] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, email), isNull(users.deletedAt))).limit(1);
  if (existing) {
    console.error('A user with that email already exists.');
    process.exit(1);
  }
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await promptHidden('Password (min 12 chars, upper+lower+number): ');
    const confirm = await promptHidden('Confirm password: ');
    if (password !== confirm) {
      console.error('Passwords do not match.');
      process.exit(1);
    }
  }
  const problem = validatePasswordStrength(password);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  const [u] = await db.insert(users).values({ email, name, role: 'ADMIN', passwordHash: await hashPassword(password) }).returning({ id: users.id });
  await audit({ userId: u!.id, userEmail: email, action: 'user.created_via_cli', entityType: 'user', entityId: u!.id, metadata: { role: 'ADMIN' } });
  console.log(`Administrator ${email} created. You can now sign in.`);
}

main()
  .catch((e) => {
    console.error('Failed:', e.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
