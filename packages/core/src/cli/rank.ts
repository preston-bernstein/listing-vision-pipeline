import { getRankedListings } from '../rank/rank.js';
import { formatPriceCents } from '../format.js';

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('rank: DATABASE_URL environment variable is not set');
    process.exitCode = 1;
    return;
  }

  // Imported dynamically so the env check above runs — and can fail fast —
  // before db/client.js's module-load side effect of opening/creating the
  // SQLite file at DATABASE_URL. Matches the pattern in cli/score.ts and
  // cli/alert.ts.
  const { db } = await import('../db/client.js');
  const ranked = await getRankedListings(db);

  if (ranked.length === 0) {
    console.log('no ranked listings yet — run ingest and score first');
    return;
  }

  console.table(
    ranked.map((row) => ({
      rank: row.rank,
      id: row.id,
      source: row.source,
      title: row.title,
      price: formatPriceCents(row.priceCents),
      score: row.score.toFixed(2),
      imagePath: row.imagePath,
    })),
  );
}

main().catch((err) => {
  console.error('rank CLI failed:', err);
  process.exitCode = 1;
});
