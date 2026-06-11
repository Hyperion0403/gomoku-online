const BOARD_SIZE = 15;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
const TURN_TIME_MS = 25_000;
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
  voiceBtn: document.querySelector("#voiceBtn"),
  muteBtn: document.querySelector("#muteBtn"),
  hangupBtn: document.querySelector("#hangupBtn"),
  voiceStatus: document.querySelector("#voiceStatus"),
  remoteAudio: document.querySelector("#remoteAudio"),
  blackPickBtn: document.querySelector("#blackPickBtn"),
  whitePickBtn: document.querySelector("#whitePickBtn"),
  freeRuleBtn: document.querySelector("#freeRuleBtn"),
  renjuRuleBtn: document.querySelector("#renjuRuleBtn"),
  noTimerBtn: document.querySelector("#noTimerBtn"),
  timer25Btn: document.querySelector("#timer25Btn"),
  shareHint: document.querySelector("#shareHint"),
  undoBtn: document.querySelector("#undoBtn"),
  undoPrompt: document.querySelector("#undoPrompt"),
  undoPromptText: document.querySelector("#undoPromptText"),
  undoPromptActions: document.querySelector("#undoPromptActions"),
  acceptUndoBtn: document.querySelector("#acceptUndoBtn"),
  rejectUndoBtn: document.querySelector("#rejectUndoBtn"),
  resetBtn: document.querySelector("#resetBtn"),
  timerText: document.querySelector("#timerText"),
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
  timerMode: "none",
  turnDeadline: 0,
  timerInterval: null,
  pausedTimerMs: null,
  pendingTimerMs: null,
  timeoutLoser: EMPTY,
  gameStarted: false,
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
  undoPending: null,
  undoRequestTimer: null,
  voicePeer: null,
  voiceLocalStream: null,
  voiceRemoteStream: null,
  voiceReady: false,
  remoteVoiceReady: false,
  voiceMuted: false,
  voiceStatus: "语音未开启",
  voiceReadyTimer: null,
  voicePendingCandidates: [],
  voiceOfferStarted: false,
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

function parseTimerParam(value, fallback = "none") {
  return value === "25" ? "25" : value === "none" ? "none" : fallback;
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
  if (state.undoPending) {
    if (!remote) return false;
    clearUndoRequest();
  }
  state.gameStarted = true;

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

  resetTurnTimer();
  render();
  if (!remote) send({ type: "move", row, col });
  if (!remote) queueAiMove();
  return true;
}

function isMyTurn() {
  if (state.undoPending) return false;
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
      const makesFive = lineIsExactFiveIncludingAnchor(row, col, moveRow, moveCol, dr, dc, color);
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
      const openFour = lineIsOpenFour(row, col, moveRow, moveCol, dr, dc, color);
      state.board[moveRow][moveCol] = EMPTY;
      return openFour;
    });
}

function lineIsExactFiveIncludingAnchor(anchorRow, anchorCol, row, col, dr, dc, color) {
  const forward = countDirection(row, col, dr, dc, color);
  const backward = countDirection(row, col, -dr, -dc, color);
  return 1 + forward + backward === 5 && lineSegmentContains(anchorRow, anchorCol, row, col, dr, dc, backward, forward);
}

function lineIsOpenFour(anchorRow, anchorCol, row, col, dr, dc, color) {
  const forward = countDirection(row, col, dr, dc, color);
  const backward = countDirection(row, col, -dr, -dc, color);
  const count = 1 + forward + backward;
  if (count !== 4 || !lineSegmentContains(anchorRow, anchorCol, row, col, dr, dc, backward, forward)) return false;

  const forwardEnd = getCell(row + dr * (forward + 1), col + dc * (forward + 1));
  const backwardEnd = getCell(row - dr * (backward + 1), col - dc * (backward + 1));
  return forwardEnd === EMPTY && backwardEnd === EMPTY;
}

