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
  if (!isValidBoard(board) || ![BLACK, WHITE].includes(aiColor)) {
    return json(400, { error: "Invalid board or color" });
  }

  const prompt = [
    "You are playing Gomoku on a 15x15 board.",
    "Return exactly one legal move for the AI.",
    "Coordinates are zero-based: row 0-14, col 0-14.",
    "Board values: 0 empty, 1 black, 2 white.",
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

    if (!isLegalMove(board, move)) {
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

function isLegalMove(board, move) {
  return (
    move &&
    Number.isInteger(move.row) &&
    Number.isInteger(move.col) &&
    move.row >= 0 &&
    move.row < BOARD_SIZE &&
    move.col >= 0 &&
    move.col < BOARD_SIZE &&
    board[move.row][move.col] === EMPTY
  );
}
