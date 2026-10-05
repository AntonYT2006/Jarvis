const express = require('express');
const http = require('http');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const { WebSocketServer } = require('ws');
const Anthropic = require('@anthropic-ai/sdk');

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 3000);
const APP_NAME = 'JARVIS';
const JWT_SECRET = process.env.JWT_SECRET || 'jarvis-dev-secret-change-me';
const ADMIN_USERNAME = process.env.JARVIS_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.JARVIS_PASSWORD || 'admin123';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

const state = {
  appName: APP_NAME,
  backendUrl: process.env.JARVIS_BACKEND_URL || 'https://jarvis-backend.local',
  apiKey: process.env.JARVIS_API_KEY || '',
  isKIEnabled: parseBool(process.env.JARVIS_ENABLE_KI, true),
  allowWebSearch: parseBool(process.env.JARVIS_ENABLE_WEB_SEARCH, false),
  allowCodeGeneration: parseBool(process.env.JARVIS_ENABLE_CODE_GEN, true),
  allowDesign: parseBool(process.env.JARVIS_ENABLE_DESIGN, true),
  isConnected: false,
  lastCheckedAt: null,
  agentMode: 'assistant',
  isNightMode: true,
  reduceAnimations: false,
  largerText: false,
  connectionSummary: 'Jarvis Backend ist bereit.',
  wsConnections: 0,
  anthropicAvailable: !!anthropic,
};

const clients = new Set();

function parseBool(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return String(value).toLowerCase() === 'true' || Number(value) === 1;
}