function lineSegmentContains(targetRow, targetCol, row, col, dr, dc, backward, forward) {
  const offset = dr !== 0 ? (targetRow - row) / dr : (targetCol - col) / dc;
  return Number.isInteger(offset) && offset >= -backward && offset <= forward;
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

function applyUndo() {
  if (!state.moves.length) return;
  if (state.winner) {
    state.score[state.winner] = Math.max(0, state.score[state.winner] - 1);
  }
  const last = state.moves.pop();
  state.board[last.row][last.col] = EMPTY;
  state.winner = EMPTY;
  state.timeoutLoser = EMPTY;
  state.forbiddenReason = "";
  state.turn = last.color;
  state.undoPending = null;
  state.pausedTimerMs = null;
  resetTurnTimer();
  render();
}

function handleUndoClick() {
  if (state.role === "local") {
    applyUndo();
    return;
  }

  if (!canRequestOnlineUndo()) return;

  const requestId = crypto.randomUUID();
  state.undoPending = {
    direction: "outgoing",
    requestId,
    moveCount: state.moves.length,
    requesterColor: state.playerColor,
  };
  pauseTurnTimer();
  sendUndoRequest();
  state.undoRequestTimer = window.setInterval(sendUndoRequest, 1200);
  render();
}

function sendUndoRequest() {
  if (state.undoPending?.direction !== "outgoing") return;
  send({
    type: "undo-request",
    requestId: state.undoPending.requestId,
    moveCount: state.undoPending.moveCount,
    requesterColor: state.undoPending.requesterColor,
  });
}

function canRequestOnlineUndo() {
  if (!["host", "guest"].includes(state.role) || !state.peerConnected || state.winner || state.undoPending) return false;
  const last = state.moves.at(-1);
  return Boolean(last && last.color === state.playerColor && state.turn !== state.playerColor);
}

function handleUndoRequest(message) {
  if (state.undoPending?.direction === "incoming" && state.undoPending.requestId === message.requestId) return;
  const last = state.moves.at(-1);
  const valid =
    !state.winner &&
    !state.undoPending &&
    message.moveCount === state.moves.length &&
    last?.color === message.requesterColor &&
    state.turn === state.playerColor;

  if (!valid) {
    send({
      type: "undo-response",
      requestId: message.requestId,
      accepted: false,
      reason: "对方已经落子或棋局状态已变化",
      remainingMs: getRemainingTimerMs(),
    });
    return;
  }

  state.undoPending = {
    direction: "incoming",
    requestId: message.requestId,
    moveCount: message.moveCount,
    requesterColor: message.requesterColor,
  };
  pauseTurnTimer();
  render();
}

function acceptUndoRequest() {
  if (state.undoPending?.direction !== "incoming") return;
  const requestId = state.undoPending.requestId;
  applyUndo();
  send({
    type: "undo-response",
    requestId,
    accepted: true,
    payload: serializeGame(),
  });
}

function rejectUndoRequest() {
  if (state.undoPending?.direction !== "incoming") return;
  const requestId = state.undoPending.requestId;
  const remainingMs = state.pausedTimerMs ?? TURN_TIME_MS;
  clearUndoRequest();
  resumeTurnTimer(remainingMs);
  send({
    type: "undo-response",
    requestId,
    accepted: false,
    reason: "对方拒绝了悔棋",
    remainingMs,
  });
  render();
}

function handleUndoResponse(message) {
  if (state.undoPending?.direction !== "outgoing" || state.undoPending.requestId !== message.requestId) return;

  if (message.accepted && message.payload) {
    clearUndoRequest();
    hydrateGame(message.payload);
    setNetworkStatus(`已连接：你执${colorName(state.playerColor).replace("棋", "")}，悔棋已同意`);
    return;
  }

  clearUndoRequest();
  resumeTurnTimer(message.remainingMs);
  setNetworkStatus(message.reason || "对方拒绝了悔棋");
  render();
}

function clearUndoRequest() {
  if (state.undoRequestTimer) {
    window.clearInterval(state.undoRequestTimer);
    state.undoRequestTimer = null;
  }
  state.undoPending = null;
  state.pausedTimerMs = null;
}

function resetGame(remote = false) {
  clearUndoRequest();
  state.board = createEmptyBoard();
  state.turn = BLACK;
  state.winner = EMPTY;
  state.timeoutLoser = EMPTY;
  state.forbiddenReason = "";
  state.moves = [];
  resetTurnTimer();
  render();
  if (!remote) send({ type: "reset" });
  if (!remote && state.role === "ai") queueAiMove();
}

function resetTurnTimer(remainingMs = TURN_TIME_MS) {
  stopTurnTimer();
  state.pendingTimerMs = remainingMs;
  if (!shouldRunTimer()) {
    renderTimer();
    return;
  }

  state.pendingTimerMs = null;
  state.pausedTimerMs = null;
  state.turnDeadline = Date.now() + Math.max(0, remainingMs);
  state.timerInterval = window.setInterval(updateTurnTimer, 200);
  updateTurnTimer();
}

function shouldRunTimer() {
  if (!state.gameStarted || state.timerMode !== "25" || state.winner || state.undoPending) return false;
  if (state.role === "local" || state.role === "ai") return true;
  return state.peerConnected;
}

function stopTurnTimer() {
  if (state.timerInterval) {
    window.clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  state.turnDeadline = 0;
}

function pauseTurnTimer() {
  if (state.timerMode !== "25") return;
  state.pausedTimerMs = getRemainingTimerMs();
  stopTurnTimer();
  renderTimer();
}

function resumeTurnTimer(remainingMs = state.pausedTimerMs ?? TURN_TIME_MS) {
  state.pausedTimerMs = null;
  resetTurnTimer(remainingMs);
}

function getRemainingTimerMs() {
  if (state.timerMode !== "25") return null;
  if (state.pausedTimerMs !== null) return state.pausedTimerMs;
  if (state.turnDeadline) return Math.max(0, state.turnDeadline - Date.now());
  return state.pendingTimerMs ?? TURN_TIME_MS;
}

function updateTurnTimer() {
  if (!shouldRunTimer()) {
    stopTurnTimer();
    renderTimer();
    return;
  }

  const remainingMs = getRemainingTimerMs();
  if (remainingMs <= 0) {
    resolveTimeout(state.turn);
    return;
  }
  renderTimer();
}

function renderTimer() {
  const enabled = state.timerMode === "25";
  els.timerText.hidden = !enabled;
  if (!enabled) return;
  if (state.winner) {
    els.timerText.textContent = state.timeoutLoser ? "0" : "—";
    return;
  }

  const remainingMs = getRemainingTimerMs();
  els.timerText.textContent = String(Math.max(0, Math.ceil((remainingMs ?? TURN_TIME_MS) / 1000)));
}

function resolveTimeout(loserColor, remote = false) {
  if (state.winner || loserColor !== state.turn) return;
  stopTurnTimer();
  clearUndoRequest();
  state.timeoutLoser = loserColor;
  state.winner = other(loserColor);
  state.score[state.winner] += 1;
  render();
  if (!remote) send({ type: "timeout", loserColor });
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
    ? `${colorName(state.winner)}获胜${
        state.timeoutLoser
          ? `（${colorName(state.timeoutLoser)}超时）`
          : state.forbiddenReason
            ? `（黑棋${state.forbiddenReason}禁手）`
            : ""
      }`
    : `${colorName(state.turn)}落子${getTurnSuffix()}`;
  els.blackScore.textContent = String(state.score[BLACK]);
  els.whiteScore.textContent = String(state.score[WHITE]);
  els.undoBtn.disabled = state.role === "local" ? !state.moves.length : !canRequestOnlineUndo();
  els.undoBtn.textContent = state.undoPending?.direction === "outgoing" ? "等待回应" : "悔棋";
  const settingsLocked = state.role !== "local" || state.moves.length > 0;
  [
    els.blackPickBtn,
    els.whitePickBtn,
    els.freeRuleBtn,
    els.renjuRuleBtn,
    els.noTimerBtn,
    els.timer25Btn,
  ].forEach((button) => {
    button.disabled = settingsLocked;
  });
  renderUndoPrompt();
  renderTimer();
  renderVoiceControls();
  updateMoves();
}

function renderUndoPrompt() {
  if (!state.undoPending) {
    els.undoPrompt.hidden = true;
    return;
  }

  els.undoPrompt.hidden = false;
  const incoming = state.undoPending.direction === "incoming";
  els.undoPromptText.textContent = incoming ? "对方请求撤回刚刚落下的一手" : "悔棋申请已发送，等待对方处理";
  els.undoPromptActions.hidden = !incoming;
}

function getTurnSuffix() {
  if (state.undoPending) return "，悔棋确认中";
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
  url.searchParams.set("timer", state.timerMode);
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
  state.gameStarted = true;
  state.playerColor = state.preferredColor;
  state.aiColor = other(state.playerColor);
  resetScores();
  resetGame(true);
  setNetworkStatus(`AI对战：你执${colorName(state.playerColor).replace("棋", "")}，${getRuleLabel()}，${getTimerLabel()}`);
  els.shareHint.textContent = "AI会优先使用 DeepSeek；接口不可用时会用本地算法临时落子。";
  render();
  queueAiMove();
}

function startLocalGame() {
  closeConnection();
  state.gameStarted = true;
  resetScores();
  resetGame(true);
  setNetworkStatus(`本地模式：${getRuleLabel()}，${getTimerLabel()}`);
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
  state.gameStarted = true;
  state.hostColor = state.preferredColor;
  state.playerColor = state.hostColor;
  state.peerConnected = false;
  resetScores();
  resetGame(true);
  els.roomInput.value = state.roomId;
  window.history.replaceState(null, "", getInviteUrl(state.roomId));
  setNetworkStatus(`房间 ${state.roomId} 等待好友`);
  els.shareHint.textContent = `你执${colorName(state.playerColor).replace("棋", "")}，${getRuleLabel()}，${getTimerLabel()}。好友打开邀请链接后会执另一方。`;
  openRealtimeRoom(state.roomId, "host");
}

function joinRoom(
  roomId = els.roomInput.value.trim(),
  hostColor = parseColorParam(new URLSearchParams(window.location.search).get("hostColor"), other(state.preferredColor)),
  ruleMode = parseRuleParam(new URLSearchParams(window.location.search).get("rule"), state.ruleMode),
  timerMode = parseTimerParam(new URLSearchParams(window.location.search).get("timer"), state.timerMode),
) {
  if (!roomId) return;
  if (!hasSupabaseConfig()) {
    setNetworkStatus("请先填写 Supabase 配置");
    return;
  }

  closeConnection();
  state.roomId = roomId;
  state.role = "guest";
  state.gameStarted = true;
  state.hostColor = hostColor;
  state.playerColor = other(hostColor);
  state.peerConnected = false;
  setPreferredColor(state.playerColor);
  setRuleMode(ruleMode);
  setTimerMode(timerMode);
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
        await state.channel.track({
          role,
          color: colorParam(state.playerColor),
          rule: state.ruleMode,
          timer: state.timerMode,
          joinedAt: Date.now(),
        });
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

  if (message.type.startsWith("voice-")) {
    void handleVoiceSignal(message).catch(() => {
      setVoiceStatus("语音信令异常，可挂断后重试");
      renderVoiceControls();
    });
    return;
  }

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

  if (message.type === "undo-request") {
    handleUndoRequest(message);
  }

  if (message.type === "undo-response") {
    handleUndoResponse(message);
  }

  if (message.type === "timeout") {
    resolveTimeout(message.loserColor, true);
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
  const wasConnected = state.peerConnected;
  state.peerConnected = true;
  stopGuestHandshake();
  setNetworkStatus(`已连接：你执${colorName(state.playerColor).replace("棋", "")}`);
  els.shareHint.textContent = "联机对局中，落子会自动同步。";
  if (!wasConnected) resetTurnTimer(state.pendingTimerMs ?? TURN_TIME_MS);
  render();
}

async function enableVoice() {
  if (!state.peerConnected || !["host", "guest"].includes(state.role) || state.voiceReady) return;
  if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection !== "function") {
    setVoiceStatus("当前浏览器不支持语音");
    return;
  }

  setVoiceStatus("正在申请麦克风权限");
  renderVoiceControls();

  try {
    state.voiceLocalStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    state.voiceReady = true;
    state.voiceMuted = false;
    ensureVoicePeer();
    state.voiceLocalStream.getTracks().forEach((track) => {
      const alreadyAdded = state.voicePeer
        .getSenders()
        .some((sender) => sender.track?.id === track.id);
      if (!alreadyAdded) state.voicePeer.addTrack(track, state.voiceLocalStream);
    });
    setVoiceStatus(state.remoteVoiceReady ? "正在建立语音连接" : "麦克风已开启，等待对方");
    startVoiceReadyBroadcast();
    sendVoiceReady();
    await maybeStartVoiceOffer();
  } catch (error) {
    setVoiceStatus(error?.name === "NotAllowedError" ? "麦克风权限被拒绝" : "无法开启麦克风");
    cleanupVoice(false, false);
  }
  renderVoiceControls();
}

function ensureVoicePeer() {
  if (state.voicePeer) return state.voicePeer;

  const peer = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  });
  state.voicePeer = peer;

  peer.addEventListener("icecandidate", (event) => {
    if (event.candidate) {
      send({ type: "voice-ice", candidate: event.candidate.toJSON() });
    } else if (state.role === "host" && peer.localDescription?.type === "offer") {
      send({ type: "voice-offer", description: peer.localDescription });
    }
  });

  peer.addEventListener("track", (event) => {
    state.voiceRemoteStream = event.streams[0] || new MediaStream([event.track]);
    els.remoteAudio.srcObject = state.voiceRemoteStream;
    void els.remoteAudio.play().catch(() => {
      setVoiceStatus("语音已连接，点击页面后可播放");
    });
  });

  peer.addEventListener("connectionstatechange", () => {
    if (peer.connectionState === "connected") {
      stopVoiceReadyBroadcast();
      setVoiceStatus("语音已连接");
    } else if (peer.connectionState === "connecting") {
      setVoiceStatus("正在建立语音连接");
    } else if (peer.connectionState === "failed") {
      setVoiceStatus("语音连接失败，可挂断后重试");
    } else if (peer.connectionState === "disconnected") {
      setVoiceStatus("语音连接中断，正在等待恢复");
    } else if (peer.connectionState === "closed") {
      setVoiceStatus("语音已挂断");
    }
    renderVoiceControls();
  });

  return peer;
}

