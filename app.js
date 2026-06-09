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
  aiBtn: document.querySelector("#aiBtn"),
  localBtn: document.querySelector("#localBtn"),
  blackPickBtn: document.querySelector("#blackPickBtn"),
  whitePickBtn: document.querySelector("#whitePickBtn"),
  freeRuleBtn: document.querySelector("#freeRuleBtn"),
  renjuRuleBtn: document.querySelector("#renjuRuleBtn"),
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
  ruleMode: "freestyle",
  forbiddenReason: "",
  role: "local",
  preferredColor: BLACK,
  playerColor: EMPTY,
  aiColor: EMPTY,
  aiThinking: false,
  hostColor: BLACK,
  clientId: crypto.randomUUID(),
  supabaseClient: null,
  channel: null,
  roomId: "",
  peerConnected: false,
  helloTimer: null,
};

function createEmptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(EMPTY));
}

function colorName(color) {
  return color === BLACK ? "黑棋" : "白棋";
}

function colorParam(color) {
  return color === WHITE ? "white" : "black";
}

function parseColorParam(value, fallback = BLACK) {
  return value === "white" ? WHITE : value === "black" ? BLACK : fallback;
}

function parseRuleParam(value, fallback = "freestyle") {
  return value === "renju" ? "renju" : value === "freestyle" ? "freestyle" : fallback;
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
  const result = getMoveResult(row, col, color);
  state.moves.push({ row, col, color, forbidden: result.forbiddenReason });

  if (result.winner) {
    state.winner = result.winner;
    state.forbiddenReason = result.forbiddenReason || "";
    state.score[result.winner] += 1;
  } else {
    state.turn = other(state.turn);
  }

  render();
  if (!remote) send({ type: "move", row, col });
  if (!remote) queueAiMove();
  return true;
}

function isMyTurn() {
  if (state.role === "local") return true;
  if (state.role === "ai") return state.playerColor === state.turn && !state.aiThinking;
  if (!state.channel || !state.peerConnected) return false;
  return state.playerColor === state.turn;
}

