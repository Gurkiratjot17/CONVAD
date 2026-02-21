// scripts/seed_ads_unique_1000.js
/* eslint-disable no-console */

const crypto = require("crypto");
const { getPool } = require("../src/db/mysql");

// ----------------------------
// helpers
// ----------------------------
function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

function norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// deterministic pseudo-random from an integer seed
function prand(seed) {
  let x = (seed * 9301 + 49297) % 233280;
  return x / 233280;
}

function pick(arr, seed) {
  return arr[Math.floor(prand(seed) * arr.length) % arr.length];
}

function weightedPick(items, seed) {
  // items: [{value, weight}]
  const r = prand(seed);
  const total = items.reduce((a, it) => a + it.weight, 0);
  let acc = 0;
  for (const it of items) {
    acc += it.weight / total;
    if (r <= acc) return it.value;
  }
  return items[items.length - 1].value;
}

function monthNowUTC() {
  return new Date().getUTCMonth() + 1; // 1..12
}

// ----------------------------
// realism config
// ----------------------------
const CATEGORY_DEFS = [
  // Academic/student-heavy (realistic for your assistant)
  {
    cat: "education",
    weight: 0.18,
    themes: [
      "Online Course", "Bootcamp", "Crash Course", "Revision Pack", "Exam Prep",
      "Skill Workshop", "Certification Program", "Study Toolkit", "Mock Tests",
      "Learning Path", "Lecture Notes Pack", "Lab Guide", "Practice Questions"
    ],
    hooks: [
      "prepare for exams", "revise faster", "understand complex topics",
      "practice mock tests", "improve grades", "learn new skills",
      "write better assignments", "study efficiently", "master fundamentals",
      "build a learning plan", "pass interviews", "strengthen concepts"
    ],
    clusters: ["study", "revision", "learning", "assessment"],
  },
  {
    cat: "productivity",
    weight: 0.16,
    themes: [
      "Planner", "Focus Toolkit", "Time Management", "Note-Taking",
      "Habit Builder", "Daily Tracker", "Workflow Optimizer",
      "Project Dashboard", "Goal Setter", "Deep Work System",
      "Pomodoro Pack", "Distraction Blocker", "Weekly Review System"
    ],
    hooks: [
      "organize tasks", "plan your day", "reduce distractions",
      "manage deadlines", "track habits", "build routines",
      "structure projects", "improve focus", "increase output",
      "prioritize better", "avoid procrastination", "stay consistent"
    ],
    clusters: ["planning", "focus", "workflow", "habits"],
  },
  {
    cat: "careers",
    weight: 0.14,
    themes: [
      "CV Builder", "Interview Practice", "Job Alerts",
      "Portfolio Review", "LinkedIn Optimizer", "Graduate Scheme Prep",
      "Salary Negotiation Guide", "Networking Toolkit", "Remote Work Guide",
      "Cover Letter Kit", "ATS Resume Pack", "Mock Interview Set"
    ],
    hooks: [
      "improve CV", "prepare interviews", "apply confidently",
      "get hired faster", "build portfolio", "switch careers",
      "network professionally", "negotiate salary", "find job opportunities",
      "prepare graduate schemes", "write cover letters", "practice answers"
    ],
    clusters: ["career", "jobs", "interview", "resume"],
  },

  // Tech-heavy (matches CONVAD + dev audience)
  {
    cat: "software",
    weight: 0.12,
    themes: [
      "API Starter Kit", "Dev Tool", "Cloud Hosting",
      "CI/CD Setup", "Database Toolkit", "Auth System",
      "Frontend Template", "Backend Framework", "Logging Service",
      "Deployment Pack", "Monitoring Stack", "Performance Audit"
    ],
    hooks: [
      "deploy applications", "build APIs", "debug faster",
      "optimize backend", "improve performance", "integrate services",
      "automate deployments", "scale infrastructure", "manage databases",
      "reduce latency", "add observability", "ship features faster"
    ],
    clusters: ["dev", "infrastructure", "database", "deployment"],
  },
  {
    cat: "ai_tools",
    weight: 0.08,
    themes: [
      "AI Assistant", "Prompt Library", "Code Helper",
      "Data Analyzer", "Automation Tool", "Chatbot Builder",
      "AI Research Tool", "Voice AI Pack", "AI Resume Builder",
      "Content Generator", "Summarizer Tool", "Idea Booster"
    ],
    hooks: [
      "automate tasks", "analyze data", "write code faster",
      "generate content", "improve research", "build chatbot",
      "draft summaries", "create prompts", "speed up productivity",
      "organize ideas", "extract insights", "test approaches"
    ],
    clusters: ["ai", "automation", "analysis", "generation"],
  },

  // Consumer / lifestyle (still useful to show “breadth”)
  {
    cat: "finance",
    weight: 0.06,
    themes: [
      "Budgeting App", "Savings Guide", "Tax Helper",
      "Expense Tracker", "Loan Calculator", "Investing Basics",
      "Student Budget Kit", "Subscription Manager", "Credit Builder"
    ],
    hooks: [
      "save money", "track expenses", "budget monthly spending",
      "reduce debt", "optimize taxes", "build emergency fund",
      "compare loans", "manage subscriptions", "improve credit"
    ],
    clusters: ["money", "budget", "finance"],
  },
  {
    cat: "travel",
    weight: 0.05,
    themes: [
      "Flight Deals", "Hotel Discounts", "Weekend Getaway",
      "Road Trip Planner", "Travel Insurance", "Local Tours",
      "City Pass", "Visa Support"
    ],
    hooks: [
      "book cheaper flights", "compare hotels", "plan vacations",
      "travel on budget", "organize trips", "secure travel insurance",
      "discover destinations", "plan weekend getaway"
    ],
    clusters: ["travel", "booking", "planning"],
  },
  {
    cat: "food",
    weight: 0.05,
    themes: [
      "Meal Planner", "Quick Recipes", "Budget Grocery Guide",
      "Coffee Subscription", "Healthy Snacks", "Student Meal Plan",
      "Protein Bundle", "Restaurant Finder"
    ],
    hooks: [
      "cook healthy meals", "save on groceries", "prepare quick meals",
      "meal prep efficiently", "discover recipes", "eat balanced diet",
      "find restaurants", "plan weekly menu"
    ],
    clusters: ["food", "meal", "health"],
  },
  {
    cat: "fitness",
    weight: 0.05,
    themes: [
      "Gym Plan", "Yoga at Home", "Sleep Routine",
      "Strength Builder", "Recovery Guide", "Running Coach",
      "Stretch Routine", "Cardio Pack"
    ],
    hooks: [
      "build strength", "improve endurance", "sleep better",
      "stay consistent", "recover faster", "increase flexibility",
      "boost energy", "follow workout plan"
    ],
    clusters: ["fitness", "health", "routine"],
  },
  {
    cat: "home",
    weight: 0.04,
    themes: [
      "Workspace Upgrade", "Storage System", "Cleaning Kit",
      "Smart Home Guide", "Lighting Upgrade", "DIY Starter Set",
      "Minimalist Setup", "Home Essentials"
    ],
    hooks: [
      "upgrade workspace", "organize storage", "clean efficiently",
      "reduce clutter", "optimize space", "install smart devices",
      "improve comfort", "fix repairs"
    ],
    clusters: ["home", "organization", "setup"],
  },
  {
    cat: "local_services",
    weight: 0.02,
    themes: [
      "Tutoring", "Handyman Support", "Cleaning",
      "Repairs", "Moving Help", "Courier Service",
      "Electrician Booking", "Plumber Visit", "Pet Care"
    ],
    hooks: [
      "book local services", "find trusted professionals",
      "schedule repairs", "hire tutors", "book same-day service",
      "arrange moving help", "solve home issues"
    ],
    clusters: ["local", "booking", "services"],
  },
  {
    cat: "mental_health",
    weight: 0.02,
    themes: [
      "Meditation Pack", "Stress Relief Guide", "Mindfulness Course",
      "Wellbeing Plan", "Burnout Recovery", "Sleep Therapy",
      "Focus Meditation", "Self Care Bundle"
    ],
    hooks: [
      "reduce stress", "manage anxiety", "improve wellbeing",
      "sleep peacefully", "recover from burnout", "build resilience",
      "develop coping skills", "improve mental clarity"
    ],
    clusters: ["wellbeing", "mindfulness", "sleep"],
  },
  {
    cat: "shopping",
    weight: 0.01,
    themes: [
      "Discount Hub", "Price Tracker", "Student Deals",
      "Bundle Offers", "Gift Finder", "Coupon Pack",
      "Flash Deals", "Seasonal Offers"
    ],
    hooks: [
      "find discounts", "compare prices", "save on purchases",
      "track price drops", "redeem coupons", "buy gifts"
    ],
    clusters: ["shopping", "deals", "savings"],
  },
  {
    cat: "entertainment",
    weight: 0.02,
    themes: [
      "Movie Picks", "Music Discovery", "Event Tickets",
      "Streaming Bundle", "Podcast Finder", "Gaming Deals",
      "Concert Alerts"
    ],
    hooks: [
      "discover new movies", "find music", "buy event tickets",
      "watch trending shows", "discover podcasts", "explore games"
    ],
    clusters: ["entertainment", "events", "media"],
  },
];

