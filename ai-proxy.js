// ============================================================
// BodyLab — локальный AI-прокси (Node, без npm-зависимостей)
// Держит ключ OpenRouter в .env, проксирует запросы к LLM,
// заодно отдаёт статику (index_v5.html и пр.) — один процесс.
//
// Запуск:  node ai-proxy.js   →  http://localhost:8777/index_v5.html
// ============================================================
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// — мини-парсер .env (без dotenv) —
function loadEnv() {
  const out = {};
  try {
    const raw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (e) { /* .env может отсутствовать */ }
  return out;
}
const ENV = loadEnv();
const KEY = process.env.OPENROUTER_API_KEY || ENV.OPENROUTER_API_KEY;
// слаг OpenRouter — задаётся в .env (проверить точное имя на openrouter.ai/models)
const MODEL = process.env.AI_MODEL || ENV.AI_MODEL || 'anthropic/claude-sonnet-4.6';
const PORT = process.env.PORT || ENV.PORT || 8777;

const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml' };

// — вызов OpenRouter —
function callLLM(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: body.model || MODEL,
      max_tokens: body.max_tokens || 700,
      temperature: body.temperature ?? 0.3,
      messages: body.messages,
      ...(body.json ? { response_format: { type: 'json_object' } } : {}),
    });
    const req = https.request('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost',
        'X-Title': 'BodyLab',
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.error) return reject(new Error(j.error.message || 'LLM error'));
          resolve({ text: j.choices?.[0]?.message?.content || '', model: j.model || MODEL });
        } catch (e) { reject(new Error('Парс ответа LLM: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  // — AI-эндпоинт —
  if (req.method === 'POST' && req.url === '/ai') {
    if (!KEY) { res.writeHead(503, {'Content-Type':'application/json'}); return res.end(JSON.stringify({ error: 'OPENROUTER_API_KEY не задан в .env' })); }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const out = await callLLM(JSON.parse(body));
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify(out));
      } catch (e) {
        console.error('AI error:', e.message);
        res.writeHead(502, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  // — статика —
  let file = req.url === '/' ? '/index_v5.html' : req.url.split('?')[0];
  const fp = path.join(__dirname, path.normalize(file).replace(/^(\.\.[\/\\])+/, ''));
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream'});
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`BodyLab → http://localhost:${PORT}/index_v5.html`);
  console.log(`AI: ${KEY ? 'ключ загружен, модель ' + MODEL : '⚠ OPENROUTER_API_KEY не задан (AI-вкладка не будет работать)'}`);
});