function canPlaceManually() {
  if (state.role === "ai") return state.playerColor === state.turn && !state.aiThinking;
  return isMyTurn();
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

function getMoveResult(row, col, color) {
  if (state.ruleMode === "renju" && color === BLACK) {
    const exactFive = hasExactFive(row, col, color);
    if (exactFive) return { winner: BLACK, forbiddenReason: "" };

    const forbiddenReason = getForbiddenReason(row, col);
    if (forbiddenReason) return { winner: WHITE, forbiddenReason };
    return { winner: EMPTY, forbiddenReason: "" };
  }

  return { winner: getWinner(row, col, color) ? color : EMPTY, forbiddenReason: "" };
}

function hasExactFive(row, col, color) {
  return getDirections().some(([dr, dc]) => 1 + countDirection(row, col, dr, dc, color) + countDirection(row, col, -dr, -dc, color) === 5);
}

function getDirections() {
  return [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
}

function getForbiddenReason(row, col) {
  if (state.ruleMode !== "renju" || state.board[row][col] !== BLACK) return "";
  if (getDirections().some(([dr, dc]) => 1 + countDirection(row, col, dr, dc, BLACK) + countDirection(row, col, -dr, -dc, BLACK) >= 6)) {
    return "长连";
  }
  if (countFourLines(row, col, BLACK) >= 2) return "四四";
  if (countOpenThreeLines(row, col, BLACK) >= 2) return "三三";
  return "";
}

function countFourLines(row, col, color) {
  return getDirections().filter(([dr, dc]) => lineHasFour(row, col, dr, dc, color)).length;
}

function lineHasFour(row, col, dr, dc, color) {
  return getLineOffsets(row, col, dr, dc)
    .filter((offset) => offset !== 0)
    .some((offset) => {
      const moveRow = row + dr * offset;
      const moveCol = col + dc * offset;
      if (state.board[moveRow]?.[moveCol] !== EMPTY) return false;
      state.board[moveRow][moveCol] = color;
      const makesFive = hasExactFive(moveRow, moveCol, color);
      state.board[moveRow][moveCol] = EMPTY;
      return makesFive;
    });
}

function countOpenThreeLines(row, col, color) {
  return getDirections().filter(([dr, dc]) => lineCanBecomeOpenFour(row, col, dr, dc, color)).length;
}

function lineCanBecomeOpenFour(row, col, dr, dc, color) {
  return getLineOffsets(row, col, dr, dc)
    .filter((offset) => offset !== 0)
    .some((offset) => {
      const moveRow = row + dr * offset;
      const moveCol = col + dc * offset;
      if (state.board[moveRow]?.[moveCol] !== EMPTY) return false;
      state.board[moveRow][moveCol] = color;
      const openFour = lineIsOpenFour(moveRow, moveCol, dr, dc, color);
      state.board[moveRow][moveCol] = EMPTY;
      return openFour;
    });
}

function lineIsOpenFour(row, col, dr, dc, color) {
  const forward = countDirection(row, col, dr, dc, color);
  const backward = countDirection(row, col, -dr, -dc, color);
  const count = 1 + forward + backward;
  if (count !== 4) return false;

  const forwardEnd = getCell(row + dr * (forward + 1), col + dc * (forward + 1));
  const backwardEnd = getCell(row - dr * (backward + 1), col - dc * (backward + 1));
  return forwardEnd === EMPTY && backwardEnd === EMPTY;
}

function getLineOffsets(row, col, dr, dc) {
  const offsets = [];
  for (let offset = -4; offset <= 4; offset += 1) {
    const currentRow = row + dr * offset;
    const currentCol = col + dc * offset;
    if (currentRow >= 0 && currentRow < BOARD_SIZE && currentCol >= 0 && currentCol < BOARD_SIZE) {
      offsets.push(offset);
    }
  }
  return offsets;
}

function getNearbyEmptyCells(row, col, radius) {
  const cells = [];
  const seen = new Set();
  for (let nextRow = Math.max(0, row - radius); nextRow <= Math.min(BOARD_SIZE - 1, row + radius); nextRow += 1) {
    for (let nextCol = Math.max(0, col - radius); nextCol <= Math.min(BOARD_SIZE - 1, col + radius); nextCol += 1) {
      const key = `${nextRow},${nextCol}`;
      if (state.board[nextRow][nextCol] === EMPTY && !seen.has(key)) {
        seen.add(key);
        cells.push({ row: nextRow, col: nextCol });
      }
    }
  }
  return cells;
}

function isLegalMoveForColor(row, col, color) {
  if (state.board[row]?.[col] !== EMPTY) return false;
  state.board[row][col] = color;
  const forbidden = state.ruleMode === "renju" && color === BLACK && !hasExactFive(row, col, color) && Boolean(getForbiddenReason(row, col));
  state.board[row][col] = EMPTY;
  return !forbidden;
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
  state.forbiddenReason = "";
  state.turn = last.color;
  render();
  if (!remote) send({ type: "undo" });
}

function resetGame(remote = false) {
  state.board = createEmptyBoard();
  state.turn = BLACK;
  state.winner = EMPTY;
  state.forbiddenReason = "";
  state.moves = [];
  render();
  if (!remote) send({ type: "reset" });
  if (!remote && state.role === "ai") queueAiMove();
}

function render() {
  const cells = els.board.querySelectorAll(".point");
  const last = state.moves.at(-1);

  cells.forEach((cell) => {
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    const value = state.board[row][col];
    cell.className = "point";
    cell.disabled = Boolean(value) || Boolean(state.winner) || !canPlaceManually();
    cell.classList.add(value === BLACK ? "black" : value === WHITE ? "white" : "empty");
    cell.classList.toggle("last", Boolean(last && last.row === row && last.col === col));
    cell.style.color = state.turn === BLACK ? "#15171b" : "#f2eee6";
  });

  els.turnCard.querySelector(".stone").className = `stone ${state.turn === BLACK ? "black" : "white"}`;
  els.turnText.textContent = state.winner
    ? `${colorName(state.winner)}获胜${state.forbiddenReason ? `（黑棋${state.forbiddenReason}禁手）` : ""}`
    : `${colorName(state.turn)}落子${getTurnSuffix()}`;
  els.blackScore.textContent = String(state.score[BLACK]);
  els.whiteScore.textContent = String(state.score[WHITE]);
  els.undoBtn.disabled = !state.moves.length || state.role !== "local";
  updateMoves();
}

function getTurnSuffix() {
  if (state.role === "local") return "";
  if (state.role === "ai") {
    if (state.aiThinking) return "，AI思考中";
    return state.turn === state.playerColor ? "，轮到你" : "，等待AI";
  }
  return isMyTurn() ? "，轮到你" : "，等待对方";
}

function updateMoves() {
  els.movesList.innerHTML = "";
  const recentMoves = state.moves.slice(-18).reverse();
  recentMoves.forEach((move) => {
    const item = document.createElement("li");
    item.textContent = `${colorName(move.color)}：${move.row + 1}, ${move.col + 1}${move.forbidden ? `（${move.forbidden}禁手）` : ""}`;
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
  url.searchParams.set("hostColor", colorParam(state.hostColor));
  url.searchParams.set("rule", state.ruleMode);
  return url.toString();
}

function setNetworkStatus(text) {
  els.networkStatus.textContent = text;
}

function resetScores() {
  state.score = { [BLACK]: 0, [WHITE]: 0 };
}

function startAiGame() {
  closeConnection();
  state.role = "ai";
  state.playerColor = state.preferredColor;
  state.aiColor = other(state.playerColor);
  resetScores();
  resetGame(true);
  setNetworkStatus(`AI对战：你执${colorName(state.playerColor).replace("棋", "")}，${getRuleLabel()}`);
  els.shareHint.textContent = "AI会优先使用 DeepSeek；接口不可用时会用本地算法临时落子。";
  render();
  queueAiMove();
}

function startLocalGame() {
  closeConnection();
  resetScores();
  resetGame(true);
  setNetworkStatus(`本地模式：${getRuleLabel()}`);
  els.shareHint.textContent = "本地双人轮流落子；禁手规则下黑棋三三、四四、长连判负。";
}

function hostRoom() {
  if (!hasSupabaseConfig()) {
    setNetworkStatus("请先填写 Supabase 配置");
    return;
  }

  closeConnection();
  state.roomId = makeRoomId();
  state.role = "host";
  state.hostColor = state.preferredColor;
  state.playerColor = state.hostColor;
  state.peerConnected = false;
  resetScores();
  resetGame(true);
  els.roomInput.value = state.roomId;
  window.history.replaceState(null, "", getInviteUrl(state.roomId));
  setNetworkStatus(`房间 ${state.roomId} 等待好友`);
  els.shareHint.textContent = `你执${colorName(state.playerColor).replace("棋", "")}，${getRuleLabel()}。好友打开邀请链接后会执另一方。`;
  openRealtimeRoom(state.roomId, "host");
}

function joinRoom(
  roomId = els.roomInput.value.trim(),
  hostColor = parseColorParam(new URLSearchParams(window.location.search).get("hostColor"), other(state.preferredColor)),
  ruleMode = parseRuleParam(new URLSearchParams(window.location.search).get("rule"), state.ruleMode),
) {
  if (!roomId) return;
  if (!hasSupabaseConfig()) {
    setNetworkStatus("请先填写 Supabase 配置");
    return;
  }

  closeConnection();
  state.roomId = roomId;
  state.role = "guest";
  state.hostColor = hostColor;
  state.playerColor = other(hostColor);
  state.peerConnected = false;
  setPreferredColor(state.playerColor);
  setRuleMode(ruleMode);
  resetScores();
  resetGame(true);
  setNetworkStatus(`正在连接房间 ${roomId}`);
  openRealtimeRoom(roomId, "guest");
}

function hasSupabaseConfig() {
  const config = window.GOMOKU_SUPABASE || {};
  return Boolean(window.supabase && config.url && config.anonKey);
}

function openRealtimeRoom(roomId, role) {
  const config = window.GOMOKU_SUPABASE;
  state.supabaseClient = supabase.createClient(config.url, config.anonKey);
  state.channel = state.supabaseClient.channel(`gomoku:${roomId}`, {
    config: {
      broadcast: { self: false },
      presence: { key: state.clientId },
    },
  });

  state.channel
    .on("broadcast", { event: "game" }, ({ payload }) => handleRemoteMessage(payload))
    .on("presence", { event: "sync" }, () => updatePresenceStatus())
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await state.channel.track({ role, color: colorParam(state.playerColor), rule: state.ruleMode, joinedAt: Date.now() });
        setNetworkStatus(role === "host" ? `房间 ${roomId} 等待好友` : `已加入房间 ${roomId}，正在确认房主`);
        if (role === "guest") startGuestHandshake();
        render();
      }

      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setNetworkStatus("连接失败：检查 Supabase 配置");
      }
    });
}

