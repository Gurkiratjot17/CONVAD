# ＣＯＮＶＡＤ

<p align="left">
  <img src="https://img.shields.io/badge/node-18.x-informational" alt="Node.js 18">
  <img src="https://img.shields.io/badge/docker-ready-blue" alt="Docker Ready">
</p>

---

## 🚀 Overview

CONVAD is a full-stack conversational AI platform that combines **LLM-driven chat**, **session-based authentication**, and **context-aware advertising infrastructure**.  
It is designed as a realistic prototype for exploring how **user intent in conversations** can be leveraged to deliver relevant ads without breaking conversational flow.

This project was developed as part of a **Final Year Project (FYP)** and focuses on **system design, backend architecture, streaming UX, and data persistence**, rather than just prompt engineering.

---

## 📦 Tech Stack

| Layer            | Technology             |
|------------------|------------------------|
| Runtime          | Node.js 18             |
| Framework        | Express.js             |
| Containerization | Docker, Docker Compose |
| Language         | JavaScript (ES6)       |
| CI/CD            | GitHub Actions         |

---

## 🚀 Key Features

### 💬 Conversational AI
- LLM-powered chatbot with multi-turn context
- Token-by-token **streaming responses** (ChatGPT-style)
- Conversation history persisted in MySQL
- Optimistic UI updates for low-latency UX

### 🔐 Authentication & Sessions
- User **registration & login**
- Secure password hashing
- **Session-based authentication** using bearer tokens
- Login sessions stored in database with expiry
- Server-side logout + client-side token invalidation

### 🗂 Conversation Management
- Multiple conversations per user
- Conversation list with timestamps
- Resume conversations across sessions
- Messages stored with role separation (user / assistant)

### 📢 Advertising Infrastructure (Foundation)
- Ads library schema (ads, tags, impressions)
- Keyword-based matching pipeline (LLM → keywords → ads)
- Impression tracking linked to chat messages
- Designed for future real-time ad injection during streaming

### 🎨 Frontend UI / UX
- Clean chat interface inspired by ChatGPT
- **Dark mode / Light mode** toggle (persisted in localStorage)
- Fully **responsive design** (desktop + mobile)
- Mobile sidebar drawer with backdrop
- Typing indicators and streaming bubbles

### 🐳 Dockerised Development
- MySQL database container
- phpMyAdmin for DB inspection
- Node.js backend container
- One-command startup via Docker Compose

---

## 🏗️ Tech Stack

### Frontend
- Vanilla HTML, CSS, JavaScript
- Responsive CSS Grid & Flexbox
- Server-Sent Events (SSE) for streaming

### Backend
- Node.js + Express
- OpenAI API (LLM inference)
- Streaming responses via SSE
- Modular service-oriented architecture

### Database
- MySQL 8
- Normalised relational schema
- Foreign key constraints for integrity

### DevOps
- Docker & Docker Compose
- Environment-based configuration

---

## 🗄️ Database Overview

Core tables include:

- `users` — user profiles  
- `user_auth` — password hashes  
- `login_sessions` — active sessions with expiry  
- `conversations` — chat threads  
- `messages` — individual messages  
- `ads` — advertisement content  
- `tags` — ad categorisation  
- `ad_tags` — many-to-many mapping  
- `ad_impressions` — ads shown per message  

The schema is intentionally extensible to support:
- intent tracking per session
- ad performance analytics
- future recommendation logic

---

## 🔁 Streaming Architecture (High-Level)

1. User sends a message  
2. Backend validates session  
3. Message stored immediately  
4. LLM response streamed token-by-token via SSE  
5. Tokens rendered incrementally in UI  
6. Final message persisted to database  
7. Conversation metadata updated  

This mirrors real production chat systems and avoids artificial typing delays.

---

## 📱 Mobile Support

- Responsive layout down to phone screens
- Sidebar collapses into a slide-out drawer
- Backdrop interaction for accessibility
- Touch-friendly buttons and spacing
- Proper viewport scaling

---

## 🐳 Running with Docker 

### Start the service

```bash
docker compose up --build
```

Endpoints:

- Main: **http://localhost:3000/**
- phpMyAdmin: **http://localhost:8080/**

To stop:

```bash
docker compose down
```

---

## 🧪 Current Status

✅ Fully working authentication

✅ Persistent chat with streaming

✅ Responsive UI with theme switching

✅ Database-backed conversations

✅ Ads infrastructure ready for integration

### Planned / In Progress

- Real-time ad injection during streaming

- Intent aggregation per session

- Ad relevance scoring

---
Basic analytics dashboard
---

### 🔧 Configuration

Environment variables can be set using a `.env` file (not committed):

```dotenv
DB_HOST=?
DB_PORT=?
DB_NAME=?
DB_USER=?
DB_PASSWORD=?
DB_ROOT=?

OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-4o-mini

> ⚠️ Never commit `.env` or secrets to Git.
```

---

## 🎓 Academic Context


This project explores the question:

How can conversational intent be inferred and operationalised in real-time systems without disrupting user experience?

Rather than focusing only on AI outputs, CONVAD emphasises:

- system design decisions

- data modelling

- UX trade-offs

- real-world deployment constraints

---

## 📌 Notes

- This is a prototype, not a production ad platform

- Security best practices are followed where appropriate for an academic project

- The architecture is intentionally modular for future expansion

---

## Contact

For any inquiries or suggestions, feel free to reach out to the project team:

- **Developers**: Gurkiratjot Singh
- **Emails**: gurkiratjotsingh17@gmail.com

--- 