async function handleVoiceSignal(message) {
  if (!["host", "guest"].includes(state.role) || !state.peerConnected) return;

  if (message.type === "voice-ready") {
    state.remoteVoiceReady = true;
    if (!state.voiceReady) {
      setVoiceStatus("对方已开启语音，点击开启加入");
      renderVoiceControls();
      return;
    }
    setVoiceStatus("正在建立语音连接");
    await maybeStartVoiceOffer();
    return;
  }

  if (message.type === "voice-offer" && state.role === "guest" && state.voiceReady) {
    const peer = ensureVoicePeer();
    const description = message.description;
    if (peer.remoteDescription?.sdp !== description?.sdp) {
      await peer.setRemoteDescription(description);
      await flushVoiceCandidates();
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
    }
    if (peer.localDescription) {
      send({ type: "voice-answer", description: peer.localDescription });
    }
    return;
  }

  if (message.type === "voice-answer" && state.role === "host" && state.voiceReady) {
    const peer = ensureVoicePeer();
    if (!peer.remoteDescription && message.description) {
      await peer.setRemoteDescription(message.description);
      await flushVoiceCandidates();
    }
    return;
  }

  if (message.type === "voice-ice" && message.candidate) {
    const peer = state.voicePeer;
    if (peer?.remoteDescription) {
      await peer.addIceCandidate(message.candidate).catch(() => {});
    } else {
      state.voicePendingCandidates.push(message.candidate);
    }
    return;
  }

  if (message.type === "voice-hangup") {
    cleanupVoice(false, false);
    setVoiceStatus("对方已挂断语音");
    renderVoiceControls();
  }
}

