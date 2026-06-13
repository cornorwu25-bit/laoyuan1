const canvas = document.querySelector("#board");
const ctx = canvas.getContext("2d");
const statusText = document.querySelector("#statusText");
const turnStone = document.querySelector("#turnStone");
const moveCount = document.querySelector("#moveCount");
const timerText = document.querySelector("#timer");
const historyList = document.querySelector("#history");
const newGameButton = document.querySelector("#newGame");
const undoButton = document.querySelector("#undo");
const pvpModeButton = document.querySelector("#pvpMode");
const aiModeButton = document.querySelector("#aiMode");
const onlineModeButton = document.querySelector("#onlineMode");
const soundToggle = document.querySelector("#soundToggle");
const onlineCard = document.querySelector("#onlineCard");
const roomCodeText = document.querySelector("#roomCode");
const playerRoleText = document.querySelector("#playerRole");
const connectionText = document.querySelector("#connectionText");
const shareLinkInput = document.querySelector("#shareLink");
const copyLinkButton = document.querySelector("#copyLink");

const size = 15;
const cell = canvas.width / (size + 1);
const margin = cell;
const winLength = 5;
const humanPlayer = 1;
const aiPlayer = 2;
const playerLabels = {
  1: "黑棋",
  2: "白棋",
};

let board = emptyBoard();
let current = 1;
let moves = [];
let winner = 0;
let startedAt = Date.now();
let timerId = null;
let lastPointer = null;
let gameMode = "pvp";
let isAiThinking = false;
let audioContext = null;
let clientId = getClientId();
let online = {
  room: null,
  color: null,
  connected: false,
  eventSource: null,
  players: {},
  error: "",
};

function emptyBoard() {
  return Array.from({ length: size }, () => Array(size).fill(0));
}

function getClientId() {
  const key = "gomokuClientId";
  let value = localStorage.getItem(key);
  if (!value) {
    value = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    localStorage.setItem(key, value);
  }
  return value;
}

function resetGame() {
  board = emptyBoard();
  current = 1;
  moves = [];
  winner = 0;
  isAiThinking = false;
  startedAt = Date.now();
  restartTimer();
  render();
  updateUi();
}

function restartTimer() {
  clearInterval(timerId);
  timerId = setInterval(updateTimer, 1000);
  updateTimer();
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBoard();
  drawStones();
  drawHoverHint();
}

function drawBoard() {
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#e8bd77");
  gradient.addColorStop(0.48, "#d7a05d");
  gradient.addColorStop(1, "#bd7b35");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(57, 39, 17, 0.72)";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";

  for (let i = 0; i < size; i++) {
    const pos = margin + i * cell;
    ctx.beginPath();
    ctx.moveTo(margin, pos);
    ctx.lineTo(margin + (size - 1) * cell, pos);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(pos, margin);
    ctx.lineTo(pos, margin + (size - 1) * cell);
    ctx.stroke();
  }

  const stars = [
    [3, 3],
    [3, 11],
    [7, 7],
    [11, 3],
    [11, 11],
  ];
  ctx.fillStyle = "#3a2916";
  for (const [x, y] of stars) {
    ctx.beginPath();
    ctx.arc(margin + x * cell, margin + y * cell, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawStones() {
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (board[row][col]) {
        drawStone(col, row, board[row][col]);
      }
    }
  }

  const lastMove = moves.at(-1);
  if (lastMove) {
    const x = margin + lastMove.col * cell;
    const y = margin + lastMove.row * cell;
    ctx.strokeStyle = lastMove.player === 1 ? "#f5d36f" : "#316f5d";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawStone(col, row, player) {
  const x = margin + col * cell;
  const y = margin + row * cell;
  const radius = cell * 0.38;
  const gradient = ctx.createRadialGradient(
    x - radius * 0.35,
    y - radius * 0.45,
    radius * 0.12,
    x,
    y,
    radius
  );

  if (player === 1) {
    gradient.addColorStop(0, "#777e83");
    gradient.addColorStop(0.45, "#171b1f");
    gradient.addColorStop(1, "#030405");
  } else {
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.58, "#ebe8df");
    gradient.addColorStop(1, "#a9a292");
  }

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.28)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHoverHint() {
  if (winner || !lastPointer || isAiTurn() || !canCurrentClientMove()) {
    return;
  }

  const point = pointFromEvent(lastPointer);
  if (!point || board[point.row][point.col]) {
    return;
  }

  const x = margin + point.col * cell;
  const y = margin + point.row * cell;
  ctx.save();
  ctx.globalAlpha = 0.35;
  drawStone(point.col, point.row, current);
  ctx.restore();

  ctx.strokeStyle = current === 1 ? "#f5d36f" : "#316f5d";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, cell * 0.42, 0, Math.PI * 2);
  ctx.stroke();
}

canvas.addEventListener("pointermove", (event) => {
  lastPointer = event;
  render();
});

canvas.addEventListener("pointerleave", () => {
  lastPointer = null;
  render();
});

canvas.addEventListener("click", async (event) => {
  if (winner || isAiThinking || isAiTurn()) {
    return;
  }

  const point = pointFromEvent(event);
  if (!point || board[point.row][point.col]) {
    playSound("error");
    return;
  }

  if (gameMode === "online") {
    if (!canCurrentClientMove()) {
      playSound("error");
      return;
    }
    await sendOnlineAction("move", point);
    return;
  }

  placeStone(point.row, point.col, { source: "human" });
});

function pointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const scale = canvas.width / rect.width;
  const x = (event.clientX - rect.left) * scale;
  const y = (event.clientY - rect.top) * scale;
  const col = Math.round((x - margin) / cell);
  const row = Math.round((y - margin) / cell);

  if (row < 0 || row >= size || col < 0 || col >= size) {
    return null;
  }

  const gridX = margin + col * cell;
  const gridY = margin + row * cell;
  const distance = Math.hypot(x - gridX, y - gridY);
  return distance <= cell * 0.45 ? { row, col } : null;
}