function isValidUrl(value) {
  if (!value || typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function sanitizeConfig(input = {}) {
  const nextConfig = {
    backendUrl: typeof input.backendUrl === 'string' ? input.backendUrl : state.backendUrl,
    apiKey: typeof input.apiKey === 'string' ? input.apiKey : state.apiKey,
    isKIEnabled: input.isKIEnabled !== undefined ? Boolean(input.isKIEnabled) : state.isKIEnabled,
    allowWebSearch: input.allowWebSearch !== undefined ? Boolean(input.allowWebSearch) : state.allowWebSearch,
    allowCodeGeneration: input.allowCodeGeneration !== undefined ? Boolean(input.allowCodeGeneration) : state.allowCodeGeneration,
    allowDesign: input.allowDesign !== undefined ? Boolean(input.allowDesign) : state.allowDesign,
    isNightMode: input.isNightMode !== undefined ? Boolean(input.isNightMode) : state.isNightMode,
    reduceAnimations: input.reduceAnimations !== undefined ? Boolean(input.reduceAnimations) : state.reduceAnimations,
    largerText: input.largerText !== undefined ? Boolean(input.largerText) : state.largerText,
    agentMode: typeof input.agentMode === 'string' ? input.agentMode : state.agentMode,
  };

  if (!isValidUrl(nextConfig.backendUrl)) {
    nextConfig.backendUrl = state.backendUrl;
  }

  return nextConfig;
}

function buildSystemPrompt(context) {
  let prompt = 'Du bist JARVIS, ein intelligenter virtueller Assistent.\n\n';
  prompt += 'Fähigkeiten:\n';
  prompt += '- Fragen beantworten und Probleme lösen\n';
  prompt += '- Code in JavaScript, TypeScript, Python, Java, C++, HTML, CSS, SQL und Bash schreiben\n';
  prompt += '- UI/UX-Designs, Layouts und Farbkonzepte entwickeln\n';
  prompt += '- Fehler debuggen und Lösungen vorschlagen\n';
  prompt += '- Dokumentation und Erklärungen erstellen\n\n';
  prompt += 'Sprache: Deutsch\n';
  prompt += 'Antwortstil: klar, hilfreich, strukturiert und professionell\n';
  prompt += 'Wenn du Code gibst, nutze Markdown-Codeblöcke mit Sprachbezeichnung.\n\n';

  if (context.allowCodeGeneration) {
    prompt += 'Code-Generierung ist erlaubt.\n';
  }
  if (context.allowDesign) {
    prompt += 'Design-Unterstützung ist erlaubt.\n';
  }
  if (context.allowWebSearch) {
    prompt += 'Web-Recherche ist erlaubt.\n';
  }

  return prompt;
}

function buildBasicReply(message) {
  const lower = (message || '').toLowerCase();

  if (!message || !message.trim()) {
    return 'Ich bin JARVIS. Wie kann ich dir helfen? Ich kann Fragen beantworten, Code schreiben, Designideen entwickeln und Fehler analysieren.';
  }

  if (lower.includes('hilfe') || lower.includes('help')) {
    return 'Ich bin JARVIS und kann dir helfen mit: Fragen beantworten, Code generieren, Designkonzepte entwickeln, Fehler debuggen und Dokumentation schreiben.';
  }

  if (lower.includes('status') || lower.includes('zustand')) {
    return `Systemstatus: ${state.isConnected ? 'verbunden' : 'bereit'}. KI: ${state.isKIEnabled ? 'aktiv' : 'aus'}. Code: ${state.allowCodeGeneration ? 'aktiv' : 'aus'}. Design: ${state.allowDesign ? 'aktiv' : 'aus'}.`;
  }

  if (lower.includes('code') || lower.includes('programm') || lower.includes('funktion') || lower.includes('script')) {
    return 'Code-Generierung ist aktiv. Beschreibe kurz dein Ziel, die Sprache und den gewünschten Output – dann erstelle ich dir den passenden Code.';
  }

  if (lower.includes('design') || lower.includes('ui') || lower.includes('ux') || lower.includes('layout') || lower.includes('farbe')) {
    return 'Design-Modus ist aktiv. Beschreibe den Stil, das Ziel und das Layout – dann mache ich dir ein passendes Konzept oder eine UI-Vorschau.';
  }

  if (lower.includes('fehler') || lower.includes('bug') || lower.includes('debug')) {
    return 'Ich kann Fehleranalyse und Debugging machen. Schick mir den Fehler, Stacktrace oder Codeausschnitt und ich erkläre die Ursache und die Lösung.';
  }

  return `Ich habe deine Anfrage verstanden: "${message}". Ich kann dir damit weiterhelfen, sei es mit Antworten, Code, Designideen oder Debugging.`;
}

async function generateSmartResponse(message, context = {}) {
  if (!anthropic) {
    return buildBasicReply(message);
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2048,
      system: buildSystemPrompt(context),
      messages: [{ role: 'user', content: message }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (textBlock && typeof textBlock.text === 'string') {
      return textBlock.text;
    }

    return buildBasicReply(message);
  } catch (error) {
    console.error('Anthropic request failed:', error.message);
    return buildBasicReply(message);
  }
}

function emitStateUpdate() {
  const payload = JSON.stringify({
    type: 'state',
    payload: {
      appName: state.appName,
      backendUrl: state.backendUrl,
      isConnected: state.isConnected,
      lastCheckedAt: state.lastCheckedAt,
      connectionSummary: state.connectionSummary,
      isKIEnabled: state.isKIEnabled,
      allowWebSearch: state.allowWebSearch,
      allowCodeGeneration: state.allowCodeGeneration,
      allowDesign: state.allowDesign,
      isNightMode: state.isNightMode,
      reduceAnimations: state.reduceAnimations,
      largerText: state.largerText,
      agentMode: state.agentMode,
      wsConnections: state.wsConnections,
      anthropicAvailable: state.anthropicAvailable,
    },
  });

  clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(payload);
    }
  });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ ok: false, message: 'Missing bearer token.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ ok: false, message: 'Invalid token.', error: error.message });
  }
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    app: APP_NAME,
    status: state.isConnected ? 'connected' : 'ready',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    capabilities: {
      ai: state.isKIEnabled,
      codeGeneration: state.allowCodeGeneration,
      design: state.allowDesign,
      anthropic: state.anthropicAvailable,
    },
  });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ ok: false, message: 'Username and password are required.' });
  }

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, message: 'Invalid login credentials.' });
  }

  const token = jwt.sign({ username, role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });

  return res.json({
    ok: true,
    token,
    user: { username, role: 'admin' },
    capabilities: {
      ai: state.isKIEnabled,
      codeGeneration: state.allowCodeGeneration,
      design: state.allowDesign,
    },
  });
});

app.get('/api/config', authMiddleware, (req, res) => {
  res.json({
    ok: true,
    config: {
      backendUrl: state.backendUrl,
      apiKey: state.apiKey ? '***' : '',
      isKIEnabled: state.isKIEnabled,
      allowWebSearch: state.allowWebSearch,
      allowCodeGeneration: state.allowCodeGeneration,
      allowDesign: state.allowDesign,
      isNightMode: state.isNightMode,
      reduceAnimations: state.reduceAnimations,
      largerText: state.largerText,
      agentMode: state.agentMode,
      isConnected: state.isConnected,
      lastCheckedAt: state.lastCheckedAt,
      connectionSummary: state.connectionSummary,
      websocketEnabled: true,
      anthropicAvailable: state.anthropicAvailable,
    },
  });
});

