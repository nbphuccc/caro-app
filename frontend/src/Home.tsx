import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { socket } from "./socket"; // adjust path if needed

const BOARD_WIDTH = 18;
const BOARD_HEIGHT = 25;
const CELL_SIZE = 30;

export default function Home() {
    const navigate = useNavigate();

    // States
    const [showMenu, setShowMenu] = useState(true);
    const [joinGameDialog, setJoinGameDialog] = useState(false);
    const [userRoomCode, setUserRoomCode] = useState("");
    const [joinError, setJoinError] = useState<string | null>(null);
    const [loadingBackend, setLoadingBackend] = useState(true);
    //const [error, setError] = useState<string | null>(null);

    const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";


    useEffect(() => {
      const pingBackend = async () => {
        try {
          const res = await fetch(`${backendUrl}/ping`);
          if (res.ok) {
            setLoadingBackend(false);
            return;
          }
        } catch (err) {
          console.log("Backend not ready, retrying...");
        }
        setTimeout(pingBackend, 2000);
      };
    
      pingBackend();
    }, [backendUrl]);


  // --- Host game ---
  const handleHostGame = () => {
    socket.emit(
      "requestRoom",
      (res: { success: boolean; roomId?: string; role?: string; clientId?: string }) => {
        if (res.success && res.roomId && res.role && res.clientId) {
          navigate(`/room/${res.roomId}`, {
            state: {
              isHost: true,
              clientId: res.clientId,
              playerRole: res.role,
              nameSet: false,
            },
          });
        }
      }
    );
  };

  // --- Open join dialog ---
  const handleJoinGame = () => {
    setJoinGameDialog(true);
  };

  // --- Connect to room ---
  const connectToRoom = () => {
    if (!userRoomCode) return;

    // For joining a room
    socket.emit(
    "join-room",
    { roomId: userRoomCode },
    (res: { success: boolean; role?: string; message?: string; clientId?: string; nameSet?: boolean}) => {
        if (res.success && res.role && res.clientId) {
        navigate(`/room/${userRoomCode}`, {
            state: {
            isHost: false,
            clientId: res.clientId,
            playerRole: res.role,
            nameSet: res.nameSet ?? false,
            },
        });
        } else {
        setJoinError(res.message || "Failed to join room");
        setUserRoomCode("");
        }
    }
    );

  };

  return (
    <div className="app-container">
      {/* Dashboard */}
      <div className="dashboard">
        <button
          className="dashboard-menu-button"
          onClick={() => setShowMenu(true)}
        >
          Main Menu
        </button>
      </div>

      <div
        className="board"
        style={{
          width: (BOARD_WIDTH - 1) * CELL_SIZE,
          height: (BOARD_HEIGHT - 1) * CELL_SIZE,
        }}
      >
        {showMenu && (
          <div className="menu-overlay">
            <h1 className="menu-title">Caro</h1>
            <div className="menu-buttons">
              <button className="menu-button host-game" onClick={handleHostGame}>
                Host Game
              </button>
              <button className="menu-button join-game" onClick={handleJoinGame}>
                Join Game
              </button>
              <button
                className="menu-button exit"
                onClick={() => setShowMenu(false)}
              >
                Close Menu
              </button>
            </div>
          </div>
        )}

        {Array.from({ length: BOARD_HEIGHT }).map((_, i) =>
          Array.from({ length: BOARD_WIDTH }).map((_, j) => {
            const x = j * CELL_SIZE;
            const y = i * CELL_SIZE;
            return (
              <div
                key={`${i}-${j}`}
                className="intersection"
                style={{ left: x - 11, top: y - 13 }}
              />
            );
          })
        )}
      </div>

      {/* Join-room dialog */}
      {joinGameDialog && (
        <div className="join-dialog-overlay">
          <div className="join-dialog-box">
            <h2>Enter Room Code</h2>
            <input
              type="text"
              value={userRoomCode}
              onChange={(e) => setUserRoomCode(e.target.value)}
              placeholder="Room Code"
            />
            {joinError && <div className="join-error">{joinError}</div>}
            <div className="join-dialog-buttons">
              <button className="join-dialog-button" onClick={connectToRoom}>
                Connect
              </button>
              <button
                className="join-dialog-button cancel"
                onClick={() => setJoinGameDialog(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {loadingBackend && (
      <div className="overlay-backdrop">
        <div className="overlay-dialog">
          <h2>Starting server...</h2>
          <p>This may take a minute...</p>
          <div className="spinner" />
        </div>
      </div>
    )}

    </div>
  );
}
