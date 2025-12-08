# ＣＯＮＶＡＤ

*Conversational Advertising Engine – early-stage product backend*

---

<p align="left">
  <img src="https://img.shields.io/badge/node-18.x-informational" alt="Node.js 18">
  <img src="https://img.shields.io/badge/docker-ready-blue" alt="Docker Ready">
  <img src="https://img.shields.io/badge/license-MIT-yellow.svg" alt="MIT License">
</p>

---

## 🚀 Overview

CONVAD is a containerized Node.js backend designed to power interactive, AI-driven advertising experiences.

It currently provides:

- A clean Express server scaffold
- Dockerized runtime
- Health check endpoint
- CI pipeline for build & test
- A foundation for future conversational ad logic and integrations

The goal is to evolve CONVAD from a backend prototype into a real product backend that supports conversational ad flows, dynamic personalization, and analytics.

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

## 📁 Project Structure

```bash
convad/
│
├── src/
│   └── index.js              # Main server entrypoint
│
├── Dockerfile                # Builds the runtime image
├── docker-compose.yml        # Dev/prod container orchestration
├── package.json              # Node metadata + scripts
├── .dockerignore             # Keeps image clean
├── .gitignore                # Keeps repository clean
└── README.md                 # Project documentation
```

---

## 🛠 Installation & Setup

### 1. Clone the repository

```bash
git clone https://github.com/Gurkiratjot17/CONVAD.git
cd convad
```

---

## 🐳 Running with Docker (recommended)

### Start the service

```bash
docker compose up --build
```

Endpoints:

- Main: **http://localhost:3000/**
- Health: **http://localhost:3000/health**

To stop:

```bash
docker compose down
```

---

## ▶ Running locally (without Docker)

```bash
npm install
npm run dev        # or: npm start
```

- `npm run dev` uses nodemon for auto-reload (if configured).
- `npm start` runs the server normally.

---

## 🧩 NPM Scripts

| Script | Command         | Description               |
|--------|-----------------|---------------------------|
| Start  | `npm start`     | Run the Express server    |
| Dev    | `npm run dev`   | Start with auto-reload    |
| Test   | `npm test`      | Run smoke tests (CI)      |

---

## 🔧 Configuration

Environment variables can be set using a `.env` file (not committed):

```dotenv
PORT=3000
NODE_ENV=development
```

Examples of future env vars:

- `OPENAI_API_KEY`
- `DATABASE_URL`
- `REDIS_URL`

> ⚠️ Never commit `.env` or secrets to Git.

---

## 🧱 Architecture (current & near-term)

CONVAD is a small but expandable Node.js service.

### Current high-level flow

```text
Client ──▶ HTTP (Express) ──▶ Route handlers ──▶ Response
                        │
                        └──▶ /health (status + timestamp)
```

### Planned evolution

- Add routing modules for:
  - `/conversations`
  - `/campaigns`
  - `/analytics`
- Add service layer
- Add AI integrations
- Add logging + middleware
- Add optional database layer

---

## 🧪 Health Endpoint

**Request**
```http
GET /health
```

**Example response**
```json
{
  "status": "ok",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

---

## ✅ Continuous Integration (CI)

### GitHub Actions

A workflow at:

```
.github/workflows/ci.yml
```

will:

1. Check out the repository  
2. Install Node.js  
3. Install dependencies  
4. Run tests  
5. Build Docker image  

The badge in this README reflects the live status.

---

## 🧭 Roadmap

### Phase 1 — Foundation (current)
- ✅ Express scaffold  
- ✅ Docker setup  
- ✅ CI pipeline   

### Phase 2 — Core API
- [ ] Conversations API  
- [ ] Campaigns API  
- [ ] Analytics API  
- [ ] Logging & middleware  

### Phase 3 — Intelligence
- [ ] AI API integration  
- [ ] Personalization logic  
- [ ] Analytics storage  
- [ ] Configurable models  

### Phase 4 — Scaling
- [ ] Database integration  
- [ ] Redis cache / queues  
- [ ] Expanded test suite  
- [ ] Deployment config  

---

## 🤝 Contributing

1. Fork the repo  
2. Create a branch: `git checkout -b feature/my-feature`  
3. Commit: `git commit -m "Add feature"`  
4. Push: `git push origin feature/my-feature`  
5. Open a Pull Request  

---

## 📄 License

MIT License — free for use, modification, and distribution.

---

## ⭐ Vision

CONVAD aims to build the next generation of **AI-powered conversational advertising**, enabling:

- Personalized, adaptive ad dialogue  
- Real-time intelligence  
- Easy integration  
- Expandable architecture  

This repository represents **Phase 1** of the evolving system.

---

## Contact

For any inquiries or suggestions, feel free to reach out to the project team:

- **Developers**: Gurkiratjot Singh
- **Emails**: gurkiratjotsingh17@gmail.com

--- 
