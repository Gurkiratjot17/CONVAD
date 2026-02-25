# ＣＯＮＶＡＤ

<p align="left">
  <img src="https://img.shields.io/badge/node-18.x-informational" alt="Node.js 18">
  <img src="https://img.shields.io/badge/docker-ready-blue" alt="Docker Ready">
  <img src="https://img.shields.io/badge/mysql-8.x-orange" alt="MySQL 8">
  <img src="https://img.shields.io/badge/status-active--development-brightgreen" alt="Status">
</p>

---

## 🚀 Overview

**CONVAD** is a full-stack conversational AI platform that combines:

* LLM-driven chat
* Session-based authentication
* Hybrid ad retrieval (BM25 + embeddings)
* Policy-controlled ad rendering
* Real-time analytics & admin dashboard

It is designed as a **system-level prototype** to explore how conversational intent can be inferred, scored, gated, and operationalised into context-aware advertising — without degrading user experience.

This project was developed as a **Final Year Project (FYP)** and focuses heavily on:

* Architecture design
* Retrieval algorithms
* Intent-policy systems
* Data modelling
* Streaming UX engineering
* Observability & analytics

---

# 🏗 System Architecture

```text
User → Chat UI → Express Backend →
    ├─ LLM Service (Streaming)
    ├─ Intent Extraction
    ├─ Candidate Retrieval (BM25)
    ├─ Embedding Re-rank
    ├─ Intent Policy Gate
    ├─ Ad Selection Service
    └─ Event Logger
```

The architecture separates:

* Retrieval logic
* Policy logic
* Rendering logic
* Observability

This makes the decision pipeline auditable and explainable.

---

# 📦 Tech Stack

## Runtime & Backend

* Node.js 18
* Express.js
* Modular Service Layer Architecture
* Server-Sent Events (SSE) for streaming

## AI & Retrieval

* OpenAI API (LLM inference)
* BM25-style lexical retrieval
* Embedding-based semantic re-ranking
* Hybrid scoring pipeline

## Database

* MySQL 8
* Normalised relational schema
* Indexed ad context table
* Event logging for analytics

## DevOps

* Docker
* Docker Compose
* phpMyAdmin
* GitHub Actions (CI-ready)

---

# 💬 Conversational AI

* Multi-turn conversation memory
* Token-by-token streaming responses (ChatGPT-style)
* Optimistic UI rendering
* Conversation resume support
* Messages persisted in database
* Context snapshots stored for decision traceability

---

# 📢 Advanced Advertising Engine

## 🔎 Hybrid Retrieval Pipeline

1. BM25-style lexical retrieval
2. Top-N candidate filtering
3. Embedding similarity re-ranking
4. Weighted hybrid score calculation
5. Policy gating
6. Final selection

This allows CONVAD to balance:

* Precision (keyword relevance)
* Semantic understanding
* Business rules
* User safety

---

## 🛡 Intent Policy Gate

A dedicated policy layer controls whether ads are allowed to render.

### Includes:

* Conversation-level frequency caps
* Turn-based spacing logic
* Cooldown windows
* Intent confidence thresholds
* Safety filtering
* Render-based counting (NOT selection-based)

This ensures:

* Ads do not spam users
* Decisions are auditable
* UX is prioritised

---

## 📊 Event Logging & Observability

All ad lifecycle events are tracked:

* Selected
* Rendered
* Clicked
* Hidden

Stored in:

* `ad_events`
* `ad_decisions`
* `conversation_context_snapshots`

This enables:

* True impression counting (rendered-only)
* CTR analysis
* Debug trace viewer
* Policy validation

---

# 🧠 Admin Dashboard

The internal admin portal provides:

* System activity line charts
* Selected vs Rendered tracking
* Click-through analytics
* Top performing ads
* Decision trace viewer
* Time-series filtering
* Dark/light theme support

Charts use deduplicated time-series logic to prevent duplicate axis values.

---

# 🔐 Authentication & Sessions

* Registration & login
* Secure password hashing
* Bearer-token authentication
* Login sessions stored in database
* Expiry enforcement
* Server-side logout
* Protected API routes

---

# 🗂 Conversation Management

* Multiple conversations per user
* Context-aware title generation
* Timestamped threads
* Resume across sessions
* Role-separated messages (user / assistant)
* Conversation-scoped ad caps

---

# 🎨 Frontend UX

* Streaming UI
* Banner injection system
* Fade-in / fade-out ad rendering
* Mobile-responsive layout
* Sidebar drawer
* LocalStorage theme persistence
* Optimistic message rendering

---

# 🗄 Database Overview

## Core Tables

* `users`
* `user_auth`
* `login_sessions`
* `conversations`
* `messages`

## Advertising & Indexing

* `ads`
* `ad_context_index`
* `ad_events`
* `ad_decisions`
* `conversation_context_snapshots`

The `ad_context_index` table stores:

* Preprocessed ad text
* Embeddings
* Structured ad card JSON
* Safety metadata
* Targeting attributes

---

# 🔁 Streaming Flow (With Ads)

1. User sends message
2. Session validated
3. Message stored
4. Intent extracted
5. Candidate ads retrieved
6. Hybrid scoring applied
7. Policy gate evaluated
8. LLM response streamed
9. Ad rendered (if allowed)
10. Event logged
11. Decision trace stored

All steps are independently testable.

---

# 📊 Current Status

## ✅ Completed

* Full hybrid retrieval pipeline
* Embedding re-rank integration
* Intent policy gate
* Render-based impression counting
* Event logging system
* Admin dashboard analytics
* Decision trace viewer
* Dockerised deployment
* Streaming chat UX
* Authentication system

## 🚧 In Progress

* Session-level intent aggregation
* A/B testing logic
* Adaptive frequency caps
* Revenue simulation metrics
* Performance benchmarking

---

# 🐳 Running with Docker

## Start

```bash
docker compose up --build
```

## Services

* App → [http://localhost:3000](http://localhost:3000)
* phpMyAdmin → [http://localhost:8080](http://localhost:8080)

## Stop

```bash
docker compose down
```

---

# 🔧 Environment Configuration

Create a `.env` file:

```dotenv
DB_HOST=?
DB_PORT=?
DB_NAME=?
DB_USER=?
DB_PASSWORD=?
DB_ROOT=?

OPENAI_API_KEY=?
OPENAI_MODEL=gpt-4o-mini
```

⚠️ Never commit `.env` or secrets.

---

# 🎓 Academic Focus

CONVAD investigates:

> How can conversational intent be inferred and used in real-time AI-powered conversational systems to enable monetisation without disrupting the user experience?

It explores:

* Hybrid retrieval vs pure semantic models
* Policy-layer system design
* Explainable ad decision pipelines
* UX-aware monetisation architecture
* Observability in AI-driven systems

This is not just a chatbot — it is an experimentation platform for conversational monetisation systems.

---

# 📌 Project Nature

* Research prototype
* Not a production ad platform
* Built for architectural experimentation
* Designed to demonstrate system-level engineering capability

---

# 👨‍💻 Developer

Name: **Gurkiratjot Singh**

📧  [gurkiratjotsingh17@gmail.com](mailto:gurkiratjotsingh17@gmail.com)

