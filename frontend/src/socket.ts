// socket.ts
import io from "socket.io-client";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

let clientId = localStorage.getItem("clientId");
if (!clientId) {
  clientId = crypto.randomUUID();
  localStorage.setItem("clientId", clientId);
}

export const socket = io(BACKEND_URL, {
  query: { clientId },
});