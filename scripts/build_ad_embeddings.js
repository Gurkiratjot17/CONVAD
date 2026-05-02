// scripts/build_ad_embeddings.js
/* eslint-disable no-console */

/*
 * Build Ad Embeddings Script
 *
 * Purpose:
 * - Finds active ads that do not yet have embeddings
 * - Generates embeddings for their indexed ad text
 * - Stores embeddings back into ad_context_index
 *
 * This supports semantic reranking in the hybrid ad-selection pipeline.
 */

const { getPool } = require("../src/db/mysql");
const EmbeddingService = require("../src/services/EmbeddingService");

/*
 * Small helper used to pause between batches.
 *
 * This reduces pressure on the embedding API and avoids aggressive request bursts.
 */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
   /*
   * Initialise database pool and embedding service.
   */
  const pool = getPool();
  const embedder = new EmbeddingService();

  /*
   * Runtime configuration.
   *
   * Environment variables allow tuning without modifying the script:
   * - EMBED_BATCH_SIZE controls ads processed per batch
   * - EMBED_PAUSE_MS controls delay between batches
   * - EMBED_LIMIT controls maximum ads processed in one run
   */
  const BATCH_SIZE = Number(process.env.EMBED_BATCH_SIZE || 25);
  const PAUSE_MS = Number(process.env.EMBED_PAUSE_MS || 200); // small pause to be gentle
  const LIMIT = Number(process.env.EMBED_LIMIT || 100000);

   /*
   * Fetch active ads that are missing embeddings.
   */
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

  /*
   * Exit early when there is no work to perform.
   */
  if (!rows.length) process.exit(0);

   /*
   * Counters for reporting script success/failure.
   */
  let ok = 0;
  let fail = 0;

  /*
   * Process ads in batches to control API usage.
   */

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    /*
     * Generate and store embeddings for each ad in the current batch.
     */
    for (const r of batch) {
      const adId = Number(r.ad_id);
      const text = String(r.ad_text || "").trim();

      /*
       * Skip empty ad text because embeddings require meaningful input.
       */
      if (!text) {
        fail += 1;
        continue;
      }

      /*
       * Generate embedding using EmbeddingService.
       */
      const emb = await embedder.embedText(text);

      /*
       * If embedding generation fails, continue with remaining ads.
       */
      if (!emb) {
        fail += 1;
        continue;
      }

      try {

        /*
         * Store embedding JSON back into the ad context index.
         */
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
        /*
         * Log failed DB updates but keep processing later ads.
         */
        console.warn("❌ Update failed for ad_id:", adId, e?.message || e);
        fail += 1;
      }
    }

    /*
     * Report batch progress.
     */
    console.log(`📦 Progress: ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length} (ok=${ok}, fail=${fail})`);
     /*
     * Optional pause between batches to reduce load.
     */
    if (PAUSE_MS > 0) await sleep(PAUSE_MS);
  }

   /*
   * Final summary and successful exit.
   */
  console.log("✅ Embedding build complete", { ok, fail });
  process.exit(0);
}

/*
 * Run script and handle top-level failures.
 */
main().catch(err => {
  console.error("❌ build_ad_embeddings failed:", err);
  process.exit(1);
});