async function maybeStartVoiceOffer() {
  if (
    state.role !== "host" ||
    !state.voiceReady ||
    !state.remoteVoiceReady
  ) {
    return;
  }

  const peer = ensureVoicePeer();
  if (peer.localDescription?.type === "offer") {
    send({ type: "voice-offer", description: peer.localDescription });
    return;
  }
  if (state.voiceOfferStarted || peer.signalingState !== "stable") return;

  state.voiceOfferStarted = true;
  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    send({ type: "voice-offer", description: peer.localDescription });
  } catch {
    state.voiceOfferStarted = false;
    setVoiceStatus("创建语音连接失败");
  }
}

async function flushVoiceCandidates() {
  if (!state.voicePeer?.remoteDescription) return;
  const candidates = state.voicePendingCandidates.splice(0);
  for (const candidate of candidates) {
    await state.voicePeer.addIceCandidate(candidate).catch(() => {});
  }
}

function startVoiceReadyBroadcast() {
  stopVoiceReadyBroadcast();
  state.voiceReadyTimer = window.setInterval(() => {
    if (!state.voiceReady || !state.channel) {
      stopVoiceReadyBroadcast();
      return;
    }
    sendVoiceReady();
    if (state.role === "host" && state.voicePeer?.localDescription?.type === "offer") {
      send({ type: "voice-offer", description: state.voicePeer.localDescription });
    }
  }, 1500);
}

