// scripts/seed_ads_500.js
/* eslint-disable no-console */

const { getPool } = require("../src/db/mysql");

function pick(arr, i) {
  return arr[i % arr.length];
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

function randFromSeed(seed) {
  // deterministic-ish pseudo-rand from index
  let x = (seed * 9301 + 49297) % 233280;
  return x / 233280;
}

function buildAd(i) {
  // Wide scenario coverage
  const categories = [
    { cat: "education", themes: ["Online Course", "Bootcamp", "Crash Course", "Revision Pack", "Exam Prep"] },
    { cat: "productivity", themes: ["Planner", "Focus Toolkit", "Time Management", "Note-Taking", "Habit Builder"] },
    { cat: "software", themes: ["API Starter Kit", "Dev Tool", "Cloud Hosting", "CI/CD Setup", "Database Toolkit"] },
    { cat: "finance", themes: ["Budgeting App", "Savings Guide", "Tax Helper", "Credit Comparison", "Investing Basics"] },
    { cat: "travel", themes: ["Flight Deals", "Hotel Discounts", "City Pass", "Road Trip Planner", "Travel Insurance"] },
    { cat: "food", themes: ["Recipe Box", "Restaurant Finder", "Meal Planner", "Coffee Subscription", "Healthy Snacks"] },
    { cat: "fitness", themes: ["Gym Plan", "Yoga at Home", "Running Coach", "Meal Prep Program", "Sleep Routine"] },
    { cat: "home", themes: ["Furniture Deals", "Home Essentials", "DIY Starter Set", "Cleaning Kit", "Smart Home Guide"] },
    { cat: "careers", themes: ["CV Builder", "Interview Practice", "Job Alerts", "Portfolio Review", "LinkedIn Optimizer"] },
    { cat: "entertainment", themes: ["Movie Picks", "Music Discovery", "Gaming Deals", "Photography Basics", "Event Tickets"] },
    { cat: "shopping", themes: ["Discount Hub", "Price Tracker", "Student Deals", "Bundle Offers", "Gift Finder"] },
    { cat: "local_services", themes: ["Tutoring", "Repairs", "Cleaning", "Moving Help", "Courier Service"] },
  ];

  const geoScopes = ["GLOBAL", "UK", "EU", "US", "LOCAL"];
  const priceTiers = ["budget", "mid", "premium"];

  const catObj = pick(categories, i);
  const theme = pick(catObj.themes, i * 3);

  const intentHooks = {
    education: ["learn", "study", "revision", "exam", "tutorial"],
    productivity: ["plan", "focus", "organize", "schedule", "workflow"],
    software: ["deploy", "build", "debug", "optimize", "integrate"],
    finance: ["save", "budget", "invest", "tax", "compare"],
    travel: ["book", "trip", "vacation", "stay", "flight"],
    food: ["cook", "eat", "meal", "recipe", "delivery"],
    fitness: ["train", "sleep", "run", "strength", "wellness"],
    home: ["furniture", "home", "repair", "upgrade", "clean"],
    careers: ["cv", "resume", "interview", "job", "apply"],
    entertainment: ["watch", "listen", "play", "discover", "tickets"],
    shopping: ["deal", "discount", "buy", "compare", "bundle"],
    local_services: ["near me", "local", "book", "same day", "trusted"],
  };

  const hook = pick(intentHooks[catObj.cat] || ["discover"], i * 7);

  const geoScope = pick(geoScopes, i * 5);
  const priceTier = pick(priceTiers, i * 11);

  const offerName = `${theme} — ${catObj.cat.replace(/_/g, " ").toUpperCase()}`;
  const title = `${theme} (${geoScope})`;
  const description =
    `A ${priceTier} option to help you ${hook}. Designed for real-world use with clear steps and quick setup.`;

  const seed = 1000 + i;
  const imageUrl = `https://picsum.photos/seed/convad${seed}/1200/700`;
  const landingUrl = `https://example.com/convad/${slugify(title)}?src=convad&ad=${seed}`;

  // ad_text is what BM25 indexes
  const adText = `${title} ${description} Offer: ${offerName}. Category: ${catObj.cat}. Geo: ${geoScope}. Tier: ${priceTier}.`.trim();

  const adCard = {
    offer: offerName,
    desc: description,
    cta: "Open offer",
    category: catObj.cat,
    geo: geoScope,
    tier: priceTier,
  };

  // Map your schema’s "safety_category" field to content category (it’s a bit misnamed, but works)
  const safetyCategory = catObj.cat; // keep consistent with your filter/gate allowlists
  const geoScopeDb = geoScope;
  const priceTierDb = priceTier;

  return {
    title,
    description,
    imageUrl,
    landingUrl,
    status: "ACTIVE",
    adCard,
    adText,
    safetyCategory,
    geoScope: geoScopeDb,
    priceTier: priceTierDb,
  };
}

async function main() {
  const pool = getPool();

  const COUNT = Number(process.env.SEED_ADS_COUNT || 500);
  const START_AT = Number(process.env.SEED_ADS_START_AT || 0); // allows running multiple times deterministically
  const BATCH = Number(process.env.SEED_ADS_BATCH || 50);

  console.log(`🌱 Seeding ${COUNT} ads into ads + ad_context_index...`);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let inserted = 0;

    for (let offset = 0; offset < COUNT; offset += BATCH) {
      const batchN = Math.min(BATCH, COUNT - offset);

      for (let j = 0; j < batchN; j++) {
        const i = START_AT + offset + j;
        const ad = buildAd(i);

        // Insert into ads
        // Assumes ads schema includes: ad_id (AUTO), title, description, image_url, landing_url, status
        const [res] = await conn.execute(
          `
          INSERT INTO ads (title, description, image_url, landing_url, status)
          VALUES (?, ?, ?, ?, ?)
          `,
          [ad.title, ad.description, ad.imageUrl, ad.landingUrl, ad.status]
        );

        const adId = res.insertId;

        // Insert into ad_context_index using the same ad_id
        await conn.execute(
          `
          INSERT INTO ad_context_index
            (ad_id, ad_card_json, ad_text, embedding_json, safety_category, geo_scope, price_tier)
          VALUES
            (?, CAST(? AS JSON), ?, NULL, ?, ?, ?)
          `,
          [
            adId,
            JSON.stringify(ad.adCard),
            ad.adText,
            ad.safetyCategory,
            ad.geoScope,
            ad.priceTier,
          ]
        );

        inserted += 1;
      }

      console.log(`✅ Progress: ${inserted}/${COUNT}`);
    }

    await conn.commit();
    console.log(`🎉 Done. Inserted ${inserted} ads.`);

    console.log("\n🔎 Quick verification SQL (run in phpMyAdmin):");
    console.log("SELECT COUNT(*) AS total_ads FROM ads;");
    console.log("SELECT COUNT(*) AS total_indexed FROM ad_context_index;");
    console.log("SELECT COUNT(*) AS active_ads FROM ads WHERE status='ACTIVE';");
  } catch (e) {
    await conn.rollback();
    console.error("❌ Seeding failed, rolled back:", e?.message || e);
    process.exitCode = 1;
  } finally {
    conn.release();
  }
}

main().catch(err => {
  console.error("❌ seed_ads_500 crashed:", err);
  process.exit(1);
});
