const BOARD_SIZE = 15;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
const STARS = [
  [3, 3],
  [3, 7],
  [3, 11],
  [7, 3],
  [7, 7],
  [7, 11],
  [11, 3],
  [11, 7],
  [11, 11],
];

const els = {
  board: document.querySelector("#board"),
  turnText: document.querySelector("#turnText"),
  turnCard: document.querySelector("#turnCard"),
  networkStatus: document.querySelector("#networkStatus"),
  roomInput: document.querySelector("#roomInput"),
  hostBtn: document.querySelector("#hostBtn"),
  joinBtn: document.querySelector("#joinBtn"),
  copyBtn: document.querySelector("#copyBtn"),
  shareHint: document.querySelector("#shareHint"),
  undoBtn: document.querySelector("#undoBtn"),
  resetBtn: document.querySelector("#resetBtn"),
  blackScore: document.querySelector("#blackScore"),
  whiteScore: document.querySelector("#whiteScore"),
  movesList: document.querySelector("#movesList"),
};

const state = {
  board: createEmptyBoard(),
  turn: BLACK,
  winner: EMPTY,
  moves: [],
  score: { [BLACK]: 0, [WHITE]: 0 },
  role: "local",
  socket: null,
  socketRole: "local",
  roomId: "",
};

function createEmptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(EMPTY));
}

function colorName(color) {
  return color === BLACK ? "黑棋" : "白棋";
}

function other(color) {
  return color === BLACK ? WHITE : BLACK;
}

function buildBoard() {
  els.board.innerHTML = "";
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const cell = document.createElement("button");
      cell.className = "point empty";
      cell.type = "button";
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-label", `${row + 1}行${col + 1}列`);
      cell.addEventListener("click", () => handleMove(row, col));
      els.board.append(cell);
    }
  }

  STARS.forEach(([row, col]) => {
    const star = document.createElement("span");
    star.className = "star";
    star.style.left = `${((col + 0.5) / BOARD_SIZE) * 100}%`;
    star.style.top = `${((row + 0.5) / BOARD_SIZE) * 100}%`;
    els.board.append(star);
  });
}

function handleMove(row, col, remote = false) {
  if (state.winner || state.board[row][col] !== EMPTY) return false;
  if (!remote && !isMyTurn()) return false;

  const color = state.turn;
  state.board[row][col] = color;
  state.moves.push({ row, col, color });
  const winner = getWinner(row, col, color);

  if (winner) {
    state.winner = color;
    state.score[color] += 1;
  } else {
    state.turn = other(state.turn);
  }

  render();
  if (!remote) send({ type: "move", row, col });
  return true;
}

function isMyTurn() {
  if (state.role === "local") return true;
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return false;
  return (state.role === "host" && state.turn === BLACK) || (state.role === "guest" && state.turn === WHITE);
}

function getWinner(row, col, color) {
  const directions = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];

  return directions.some(([dr, dc]) => {
    let count = 1;
    count += countDirection(row, col, dr, dc, color);
    count += countDirection(row, col, -dr, -dc, color);
    return count >= 5;
  });
}

function countDirection(row, col, dr, dc, color) {
  let count = 0;
  let nextRow = row + dr;
  let nextCol = col + dc;

  while (
    nextRow >= 0 &&
    nextRow < BOARD_SIZE &&
    nextCol >= 0 &&
    nextCol < BOARD_SIZE &&
    state.board[nextRow][nextCol] === color
  ) {
    count += 1;
    nextRow += dr;
    nextCol += dc;
  }

  return count;
}

function undo(remote = false) {
  if (!state.moves.length) return;
  const last = state.moves.pop();
  state.board[last.row][last.col] = EMPTY;
  state.winner = EMPTY;
  state.turn = last.color;
  render();
  if (!remote) send({ type: "undo" });
}

function resetGame(remote = false) {
  state.board = createEmptyBoard();
  state.turn = BLACK;
  state.winner = EMPTY;
  state.moves = [];
  render();
  if (!remote) send({ type: "reset" });
}

function render() {
  const cells = els.board.querySelectorAll(".point");
  const last = state.moves.at(-1);

  cells.forEach((cell) => {
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    const value = state.board[row][col];
    cell.className = "point";
    cell.disabled = Boolean(value) || Boolean(state.winner) || !isMyTurn();
    cell.classList.add(value === BLACK ? "black" : value === WHITE ? "white" : "empty");
    cell.classList.toggle("last", Boolean(last && last.row === row && last.col === col));
    cell.style.color = state.turn === BLACK ? "#15171b" : "#f2eee6";
  });

  els.turnCard.querySelector(".stone").className = `stone ${state.turn === BLACK ? "black" : "white"}`;
  els.turnText.textContent = state.winner
    ? `${colorName(state.winner)}获胜`
    : `${colorName(state.turn)}落子${state.role === "local" ? "" : isMyTurn() ? "，轮到你" : "，等待对方"}`;
  els.blackScore.textContent = String(state.score[BLACK]);
  els.whiteScore.textContent = String(state.score[WHITE]);
  els.undoBtn.disabled = !state.moves.length || state.role !== "local";
  updateMoves();
}