function stopVoiceReadyBroadcast() {
  if (state.voiceReadyTimer) {
    window.clearInterval(state.voiceReadyTimer);
    state.voiceReadyTimer = null;
  }
}

function sendVoiceReady() {
  send({ type: "voice-ready" });
}

function toggleVoiceMute() {
  if (!state.voiceLocalStream) return;
  state.voiceMuted = !state.voiceMuted;
  state.voiceLocalStream.getAudioTracks().forEach((track) => {
    track.enabled = !state.voiceMuted;
  });
  setVoiceStatus(state.voiceMuted ? "麦克风已静音" : state.voicePeer?.connectionState === "connected" ? "语音已连接" : "麦克风已开启");
  renderVoiceControls();
}

function hangupVoice() {
  if (!state.voiceReady && !state.voicePeer) return;
  send({ type: "voice-hangup" });
  cleanupVoice(false, false);
  setVoiceStatus("语音已挂断");
  renderVoiceControls();
}

function cleanupVoice(notifyPeer = false, preserveRemoteReady = false) {
  if (notifyPeer && state.channel && (state.voiceReady || state.voicePeer)) {
    send({ type: "voice-hangup" });
  }
  stopVoiceReadyBroadcast();
  state.voiceLocalStream?.getTracks().forEach((track) => track.stop());
  state.voiceRemoteStream?.getTracks().forEach((track) => track.stop());
  state.voicePeer?.close();
  state.voicePeer = null;
  state.voiceLocalStream = null;
  state.voiceRemoteStream = null;
  state.voiceReady = false;
  if (!preserveRemoteReady) state.remoteVoiceReady = false;
  state.voiceMuted = false;
  state.voicePendingCandidates = [];
  state.voiceOfferStarted = false;
  els.remoteAudio.srcObject = null;
}