// Seasonal nudges (small bias that makes “trends” feel believable)
function seasonalBoost(cat, month) {
  // month: 1..12
  // Keep mild boosts so we don’t distort variety too hard.
  const boosts = {
    education: [1,2,5,6,9,10,11,12].includes(month) ? 1.25 : 1.0, // exams/semesters
    travel: [6,7,8,12].includes(month) ? 1.25 : 1.0, // summer + holidays
    fitness: [1,2].includes(month) ? 1.25 : 1.0, // new year
    shopping: [11,12].includes(month) ? 1.35 : 1.0, // black friday/xmas
  };
  return boosts[cat] || 1.0;
}

// Geo scope weighting (slightly more realistic than uniform)
function pickGeo(seed) {
  const geos = [
    { value: "UK", weight: 0.36 },
    { value: "EU", weight: 0.20 },
    { value: "US", weight: 0.16 },
    { value: "GLOBAL", weight: 0.20 },
    { value: "LOCAL", weight: 0.08 },
  ];
  return weightedPick(geos, seed);
}

function pickTier(seed) {
  const tiers = [
    { value: "budget", weight: 0.46 },
    { value: "mid", weight: 0.38 },
    { value: "premium", weight: 0.16 },
  ];
  return weightedPick(tiers, seed);
}

