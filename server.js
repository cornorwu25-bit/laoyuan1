const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const host = "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const root = __dirname;
const size = 15;
const winLength = 5;
const rooms = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function emptyBoard() {
  return Array.from({ length: size }, () => Array(size).fill(0));
}

function createRoom(id) {
  return {
    id,
    board: emptyBoard(),
    current: 1,
    moves: [],
    winner: 0,
    startedAt: Date.now(),
    players: { 1: null, 2: null },
    clients: new Set(),
  };
}

function getRoom(id) {
  const roomId = String(id || "").trim().toUpperCase();
  if (!roomId) {
    return null;
  }
  if (!rooms.has(roomId)) {
    rooms.set(roomId, createRoom(roomId));
  }
  return rooms.get(roomId);
}

function assignPlayer(room, clientId) {
  if (room.players[1] === clientId) return 1;
  if (room.players[2] === clientId) return 2;
  if (!room.players[1]) {
    room.players[1] = clientId;
    return 1;
  }
  if (!room.players[2]) {
    room.players[2] = clientId;
    return 2;
  }
  return null;
}

function colorByClient(room) {
  const colors = {};
  for (const [color, id] of Object.entries(room.players)) {
    if (id) {
      colors[id] = Number(color);
    }
  }
  return colors;
}

function publicState(room) {
  return {
    id: room.id,
    board: room.board,
    current: room.current,
    moves: room.moves,
    winner: room.winner,
    startedAt: room.startedAt,
    players: room.players,
    colorByClient: colorByClient(room),
  };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 100_000) {
        req.destroy();
        reject(new Error("请求内容过大"));
      }
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("JSON 格式错误"));
      }
    });
    req.on("error", reject);
  });
}

function broadcast(room) {
  const data = `event: state\ndata: ${JSON.stringify(publicState(room))}\n\n`;
  for (const res of [...room.clients]) {
    res.write(data);
  }
}

function hasWon(room, row, col, player) {
  const directions = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];

  return directions.some(([dr, dc]) => {
    const total =
      1 + countDirection(room, row, col, dr, dc, player) + countDirection(room, row, col, -dr, -dc, player);
    return total >= winLength;
  });
}

function countDirection(room, row, col, dr, dc, player) {
  let count = 0;
  let nextRow = row + dr;
  let nextCol = col + dc;

  while (
    nextRow >= 0 &&
    nextRow < size &&
    nextCol >= 0 &&
    nextCol < size &&
    room.board[nextRow][nextCol] === player
  ) {
    count++;
    nextRow += dr;
    nextCol += dc;
  }

  return count;
}

function resetRoom(room) {
  room.board = emptyBoard();
  room.current = 1;
  room.moves = [];
  room.winner = 0;
  room.startedAt = Date.now();
}

function serveStatic(req, res, url) {
  const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(root, requested));
  if (!filePath.startsWith(root)) {
    sendJson(res, 403, { error: "禁止访问" });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(res, 404, { error: "文件不存在" });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(content);
  });
}

async function handleApi(req, res, url) {
  try {
    if (req.method === "POST" && url.pathname === "/api/rooms/join") {
      const body = await readJson(req);
      const room = getRoom(body.room);
      if (!room || !body.clientId) {
        sendJson(res, 400, { error: "缺少房间或玩家信息" });
        return;
      }
      const color = assignPlayer(room, body.clientId);
      broadcast(room);
      sendJson(res, 200, { color, state: publicState(room) });
      return;
    }

    const match = url.pathname.match(/^\/api\/rooms\/([^/]+)\/(move|undo|reset)$/);
    if (!match || req.method !== "POST") {
      sendJson(res, 404, { error: "接口不存在" });
      return;
    }

    const room = getRoom(match[1]);
    const action = match[2];
    const body = await readJson(req);
    const player = colorByClient(room)[body.clientId];

    if (!player) {
      sendJson(res, 403, { error: "观战不能操作棋局" });
      return;
    }

    if (action === "reset") {
      resetRoom(room);
      broadcast(room);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (action === "undo") {
      const last = room.moves.pop();
      if (!last) {
        sendJson(res, 400, { error: "暂无可悔棋步数" });
        return;
      }
      room.board[last.row][last.col] = 0;
      room.current = last.player;
      room.winner = 0;
      broadcast(room);
      sendJson(res, 200, { ok: true });
      return;
    }

    const row = Number(body.row);
    const col = Number(body.col);
    if (room.winner) {
      sendJson(res, 400, { error: "本局已结束，请开新局" });
      return;
    }
    if (player !== room.current) {
      sendJson(res, 400, { error: "还没轮到你" });
      return;
    }
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= size || col < 0 || col >= size) {
      sendJson(res, 400, { error: "落子位置无效" });
      return;
    }
    if (room.board[row][col]) {
      sendJson(res, 400, { error: "这里已经有棋子" });
      return;
    }

    room.board[row][col] = player;
    room.moves.push({ row, col, player });
    if (hasWon(room, row, col, player)) {
      room.winner = player;
    } else if (room.moves.length === size * size) {
      room.winner = 3;
    } else {
      room.current = player === 1 ? 2 : 1;
    }
    broadcast(room);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

function handleEvents(req, res, url) {
  const room = getRoom(url.searchParams.get("room"));
  if (!room) {
    sendJson(res, 400, { error: "缺少房间号" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("\n");
  room.clients.add(res);
  res.write(`event: state\ndata: ${JSON.stringify(publicState(room))}\n\n`);

  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    room.clients.delete(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/healthz") {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (url.pathname === "/events") {
    handleEvents(req, res, url);
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url);
    return;
  }
  serveStatic(req, res, url);
});

server.listen(port, host, () => {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => `http://${item.address}:${port}`);

  console.log(`五子棋服务已启动: http://localhost:${port}`);
  for (const address of addresses) {
    console.log(`局域网访问: ${address}`);
  }
});