function placeStone(row, col, options = {}) {
  board[row][col] = current;
  moves.push({ row, col, player: current });
  finishMove(row, col);
  render();
  updateUi();

  if (options.source === "human") {
    queueAiMove();
  }
}

function finishMove(row, col) {
  if (hasWon(row, col, current)) {
    winner = current;
    clearInterval(timerId);
    playSound("win");
  } else if (moves.length === size * size) {
    winner = 3;
    clearInterval(timerId);
    playSound("draw");
  } else {
    playSound(current === 1 ? "black" : "white");
    current = current === 1 ? 2 : 1;
  }
}

function hasWon(row, col, player) {
  const directions = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];

  return directions.some(([dr, dc]) => {
    const total =
      1 + countDirection(row, col, dr, dc, player) + countDirection(row, col, -dr, -dc, player);
    return total >= winLength;
  });
}

function countDirection(row, col, dr, dc, player) {
  let count = 0;
  let nextRow = row + dr;
  let nextCol = col + dc;

  while (
    nextRow >= 0 &&
    nextRow < size &&
    nextCol >= 0 &&
    nextCol < size &&
    board[nextRow][nextCol] === player
  ) {
    count++;
    nextRow += dr;
    nextCol += dc;
  }

  return count;
}

function isAiTurn() {
  return gameMode === "ai" && current === aiPlayer && !winner;
}

function queueAiMove() {
  if (!isAiTurn()) {
    return;
  }

  isAiThinking = true;
  updateUi();
  window.setTimeout(() => {
    const move = findBestAiMove();
    isAiThinking = false;
    if (move && !winner) {
      placeStone(move.row, move.col, { source: "ai" });
    } else {
      updateUi();
    }
  }, 320);
}

function findBestAiMove() {
  if (!moves.length) {
    return { row: 7, col: 7 };
  }

  let best = null;
  for (const { row, col } of candidateMoves()) {
    const attack = scoreMove(row, col, aiPlayer);
    const defense = scoreMove(row, col, humanPlayer);
    const centerBias = 16 - Math.abs(row - 7) - Math.abs(col - 7);
    const score = attack * 1.12 + defense + centerBias;

    if (!best || score > best.score) {
      best = { row, col, score };
    }
  }

  return best;
}

function candidateMoves() {
  const candidates = new Map();

  for (const move of moves) {
    for (let row = Math.max(0, move.row - 2); row <= Math.min(size - 1, move.row + 2); row++) {
      for (let col = Math.max(0, move.col - 2); col <= Math.min(size - 1, move.col + 2); col++) {
        if (!board[row][col]) {
          candidates.set(`${row},${col}`, { row, col });
        }
      }
    }
  }

  return [...candidates.values()];
}