function pickCategory(seed) {
  const m = monthNowUTC();

  // apply seasonal boost to weights dynamically
  const boosted = CATEGORY_DEFS.map(d => ({
    value: d,
    weight: d.weight * seasonalBoost(d.cat, m),
  }));

  return weightedPick(boosted, seed);
}

function buildAd(i) {
  // choose category with realism weighting + seasonal bias
  const def = pickCategory(i * 17 + 3);

  const geoScope = pickGeo(i * 29 + 7);
  const priceTier = pickTier(i * 31 + 11);

  const theme = pick(def.themes, i * 13 + 5);
  const hook = pick(def.hooks, i * 19 + 9);

  // add a “modifier” so titles don’t collide too easily within a category
  const modifiers = [
    "Starter", "Pro", "Fast Track", "Step-by-step", "Template",
    "Toolkit", "Bundle", "Guide", "Pack", "Playbook"
  ];
  const mod = pick(modifiers, i * 23 + 2);

  const offerName = `${theme} ${mod} — ${def.cat.replace(/_/g, " ").toUpperCase()}`;
  const title = `${theme} ${mod} (${geoScope})`;

  const description =
    `A ${priceTier} option to help you ${hook}. Built for real use-cases with clear steps, quick setup, and measurable outcomes.`;

  // stable image seed from content identity (not run-dependent)
  const imgSeed = sha256(`${norm(title)}|${norm(description)}`).slice(0, 14);
  const imageUrl = `https://picsum.photos/seed/convad_${imgSeed}/1200/700`;

  // landing url stable-ish; doesn't define uniqueness
  const landingUrl = `https://example.com/convad/${slugify(title)}?src=convad&k=${imgSeed}&geo=${geoScope}`;

  // intent clusters
  const intentCluster = pick(def.clusters, i * 37 + 4);

  // include cluster + category + geo + tier in ad_text for BM25
  const adText = [
    title,
    description,
    `Offer: ${offerName}.`,
    `Category: ${def.cat}.`,
    `Intent: ${intentCluster}.`,
    `Geo: ${geoScope}.`,
    `Tier: ${priceTier}.`,
    `Keywords: ${hook}.`
  ].join(" ").trim();

  const adCard = {
    offer: offerName,
    desc: description,
    cta: "Open offer",
    category: def.cat,
    intent_cluster: intentCluster,
    geo: geoScope,
    tier: priceTier,
    // handy for your evaluation screenshots:
    eval_tags: [def.cat, intentCluster, geoScope, priceTier],
  };

  // Dedupe key MUST ignore landing_url (your earlier issue)
  const dedupeKey = sha256(`${norm(title)}|${norm(description)}|${norm(imageUrl)}`);

  return {
    title,
    description,
    imageUrl,
    landingUrl,
    status: "ACTIVE",
    dedupeKey,
    adCard,
    adText,
    safetyCategory: def.cat, // your schema uses safety_category; you're using it as category
    geoScope,
    priceTier,
  };
}

