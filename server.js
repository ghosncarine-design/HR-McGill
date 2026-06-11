const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'mcgill-admin-2024';

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Knowledge store ──────────────────────────────────────────────
const knowledge = {
  pages: [],          // { title, url, source, text }
  lastCrawled: null,
  status: 'idle',     // idle | crawling | ready | error
  message: 'Not yet crawled. Visit /admin to trigger a crawl.'
};

// ─── Sources ──────────────────────────────────────────────────────
const SOURCES = [
  {
    id: 'general',
    shortName: 'General Staff KB',
    base: 'https://general-knowledgebase.mcgill.ca',
    startPath: '/spaces/SHRKB/pages/54632418/Time+Absence',
    spaceKey: 'SHRKB'
  },
  {
    id: 'worker',
    shortName: 'Hourly Workers KB',
    base: 'https://worker-knowledgebase.mcgill.ca',
    startPath: '/spaces/RAAHKBW/pages/49919872/Time+Absence',
    spaceKey: 'RAAHKBW'
  }
];

const MAX_PAGES_PER_SOURCE = 60;
const CRAWL_DELAY_MS = 400;

// ─── Crawler ──────────────────────────────────────────────────────
async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'McGill-HR-Bot/2.0 (internal knowledge assistant)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-CA,en;q=0.9,fr-CA;q=0.8'
      },
      timeout: 10000
    });
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    console.warn(`Failed to fetch ${url}: ${err.message}`);
    return null;
  }
}

function extractText(html) {
  const $ = cheerio.load(html);
  $('script, style, nav, header, footer, .aui-sidebar, #sidebar, .aui-header, .breadcrumb-section').remove();
  const content = $('#main-content').length ? $('#main-content') :
                  $('.wiki-content').length ? $('.wiki-content') :
                  $('main').length ? $('main') : $('body');
  return content.text().replace(/\s+/g, ' ').trim();
}

function extractLinks(html, base, spaceKey) {
  const $ = cheerio.load(html);
  const links = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    if (href.includes(`/spaces/${spaceKey}/pages/`) || href.includes(`/display/${spaceKey}/`)) {
      const full = href.startsWith('http') ? href : base + href;
      links.add(full.split('#')[0].split('?')[0]);
    }
  });
  return [...links];
}

function extractTitle(html, fallback) {
  const $ = cheerio.load(html);
  return $('#title-text').text().trim() ||
         $('h1').first().text().trim() ||
         $('title').text().trim() ||
         fallback;
}

async function crawlSource(src, progressCallback) {
  const visited = new Set();
  const queue = [src.base + src.startPath];
  const pages = [];

  while (queue.length > 0 && pages.length < MAX_PAGES_PER_SOURCE) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    const html = await fetchPage(url);
    if (!html) continue;

    const text = extractText(html);
    if (text.length > 150) {
      const title = extractTitle(html, decodeURIComponent(url.split('/').pop().replace(/\+/g, ' ')));
      pages.push({ title, url, source: src.shortName, text });
      progressCallback(src.id, pages.length, title);

      extractLinks(html, src.base, src.spaceKey).forEach(l => {
        if (!visited.has(l)) queue.push(l);
      });
    }

    await new Promise(r => setTimeout(r, CRAWL_DELAY_MS));
  }

  return pages;
}

async function runCrawl() {
  if (knowledge.status === 'crawling') {
    return { ok: false, message: 'Crawl already in progress.' };
  }

  knowledge.status = 'crawling';
  knowledge.message = 'Crawl started...';
  knowledge.pages = [];
  console.log('[Crawler] Starting crawl of both McGill KBs...');

  try {
    const allPages = [];
    for (const src of SOURCES) {
      console.log(`[Crawler] Crawling ${src.shortName}...`);
      const pages = await crawlSource(src, (id, count, title) => {
        knowledge.message = `Crawling ${src.shortName}: ${count} pages (last: ${title})`;
        console.log(`[Crawler] ${src.shortName} — ${count} pages — ${title}`);
      });
      allPages.push(...pages);
      console.log(`[Crawler] ${src.shortName} done: ${pages.length} pages`);
    }

    knowledge.pages = allPages;
    knowledge.lastCrawled = new Date().toISOString();
    knowledge.status = 'ready';
    knowledge.message = `Ready — ${allPages.length} pages indexed across both knowledgebases (last crawled: ${new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' })})`;
    console.log(`[Crawler] Complete: ${allPages.length} total pages`);
    return { ok: true, message: knowledge.message };
  } catch (err) {
    knowledge.status = 'error';
    knowledge.message = `Crawl failed: ${err.message}`;
    console.error('[Crawler] Error:', err);
    return { ok: false, message: knowledge.message };
  }
}