function setVoiceStatus(text) {
  state.voiceStatus = text;
  els.voiceStatus.textContent = text;
}

function renderVoiceControls() {
  const online = ["host", "guest"].includes(state.role) && state.peerConnected;
  els.voiceBtn.disabled = !online || state.voiceReady;
  els.voiceBtn.classList.toggle("active", state.voiceReady);
  els.voiceBtn.textContent = state.voiceReady ? "语音已开启" : "开启语音";
  els.muteBtn.disabled = !state.voiceReady;
  els.muteBtn.classList.toggle("active", state.voiceMuted);
  els.muteBtn.textContent = state.voiceMuted ? "取消静音" : "静音";
  els.hangupBtn.disabled = !state.voiceReady && !state.voicePeer;
  els.voiceStatus.textContent = state.voiceStatus;
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
    timerMode: state.timerMode,
    turnRemainingMs: getRemainingTimerMs(),
    timeoutLoser: state.timeoutLoser,
  };
}

function hydrateGame(payload) {
  if (!payload) return;
  state.gameStarted = true;
  state.board = payload.board || createEmptyBoard();
  state.turn = payload.turn || BLACK;
  state.winner = payload.winner || EMPTY;
  state.moves = payload.moves || [];
  state.score = payload.score || { [BLACK]: 0, [WHITE]: 0 };
  state.hostColor = payload.hostColor || state.hostColor;
  setRuleMode(payload.ruleMode || state.ruleMode);
  setTimerMode(payload.timerMode || state.timerMode);
  state.timeoutLoser = payload.timeoutLoser || EMPTY;
  state.pendingTimerMs = payload.turnRemainingMs ?? TURN_TIME_MS;
  if (state.role === "guest") {
    state.playerColor = other(state.hostColor);
    setPreferredColor(state.playerColor);
  }
  resetTurnTimer(state.pendingTimerMs);
  render();
}

