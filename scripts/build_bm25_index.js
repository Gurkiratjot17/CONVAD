// scripts/build_bm25_index.js
/* eslint-disable no-console */

const { getPool } = require("../src/db/mysql");

// --- lightweight tokenizer ---
/*
 * STOP words set
 *
 * Common words removed during tokenization to reduce noise
 * and improve retrieval quality.
 */
const STOP = new Set([
  "the","a","an","and","or","but","if","then","else","to","of","in","on","for","with","at","by",
  "i","you","we","they","he","she","it","is","are","was","were","be","been","being",
  "my","your","our","their","me","him","her","them",
  "this","that","these","those",
  "what","how","why","when","where","which",
  "can","could","should","would","do","did","does",
  "today","tomorrow","yesterday","please","thanks","thank",
]);

/*
 * Tokenization function
 *
 * Converts raw text into normalized tokens:
 * - lowercases text
 * - removes punctuation
 * - splits into words
 * - removes stopwords, numbers, and very short tokens
 */
function tokenize(text) {
  const t = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return [];
  const raw = t.match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) || [];
  return raw
    .map(w => w.trim())
    .filter(w => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w));
}

/*
 * Utility function to split arrays into chunks
 *
 * Used for batching large inserts into the database.
 */
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/*
 * Ensures required BM25 index tables exist.
 *
 * Tables:
 * - ad_terms: inverted index postings (term frequency per ad)
 * - term_stats: document frequency per term
 * - ad_stats: document length per ad
 * - corpus_stats: global corpus statistics
 */
async function ensureTables(pool) {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS ad_terms (
      ad_id BIGINT NOT NULL,
      term VARCHAR(64) NOT NULL,
      tf INT NOT NULL,
      PRIMARY KEY (ad_id, term),
      INDEX idx_term (term),
      INDEX idx_term_tf (term, tf)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS term_stats (
      term VARCHAR(64) NOT NULL PRIMARY KEY,
      df INT NOT NULL,
      INDEX idx_df (df)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS ad_stats (
      ad_id BIGINT NOT NULL PRIMARY KEY,
      doc_len INT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS corpus_stats (
      id TINYINT NOT NULL PRIMARY KEY,
      total_docs INT NOT NULL,
      avg_doc_len FLOAT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

/*
 * Clears existing BM25 index tables.
 *
 * This ensures a full rebuild rather than incremental updates.
 */
async function clearTables(pool) {
  await pool.execute(`DELETE FROM ad_terms`);
  await pool.execute(`DELETE FROM term_stats`);
  await pool.execute(`DELETE FROM ad_stats`);
  await pool.execute(`DELETE FROM corpus_stats`);
}

/*
 * Fetches all active ads.
 *
 * Prefers preprocessed ad_text from ad_context_index,
 * falling back to title + description if needed.
 */
async function fetchAds(pool) {
  const [rows] = await pool.execute(`
    SELECT
      a.ad_id,
      a.title,
      a.description,
      aci.ad_text
    FROM ads a
    LEFT JOIN ad_context_index aci ON aci.ad_id = a.ad_id
    WHERE a.status = 'ACTIVE'
    ORDER BY a.ad_id ASC
  `);
  return rows || [];
}

/*
 * Batch insert helper.
 *
 * Builds parameterised multi-row INSERT statements
 * to improve database write efficiency.
 */
async function insertMany(pool, sql, rows, batchSize = 1000) {
  const batches = chunk(rows, batchSize);
  for (const b of batches) {
    const params = [];
    const values = b
      .map(r => {
        params.push(...r);
        return `(${r.map(() => "?").join(",")})`;
      })
      .join(",");
    await pool.execute(`${sql} ${values}`, params);
  }
}

async function main() {
  const pool = getPool(); 

  console.log("🔧 Ensuring BM25 tables...");
  await ensureTables(pool);

  console.log("🧹 Clearing existing BM25 index...");
  await clearTables(pool);

  console.log("📥 Fetching ACTIVE ads...");
  const ads = await fetchAds(pool);
  console.log(`✅ Loaded ${ads.length} ads`);

  /*
   * Data structures for building BM25 index
   */
  const df = new Map(); // term -> document frequency
  const adDocLen = new Map(); // ad_id -> document length
  const adTermTfRows = []; // [ad_id, term, tf]

  let totalLen = 0;
  let totalDocs = 0;

  console.log("🧠 Building term frequencies + df...");
  for (const a of ads) {
    const adId = Number(a.ad_id);

    /*
     * Use precomputed ad_text where available,
     * otherwise construct from title + description.
     */
    const text = String(a.ad_text || `${a.title || ""} ${a.description || ""}`).trim();
    const terms = tokenize(text);

    if (!terms.length) continue;

    totalDocs += 1;
    totalLen += terms.length;
    adDocLen.set(adId, terms.length);

    /*
     * Compute term frequency (TF) for this document.
     */
    const tf = new Map();
    for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1);

    /*
     * Update document frequency (DF) using unique terms.
     */
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);

    /*
     * Store postings (ad_id, term, tf).
     */
    for (const [term, count] of tf.entries()) {
      // cap tf to avoid pathological docs
      const safeTf = Math.min(255, Number(count) || 0);
      adTermTfRows.push([adId, term, safeTf]);
    }
  }

  /*
   * Compute average document length for BM25 normalization.
   */
  const avgDocLen = totalDocs > 0 ? totalLen / totalDocs : 100;

  console.log("💾 Writing ad_stats...");
  const adStatsRows = Array.from(adDocLen.entries()).map(([adId, len]) => [adId, len]);
  if (adStatsRows.length) {
    await insertMany(pool, `INSERT INTO ad_stats (ad_id, doc_len) VALUES`, adStatsRows, 2000);
  }

  console.log("💾 Writing term_stats...");
  const termStatsRows = Array.from(df.entries()).map(([term, d]) => [term, d]);
  if (termStatsRows.length) {
    await insertMany(pool, `INSERT INTO term_stats (term, df) VALUES`, termStatsRows, 2000);
  }

  console.log("💾 Writing ad_terms...");
  if (adTermTfRows.length) {
    await insertMany(pool, `INSERT INTO ad_terms (ad_id, term, tf) VALUES`, adTermTfRows, 2000);
  }

  console.log("💾 Writing corpus_stats...");
  await pool.execute(
    `INSERT INTO corpus_stats (id, total_docs, avg_doc_len) VALUES (1, ?, ?)`,
    [totalDocs, avgDocLen]
  );

  console.log("✅ BM25 index build complete");
  console.log({
    totalDocs,
    avgDocLen,
    uniqueTerms: df.size,
    postings: adTermTfRows.length,
  });

  process.exit(0);
}

main().catch(err => {
  console.error("❌ build_bm25_index failed:", err);
  process.exit(1);
});