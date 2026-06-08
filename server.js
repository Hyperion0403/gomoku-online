const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const rooms = new Map();
const clients = new Map();

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".md": "text/plain; charset=utf-8",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(ROOT, requested));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
});

server.on("upgrade", (req, socket) => {
  if (req.url !== "/ws") {
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );

  socket.on("data", (chunk) => handleSocketData(socket, chunk));
  socket.on("close", () => leaveRoom(socket));
  socket.on("error", () => leaveRoom(socket));
});

function handleSocketData(socket, chunk) {
  const message = decodeFrame(chunk);
  if (!message) return;

  let data;
  try {
    data = JSON.parse(message);
  } catch {
    send(socket, { type: "error", message: "消息格式错误" });
    return;
  }

  if (data.type === "join") {
    joinRoom(socket, data.room, data.role);
    return;
  }

  const client = clients.get(socket);
  if (!client) return;

  if (["move", "reset", "undo", "sync"].includes(data.type)) {
    relay(client.room, socket, data);
  }
}

function joinRoom(socket, roomId, role) {
  if (!/^[a-f0-9]{8}$/i.test(String(roomId)) || !["host", "guest"].includes(role)) {
    send(socket, { type: "error", message: "房间码无效" });
    return;
  }

  const existingClient = clients.get(socket);
  if (existingClient) {
    send(socket, { type: "joined", room: existingClient.room, role: existingClient.role });
    return;
  }

  let room = rooms.get(roomId);
  if (!room) {
    room = { host: null, guest: null };
    rooms.set(roomId, room);
  }

  if (room[role] && room[role] !== socket) {
    send(socket, { type: "error", message: role === "host" ? "房间已存在" : "房间已满" });
    return;
  }

  room[role] = socket;
  clients.set(socket, { room: roomId, role });
  send(socket, { type: "joined", room: roomId, role });

  if (room.host && room.guest) {
    send(room.host, { type: "connected", role: "host" });
    send(room.guest, { type: "connected", role: "guest" });
  }
}

function leaveRoom(socket) {
  const client = clients.get(socket);
  if (!client) return;

  const room = rooms.get(client.room);
  if (room) {
    if (room.host === socket) room.host = null;
    if (room.guest === socket) room.guest = null;
    relay(client.room, socket, { type: "peer-left" });
    if (!room.host && !room.guest) rooms.delete(client.room);
  }

  clients.delete(socket);
}

function relay(roomId, sender, data) {
  const room = rooms.get(roomId);
  if (!room) return;
  [room.host, room.guest].forEach((socket) => {
    if (socket && socket !== sender) send(socket, data);
  });
}

function send(socket, data) {
  if (!socket.writable) return;
  socket.write(encodeFrame(JSON.stringify(data)));
}

function decodeFrame(buffer) {
  const first = buffer[0];
  const opcode = first & 0x0f;
  if (opcode === 0x8) return null;

  let offset = 2;
  let length = buffer[1] & 0x7f;

  if (length === 126) {
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    const high = buffer.readUInt32BE(offset);
    const low = buffer.readUInt32BE(offset + 4);
    length = high * 2 ** 32 + low;
    offset += 8;
  }

  const masked = (buffer[1] & 0x80) !== 0;
  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  offset += masked ? 4 : 0;

  const payload = buffer.subarray(offset, offset + length);
  if (!masked) return payload.toString("utf8");

  const unmasked = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    unmasked[index] = payload[index] ^ mask[index % 4];
  }
  return unmasked.toString("utf8");
}

function encodeFrame(message) {
  const payload = Buffer.from(message);
  const length = payload.length;
  let header;

  if (length < 126) {
    header = Buffer.from([0x81, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, payload]);
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Gomoku server: http://127.0.0.1:${PORT}/`);
});