function closeConnection() {
  stopGuestHandshake();
  stopTurnTimer();
  clearUndoRequest();
  cleanupVoice(true, false);
  setVoiceStatus("语音未开启");
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
  state.timeoutLoser = EMPTY;
  state.gameStarted = false;
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
  els.voiceBtn.addEventListener("click", enableVoice);
  els.muteBtn.addEventListener("click", toggleVoiceMute);
  els.hangupBtn.addEventListener("click", hangupVoice);
  els.blackPickBtn.addEventListener("click", () => setPreferredColor(BLACK));
  els.whitePickBtn.addEventListener("click", () => setPreferredColor(WHITE));
  els.freeRuleBtn.addEventListener("click", () => setRuleMode("freestyle"));
  els.renjuRuleBtn.addEventListener("click", () => setRuleMode("renju"));
  els.noTimerBtn.addEventListener("click", () => setTimerMode("none"));
  els.timer25Btn.addEventListener("click", () => setTimerMode("25"));
  els.undoBtn.addEventListener("click", handleUndoClick);
  els.acceptUndoBtn.addEventListener("click", acceptUndoRequest);
  els.rejectUndoBtn.addEventListener("click", rejectUndoRequest);
  els.resetBtn.addEventListener("click", () => resetGame());
  els.roomInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") joinRoom();
  });
  window.addEventListener("pagehide", () => {
    cleanupVoice(false, false);
  });

  const roomFromUrl = new URLSearchParams(window.location.search).get("room");
  if (roomFromUrl) {
    const hostColor = parseColorParam(new URLSearchParams(window.location.search).get("hostColor"), BLACK);
    const ruleMode = parseRuleParam(new URLSearchParams(window.location.search).get("rule"), "freestyle");
    const timerMode = parseTimerParam(new URLSearchParams(window.location.search).get("timer"), "none");
    els.roomInput.value = roomFromUrl;
    setPreferredColor(other(hostColor));
    setRuleMode(ruleMode);
    setTimerMode(timerMode);
    setTimeout(() => {
      if (state.role === "local") joinRoom(roomFromUrl, hostColor, ruleMode, timerMode);
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

function setTimerMode(timerMode) {
  state.timerMode = parseTimerParam(timerMode);
  els.noTimerBtn.classList.toggle("active", state.timerMode === "none");
  els.timer25Btn.classList.toggle("active", state.timerMode === "25");
  resetTurnTimer();
  renderTimer();
}

function getTimerLabel() {
  return state.timerMode === "25" ? "每手25秒" : "不限时";
}

buildBoard();
setPreferredColor(BLACK);
setRuleMode("freestyle");
setTimerMode("none");
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