function updatePresenceStatus() {
  if (!state.channel || state.role === "local") return;

  const players = Object.values(state.channel.presenceState()).flat();
  const hasOpponent = players.some((player) => player.role && player.role !== state.role);
  if (hasOpponent) {
    if (state.role === "host") {
      confirmPeerConnected();
      send({ type: "welcome", payload: serializeGame() });
    } else if (!state.peerConnected) {
      setNetworkStatus(`已发现房主，正在同步：你将执${colorName(state.playerColor).replace("棋", "")}`);
      startGuestHandshake();
    }
  } else {
    setNetworkStatus(state.role === "host" ? `房间 ${state.roomId} 等待好友` : `已加入房间 ${state.roomId}`);
  }
  render();
}

function handleRemoteMessage(message) {
  if (!message || typeof message !== "object" || message.from === state.clientId) return;

  if (message.type === "hello" && state.role === "host") {
    confirmPeerConnected();
    send({ type: "welcome", payload: serializeGame() });
    render();
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

  if (message.type === "welcome" || message.type === "sync") {
    hydrateGame(message.payload);
    if (state.role === "guest") {
      confirmPeerConnected();
    }
  }
}

function startGuestHandshake() {
  if (state.role !== "guest" || state.peerConnected || !state.channel) return;
  stopGuestHandshake();
  sendGuestHello();
  state.helloTimer = window.setInterval(() => {
    if (state.role !== "guest" || state.peerConnected || !state.channel) {
      stopGuestHandshake();
      return;
    }
    sendGuestHello();
  }, 1200);
}

function sendGuestHello() {
  send({
    type: "hello",
    roomId: state.roomId,
    guestColor: colorParam(state.playerColor),
  });
}

function stopGuestHandshake() {
  if (state.helloTimer) {
    window.clearInterval(state.helloTimer);
    state.helloTimer = null;
  }
}

function confirmPeerConnected() {
  state.peerConnected = true;
  stopGuestHandshake();
  setNetworkStatus(`已连接：你执${colorName(state.playerColor).replace("棋", "")}`);
  els.shareHint.textContent = "联机对局中，落子会自动同步。";
  render();
}

function send(message) {
  if (!state.channel) return;
  state.channel.send({
    type: "broadcast",
    event: "game",
    payload: { ...message, from: state.clientId },
  });
}

function serializeGame() {
  return {
    board: state.board,
    turn: state.turn,
    winner: state.winner,
    moves: state.moves,
    score: state.score,
    hostColor: state.hostColor,
    ruleMode: state.ruleMode,
  };
}

function hydrateGame(payload) {
  if (!payload) return;
  state.board = payload.board || createEmptyBoard();
  state.turn = payload.turn || BLACK;
  state.winner = payload.winner || EMPTY;
  state.moves = payload.moves || [];
  state.score = payload.score || { [BLACK]: 0, [WHITE]: 0 };
  state.hostColor = payload.hostColor || state.hostColor;
  setRuleMode(payload.ruleMode || state.ruleMode);
  if (state.role === "guest") {
    state.playerColor = other(state.hostColor);
    setPreferredColor(state.playerColor);
  }
  render();
}

function closeConnection() {
  stopGuestHandshake();
  if (state.channel && state.supabaseClient) {
    state.supabaseClient.removeChannel(state.channel);
  }
  state.channel = null;
  state.supabaseClient = null;
  state.role = "local";
  state.playerColor = EMPTY;
  state.aiColor = EMPTY;
  state.aiThinking = false;
  state.peerConnected = false;
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
  els.aiBtn.addEventListener("click", startAiGame);
  els.localBtn.addEventListener("click", startLocalGame);
  els.blackPickBtn.addEventListener("click", () => setPreferredColor(BLACK));
  els.whitePickBtn.addEventListener("click", () => setPreferredColor(WHITE));
  els.freeRuleBtn.addEventListener("click", () => setRuleMode("freestyle"));
  els.renjuRuleBtn.addEventListener("click", () => setRuleMode("renju"));
  els.undoBtn.addEventListener("click", () => undo());
  els.resetBtn.addEventListener("click", () => resetGame());
  els.roomInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") joinRoom();
  });

  const roomFromUrl = new URLSearchParams(window.location.search).get("room");
  if (roomFromUrl) {
    const hostColor = parseColorParam(new URLSearchParams(window.location.search).get("hostColor"), BLACK);
    const ruleMode = parseRuleParam(new URLSearchParams(window.location.search).get("rule"), "freestyle");
    els.roomInput.value = roomFromUrl;
    setPreferredColor(other(hostColor));
    setRuleMode(ruleMode);
    setTimeout(() => {
      if (state.role === "local") joinRoom(roomFromUrl, hostColor, ruleMode);
    }, 0);
  }
}