async function main() {
  const pool = getPool();

  const COUNT = Math.max(1000, Number(process.env.SEED_ADS_COUNT || 1000));
  const START_AT = Number(process.env.SEED_ADS_START_AT || 0);
  const BATCH = Math.max(25, Number(process.env.SEED_ADS_BATCH || 100));

  console.log(`🌱 Seeding ${COUNT} UNIQUE ads (idempotent). START_AT=${START_AT} BATCH=${BATCH}`);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let processed = 0;

    for (let offset = 0; offset < COUNT; offset += BATCH) {
      const batchN = Math.min(BATCH, COUNT - offset);

      for (let j = 0; j < batchN; j++) {
        const idx = START_AT + offset + j;
        const ad = buildAd(idx);

        // UPSERT ads by unique dedupe_key.
        // LAST_INSERT_ID trick returns existing row id when duplicate key hit.
        const [res] = await conn.execute(
          `
          INSERT INTO ads (title, description, image_url, landing_url, status, dedupe_key)
          VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            ad_id = LAST_INSERT_ID(ad_id),
            title = VALUES(title),
            description = VALUES(description),
            image_url = VALUES(image_url),
            landing_url = VALUES(landing_url),
            status = VALUES(status)
          `,
          [ad.title, ad.description, ad.imageUrl, ad.landingUrl, ad.status, ad.dedupeKey]
        );

        const adId = res.insertId;

        // UPSERT ad_context_index (PK: ad_id)
        await conn.execute(
          `
          INSERT INTO ad_context_index
            (ad_id, ad_card_json, ad_text, embedding_json, safety_category, geo_scope, price_tier)
          VALUES
            (?, CAST(? AS JSON), ?, NULL, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            ad_card_json = VALUES(ad_card_json),
            ad_text = VALUES(ad_text),
            safety_category = VALUES(safety_category),
            geo_scope = VALUES(geo_scope),
            price_tier = VALUES(price_tier),
            updated_at = CURRENT_TIMESTAMP
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

        processed += 1;
      }

      console.log(`✅ Progress: ${processed}/${COUNT}`);
    }

    await conn.commit();
    console.log(`🎉 Done. Processed ${processed} ads (inserted/updated without duplicates).`);

    console.log("\n🔎 Verification SQL:");
    console.log("SELECT COUNT(*) AS total_ads FROM ads;");
    console.log("SELECT COUNT(*) AS total_indexed FROM ad_context_index;");
    console.log("SELECT COUNT(*) AS active_ads FROM ads WHERE status='ACTIVE';");
    console.log("SELECT COUNT(*) AS dupes FROM (SELECT dedupe_key, COUNT(*) c FROM ads GROUP BY dedupe_key HAVING c>1) t;");
  } catch (e) {
    await conn.rollback();
    console.error("❌ Seeding failed, rolled back:", e?.message || e);
    process.exitCode = 1;
  } finally {
    conn.release();
  }
}

main().catch(err => {
  console.error("❌ seed_ads_unique_1000 crashed:", err);
  process.exit(1);
});