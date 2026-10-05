# JARVIS Backend v2.0.0

Ein vollständiger AI-Backend für deine Jarvis-App mit:
- Fragen beantworten
- Code generieren
- Designideen machen
- Fehler analysieren
- WebSocket-Status
- JWT-Authentifizierung

## Schnellstart

1. Abhängigkeiten installieren:

```bash
npm install
```

2. Server starten:

```bash
npm start
```

3. Browser oder App nutzen:

```text
http://localhost:3000
```

## Login

Standardwerte:

```text
Username: admin
Password: admin123
```

Kann über `.env` angepasst werden.

## wichtige Endpunkte

- GET /health
- POST /api/auth/login
- GET /api/config
- POST /api/config
- POST /api/check-connection
- POST /api/assistant/message
- POST /api/code/generate
- POST /api/design/concept
- POST /api/debug/analyze
- WebSocket: ws://localhost:3000/ws

## Beispiel Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

## Beispiel Assistant

```bash
curl -X POST http://localhost:3000/api/assistant/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"message":"Erkläre React Hooks"}'
```

## Beispiel Code-Generierung

```bash
curl -X POST http://localhost:3000/api/code/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"description":"Eine Todo-App in React mit Add/Delete","language":"javascript"}'
```

## Beispiel Design

```bash
curl -X POST http://localhost:3000/api/design/concept \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"requirement":"Modernes Dashboard mit Dark Mode","designType":"UI"}'
```

## Beispiel Debugging

```bash
curl -X POST http://localhost:3000/api/debug/analyze \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"error":"TypeError: Cannot read property map of undefined","code":"const items = undefined; items.map(x => x)","context":"React"}'
```

## Umgebungsvariablen

```bash
PORT=3000
JWT_SECRET=jarvis-dev-secret-change-me
JARVIS_USERNAME=admin
JARVIS_PASSWORD=admin123
JARVIS_BACKEND_URL=https://jarvis-backend.local
JARVIS_API_KEY=
JARVIS_ENABLE_KI=true
JARVIS_ENABLE_CODE_GEN=true
JARVIS_ENABLE_DESIGN=true
JARVIS_ENABLE_WEB_SEARCH=false
ANTHROPIC_API_KEY=
```

## Hinweis

Wenn `ANTHROPIC_API_KEY` gesetzt ist, nutzt das Backend Claude für echte KI-Antworten. Ohne Key fallen die Antworten automatisch auf die lokale Fallback-Logik zurück.