function updateMoves() {
  els.movesList.innerHTML = "";
  const recentMoves = state.moves.slice(-18).reverse();
  recentMoves.forEach((move) => {
    const item = document.createElement("li");
    item.textContent = `${colorName(move.color)}：${move.row + 1}, ${move.col + 1}`;
    els.movesList.append(item);
  });
}

function makeRoomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getInviteUrl(roomId) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomId);
  return url.toString();
}

function setNetworkStatus(text) {
  els.networkStatus.textContent = text;
}

function canUseWebSocket() {
  return location.protocol === "http:" || location.protocol === "https:";
}

function resetScores() {
  state.score = { [BLACK]: 0, [WHITE]: 0 };
}

function hostRoom() {
  if (!canUseWebSocket()) {
    setNetworkStatus("请通过服务器地址打开页面");
    return;
  }

  closeConnection();
  state.roomId = makeRoomId();
  state.role = "host";
  resetScores();
  resetGame(true);
  els.roomInput.value = state.roomId;
  window.history.replaceState(null, "", getInviteUrl(state.roomId));
  setNetworkStatus(`房间 ${state.roomId} 等待好友`);
  els.shareHint.textContent = "你执黑先手。好友打开邀请链接后即可连接。";
  openSocket(state.roomId, "host");
}

function joinRoom(roomId = els.roomInput.value.trim()) {
  if (!roomId) return;
  if (!canUseWebSocket()) {
    setNetworkStatus("请通过服务器地址打开页面");
    return;
  }

  closeConnection();
  state.roomId = roomId;
  state.role = "guest";
  resetScores();
  resetGame(true);
  setNetworkStatus(`正在连接房间 ${roomId}`);
  openSocket(roomId, "guest");
}

function openSocket(roomId, role) {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${location.host}/ws`);
  state.socket = socket;
  state.socketRole = role;

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "join", room: roomId, role }));
  });
  socket.addEventListener("message", (event) => handleServerMessage(event.data));
  socket.addEventListener("close", () => {
    setNetworkStatus("好友已断开，保留当前棋局");
    state.socket = null;
    render();
  });
  socket.addEventListener("error", () => setNetworkStatus("连接失败：请确认使用 node server.js 运行"));
}

function handleServerMessage(rawMessage) {
  let message;
  try {
    message = JSON.parse(rawMessage);
  } catch {
    return;
  }

  if (!message || typeof message !== "object") return;

  if (message.type === "joined") {
    state.role = state.socketRole || message.role || state.role;
    setNetworkStatus(state.role === "host" ? `房间 ${message.room} 等待好友` : `已加入房间 ${message.room}`);
    render();
    return;
  }

  if (message.type === "connected") {
    state.role = state.socketRole || message.role || state.role;
    setNetworkStatus(state.role === "host" ? "已连接：你执黑" : "已连接：你执白");
    els.shareHint.textContent = "联机对局中，落子会自动同步。";
    if (state.role === "host") send({ type: "sync", payload: serializeGame() });
    render();
    return;
  }

  if (message.type === "peer-left") {
    setNetworkStatus("好友已离开，保留当前棋局");
    render();
    return;
  }

  if (message.type === "error") {
    setNetworkStatus(message.message || "联机失败");
    return;
  }

  if (message.type === "move") {
    handleMove(message.row, message.col, true);
  }

  if (message.type === "reset") {
    resetGame(true);
  }

  if (message.type === "undo") {
    undo(true);
  }

  if (message.type === "sync") {
    hydrateGame(message.payload);
  }
}

function send(message) {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify(message));
  }
}

function serializeGame() {
  return {
    board: state.board,
    turn: state.turn,
    winner: state.winner,
    moves: state.moves,
    score: state.score,
  };
}

function hydrateGame(payload) {
  if (!payload) return;
  state.board = payload.board || createEmptyBoard();
  state.turn = payload.turn || BLACK;
  state.winner = payload.winner || EMPTY;
  state.moves = payload.moves || [];
  state.score = payload.score || { [BLACK]: 0, [WHITE]: 0 };
  render();
}

function closeConnection() {
  if (state.socket) state.socket.close();
  state.socket = null;
  state.socketRole = "local";
  state.role = "local";
}

async function copyInvite() {
  const roomId = state.roomId || els.roomInput.value.trim();
  if (!roomId) {
    els.shareHint.textContent = "先创建房间，再复制邀请链接。";
    return;
  }

  const url = getInviteUrl(roomId);
  try {
    await navigator.clipboard.writeText(url);
    els.shareHint.textContent = "邀请链接已复制。";
  } catch {
    els.shareHint.textContent = url;
  }
}

function wireControls() {
  els.hostBtn.addEventListener("click", hostRoom);
  els.joinBtn.addEventListener("click", () => joinRoom());
  els.copyBtn.addEventListener("click", copyInvite);
  els.undoBtn.addEventListener("click", () => undo());
  els.resetBtn.addEventListener("click", () => resetGame());
  els.roomInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") joinRoom();
  });

  const roomFromUrl = new URLSearchParams(window.location.search).get("room");
  if (roomFromUrl) {
    els.roomInput.value = roomFromUrl;
    setTimeout(() => {
      if (state.role === "local") joinRoom(roomFromUrl);
    }, 0);
  }
}

buildBoard();
wireControls();
render();
