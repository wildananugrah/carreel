import { nanoid } from "nanoid";
import type { ServerWebSocket } from "bun";

// Backend API URL for status updates
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";

/**
 * Chat WebSocket Service
 *
 * This service handles real-time WebSocket connections only.
 * Database persistence is handled by the main app's REST API.
 *
 * Endpoints:
 * - /ws?roomId=xxx&username=xxx - Broadcast chat (for live streams)
 * - /ws/private?conversationId=xxx&userId=xxx&username=xxx - Private messaging
 */

interface Message {
  type: "message" | "join" | "leave" | "typing" | "read" | "error";
  sender: string;
  senderId?: string;
  content: string;
  timestamp: number;
  messageId?: string;
  // Attachment fields for file sharing
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentType?: string;
  attachmentSize?: number;
}

interface WebSocketData {
  roomId: string;
  username: string;
  userId: string;
  roomType: "broadcast" | "private";
}

interface Client {
  ws: ServerWebSocket<WebSocketData>;
  username: string;
  userId: string;
  roomId: string;
  roomType: "broadcast" | "private";
}

const rooms = new Map<string, Set<Client>>();
// Global online users tracking (userId -> Set of connected sockets)
const onlineUsers = new Map<string, Set<Client>>();
// Global notification clients (userId -> Set of connected sockets for notifications)
const notificationClients = new Map<string, Set<ServerWebSocket<WebSocketData>>>();

