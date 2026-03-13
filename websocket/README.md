# Chat Service

A lightweight, real-time WebSocket chat server built with [Bun](https://bun.sh).

## Features

- Real-time messaging via WebSocket
- Room-based chat (unlimited users per room)
- Auto-generated unique room IDs
- User join/leave notifications
- Auto-cleanup of empty rooms
- CORS enabled for cross-origin requests

## Requirements

- [Bun](https://bun.sh) v1.0.0 or higher

## Installation

```bash
bun install
```

## Usage

### Development

```bash
bun run dev
```

### Production

```bash
bun run start
```

### With PM2

```bash
pm2 start pm2.config.cjs
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3001` | Server port |

## API Reference

### REST Endpoints

#### Create Room

```
POST /api/room/create
```

Creates a new chat room with a unique ID.

**Response:**
```json
{
  "roomId": "abc123xyz"
}
```

#### Check Room Status

```
GET /api/room/{roomId}
```

Check if a room exists and get user count.

**Response:**
```json
{
  "exists": true,
  "userCount": 5
}
```

### WebSocket

#### Connect

```
ws://localhost:3001/ws?roomId={roomId}&username={username}
```

**Query Parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `roomId` | Yes | The room to join |
| `username` | Yes | Display name for the user |

If the room doesn't exist, it will be created automatically.

#### Message Types

All messages are JSON with this structure:

```typescript
interface Message {
  type: "message" | "join" | "leave";
  sender: string;      // Username or "system"
  content: string;     // Message content
  timestamp: number;   // Unix timestamp in milliseconds
}
```

#### Sending Messages

Send a JSON payload to the WebSocket:

```json
{
  "type": "message",
  "content": "Hello, world!"
}
```

#### Receiving Messages

**User Message:**
```json
{
  "type": "message",
  "sender": "john",
  "content": "Hello everyone!",
  "timestamp": 1701345600000
}
```

**Join Notification:**
```json
{
  "type": "join",
  "sender": "system",
  "content": "john joined the room",
  "timestamp": 1701345600000
}
```

**Leave Notification:**
```json
{
  "type": "leave",
  "sender": "system",
  "content": "john left the room",
  "timestamp": 1701345600000
}
```

## Integration Examples

### JavaScript/TypeScript Client

```typescript
const roomId = "abc123";
const username = "john";

const ws = new WebSocket(
  `ws://localhost:3001/ws?roomId=${roomId}&username=${encodeURIComponent(username)}`
);

ws.onopen = () => {
  console.log("Connected to chat");
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log(`[${message.sender}]: ${message.content}`);
};

ws.onclose = () => {
  console.log("Disconnected from chat");
};

// Send a message
ws.send(JSON.stringify({
  type: "message",
  content: "Hello!"
}));
```

### Creating a Room First

```typescript
async function createRoom(): Promise<string> {
  const response = await fetch("http://localhost:3001/api/room/create", {
    method: "POST"
  });
  const data = await response.json();
  return data.roomId;
}

// Usage
const roomId = await createRoom();
// Then connect via WebSocket
```

### React Hook Example

```typescript
function useWebSocket(roomId: string, username: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(
      `ws://localhost:3001/ws?roomId=${roomId}&username=${encodeURIComponent(username)}`
    );

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e) => {
      setMessages(prev => [...prev, JSON.parse(e.data)]);
    };

    wsRef.current = ws;
    return () => ws.close();
  }, [roomId, username]);

  const sendMessage = (content: string) => {
    wsRef.current?.send(JSON.stringify({ type: "message", content }));
  };

  return { messages, connected, sendMessage };
}
```

### Python Client

```python
import asyncio
import websockets
import json

async def chat_client():
    uri = "ws://localhost:3001/ws?roomId=abc123&username=python_user"

    async with websockets.connect(uri) as ws:
        # Send a message
        await ws.send(json.dumps({
            "type": "message",
            "content": "Hello from Python!"
        }))

        # Receive messages
        async for message in ws:
            data = json.loads(message)
            print(f"[{data['sender']}]: {data['content']}")

asyncio.run(chat_client())
```

### cURL Examples

**Create a room:**
```bash
curl -X POST http://localhost:3001/api/room/create
```

**Check room status:**
```bash
curl http://localhost:3001/api/room/abc123xyz
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Bun Server                          │
├─────────────────────────────────────────────────────────┤
│  HTTP Handler                                           │
│  ├── POST /api/room/create  → Create new room           │
│  ├── GET  /api/room/{id}    → Check room status         │
│  └── GET  /ws               → WebSocket upgrade         │
├─────────────────────────────────────────────────────────┤
│  WebSocket Handler                                      │
│  ├── open()    → Add client to room, broadcast join     │
│  ├── message() → Broadcast message to room              │
│  └── close()   → Remove client, broadcast leave         │
├─────────────────────────────────────────────────────────┤
│  Room Manager (In-Memory)                               │
│  └── Map<roomId, Set<Client>>                           │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

```
Client A                    Server                    Client B
   │                          │                          │
   │── Connect (roomId, user) ─►│                          │
   │                          │── "A joined" ────────────►│
   │◄── "Welcome!" ───────────│                          │
   │                          │                          │
   │── Send message ─────────►│                          │
   │                          │── Broadcast ─────────────►│
   │◄── Echo back ────────────│                          │
   │                          │                          │
   │── Disconnect ───────────►│                          │
   │                          │── "A left" ──────────────►│
```

