// Room.tsx
import { useState, useEffect, useRef } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { socket } from "./socket"; // assuming your socket instance

type PlayerRole = "X" | "O";
type Point = { row: number; col: number };

interface SyncState {
  board: PlayerRole[][];
  turnNumber: number;
  winner: PlayerRole;
  line?: Point[];
  names: Record<string,string>;
  scores: Record<string,number>;
  roleMap: Record<PlayerRole, string>;
  messages: { sender: string; text: string }[];
}

interface MoveMadePayload {
  row: number;
  col: number;
  role: PlayerRole;
  turnNumber: number;
  winner?: PlayerRole
  line?: Point[];
}

const BOARD_WIDTH = 18;
const BOARD_HEIGHT = 25;
const CELL_SIZE = 30;

export default function Room() {
    const params = useParams<{ roomId: string }>();
    const location = useLocation();
    const navigate = useNavigate();
    const messagesEndRef = useRef<HTMLDivElement | null>(null);


    // --- Game state ---
    const [board, setBoard] = useState<PlayerRole[][]>(
      Array.from({ length: BOARD_HEIGHT }, () => Array(BOARD_WIDTH).fill(null))
    );
    const [turnNumber, setTurnNumber] = useState<number | null>(null);
    const [playerRole, setPlayerRole] = useState<"X" | "O" | null>(null);
    const [roomId, setRoomId] = useState<string | null>(null);
    const [clientId, setClientId] = useState<string | null>(null);
    const [isHost, setIsHost] = useState(false);
    const [roomFull, setRoomFull] = useState(false);
    const [endGame, setEndGame] = useState(false);
    const [winningLine, setWinningLine] = useState<Point[] | null>(null);
    const [localName, setLocalName] = useState("");   // stores what user types
    const [names, setNames] = useState<Record<string, string>>({});
    const [scores, setScores] = useState<Record<string,number>>({});
    const [roleMap, setRoleMap] = useState<Record<PlayerRole, string>>({ X: "", O: "" });
  
    // --- UI state ---
    //const [showMenu, setShowMenu] = useState(true);
    //const [selectedMenu, setSelectedMenu] = useState<"single" | "host" | "join" | null>(null);
    const [flashMessage, setFlashMessage] = useState<string | null>(null);
    const [copied, setCopied] = useState<"code" | "link" | null>(null);
    const [newGameDialog, setNewGameDialog] = useState<"proposer" | "receiver" | null>(null);
    //const [joinGameDialog, setJoinGameDialog] = useState(false);
    //const [userRoomCode, setUserRoomCode] = useState<string>("");
    //const [joinError, setJoinError] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [switchDialog, setSwitchDialog] = useState<null | "waiting" | "incoming" | "declined" | "accepted">(null);
    const [showNameDialog, setShowNameDialog] = useState(false); // toggle dialog
    const [nameError, setNameError] = useState<string | null>(null); // error
    const [opponentStatus, setOpponentStatus] = useState<"connected" | "disconnected" | "left" | null>(null);
    const [messages, setMessages] = useState<{ sender: string; text: string }[]>([]);
    const [newMessage, setNewMessage] = useState<string>("");
    //const [loadingBackend, setLoadingBackend] = useState(isDev ? true : false);

    useEffect(() => {
  const roomIdParam = params.roomId;
  if (!roomIdParam) return;

  if (location.state && !window.performance?.navigation?.type) {
    // Navigated from Home via buttons
    const state = location.state as { isHost: boolean; clientId: string; playerRole: PlayerRole; nameSet?: boolean };
    setRoomId(roomIdParam);
    setClientId(state.clientId);
    setPlayerRole(state.playerRole);
    setIsHost(state.isHost);
    setShowNameDialog(!state.nameSet);
    socket.emit("sync-request", { roomId: roomIdParam }, (res: any) => {
        if (!res.success) console.error("Sync failed:", res.message);
    });
    
    if (!state.isHost) setOpponentStatus("connected");
  } else {
    // Refresh or pasted URL: join via backend
    socket.emit("join-room", { roomId: roomIdParam }, (ack: any) => {
      if (!ack.success) return setError(ack.message);
      setRoomId(ack.roomId);
      setPlayerRole(ack.role);
      setClientId(ack.clientId);
      setShowNameDialog(!ack.nameSet);
      if (!ack.isHost) setOpponentStatus("connected");
    });
  }
}, [params.roomId, location.state]);


/*
  // --- Sync request on load / reconnect ---
    useEffect(() => {
      if (!roomId) return;
  
      socket.emit("sync-request", { roomId }, (res: any) => {
        if (!res.success) console.error("Sync failed:", res.message);
      });
    }, []);
    */
  
    // --- Receive sync state ---
    useEffect(() => {
    const handleSyncState = (state: SyncState) => {
      setBoard(state.board);
      setTurnNumber(state.turnNumber);
      setEndGame(!!state.winner);
      setWinningLine(state.line ?? null);
      setNames(state.names);
      setScores(state.scores);
      setRoleMap(state.roleMap);
      setMessages(state.messages);
    };
  
    socket.on("sync-state", handleSyncState);
  
    return () => {
      socket.off("sync-state", handleSyncState);
    };
  }, []);

  // --- Host listens for opponent ---
  useEffect(() => {
  if (!isHost) return;

  const handleOpponentJoin = () => {
    setRoomFull(true);
    setOpponentStatus("connected");
  };

  socket.on("player-joined", handleOpponentJoin);

  return () => {
    socket.off("player-joined", handleOpponentJoin);
  };
}, [isHost]);

// --- Opponent disconnect / host change ---
  useEffect(() => {
    socket.on("opponent-left", () => {
      setRoomFull(false);
      setFlashMessage(`${names[roleMap[playerRole === "X" ? "O" : "X"]] ?? "Opponent"} disconnected!`);
      setTimeout(() => setFlashMessage(null), 3000);
      setOpponentStatus("disconnected");
    });

    socket.on("host-changed", () => {
      setFlashMessage("Host disconnected, you are now the host!");
      setIsHost(true);
      setRoomFull(false);
      setTimeout(() => setFlashMessage(null), 3000);
      setOpponentStatus("disconnected");
    });

    return () => {
      socket.off("opponent-left");
      socket.off("host-changed");
    };
  }, []);

  // --- Moves from server ---
  useEffect(() => {
    const handleMove = (payload: MoveMadePayload & { scores?: Record<string, number> }) => {
      const { row, col, role, turnNumber: serverTurn, winner, line, scores: updatedScores } = payload;
  
      setBoard(prev => {
        const newBoard = prev.map(r => [...r]);
        newBoard[row][col] = role;
        return newBoard;
      });
  
      setTurnNumber(serverTurn);
  
      if (winner) {
        setEndGame(true);
        setWinningLine(line ?? null);
      }
  
      // Update scores if provided
      if (updatedScores) {
        setScores(updatedScores);
      }
    };
  
    socket.on("move-made", handleMove);
    socket.on("game-over", handleMove);
  
    return () => {
      socket.off("move-made", handleMove);
      socket.off("game-over", handleMove);
    };
  }, []);
  
  // Handle new game proposals
useEffect(() => {
  const handleNewGameRequest = () => {
    setNewGameDialog("receiver");
  };

  socket.on("new-game-request", handleNewGameRequest);
  return () => {
    socket.off("new-game-request", handleNewGameRequest);
  };
}, []);

// Hanldle rejecting, accepting new game
useEffect(() => {
  const handleNewGameStarted = () => {
    setBoard(Array.from({ length: BOARD_HEIGHT }, () => Array(BOARD_WIDTH).fill(null)));
    setTurnNumber(1);
    setEndGame(false);
    setWinningLine(null);
    setNewGameDialog(null);
  };

  const handleNewGameDeclined = () => {
    setFlashMessage(`${names[roleMap[playerRole === "X" ? "O" : "X"]] ?? "Your opponent"} declined the new game.`);

    setTimeout(() => setFlashMessage(null), 3000);
    setNewGameDialog(null);
  };

  socket.on("new-game-started", handleNewGameStarted);
  socket.on("new-game-declined", handleNewGameDeclined);

  return () => {
    socket.off("new-game-started", handleNewGameStarted);
    socket.off("new-game-declined", handleNewGameDeclined);
  };
}, []);

// (**) When intentionally leave room, go back to default state. (**)
useEffect(() => {
  const handleLeave = () => {
    // --- Reset all game and UI state ---
    setBoard(Array.from({ length: BOARD_HEIGHT }, () => Array(BOARD_WIDTH).fill(null)));
    setTurnNumber(null);
    setPlayerRole(null);
    setRoomId(null);
    setIsHost(false);
    setRoomFull(false);
    setEndGame(false);
    setWinningLine(null);
    //setShowMenu(true);
    //setSelectedMenu(null);
    //setUserRoomCode("");
    setNames({});
    setScores({});
    setLocalName("");
    setRoleMap({ X: "", O: "" });
    setOpponentStatus(null);
    setMessages([]);
    setNewMessage("");
    // --- Navigate back to default route ---
    navigate("/", { replace: true });
  };

  socket.on("room-left-intentional", handleLeave);

  return () => {
    socket.off("room-left-intentional", handleLeave);
  };
}, []);

// New game when the other player leave the game
useEffect(() => {
  const handleOpponentLeft = () => {
    // Clear board but keep yourself in the room
    setBoard(Array.from({ length: BOARD_HEIGHT }, () =>
      Array(BOARD_WIDTH).fill(null)
    ));
    setTurnNumber(1);
    setWinningLine(null);
    setEndGame(false)
    // Mark that you’re now waiting for a new opponent
    setRoomFull(false);
    setOpponentStatus("left");
  };

  socket.on("opponent-intentionally-left", handleOpponentLeft);
  return () => {
    socket.off("opponent-intentionally-left", handleOpponentLeft);
  };
}, []);

// Role Switch 
useEffect(() => {
  // Opponent asks to switch
  socket.on("switch-roles-request", () => {
    setSwitchDialog("incoming"); // show Accept/Decline dialog
  });

  // Opponent declined
  socket.on("switch-roles-declined", () => {
    setSwitchDialog("declined"); // show "Opponent declined"
  });

  // Switch accepted
  socket.on(
  "switch-roles-accepted",
  ({ newRole, roleMap }: { newRole: PlayerRole; roleMap: Record<PlayerRole, string> }) => {
    setPlayerRole(newRole);
    setRoleMap(roleMap);
    setSwitchDialog("accepted");
  }
);

  return () => {
    socket.off("switch-roles-request");
    socket.off("switch-roles-declined");
    socket.off("switch-roles-accepted");
  };
}, []);

// --- Socket Listener ---
  useEffect(() => {
    socket.on("chat-message", ({ sender, text }: { sender: string; text: string }) => {
    setMessages((prev) => [...prev, { sender, text }]);
    });

    return () => {
      socket.off("chat-message");
    };
  }, []);

  useEffect(() => {
  if (messagesEndRef.current) {
    messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
  }
}, [messages]);

// --- Make move ---
  const handleClick = (row: number, col: number) => {
    console.log("Name:", name, "Turn:", turnNumber, "Role:", playerRole, "EndGame:", endGame);
    if (!roomId || endGame) return;
    if (!playerRole || turnNumber === null) return;

    const isXTurn = turnNumber % 2 === 1;

    if ((isXTurn && playerRole !== "X") || (!isXTurn && playerRole !== "O")) return;

    socket.emit("make-move", { roomId, row, col, role: playerRole }, (res: any) => {
      if (!res.success) console.log("Move rejected:", res.message);
    });
  };

  // --- New game ---
  const handleNewGameClick = () => {
    if (!roomId || !endGame) return;
    socket.emit("propose-new-game", { roomId }, (res: any) => {
      if (!res.success) {
        setFlashMessage(res.message);
        setTimeout(() => setFlashMessage(null), 3000);
        return;
      }
      // Show overlay to proposer
      setNewGameDialog("proposer");
    });
  };

  //Responds to new game offer
const respondNewGame = (accept: boolean) => {
  if (!roomId) return;

  socket.emit("respond-new-game", { roomId, accept });
  setNewGameDialog(null);
};

// --- Switch Sides ---
const handleSwitchSides = () => {
  if (!roomId || !playerRole) return;

  // Emit a request to switch roles
  socket.emit("propose-switch-roles", { roomId }, (res: { success: boolean; message?: string }) => {
    if (!res.success) {
      setFlashMessage(res.message || "Failed to propose switch.");
      return;
    }

    // Show "waiting" dialog for proposer
    setSwitchDialog("waiting");
  });
};

// --- Handler for submitting name ---
const handleGetName = () => {
  const newName = localName.trim();
  if (!newName) {
    setNameError("Name cannot be empty");
    return;
  }
  setNameError(null);

  socket.emit("get-name", { roomId, name: newName }, (ack: { success: boolean }) => {
      if (ack.success) {
        setShowNameDialog(false);
      } else {
        setNameError("Failed to set name");
      }
    }
  );
};

// --- Send Message ---
const sendMessage = () => {
  const trimmed = newMessage.trim();
  if (!trimmed || !clientId) return;

  socket.emit("chat-message", { roomId, text: trimmed });
  setNewMessage("");
};


const isYourTurn = 
  playerRole && turnNumber
    ? (playerRole === "X" && turnNumber % 2 === 1) || (playerRole === "O" && turnNumber % 2 === 0)
    : false;

return (
    <div className="app-container">
      {/* Dashboard */}
      <div className="dashboard">
        {roomId && (
        <>
          <button
            className={`dashboard-button new-game ${endGame ? "" : "disabled"}`}
            onClick={handleNewGameClick}
          >
            New Game
          </button>

          <button
            className="dashboard-button switch-sides"
            onClick={handleSwitchSides}
            disabled={turnNumber !== 1 && !endGame} // locked unless game not started or game ended
          >
            Switch Sides
          </button>

          <button 
            className="dashboard-button change-name"
            onClick={() => setShowNameDialog(true)}
          >
            Change Name
          </button>

          {/* Kick Button */}
          {isHost && (
            <button
              className="dashboard-button kick"
              onClick={() => {
                socket.emit("kick-player", { roomId });
                setOpponentStatus("left");
              }}
              disabled={opponentStatus !== "disconnected"} // disable unless opponent disconnected
            >
              Kick
            </button>
          )}
        </>
      )}


        {flashMessage && <div className="flash-message">{flashMessage}</div>}

        {roomId && (
        <div className="room-box">
          {/* Top row: label + ID */}
          <div className="room-info">
            <span className="room-label">{isHost ? "Hosting Room:" : "Joining Room:"}</span>
            <span className="room-id">{roomId}</span>
          </div>

          {/* Second row: copy buttons */}
          <div className="copy-buttons">
            <div>
              <button
                className="copy-button"
                onClick={() => {
                  navigator.clipboard.writeText(roomId);
                  setCopied("code");
                  setTimeout(() => setCopied(null), 1500);
                }}
              >
                Copy Code
              </button>
              {copied === "code" && <span className="copied-text">Copied!</span>}
            </div>

            <div>
              <button
                className="copy-button"
                onClick={() => {
                  const link = `${window.location.origin}/room/${roomId}`;
                  navigator.clipboard.writeText(link);
                  setCopied("link");
                  setTimeout(() => setCopied(null), 1500);
                }}
              >
                Copy Link
              </button>
              {copied === "link" && <span className="copied-text">Copied!</span>}
            </div>
          </div>
        </div>
      )}


        {/* Turn Indicator Box */}
        {roomId && (
          <div
            className={`turn-indicator ${playerRole ?? ""} ${
              playerRole && turnNumber && !endGame
                ? isYourTurn
                  ? ""
                  : "inactive"
                : "inactive"
            }`}
          >
            <span>Your Turn</span>
            <span>{playerRole ?? "-"}</span>
          </div>
        )}

        {/* Scoreboard */}
        {roomId && (
          <div className="scoreboard">
            {Object.keys(names).map((clientId) => {
              const roleClass =
                roleMap?.X === clientId ? "red" : roleMap?.O === clientId ? "blue" : "";

              // Determine if this client is the opponent
              const isOpponent =
                (playerRole === "X" && roleMap?.O === clientId) ||
                (playerRole === "O" && roleMap?.X === clientId);

              // Diamond status color
              let statusClass = "";
              if (isOpponent) {
                if (opponentStatus === "connected") statusClass = "status-connected";
                else if (opponentStatus === "disconnected") statusClass = "status-disconnected";
                else if (opponentStatus === "left") statusClass = "status-left";
              } else {
                statusClass = "status-connected"; // you are always connected
              }

              return (
                <div key={clientId} className="score-entry">
                  <span className={`status-diamond ${statusClass}`} />
                  <span className={`score-name ${roleClass}`}>
                    {names[clientId] ?? "-"}
                  </span>
                  <span className="score-value">{scores[clientId] ?? 0}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* --- Disconnect Button --- */}
        {roomId && (
          <button
            className="dashboard-button disconnect"
            onClick={() => {
              socket.emit("leaving-game", { roomId });
            }}
          >
            Disconnect
          </button>
        )}

      </div>

      {/* Name Dialog */}
      {showNameDialog && (
        <div className="name-dialog-overlay">
          <div className="name-dialog-box">
            <h2>Enter Your Name</h2>
            <input
              type="text"
              placeholder="Your name"
              value={localName}
              onChange={(e) => setLocalName(e.target.value)}
            />
            {nameError && <p className="name-error">{nameError}</p>}
            <div className="name-dialog-buttons">
              <button onClick={handleGetName}>Enter</button>
            </div>
          </div>
        </div>
      )}

      {/*New Game Choice Dialog*/}
      {newGameDialog === "proposer" && (
        <div className="new-game-dialog-backdrop">
          <div className="new-game-dialog">
            <h2>Waiting for {names[roleMap[playerRole === "X" ? "O" : "X"]] ?? "your opponent"} to accept new game...</h2>
          </div>
        </div>
      )}

      {newGameDialog === "receiver" && (
        <div className="new-game-dialog-backdrop">
          <div className="new-game-dialog">
            <h2>{names[roleMap[playerRole === "X" ? "O" : "X"]] ?? "Your opponent"} proposes a new game</h2>
            <div className="new-game-buttons">
              <button
                className="new-game-choice-button"
                onClick={() => respondNewGame(true)}
              >
                Accept
              </button>
              <button
                className="new-game-choice-button decline"
                onClick={() => respondNewGame(false)}
              >
                Decline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Waiting dialog (proposer) */}
      {switchDialog === "waiting" && (
        <div className="switch-roles-dialog">
          <h2>Waiting for {names[roleMap[playerRole === "X" ? "O" : "X"]] ?? "your opponent"} to accept switching sides...</h2>
        </div>
      )}

      {/* Incoming request (receiver) */}
      {switchDialog === "incoming" && (
        <div className="switch-roles-dialog">
          <h2>{names[roleMap[playerRole === "X" ? "O" : "X"]] ?? "Your opponent"} wants to switch sides</h2>
          <div className="switch-roles-buttons">
            <button
              className="switch-roles-button"
              onClick={() => {
                socket.emit("respond-switch-roles", { roomId, accepted: true });
                setSwitchDialog(null);
              }}
            >
              Accept
            </button>

            <button
              className="switch-roles-button decline"
              onClick={() => {
                socket.emit("respond-switch-roles", { roomId, accepted: false });
                setSwitchDialog(null);
              }}
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {/* Declined dialog (shown to proposer) */}
      {switchDialog === "declined" && (
        <div className="switch-roles-dialog">
          <h2>{names[roleMap[playerRole === "X" ? "O" : "X"]] ?? "Your opponent"} declined to switch sides</h2>
          <div className="switch-roles-buttons">
            <button
              className="switch-roles-button"
              onClick={() => setSwitchDialog(null)}
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* Accepted dialog (both players) */}
      {switchDialog === "accepted" && (
        <div className="switch-roles-dialog">
          <h2>You are now playing as {playerRole}</h2>
          <div className="switch-roles-buttons">
            <button
              className="switch-roles-button"
              onClick={() => setSwitchDialog(null)}
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* Game board */}
      <div
        className="board"
        style={{
          width: (BOARD_WIDTH-1) * CELL_SIZE,
          height: (BOARD_HEIGHT-1) * CELL_SIZE,
        }}
      >
        {board.map((rowArr, i) =>
          rowArr.map((cell, j) => {
            const x = j * CELL_SIZE;
            const y = i * CELL_SIZE;
            const isWinning = winningLine?.some((p) => p.row === i && p.col === j) ?? false;
            return (
              <div
                key={`${i}-${j}`}
                className="intersection"
                style={{ left: x - 11, top: y - 13 }}
                onClick={() => handleClick(i, j)}
              >
                {cell === "X" && <span className={`marker-x ${isWinning ? "winning" : ""}`}>X</span>}
                {cell === "O" && <span className={`marker-o ${isWinning ? "winning" : ""}`}>O</span>}
              </div>
            );
          })
        )}

        {/* Waiting Overlay */}
        {!roomFull && isHost && !endGame && (
          <div className="waiting-overlay">
            {opponentStatus === "disconnected" && roleMap && playerRole ? (
              <>Waiting for {names[roleMap[playerRole === "X" ? "O" : "X"]] ?? "opponent"} to rejoin...</>
            ) : opponentStatus === "left" ? (
              <>Waiting for someone else to join...</>
            ) : (
              <>Waiting for someone to join...</>
            )}
          </div>
        )}

      </div>

      {roomId && (
      <div className="chat-window">
        <div className="chat-messages">
          {messages.map((msg, idx) => {
            const senderName = names[msg.sender] ?? "Unknown";
            return (
              <div key={idx} className="chat-message">
                <span className="chat-sender">{senderName}:</span>
                <span className="chat-text">{msg.text}</span>
              </div>
            );
          })}
            <div ref={messagesEndRef} />  {/* anchor */}

        </div>
        <div className="chat-input">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          />
          <button onClick={sendMessage}>Send</button>
        </div>
      </div>
    )}

    {error && (
  <div className="error-box">
    <div className="error-content">
      <p>{error}</p>
      <button onClick={() => (window.location.href = "/")}>Go Back</button>
    </div>
  </div>
)}


    </div>
  );

}