// Update user status via backend API
async function updateUserStatusViaBackend(userId: string, isOnline: boolean) {
  if (!userId) return;

  try {
    await fetch(`${BACKEND_URL}/api/users/${userId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isOnline }),
    });
  } catch (e) {
    console.error("Failed to update user status via backend:", e);
  }
}

// Track user connection
function trackUserOnline(userId: string, client: Client) {
  if (!userId) return;

  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
    // User just came online - notify backend
    updateUserStatusViaBackend(userId, true);
  }
  onlineUsers.get(userId)!.add(client);
}

// Track user disconnection
function trackUserOffline(userId: string, client: Client) {
  if (!userId) return;

  const userSockets = onlineUsers.get(userId);
  if (userSockets) {
    userSockets.delete(client);
    if (userSockets.size === 0) {
      onlineUsers.delete(userId);
      // User went offline (no more connections) - notify backend
      updateUserStatusViaBackend(userId, false);
    }
  }
}

// Check if user is online (in-memory check)
function isUserOnline(userId: string): boolean {
  return onlineUsers.has(userId) && onlineUsers.get(userId)!.size > 0;
}

// Send notification to a user (across all their notification connections)
function sendNotificationToUser(userId: string, notification: object) {
  const clients = notificationClients.get(userId);
  if (!clients) return;

  const payload = JSON.stringify(notification);
  for (const ws of clients) {
    try {
      ws.send(payload);
    } catch (e) {
      console.error("Failed to send notification:", e);
    }
  }
}

function broadcast(roomId: string, message: Message, excludeClient?: Client) {
  const room = rooms.get(roomId);
  if (!room) return;

  const payload = JSON.stringify(message);
  for (const client of room) {
    if (client !== excludeClient) {
      client.ws.send(payload);
    }
  }
}

function getRoomUserCount(roomId: string): number {
  return rooms.get(roomId)?.size ?? 0;
}

function getOnlineUsers(roomId: string): string[] {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room).map(c => c.userId);
}

const server = Bun.serve<WebSocketData>({
  port: process.env.PORT || 3001,
  async fetch(req, server) {
    const url = new URL(req.url);

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // Create new room endpoint (for broadcasts)
    if (url.pathname === "/api/room/create" && req.method === "POST") {
      const roomId = nanoid(10);
      rooms.set(roomId, new Set());
      return new Response(JSON.stringify({ roomId }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // Check if room exists
    if (url.pathname.startsWith("/api/room/") && req.method === "GET") {
      const roomId = url.pathname.split("/").pop();
      const exists = rooms.has(roomId!);
      return new Response(
        JSON.stringify({
          exists,
          userCount: getRoomUserCount(roomId!),
          onlineUsers: getOnlineUsers(roomId!)
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // Check if a user is online (real-time in-memory status)
    if (url.pathname.startsWith("/api/user/") && url.pathname.endsWith("/status") && req.method === "GET") {
      const pathParts = url.pathname.split("/");
      const userId = pathParts[pathParts.length - 2] || "";
      return new Response(
        JSON.stringify({
          isOnline: isUserOnline(userId),
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    // WebSocket upgrade for broadcast chat (existing behavior)
    if (url.pathname === "/ws") {
      const roomId = url.searchParams.get("roomId");
      const username = url.searchParams.get("username");

      if (!roomId || !username) {
        return new Response("Missing roomId or username", { status: 400 });
      }

      // Create room if doesn't exist
      if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
      }

      const upgraded = server.upgrade(req, {
        data: {
          roomId,
          username,
          userId: "",
          roomType: "broadcast" as const,
        },
      });

      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 500 });
      }

      return undefined;
    }

    // WebSocket upgrade for private messaging
    if (url.pathname === "/ws/private") {
      const conversationId = url.searchParams.get("conversationId");
      const userId = url.searchParams.get("userId");
      const username = url.searchParams.get("username");

      if (!conversationId || !userId || !username) {
        return new Response("Missing conversationId, userId, or username", { status: 400 });
      }

      const roomId = `private:${conversationId}`;

      // Create room if doesn't exist
      if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
      }

      const upgraded = server.upgrade(req, {
        data: {
          roomId,
          username,
          userId,
          roomType: "private" as const,
        },
      });

      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 500 });
      }

      return undefined;
    }

    // WebSocket upgrade for global notifications (message badge updates)
    if (url.pathname === "/ws/notifications") {
      const userId = url.searchParams.get("userId");
      const username = url.searchParams.get("username") || "User";

      if (!userId) {
        return new Response("Missing userId", { status: 400 });
      }

      const upgraded = server.upgrade(req, {
        data: {
          roomId: `notifications:${userId}`,
          username,
          userId,
          roomType: "private" as const, // Use private type for online tracking
        },
      });

      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 500 });
      }

      return undefined;
    }

    // Internal API: send notification to a connected user (called by backend)
    if (url.pathname === "/api/notify" && req.method === "POST") {
      try {
        const { userId, notification } = await req.json() as { userId: string; notification: object };
        if (!userId || !notification) {
          return new Response(JSON.stringify({ error: "Missing userId or notification" }), {
            status: 400,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          });
        }
        sendNotificationToUser(userId, notification);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      } catch {
        return new Response(JSON.stringify({ error: "Invalid request body" }), {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
    }

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    open(ws) {
      const { roomId, username, userId, roomType } = ws.data;

      // Handle notification connections separately
      if (roomId.startsWith("notifications:")) {
        if (!notificationClients.has(userId)) {
          notificationClients.set(userId, new Set());
        }
        notificationClients.get(userId)!.add(ws);

        // Also track as online
        const dummyClient: Client = { ws, username, userId, roomId, roomType };
        trackUserOnline(userId, dummyClient);
        (ws as unknown as { client: Client }).client = dummyClient;

        ws.send(JSON.stringify({
          type: "connected",
          content: "Notification channel connected",
          timestamp: Date.now(),
        }));

        console.log(`${username} connected to notifications. Total notification clients for user: ${notificationClients.get(userId)?.size}`);
        return;
      }

      const client: Client = {
        ws,
        username,
        userId,
        roomId,
        roomType,
      };

      const room = rooms.get(roomId);
      if (room) {
        room.add(client);
      }

      // Store client reference on ws for later access
      (ws as unknown as { client: Client }).client = client;

      // Track user online status (for private messaging)
      if (roomType === "private" && userId) {
        trackUserOnline(userId, client);
      }

      // Broadcast join message to others
      broadcast(
        roomId,
        {
          type: "join",
          sender: "system",
          senderId: userId,
          content: `${username} joined`,
          timestamp: Date.now(),
        },
        client
      );

      // Send confirmation to the joining user
      ws.send(
        JSON.stringify({
          type: "join",
          sender: "system",
          content: `Connected as ${username}`,
          timestamp: Date.now(),
          onlineUsers: getOnlineUsers(roomId),
        })
      );

      console.log(
        `${username} joined room ${roomId}. Users in room: ${room?.size}`
      );
    },

    message(ws, message) {
      const client = (ws as unknown as { client: Client }).client;
      if (!client) return;

      try {
        const data = JSON.parse(message.toString());

        if (data.type === "message" && (data.content || data.attachmentUrl)) {
          const msg: Message = {
            type: "message",
            sender: client.username,
            senderId: client.userId,
            content: data.content || "",
            timestamp: Date.now(),
            messageId: data.messageId, // Client can provide messageId after saving to DB
            // Forward attachment data for real-time file sharing
            attachmentUrl: data.attachmentUrl,
            attachmentName: data.attachmentName,
            attachmentType: data.attachmentType,
            attachmentSize: data.attachmentSize,
          };

          // Broadcast to all in room (including sender for confirmation)
          const room = rooms.get(client.roomId);
          const usersInRoom = new Set<string>();
          if (room) {
            const payload = JSON.stringify(msg);
            for (const c of room) {
              c.ws.send(payload);
              usersInRoom.add(c.userId);
            }
          }

          // Send notification to recipient if they provided recipientId
          // This handles the case where recipient is NOT in the chat room
          if (data.recipientId && data.recipientId !== client.userId) {
            // Only send notification if recipient is not already in the room
            if (!usersInRoom.has(data.recipientId)) {
              sendNotificationToUser(data.recipientId, {
                type: "new_message",
                conversationId: client.roomId.replace("private:", ""),
                senderId: client.userId,
                senderName: client.username,
                content: data.content || (data.attachmentName ? `📎 ${data.attachmentName}` : ""),
                timestamp: Date.now(),
              });
            }
          }
        } else if (data.type === "typing") {
          // Broadcast typing indicator to others
          broadcast(
            client.roomId,
            {
              type: "typing",
              sender: client.username,
              senderId: client.userId,
              content: "",
              timestamp: Date.now(),
            },
            client
          );
        } else if (data.type === "read") {
          // Broadcast read receipt to others
          broadcast(
            client.roomId,
            {
              type: "read",
              sender: client.username,
              senderId: client.userId,
              content: "",
              timestamp: Date.now(),
            },
            client
          );
        }
      } catch (e) {
        console.error("Failed to parse message:", e);
        ws.send(JSON.stringify({
          type: "error",
          sender: "system",
          content: "Failed to parse message",
          timestamp: Date.now(),
        }));
      }
    },

    close(ws) {
      const client = (ws as unknown as { client: Client }).client;
      if (!client) return;

      // Handle notification disconnections
      if (client.roomId.startsWith("notifications:")) {
        const userClients = notificationClients.get(client.userId);
        if (userClients) {
          userClients.delete(ws);
          if (userClients.size === 0) {
            notificationClients.delete(client.userId);
          }
        }
        trackUserOffline(client.userId, client);
        console.log(`${client.username} disconnected from notifications`);
        return;
      }

      // Track user offline status
      if (client.roomType === "private" && client.userId) {
        trackUserOffline(client.userId, client);
      }

      const room = rooms.get(client.roomId);
      if (room) {
        room.delete(client);

        // Broadcast leave message
        broadcast(client.roomId, {
          type: "leave",
          sender: "system",
          senderId: client.userId,
          content: `${client.username} left`,
          timestamp: Date.now(),
        });

        console.log(
          `${client.username} left room ${client.roomId}. Users in room: ${room.size}`
        );

        // Clean up empty rooms after some time
        if (room.size === 0) {
          setTimeout(() => {
            const currentRoom = rooms.get(client.roomId);
            if (currentRoom && currentRoom.size === 0) {
              rooms.delete(client.roomId);
              console.log(`Room ${client.roomId} deleted (empty)`);
            }
          }, 60000); // Delete empty room after 1 minute
        }
      }
    },
  },
});

console.log(`🚀 Chat server running on http://localhost:${server.port}`);
