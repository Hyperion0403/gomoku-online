const BOARD_SIZE = 15;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return json(503, { error: "Missing DEEPSEEK_API_KEY" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const board = body.board;
  const aiColor = body.aiColor;
  const ruleMode = body.ruleMode === "renju" ? "renju" : "freestyle";
  if (!isValidBoard(board) || ![BLACK, WHITE].includes(aiColor)) {
    return json(400, { error: "Invalid board or color" });
  }

  const prompt = [
    "You are playing Gomoku on a 15x15 board.",
    "Return exactly one legal move for the AI.",
    "Coordinates are zero-based: row 0-14, col 0-14.",
    "Board values: 0 empty, 1 black, 2 white.",
    ruleMode === "renju"
      ? "Renju forbidden rule is enabled: black must not play overline, double-four, or double-open-three. White has no forbidden moves."
      : "Freestyle rule is enabled: five or more in a row wins.",
    "Prefer winning moves, then blocking opponent wins, then strong central connected moves.",
    "Respond with strict JSON only, no markdown, in this shape: {\"row\":7,\"col\":7}",
    `AI color: ${aiColor}`,
    `Opponent color: ${aiColor === BLACK ? WHITE : BLACK}`,
    `Board: ${JSON.stringify(board)}`,
  ].join("\n");

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
        messages: [
          { role: "system", content: "You are a concise Gomoku move engine. Output strict JSON only." },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 40,
      }),
    });

    if (!response.ok) {
      return json(502, { error: "DeepSeek request failed" });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    const move = parseMove(content);

    if (!isLegalMove(board, move, aiColor, ruleMode)) {
      return json(422, { error: "DeepSeek returned an invalid move" });
    }

    return json(200, { move });
  } catch {
    return json(502, { error: "DeepSeek request failed" });
  }
};

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

function isValidBoard(board) {
  return (
    Array.isArray(board) &&
    board.length === BOARD_SIZE &&
    board.every(
      (row) =>
        Array.isArray(row) &&
        row.length === BOARD_SIZE &&
        row.every((cell) => [EMPTY, BLACK, WHITE].includes(cell)),
    )
  );
}

function parseMove(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[^{}]*"row"\s*:\s*\d+[^{}]*"col"\s*:\s*\d+[^{}]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }
}

function isLegalMove(board, move, color, ruleMode) {
  if (
    !move ||
    !Number.isInteger(move.row) ||
    !Number.isInteger(move.col) ||
    move.row < 0 ||
    move.row >= BOARD_SIZE ||
    move.col < 0 ||
    move.col >= BOARD_SIZE ||
    board[move.row][move.col] !== EMPTY
  ) {
    return false;
  }

  board[move.row][move.col] = color;
  const forbidden = ruleMode === "renju" && color === BLACK && !hasExactFive(board, move.row, move.col, color) && Boolean(getForbiddenReason(board, move.row, move.col));
  board[move.row][move.col] = EMPTY;
  return !forbidden;
}

function getDirections() {
  return [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
}

function countDirection(board, row, col, dr, dc, color) {
  let count = 0;
  let nextRow = row + dr;
  let nextCol = col + dc;
  while (nextRow >= 0 && nextRow < BOARD_SIZE && nextCol >= 0 && nextCol < BOARD_SIZE && board[nextRow][nextCol] === color) {
    count += 1;
    nextRow += dr;
    nextCol += dc;
  }
  return count;
}

function hasExactFive(board, row, col, color) {
  return getDirections().some(([dr, dc]) => 1 + countDirection(board, row, col, dr, dc, color) + countDirection(board, row, col, -dr, -dc, color) === 5);
}

function getForbiddenReason(board, row, col) {
  if (getDirections().some(([dr, dc]) => 1 + countDirection(board, row, col, dr, dc, BLACK) + countDirection(board, row, col, -dr, -dc, BLACK) >= 6)) {
    return "overline";
  }
  if (countFourLines(board, row, col, BLACK) >= 2) return "double-four";
  if (countOpenThreeLines(board, row, col, BLACK) >= 2) return "double-three";
  return "";
}

function countFourLines(board, row, col, color) {
  return getDirections().filter(([dr, dc]) => lineHasFour(board, row, col, dr, dc, color)).length;
}

function lineHasFour(board, row, col, dr, dc, color) {
  return getLineOffsets(row, col, dr, dc)
    .filter((offset) => offset !== 0)
    .some((offset) => {
      const moveRow = row + dr * offset;
      const moveCol = col + dc * offset;
      if (board[moveRow]?.[moveCol] !== EMPTY) return false;
      board[moveRow][moveCol] = color;
      const makesFive = hasExactFive(board, moveRow, moveCol, color);
      board[moveRow][moveCol] = EMPTY;
      return makesFive;
    });
}

function countOpenThreeLines(board, row, col, color) {
  return getDirections().filter(([dr, dc]) => lineCanBecomeOpenFour(board, row, col, dr, dc, color)).length;
}

function lineCanBecomeOpenFour(board, row, col, dr, dc, color) {
  return getLineOffsets(row, col, dr, dc)
    .filter((offset) => offset !== 0)
    .some((offset) => {
      const moveRow = row + dr * offset;
      const moveCol = col + dc * offset;
      if (board[moveRow]?.[moveCol] !== EMPTY) return false;
      board[moveRow][moveCol] = color;
      const openFour = lineIsOpenFour(board, moveRow, moveCol, dr, dc, color);
      board[moveRow][moveCol] = EMPTY;
      return openFour;
    });
}

function lineIsOpenFour(board, row, col, dr, dc, color) {
  const forward = countDirection(board, row, col, dr, dc, color);
  const backward = countDirection(board, row, col, -dr, -dc, color);
  const count = 1 + forward + backward;
  if (count !== 4) return false;

  const forwardEnd = getCell(board, row + dr * (forward + 1), col + dc * (forward + 1));
  const backwardEnd = getCell(board, row - dr * (backward + 1), col - dc * (backward + 1));
  return forwardEnd === EMPTY && backwardEnd === EMPTY;
}

function getCell(board, row, col) {
  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return null;
  return board[row][col];
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