function setPreferredColor(color) {
  state.preferredColor = color;
  els.blackPickBtn.classList.toggle("active", color === BLACK);
  els.whitePickBtn.classList.toggle("active", color === WHITE);
}

function setRuleMode(ruleMode) {
  state.ruleMode = parseRuleParam(ruleMode);
  els.freeRuleBtn.classList.toggle("active", state.ruleMode === "freestyle");
  els.renjuRuleBtn.classList.toggle("active", state.ruleMode === "renju");
}

function getRuleLabel() {
  return state.ruleMode === "renju" ? "禁手规则" : "自由规则";
}

buildBoard();
setPreferredColor(BLACK);
setRuleMode("freestyle");
wireControls();
render();

async function queueAiMove() {
  if (state.role !== "ai" || state.winner || state.turn !== state.aiColor || state.aiThinking) return;

  state.aiThinking = true;
  render();

  const move = await getAiMove();
  state.aiThinking = false;

  if (!state.winner && move && state.board[move.row]?.[move.col] === EMPTY) {
    handleMove(move.row, move.col, true);
  }
  render();
}

async function getAiMove() {
  try {
    const response = await fetch("/api/deepseek-move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        board: state.board,
        aiColor: state.aiColor,
        playerColor: state.playerColor,
        ruleMode: state.ruleMode,
        moves: state.moves,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (isValidMove(data.move)) return data.move;
    }
  } catch {
    // Static local preview has no Netlify Function; fall through to local fallback.
  }

  return getFallbackMove(state.aiColor);
}