function scoreMove(row, col, player) {
  board[row][col] = player;
  if (hasWon(row, col, player)) {
    board[row][col] = 0;
    return 1000000;
  }

  const directions = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  let score = 0;

  for (const [dr, dc] of directions) {
    const forward = countDirection(row, col, dr, dc, player);
    const backward = countDirection(row, col, -dr, -dc, player);
    const length = 1 + forward + backward;
    const openEnds =
      Number(isOpenEnd(row + (forward + 1) * dr, col + (forward + 1) * dc)) +
      Number(isOpenEnd(row - (backward + 1) * dr, col - (backward + 1) * dc));

    score += patternScore(length, openEnds);
  }

  board[row][col] = 0;
  return score;
}

function isOpenEnd(row, col) {
  return row >= 0 && row < size && col >= 0 && col < size && board[row][col] === 0;
}

function patternScore(length, openEnds) {
  if (length >= 5) return 1000000;
  if (length === 4 && openEnds === 2) return 120000;
  if (length === 4 && openEnds === 1) return 25000;
  if (length === 3 && openEnds === 2) return 10000;
  if (length === 3 && openEnds === 1) return 1600;
  if (length === 2 && openEnds === 2) return 700;
  if (length === 2 && openEnds === 1) return 120;
  if (length === 1 && openEnds === 2) return 30;
  return 2;
}

function updateUi() {
  moveCount.textContent = moves.length;
  undoButton.disabled = moves.length === 0 || isAiThinking || (gameMode === "online" && !online.color);
  pvpModeButton.classList.toggle("active", gameMode === "pvp");
  aiModeButton.classList.toggle("active", gameMode === "ai");
  onlineModeButton.classList.toggle("active", gameMode === "online");
  pvpModeButton.setAttribute("aria-pressed", String(gameMode === "pvp"));
  aiModeButton.setAttribute("aria-pressed", String(gameMode === "ai"));
  onlineModeButton.setAttribute("aria-pressed", String(gameMode === "online"));
  onlineCard.hidden = gameMode !== "online";
  turnStone.className = `stone ${current === 1 ? "black" : "white"}`;

  if (winner === 3) {
    statusText.textContent = "平局";
  } else if (winner) {
    statusText.textContent = `${playerLabels[winner]}获胜`;
    turnStone.className = `stone ${winner === 1 ? "black" : "white"}`;
  } else if (isAiThinking) {
    statusText.textContent = "AI 思考中";
  } else if (gameMode === "ai" && current === humanPlayer) {
    statusText.textContent = "你执黑棋";
  } else if (gameMode === "ai" && current === aiPlayer) {
    statusText.textContent = "AI 执白棋";
  } else if (gameMode === "online" && !online.connected) {
    statusText.textContent = "等待连接";
  } else if (gameMode === "online" && online.color === current) {
    statusText.textContent = `轮到你落子`;
  } else if (gameMode === "online" && online.color) {
    statusText.textContent = `等待${playerLabels[current]}`;
  } else {
    statusText.textContent = `${playerLabels[current]}落子`;
  }

  updateOnlineUi();
  renderHistory();
}

function updateOnlineUi() {
  if (gameMode !== "online") {
    return;
  }

  roomCodeText.textContent = online.room || "未连接";
  playerRoleText.textContent = online.color ? playerLabels[online.color] : "观战";
  shareLinkInput.value = online.room ? roomUrl(online.room) : "";

  const playerCount = Object.values(online.players || {}).filter(Boolean).length;
  if (online.error) {
    connectionText.textContent = online.error;
  } else if (!online.connected) {
    connectionText.textContent = "正在连接房间...";
  } else if (playerCount < 2) {
    connectionText.textContent = "已连接，等待朋友加入。";
  } else {
    connectionText.textContent = "两位玩家已就位，可以开始对局。";
  }
}

function renderHistory() {
  historyList.innerHTML = "";
  moves.slice(-80).forEach((move, index) => {
    const item = document.createElement("li");
    const moveNumber = moves.length > 80 ? moves.length - 80 + index + 1 : index + 1;
    const colName = String.fromCharCode(65 + move.col);
    item.textContent = `${moveNumber}. ${playerLabels[move.player]} ${colName}${move.row + 1}`;
    if (index === Math.min(moves.length, 80) - 1) {
      item.className = "latest";
    }
    historyList.appendChild(item);
  });
  historyList.scrollTop = historyList.scrollHeight;
}

