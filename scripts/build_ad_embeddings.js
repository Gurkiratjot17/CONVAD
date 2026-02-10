// scripts/build_ad_embeddings.js
/* eslint-disable no-console */

const { getPool } = require("../src/db/mysql");
const EmbeddingService = require("../src/services/EmbeddingService");

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const pool = getPool();
  const embedder = new EmbeddingService();

  const BATCH_SIZE = Number(process.env.EMBED_BATCH_SIZE || 25);
  const PAUSE_MS = Number(process.env.EMBED_PAUSE_MS || 200); // small pause to be gentle
  const LIMIT = Number(process.env.EMBED_LIMIT || 100000);

  console.log("📥 Fetching ads missing embeddings...");
  const [rows] = await pool.execute(
    `
    SELECT aci.ad_id, aci.ad_text
    FROM ad_context_index aci
    JOIN ads a ON a.ad_id = aci.ad_id
    WHERE a.status = 'ACTIVE'
      AND (aci.embedding_json IS NULL OR JSON_LENGTH(aci.embedding_json) = 0)
    ORDER BY aci.ad_id ASC
    LIMIT ${Math.max(1, Math.floor(LIMIT))}
    `
  );

  console.log(`✅ Found ${rows.length} ads to embed`);
  if (!rows.length) process.exit(0);

  let ok = 0;
  let fail = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    for (const r of batch) {
      const adId = Number(r.ad_id);
      const text = String(r.ad_text || "").trim();

      if (!text) {
        fail += 1;
        continue;
      }

      const emb = await embedder.embedText(text);
      if (!emb) {
        fail += 1;
        continue;
      }

      try {
        await pool.execute(
          `
          UPDATE ad_context_index
          SET embedding_json = CAST(? AS JSON),
              updated_at = CURRENT_TIMESTAMP
          WHERE ad_id = ?
          `,
          [JSON.stringify(emb), adId]
        );
        ok += 1;
      } catch (e) {
        console.warn("❌ Update failed for ad_id:", adId, e?.message || e);
        fail += 1;
      }
    }

    console.log(`📦 Progress: ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length} (ok=${ok}, fail=${fail})`);
    if (PAUSE_MS > 0) await sleep(PAUSE_MS);
  }

  console.log("✅ Embedding build complete", { ok, fail });
  process.exit(0);
}

main().catch(err => {
  console.error("❌ build_ad_embeddings failed:", err);
  process.exit(1);
});