// ─── API routes ───────────────────────────────────────────────────

// Health / status
app.get('/health', (req, res) => {
  res.json({
    status: knowledge.status,
    pagesIndexed: knowledge.pages.length,
    lastCrawled: knowledge.lastCrawled,
    message: knowledge.message
  });
});

// Admin: trigger crawl (protected by secret)
app.post('/admin/crawl', async (req, res) => {
  const secret = req.headers['x-admin-secret'] || req.body?.secret;
  if (secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized. Provide x-admin-secret header.' });
  }
  res.json({ ok: true, message: 'Crawl started in background.' });
  runCrawl(); // non-blocking
});

// Admin: crawl status
app.get('/admin/status', (req, res) => {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  if (secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  res.json({
    status: knowledge.status,
    pagesIndexed: knowledge.pages.length,
    lastCrawled: knowledge.lastCrawled,
    message: knowledge.message,
    sources: SOURCES.map(s => ({
      name: s.shortName,
      pages: knowledge.pages.filter(p => p.source === s.shortName).length
    }))
  });
});

// Admin: list all indexed pages
app.get('/admin/pages', (req, res) => {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  if (secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  res.json({
    total: knowledge.pages.length,
    pages: knowledge.pages.map(p => ({ title: p.title, url: p.url, source: p.source, chars: p.text.length }))
  });
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured on server.' });
  }

  const { question } = req.body;
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'Invalid request: question string required.' });
  }

  // Search relevant pages (simple keyword scoring)
  const qWords = question.toLowerCase().split(/\W+/).filter(w => w.length > 3);

  let contextPages = [];

  if (knowledge.pages.length > 0) {
    const scored = knowledge.pages.map(page => {
      const haystack = (page.title + ' ' + page.text).toLowerCase();
      const score = qWords.reduce((s, w) => {
        const matches = (haystack.match(new RegExp(w, 'g')) || []).length;
        const titleMatch = page.title.toLowerCase().includes(w) ? 5 : 0;
        return s + matches + titleMatch;
      }, 0);
      return { ...page, score };
    });

    contextPages = scored
      .filter(p => p.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    // If no keyword match, take top pages
    if (contextPages.length === 0) {
      contextPages = knowledge.pages.slice(0, 4);
    }
  }

  // Build context string
  const contextText = contextPages.length > 0
    ? contextPages.map(p => `=== [${p.source}] ${p.title}\nURL: ${p.url}\n${p.text.substring(0, 2000)}`).join('\n\n')
    : 'No knowledgebase content available yet. Direct users to the HR Help Desk.';

  const systemPrompt = `You are a professional McGill University HR Assistant. You answer employee questions using content crawled from two official McGill HR Knowledgebases:
1. General Staff Knowledgebase — for non-unionized and general staff
2. Hourly Workers Knowledgebase — for hourly and part-time workers

RELEVANT KNOWLEDGEBASE CONTENT:
${contextText}

Instructions:
- Answer clearly and professionally in the same language as the question (English or French)
- Base your answer strictly on the knowledgebase content above
- If both sources have relevant info, synthesize and note any differences between staff categories
- If the topic is not covered, say so honestly and direct the user to:
  McGill HR Help Desk: hr.helpdesk@mcgill.ca | 514-398-4747
- Be specific and actionable — employees need practical guidance
- Keep answers concise (3–6 sentences) unless detail is genuinely needed
- Never invent policies not found in the content above`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: 'user', content: question }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Anthropic API error' });
    }

    const answer = data.content?.[0]?.text || 'Unable to generate a response.';
    const sources = contextPages.slice(0, 3).map(p => ({ title: p.title, url: p.url, source: p.source }));

    res.json({ answer, sources, pagesSearched: contextPages.length });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`McGill HR Assistant running on port ${PORT}`);
  console.log(`Admin secret: ${ADMIN_SECRET}`);
  console.log(`Trigger crawl: POST /admin/crawl with header x-admin-secret: ${ADMIN_SECRET}`);
});
