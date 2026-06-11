# McGill HR Assistant — Backend Proxy

A secure Node.js proxy that crawls both McGill HR Knowledgebases server-side and powers the HR chatbot without exposing the API key.

## Architecture

```
User browser  →  Your server (Node.js)  →  Anthropic API
                      ↓ crawls
              McGill General KB + Worker KB
```

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Set environment variables

Create a `.env` file or set in your hosting platform:

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
ADMIN_SECRET=choose-a-strong-secret
PORT=3000
```

### 3. Run locally
```bash
npm start
```

### 4. Trigger the first crawl

After the server starts, trigger a crawl via the admin panel:

- Open: `http://localhost:3000/admin.html`
- Enter your ADMIN_SECRET
- Click **Re-crawl knowledgebase**
- Monitor progress with **Refresh status**

Or via curl:
```bash
curl -X POST http://localhost:3000/admin/crawl \
  -H "x-admin-secret: your-secret-here"
```

## Deploy to Render.com (free)

1. Push this folder to a GitHub repo
2. Go to render.com → New → Web Service
3. Connect your repo
4. Set environment variables:
   - `ANTHROPIC_API_KEY` = your Anthropic key
   - `ADMIN_SECRET` = a strong secret password
5. Deploy — you get a URL like `https://mcgill-hr-assistant.onrender.com`
6. Visit `/admin.html` on your deployed URL to trigger the first crawl

## Deploy to Railway.app

1. Push to GitHub
2. railway.app → New Project → Deploy from GitHub
3. Add environment variables in Railway dashboard
4. Deploy

## Admin Panel

Visit `/admin.html` on your server to:
- Check crawl status
- Trigger a re-crawl manually
- View all indexed pages

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Chatbot frontend |
| `/health` | GET | Public status check |
| `/api/chat` | POST | Chat (body: `{ question }`) |
| `/admin.html` | GET | Admin panel UI |
| `/admin/crawl` | POST | Trigger crawl (requires x-admin-secret header) |
| `/admin/status` | GET | Crawl status (requires x-admin-secret header) |
| `/admin/pages` | GET | List all indexed pages (requires x-admin-secret header) |

## Sources Crawled

- **General Staff KB**: https://general-knowledgebase.mcgill.ca/spaces/SHRKB
- **Hourly Workers KB**: https://worker-knowledgebase.mcgill.ca/spaces/RAAHKBW

Max 60 pages per source (120 total). Adjust `MAX_PAGES_PER_SOURCE` in `server.js` as needed.
