import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5000";

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ["GET", "POST"],
  },
});

type PlayerRole = "X" | "O";

interface Room {
  players: Record<string, PlayerRole>;      // clientId -> role
  roleMap: Record<PlayerRole, string>;      // role -> clientId
  sockets: Record<string, string>;          // clientId -> socket.id
  names: Record<string, string>;            // clientId -> display name
  scores: Record<string, number>;           // clientId -> score
  hostId: string;                           // clientId of current host
  board: (PlayerRole | null)[][];
  turnNumber: number;
  winner: PlayerRole | null;
  winningLine?: { row: number; col: number }[];
  messages: { sender: string; text: string }[]; // chat messages in the room
}

const rooms: Record<string, Room> = {};
const BOARD_WIDTH = 18;
const BOARD_HEIGHT = 25;
const WIN_LENGTH = 5;

function generateRoomId(length = 6) {
  return Math.random().toString(36).substring(2, 2 + length);
}

// --- check win ---
function checkWin(board: (PlayerRole | null)[][], row: number, col: number) {
  const marker = board[row][col];
  if (!marker) return null;

  const directions = [
    { dr: 0, dc: 1 },
    { dr: 1, dc: 0 },
    { dr: 1, dc: 1 },
    { dr: 1, dc: -1 },
  ];

  for (const { dr, dc } of directions) {
    let count = 1;
    const points = [{ row, col }];

    let r = row + dr, c = col + dc;
    while (r >= 0 && r < BOARD_HEIGHT && c >= 0 && c < BOARD_WIDTH && board[r][c] === marker) {
      points.push({ row: r, col: c });
      count++; r += dr; c += dc;
    }

    r = row - dr; c = col - dc;
    while (r >= 0 && r < BOARD_HEIGHT && c >= 0 && c < BOARD_WIDTH && board[r][c] === marker) {
      points.push({ row: r, col: c });
      count++; r -= dr; c -= dc;
    }

    if (count >= WIN_LENGTH) return { winner: marker, line: points };
  }

  return null;
}

// Intentional Disconnecting
function leaveRoomIntentional(roomId: string, clientId: string, socket: any) {
  const room = rooms[roomId];
  if (!room) return;

  const role = room.players[clientId];
  if (!role) return;

  delete room.players[clientId];
  delete room.roleMap[role];
  delete room.sockets[clientId];
  delete room.names[clientId];
  delete room.scores[clientId];
  room.messages = [];
  resetGame(roomId);
  
  const remainingId = Object.keys(room.players)[0] ?? null;
  if (room.hostId === clientId) {
    if (remainingId) {
      room.hostId = remainingId;
      if (room.sockets[remainingId]) {
        io.to(room.sockets[remainingId]).emit("host-changed");
      }
    } else {
      delete rooms[roomId];
    }
  } else if (room.hostId && room.sockets[room.hostId]) {
    io.to(room.sockets[room.hostId]).emit("opponent-left");
  }
  io.to(room.sockets[room.hostId]).emit("opponent-intentionally-left");
  socket.emit("room-left-intentional");
}

function resetGame(roomId: string){
  rooms[roomId].board = Array.from({ length: BOARD_HEIGHT }, () =>
    Array(BOARD_WIDTH).fill(null)
  );
  rooms[roomId].turnNumber = 1;
  rooms[roomId].winner = null;
  rooms[roomId].winningLine = undefined;
}

app.get("/ping", (req, res) => {
  res.send("pong");
});