## Extending the Service

### Adding Message Persistence

To persist messages (e.g., with a database), modify the `message` handler:

```typescript
// In websocket.message handler
if (data.type === "message" && data.content) {
  const msg: Message = {
    type: "message",
    sender: client.username,
    content: data.content,
    timestamp: Date.now(),
  };

  // Add persistence here
  await db.messages.create({
    roomId: client.roomId,
    ...msg
  });

  // Broadcast to all
  // ... existing code
}
```

### Adding Authentication

Add a token validation before WebSocket upgrade:

```typescript
if (url.pathname === "/ws") {
  const token = url.searchParams.get("token");

  // Validate token (JWT, session, etc.)
  const user = await validateToken(token);
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Continue with upgrade using user.username
  const upgraded = server.upgrade(req, {
    data: { roomId, username: user.username },
  });
  // ...
}
```

### Adding Rate Limiting

```typescript
const rateLimits = new Map<string, number[]>();

function isRateLimited(clientId: string, limit = 10, windowMs = 1000): boolean {
  const now = Date.now();
  const timestamps = rateLimits.get(clientId) || [];
  const recent = timestamps.filter(t => now - t < windowMs);

  if (recent.length >= limit) {
    return true;
  }

  recent.push(now);
  rateLimits.set(clientId, recent);
  return false;
}

// In message handler
message(ws, message) {
  const client = (ws as any).client;
  if (isRateLimited(client.username)) {
    ws.send(JSON.stringify({
      type: "error",
      content: "Rate limit exceeded"
    }));
    return;
  }
  // ... process message
}
```

### Adding Private Rooms

```typescript
interface Room {
  clients: Set<Client>;
  isPrivate: boolean;
  password?: string;
}

const rooms = new Map<string, Room>();

// When creating a room
if (url.pathname === "/api/room/create" && req.method === "POST") {
  const body = await req.json();
  const roomId = nanoid(10);

  rooms.set(roomId, {
    clients: new Set(),
    isPrivate: body.isPrivate || false,
    password: body.password
  });

  return new Response(JSON.stringify({ roomId }), { ... });
}

// When joining
if (url.pathname === "/ws") {
  const room = rooms.get(roomId);
  if (room?.isPrivate) {
    const password = url.searchParams.get("password");
    if (password !== room.password) {
      return new Response("Invalid password", { status: 403 });
    }
  }
  // ... continue with upgrade
}
```

### Adding Typing Indicators

```typescript
// In message handler
if (data.type === "typing") {
  broadcast(client.roomId, {
    type: "typing",
    sender: client.username,
    content: "",
    timestamp: Date.now(),
  }, client); // exclude sender
}
```

### Creating a Publishable Package

```typescript
// src/index.ts
import { nanoid } from 'nanoid'
import type { ServerWebSocket } from 'bun'

interface ChatServerOptions {
  port?: number
  onMessage?: (roomId: string, message: Message) => void
  onJoin?: (roomId: string, username: string) => void
  onLeave?: (roomId: string, username: string) => void
  corsOrigin?: string
}

export function createChatServer(options: ChatServerOptions = {}) {
  const {
    port = 3001,
    onMessage,
    onJoin,
    onLeave,
    corsOrigin = "*"
  } = options

  // ... server implementation with callbacks

  return server
}

export type { Message, ChatServerOptions }
```

**package.json for publishing:**
```json
{
  "name": "@yourname/bun-chat-server",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "bun build ./src/index.ts --outdir ./dist --target bun",
    "prepublishOnly": "bun run build"
  },
  "peerDependencies": {
    "bun": ">=1.0.0"
  }
}
```

## Deployment

### Docker

```dockerfile
FROM oven/bun:1

WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

COPY . .

EXPOSE 3001
CMD ["bun", "run", "start"]
```

**Build and run:**
```bash
docker build -t chat-service .
docker run -p 3001:3001 chat-service
```

### Railway / Render / Fly.io

These platforms set the `PORT` environment variable automatically.

1. Connect your repository
2. Set build command: `bun install`
3. Set start command: `bun run start`

### Behind Nginx

```nginx
location /chat/ {
    proxy_pass http://localhost:3001/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 86400;  # 24 hours for long-lived connections
}
```

### With SSL (wss://)

If using Nginx as reverse proxy with SSL:

```nginx
server {
    listen 443 ssl;
    server_name chat.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location /ws {
        proxy_pass http://localhost:3001/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location /api/ {
        proxy_pass http://localhost:3001/api/;
    }
}
```

Clients connect with `wss://chat.example.com/ws?...`

## Monitoring

### Health Check Endpoint

Add to server:

```typescript
if (url.pathname === "/health") {
  return new Response(JSON.stringify({
    status: "ok",
    rooms: rooms.size,
    uptime: process.uptime()
  }), {
    headers: { "Content-Type": "application/json" }
  });
}
```

### Logging

The server logs to console:
- User joins: `{username} joined room {roomId}. Users in room: {count}`
- User leaves: `{username} left room {roomId}. Users in room: {count}`
- Room cleanup: `Room {roomId} deleted (empty)`

## License

MIT