function isValidMove(move) {
  return (
    move &&
    Number.isInteger(move.row) &&
    Number.isInteger(move.col) &&
    move.row >= 0 &&
    move.row < BOARD_SIZE &&
    move.col >= 0 &&
    move.col < BOARD_SIZE &&
    state.board[move.row][move.col] === EMPTY &&
    isLegalMoveForColor(move.row, move.col, state.aiColor)
  );
}

function getFallbackMove(color) {
  const opponent = other(color);
  const winningMove = findTacticalMove(color);
  if (winningMove) return winningMove;

  const blockingMove = findTacticalMove(opponent);
  if (blockingMove) return blockingMove;

  const center = Math.floor(BOARD_SIZE / 2);
  const candidates = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (state.board[row][col] === EMPTY && isLegalMoveForColor(row, col, color)) {
        candidates.push({
          row,
          col,
          score: scorePosition(row, col, color) - Math.hypot(row - center, col - center) * 0.12,
        });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

function findTacticalMove(color) {
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (state.board[row][col] !== EMPTY || !isLegalMoveForColor(row, col, color)) continue;
      state.board[row][col] = color;
      const wins = getWinner(row, col, color);
      state.board[row][col] = EMPTY;
      if (wins) return { row, col };
    }
  }
  return null;
}

function scorePosition(row, col, color) {
  const opponent = other(color);
  return evaluatePlacement(row, col, color) + evaluatePlacement(row, col, opponent) * 1.18;
}

function evaluatePlacement(row, col, color) {
  state.board[row][col] = color;
  const score = getDirections().reduce((total, [dr, dc]) => {
    const info = getLineInfo(row, col, dr, dc, color);
    return total + scoreLineInfo(info.count, info.openEnds);
  }, 0);
  state.board[row][col] = EMPTY;
  return score;
}

function getLineInfo(row, col, dr, dc, color) {
  const forward = countDirection(row, col, dr, dc, color);
  const backward = countDirection(row, col, -dr, -dc, color);
  const forwardEnd = getCell(row + dr * (forward + 1), col + dc * (forward + 1));
  const backwardEnd = getCell(row - dr * (backward + 1), col - dc * (backward + 1));
  return {
    count: 1 + forward + backward,
    openEnds: Number(forwardEnd === EMPTY) + Number(backwardEnd === EMPTY),
  };
}

function getCell(row, col) {
  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return null;
  return state.board[row][col];
}

function scoreLineInfo(count, openEnds) {
  if (count >= 5) return 1_000_000;
  if (count === 4 && openEnds === 2) return 120_000;
  if (count === 4 && openEnds === 1) return 28_000;
  if (count === 3 && openEnds === 2) return 9_000;
  if (count === 3 && openEnds === 1) return 1_800;
  if (count === 2 && openEnds === 2) return 900;
  if (count === 2 && openEnds === 1) return 160;
  return openEnds * 18 + count * 8;
}
