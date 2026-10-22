import { closeDb } from '../src/db/client';
import { seedBaseline } from '../src/server/seed';

seedBaseline()
  .then(() => console.log('Baseline seed complete (pipeline stages, unreviewed country policies, templates, follow-up rules). No users were created.'))
  .catch((e) => {
    console.error('Seed failed:', e.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
