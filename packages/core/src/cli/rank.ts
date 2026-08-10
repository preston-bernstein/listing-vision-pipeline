import { db } from "../db/client.js";
import { getRankedListings } from "../rank/rank.js";

async function main() {
  const ranked = await getRankedListings(db);

  if (ranked.length === 0) {
    console.log("no ranked listings yet — run ingest and score first");
    return;
  }

  console.table(
    ranked.map((row) => ({
      rank: row.rank,
      id: row.id,
      source: row.source,
      title: row.title,
      price: `$${(row.priceCents / 100).toFixed(2)}`,
      score: row.score.toFixed(2),
      imagePath: row.imagePath,
    })),
  );
}

main().catch((err) => {
  console.error("rank CLI failed:", err);
  process.exitCode = 1;
});