io.on("connection", (socket) => {
  const clientId = socket.handshake.query.clientId as string;
  console.log("Connected:", clientId);

  /// --- Request a new empty roomId ---
// --- Reserve roomId first ---
socket.on("requestRoom", (ack) => {
  let id;
  do { id = generateRoomId(); } while (rooms[id]);

  rooms[id] = {
    players: { [clientId]: "X" },          // host role assigned immediately
    roleMap: { X: clientId, O: "" },       // X is host
    sockets: { [clientId]: socket.id },
    names: { [clientId]: "" },             // name empty initially
    scores: {},                           // score not set yet
    hostId: clientId,
    board: Array.from({ length: BOARD_HEIGHT }, () =>
      Array(BOARD_WIDTH).fill(null)
    ),
    turnNumber: 1,
    winner: null,
    messages: []
  };

  socket.join(id);

  // Return the roomId to the frontend
  ack({ success: true, roomId: id, role: "X", clientId });

  // Wait for the host to emit "get-name" to set their name
});


// --- Get name and broadcast ---
socket.on(
  "get-name",
  ({ roomId, name }: { roomId: string; name: string }, ack) => {
    const room = rooms[roomId];
    if (!room) return ack({ success: false, message: "Room not found" });

    // Update host name
    room.names[clientId] = name;

    ack({ success: true });

    // Send initial sync-state with role, names, and scores
    io.in(roomId).emit("sync-state", {
      board: room.board,
      turnNumber: room.turnNumber,
      winner: room.winner,
      line: room.winningLine,
      names: room.names,
      scores: room.scores,
      roleMap: room.roleMap,
      messages: room.messages
    });
  }
);


  // --- Join a room ---
  socket.on("join-room", ({ roomId }: { roomId: string }, ack) => {
  const room = rooms[roomId];
  if (!room) return ack({ success: false, message: "Room not found" });

  // Track socket.id
  room.sockets[clientId] = socket.id;

  // Deny if room full
  const currentPlayers = Object.keys(room.players).length;
  if (!room.players[clientId] && currentPlayers >= 2) {
    return ack({ success: false, message: "Room is full" });
  }

  // Assign role (reconnect or first vacant)
  let assignedRole: PlayerRole | null = null;
  for (const role of ["X", "O"] as PlayerRole[]) {
    if (room.roleMap[role] === clientId) {
      assignedRole = role;
      break;
    }
  }
  if (!assignedRole) {
    assignedRole = !room.roleMap["X"] ? "X" : "O";
  }
  room.players[clientId] = assignedRole;
  room.roleMap[assignedRole] = clientId;

  // Initialize scores if not yet set
  if (room.scores[clientId] == null) {
    for (const id of Object.keys(room.players)) {
      room.scores[id] = 0;
    }
  }

  // Check if name existed
  let nameSet: boolean = true;
  if (!room.names[clientId]) {
    nameSet = false;
  }

  // Join socket room
  socket.join(roomId);

  // Ack the join immediately (role assigned)
  ack({ success: true, roomId, role: assignedRole, nameSet, clientId});

  // Notify room that player joined
  io.in(roomId).emit("player-joined");

  //console.log(room.roleMap)

  // Send initial state to client
  io.in(roomId).emit("sync-state", {
    board: room.board,
    turnNumber: room.turnNumber,
    winner: room.winner,
    line: room.winningLine,
    names: room.names,   // may include nulls
    scores: room.scores, // both scores initialized if first join
    roleMap: room.roleMap,
    messages: room.messages
  });
});



  // --- Make move ---
  socket.on("make-move", ({ roomId, row, col, role }, ack) => {
  const room = rooms[roomId];
  if (!room) return ack({ success: false, message: "Room not found" });
  if (room.winner) return ack({ success: false, message: "Game already won" });

  // Validate role
  if (room.players[clientId] !== role) 
    return ack({ success: false, message: "Not your role" });

  // Validate turn
  const isXTurn = room.turnNumber % 2 === 1;
  if ((isXTurn && role !== "X") || (!isXTurn && role !== "O")) 
    return ack({ success: false, message: "Not your turn" });

  // Validate empty cell
  if (room.board[row][col] !== null) 
    return ack({ success: false, message: "Cell occupied" });

  // Make the move
  room.board[row][col] = role;
  room.turnNumber++;

  // Check win
  const winResult = checkWin(room.board, row, col);
  if (winResult) {
    room.winner = winResult.winner;
    room.winningLine = winResult.line;
    // Find the clientId of the winner
    const winnerClientId = room.roleMap[winResult.winner];

  // Increment winner's score
  if (winnerClientId) {
    if (room.scores[winnerClientId] == null) room.scores[winnerClientId] = 0;
    room.scores[winnerClientId] += 1;
  }
    io.in(roomId).emit("game-over", {
      row, col, role, turnNumber: room.turnNumber,
      winner: winResult.winner, line: winResult.line, scores: room.scores
    });
  } else {
    io.in(roomId).emit("move-made", {
      row, col, role, turnNumber: room.turnNumber
    });
  }

  console.log("Emitting move", { turnNumber: room.turnNumber, winner: winResult?.winner });
  ack({ success: true });
});


  // --- Propose new game ---
socket.on("propose-new-game", ({ roomId }, ack) => {
  const room = rooms[roomId];
  if (!room) return ack({ success: false, message: "Room not found" });

  // Identify opponent
  const opponentId = Object.keys(room.players).find((id) => id !== clientId) ?? null;

  if (!opponentId || !room.sockets[opponentId]) {
    // --- Opponent missing: reset game state for proposer ---
    resetGame(roomId);

    // Notify proposer that opponent is gone
    io.to(room.sockets[clientId]).emit("opponent-intentionally-left");
  } else {
    // Notify opponent
    io.to(room.sockets[opponentId]).emit("new-game-request");
    ack({ success: true });
  }
});

// --- Respond to new game ---
socket.on(
  "respond-new-game",
  ({ roomId, accept }: { roomId: string; accept: boolean }) => {
    const room = rooms[roomId];
    if (!room) return;

    // Identify proposer (other player)
    const proposerId = Object.keys(room.players).find((id) => id !== clientId) ?? null;
    if (!proposerId || !room.sockets[proposerId]) return;

    if (accept) {
      // Reset the game
      resetGame(roomId);
      // Notify both players
      io.in(roomId).emit("new-game-started");
    } else {
      // Notify proposer and remove responder from the room
      io.to(room.sockets[proposerId]).emit("new-game-declined");
    }
  }
);


  // --- Disconnect ---
  socket.on("disconnect", () => {

  for (const roomId in rooms) {
    const room = rooms[roomId];
    const role = room.players[clientId];
    if (!role) continue;

    // --- Remove only socket reference ---
    delete room.sockets[clientId];

    if (room.hostId === clientId) {
      // --- Host left: transfer host or delete room ---
      const otherId =
        room.roleMap.X === clientId ? room.roleMap.O : room.roleMap.X;

      if (otherId) {
        room.hostId = otherId;
        if (room.sockets[otherId]) {
          io.to(room.sockets[otherId]).emit("host-changed");
        }
      } else {
        // No players left → delete room
        delete rooms[roomId];
      }
    } else {
      // --- Non-host left: notify host ---
      if (room.hostId && room.sockets[room.hostId]) {
        io.to(room.sockets[room.hostId]).emit("opponent-left");
      }
    }
    if (Object.keys(room.sockets).length === 0) {
      delete rooms[roomId];
    }
  }
});

socket.on("leaving-game", ({ roomId }) => {
  const room = rooms[roomId];
  if (!room) return;

  const role = room.players[clientId];
  if (!role) return;

  delete room.players[clientId];
  delete room.roleMap[role];
  delete room.sockets[clientId];
  delete room.names[clientId];
  delete room.scores[clientId];
  room.messages = [];
  resetGame(roomId);
  
  const remainingId = Object.keys(room.players)[0] ?? null;
  if (room.hostId === clientId) {
    if (remainingId) {
      room.hostId = remainingId;
      if (room.sockets[remainingId]) {
        io.to(room.sockets[remainingId]).emit("host-changed");
      }
    } else {
      delete rooms[roomId];
    }
  } else if (room.hostId && room.sockets[room.hostId]) {
    io.to(room.sockets[room.hostId]).emit("opponent-left");
  }
  io.to(room.sockets[room.hostId]).emit("opponent-intentionally-left");
  socket.emit("room-left-intentional");
});

// --- Propose switch roles ---
socket.on("propose-switch-roles", ({ roomId }, ack) => {
  const room = rooms[roomId];
  if (!room) return ack?.({ success: false, message: "Room not found" });

  const opponentId = Object.keys(room.players).find((id) => id !== clientId);
  if (!opponentId || !room.sockets[opponentId]) {
    return ack?.({ success: false, message: "No opponent to switch with" });
  }

  // Notify opponent
  io.to(room.sockets[opponentId]).emit("switch-roles-request");

  ack?.({ success: true });
});


// --- Respond to switch roles ---
socket.on(
  "respond-switch-roles",
  ({ roomId, accepted }: { roomId: string; accepted: boolean }) => {
    const room = rooms[roomId];
    if (!room) return;

    const proposerId = Object.keys(room.players).find((id) => id !== clientId);
    if (!proposerId || !room.sockets[proposerId]) return;

    if (!accepted) {
      // Notify proposer that opponent declined
      io.to(room.sockets[proposerId]).emit("switch-roles-declined");
      return;
    }

    // --- Swap roles ---
    const clientRole = room.players[clientId];
    const proposerRole = room.players[proposerId];
    if (!clientRole || !proposerRole) return;

    room.players[clientId] = proposerRole;
    room.players[proposerId] = clientRole;

    room.roleMap[proposerRole] = clientId;
    room.roleMap[clientRole] = proposerId;

    // Notify each player their *own* new role
    io.to(room.sockets[clientId]).emit("switch-roles-accepted", {
      newRole: room.players[clientId], roleMap: room.roleMap
    });
    io.to(room.sockets[proposerId]).emit("switch-roles-accepted", {
      newRole: room.players[proposerId], roleMap: room.roleMap
    });
  }
);

// --- Kick Player ---
socket.on("kick-player", ({ roomId }: { roomId: string }) => {
  const room = rooms[roomId];
  if (!room) return;

  // Only host can kick
  if (room.hostId !== clientId) return;

  // Find the opponent ID
  const opponentId = Object.keys(room.players).find((id) => id !== clientId);
  if (!opponentId) return;

  /*
  // Disconnect opponent
  const opponentSocketId = room.sockets[opponentId];
  if (opponentSocketId) {
    io.to(opponentSocketId).emit("kicked"); // Notify client
    io.sockets.sockets.get(opponentSocketId)?.disconnect();
  }
    */

  // Remove opponent from room
  delete room.players[opponentId];
  delete room.sockets[opponentId];
  delete room.names[opponentId];
  delete room.scores[opponentId];

  // Remove from roleMap
  for (const role of ["X", "O"] as PlayerRole[]) {
    if (room.roleMap[role] === opponentId) {
      delete room.roleMap[role];
    }
  }
});

  socket.on("chat-message", ({ roomId, text }) => {
    const room = rooms[roomId];
    if (!room) return;

    const message = { sender: clientId, text };

    // Store in the room
    room.messages.push(message);

    // Broadcast to all clients in the room
    io.in(roomId).emit("chat-message", message);
});
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