app.post('/api/config', authMiddleware, (req, res) => {
  const nextConfig = sanitizeConfig(req.body || {});
  Object.assign(state, nextConfig);
  state.lastCheckedAt = new Date().toISOString();
  emitStateUpdate();

  res.json({
    ok: true,
    message: 'Konfiguration gespeichert.',
    config: {
      backendUrl: state.backendUrl,
      apiKey: state.apiKey ? '***' : '',
      isKIEnabled: state.isKIEnabled,
      allowWebSearch: state.allowWebSearch,
      allowCodeGeneration: state.allowCodeGeneration,
      allowDesign: state.allowDesign,
      isNightMode: state.isNightMode,
      reduceAnimations: state.reduceAnimations,
      largerText: state.largerText,
      agentMode: state.agentMode,
    },
  });
});

app.post('/api/check-connection', authMiddleware, async (req, res) => {
  const config = sanitizeConfig(req.body || {});
  const targetUrl = config.backendUrl;

  if (!isValidUrl(targetUrl)) {
    state.isConnected = false;
    state.lastCheckedAt = new Date().toISOString();
    state.connectionSummary = 'Keine gültige Backend-URL angegeben.';
    emitStateUpdate();
    return res.status(400).json({ ok: false, isConnected: false, summary: state.connectionSummary });
  }

  try {
    state.backendUrl = targetUrl;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timer);

    state.isConnected = response.ok;
    state.lastCheckedAt = new Date().toISOString();
    state.connectionSummary = response.ok
      ? `Verbindung erfolgreich geprüft: ${targetUrl}`
      : `Backend erreichbar, aber Fehlerstatus ${response.status}.`;

    emitStateUpdate();

    return res.json({
      ok: response.ok,
      isConnected: response.ok,
      backendUrl: targetUrl,
      summary: state.connectionSummary,
      statusCode: response.status,
    });
  } catch (error) {
    state.isConnected = false;
    state.lastCheckedAt = new Date().toISOString();
    state.connectionSummary = `Verbindungsfehler: ${error.message}`;
    emitStateUpdate();
    return res.status(500).json({ ok: false, isConnected: false, summary: state.connectionSummary, error: error.message });
  }
});

app.get('/api/agents', authMiddleware, (req, res) => {
  res.json({
    ok: true,
    agents: [
      {
        id: 'assistant',
        name: 'Allgemeiner Assistent',
        description: 'Beantwortet Fragen und analysiert Probleme',
        active: true,
        icon: '💬',
        capabilities: ['qa', 'analysis', 'chat'],
      },
      {
        id: 'coder',
        name: 'Code-Generator',
        description: 'Generiert und erklärt Code in vielen Sprachen',
        active: state.allowCodeGeneration,
        icon: '💻',
        capabilities: ['javascript', 'python', 'java', 'cpp', 'sql', 'html', 'css'],
      },
      {
        id: 'designer',
        name: 'Design-Spezialist',
        description: 'Erstellt Layouts, Farbkonzepte und UI/UX-Ideen',
        active: state.allowDesign,
        icon: '🎨',
        capabilities: ['ui', 'ux', 'layout', 'colors', 'components'],
      },
      {
        id: 'debugger',
        name: 'Fehler-Debugger',
        description: 'Hilft bei der Analyse und Lösung von Bugs',
        active: true,
        icon: '🔍',
        capabilities: ['debugging', 'stacktrace', 'fixes'],
      },
    ],
  });
});

app.post('/api/assistant/message', authMiddleware, async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message : '';
  const context = req.body?.context || {};

  if (!state.isKIEnabled) {
    return res.status(503).json({ ok: false, message: 'KI ist deaktiviert. Aktiviere sie in den Einstellungen.', reply: null });
  }

  try {
    const aiContext = {
      allowCodeGeneration: state.allowCodeGeneration,
      allowDesign: state.allowDesign,
      allowWebSearch: state.allowWebSearch,
      agentMode: context.agentMode || state.agentMode,
      ...context,
    };

    const reply = await generateSmartResponse(message, aiContext);

    return res.json({
      ok: true,
      message,
      reply,
      timestamp: new Date().toISOString(),
      anthropic: state.anthropicAvailable,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: 'Fehler beim Verarbeiten der Nachricht.',
      error: error.message,
    });
  }
});