function updateTimer() {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  timerText.textContent = `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function setMode(mode) {
  if (gameMode === mode) {
    return;
  }

  closeOnline();
  gameMode = mode;
  playSound("switch");
  if (mode === "online") {
    startOnline();
  } else {
    resetGame();
  }
}

async function undoMove() {
  if (!moves.length || isAiThinking) {
    return;
  }

  if (gameMode === "online") {
    await sendOnlineAction("undo");
    return;
  }

  const undoCount = gameMode === "ai" ? Math.min(2, moves.length) : 1;
  for (let i = 0; i < undoCount; i++) {
    const last = moves.pop();
    board[last.row][last.col] = 0;
    current = last.player;
  }

  winner = 0;
  restartTimer();
  playSound("undo");
  render();
  updateUi();
}

async function newGame() {
  playSound("switch");
  if (gameMode === "online") {
    await sendOnlineAction("reset");
    return;
  }
  resetGame();
}

function canCurrentClientMove() {
  return gameMode !== "online" || (online.connected && online.color === current);
}

function startOnline() {
  const params = new URLSearchParams(location.search);
  const room = params.get("room") || makeRoomCode();
  online = {
    room,
    color: null,
    connected: false,
    eventSource: null,
    players: {},
    error: "",
  };

  history.replaceState(null, "", roomUrl(room, true));
  resetGame();
  joinRoom(room);
}

async function joinRoom(room) {
  try {
    const response = await fetch("/api/rooms/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room, clientId }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "无法加入房间");
    }

    online.color = data.color;
    applyOnlineState(data.state);
    connectEvents(room);
  } catch (error) {
    online.error = error.message;
    updateUi();
  }
}

function connectEvents(room) {
  if (online.eventSource) {
    online.eventSource.close();
  }

  const events = new EventSource(`/events?room=${encodeURIComponent(room)}&client=${encodeURIComponent(clientId)}`);
  online.eventSource = events;

  events.addEventListener("open", () => {
    online.connected = true;
    online.error = "";
    updateUi();
  });

  events.addEventListener("state", (event) => {
    online.connected = true;
    online.error = "";
    applyOnlineState(JSON.parse(event.data));
  });

  events.addEventListener("error", () => {
    online.connected = false;
    online.error = "连接断开，正在自动重连。";
    updateUi();
  });
}

function closeOnline() {
  if (online.eventSource) {
    online.eventSource.close();
  }
  online.eventSource = null;
}

function applyOnlineState(state) {
  board = state.board;
  current = state.current;
  moves = state.moves;
  winner = state.winner;
  online.players = state.players || {};
  online.color = state.colorByClient?.[clientId] || online.color;
  startedAt = state.startedAt || Date.now();
  if (winner) {
    clearInterval(timerId);
  } else {
    restartTimer();
  }
  render();
  updateUi();
}

async function sendOnlineAction(action, payload = {}) {
  try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(online.room)}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, ...payload }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "操作失败");
    }
    online.error = "";
  } catch (error) {
    online.error = error.message;
    playSound("error");
    updateUi();
  }
}

function makeRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function roomUrl(room, keepSearchOnly = false) {
  const url = new URL(location.href);
  url.searchParams.set("room", room);
  return keepSearchOnly ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}

async function copyShareLink() {
  if (!shareLinkInput.value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(shareLinkInput.value);
    copyLinkButton.textContent = "已复制";
    window.setTimeout(() => {
      copyLinkButton.textContent = "复制";
    }, 1200);
  } catch {
    shareLinkInput.select();
  }
}

function getAudioContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return null;
    }
    audioContext = new AudioContextClass();
  }
  return audioContext;
}

function playSound(type) {
  if (!soundToggle.checked) {
    return;
  }

  const audio = getAudioContext();
  if (!audio) {
    return;
  }

  const now = audio.currentTime;
  const notes = {
    black: [260, 0.055, 0.045],
    white: [340, 0.055, 0.04],
    win: [520, 0.16, 0.065],
    draw: [220, 0.12, 0.045],
    undo: [180, 0.075, 0.035],
    switch: [420, 0.075, 0.035],
    error: [120, 0.06, 0.025],
  };
  const [frequency, duration, volume] = notes[type] || notes.black;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();

  oscillator.type = type === "win" ? "sine" : "triangle";
  oscillator.frequency.setValueAtTime(frequency, now);
  if (type === "win") {
    oscillator.frequency.exponentialRampToValueAtTime(780, now + duration);
  }

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}

newGameButton.addEventListener("click", newGame);
undoButton.addEventListener("click", undoMove);
pvpModeButton.addEventListener("click", () => setMode("pvp"));
aiModeButton.addEventListener("click", () => setMode("ai"));
onlineModeButton.addEventListener("click", () => setMode("online"));
copyLinkButton.addEventListener("click", copyShareLink);

if (new URLSearchParams(location.search).has("room")) {
  gameMode = "online";
  startOnline();
} else {
  resetGame();
}