app.post('/api/code/generate', authMiddleware, async (req, res) => {
  if (!state.allowCodeGeneration) {
    return res.status(403).json({ ok: false, message: 'Code-Generierung ist deaktiviert.' });
  }

  const { description, language } = req.body || {};

  if (!description) {
    return res.status(400).json({ ok: false, message: 'Description is required.' });
  }

  try {
    const prompt = `Generiere ${language ? 'in ' + language : ''} Code für: ${description}. Gib nur den Code zurück, ohne lange Erklärung.`;
    const code = await generateSmartResponse(prompt, { allowCodeGeneration: true, allowDesign: false, allowWebSearch: false });

    return res.json({
      ok: true,
      code,
      language: language || 'unknown',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: 'Code-Generierung fehlgeschlagen.',
      error: error.message,
    });
  }
});

app.post('/api/design/concept', authMiddleware, async (req, res) => {
  if (!state.allowDesign) {
    return res.status(403).json({ ok: false, message: 'Design ist deaktiviert.' });
  }

  const { requirement, designType } = req.body || {};

  if (!requirement) {
    return res.status(400).json({ ok: false, message: 'Requirement is required.' });
  }

  try {
    const prompt = `Erstelle ein detailliertes ${designType || 'UI'} Design-Konzept für: ${requirement}. Inkludiere Layout-Ideen, Farbpalette, Typografie, Komponenten und UX-Strategie.`;
    const designConcept = await generateSmartResponse(prompt, { allowDesign: true, allowCodeGeneration: false, allowWebSearch: false });

    return res.json({
      ok: true,
      designConcept,
      designType: designType || 'UI',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: 'Design-Generierung fehlgeschlagen.',
      error: error.message,
    });
  }
});

app.post('/api/debug/analyze', authMiddleware, async (req, res) => {
  const { error, code, context: debugContext } = req.body || {};

  if (!error) {
    return res.status(400).json({ ok: false, message: 'Error message is required.' });
  }

  try {
    let prompt = `Analysiere diesen Fehler und biete Lösungen. Fehler: ${error}`;
    if (code) prompt += `\n\nCode:\n${code}`;
    if (debugContext) prompt += `\n\nKontext: ${debugContext}`;

    const analysis = await generateSmartResponse(prompt, { allowCodeGeneration: true, allowDesign: false, allowWebSearch: true });

    return res.json({
      ok: true,
      analysis,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: 'Fehleranalyse fehlgeschlagen.',
      error: error.message,
    });
  }
});

app.get('/', (req, res) => {
  res.json({
    app: APP_NAME,
    version: '2.0.0',
    status: state.isConnected ? 'connected' : 'ready',
    capabilities: {
      ai: state.isKIEnabled,
      codeGeneration: state.allowCodeGeneration,
      design: state.allowDesign,
      debugging: true,
      websocket: true,
      anthropic: state.anthropicAvailable,
    },
    auth: {
      login: '/api/auth/login',
      tokenType: 'Bearer',
      tokenExpiry: '24h',
    },
    endpoints: {
      health: '/health',
      auth: '/api/auth/login',
      config: ['/api/config (GET)', '/api/config (POST)'],
      assistant: '/api/assistant/message',
      agents: '/api/agents',
      code: '/api/code/generate',
      design: '/api/design/concept',
      debug: '/api/debug/analyze',
      websocket: 'ws://localhost:' + PORT + '/ws',
    },
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket) => {
  state.wsConnections += 1;
  emitStateUpdate();

  socket.send(JSON.stringify({
    type: 'welcome',
    payload: {
      appName: state.appName,
      message: 'JARVIS WebSocket verbunden.',
      authenticated: false,
      capabilities: {
        ai: state.isKIEnabled,
        codeGeneration: state.allowCodeGeneration,
        design: state.allowDesign,
      },
    },
  }));

  socket.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      if (message.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      }
    } catch (error) {
      console.error('WebSocket message error:', error.message);
    }
  });

  socket.on('close', () => {
    state.wsConnections = Math.max(0, state.wsConnections - 1);
    emitStateUpdate();
  });

  socket.on('error', (error) => {
    console.error('WebSocket error:', error.message);
  });
});

server.listen(PORT, () => {
  console.log('\n============================================================');
  console.log('JARVIS Backend v2.0.0 läuft!');
  console.log('============================================================');
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}/ws`);
  console.log('Login-Daten:');
  console.log(`Username: ${ADMIN_USERNAME}`);
  console.log(`Password: ${ADMIN_PASSWORD}`);
  console.log('Fähigkeiten: Fragen, Code, Design, Debugging');
  console.log('Anthropic verbunden:', state.anthropicAvailable ? 'ja' : 'nein');
  console.log('============================================================\n');
});

module.exports = { app, server, state };
