const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map(); // ws -> roomCode

wss.on("connection", (ws) => {
    console.log("A client connected.");

    ws.on("message", (data) => {
        try {
            const msg = JSON.parse(data.toString());

            // Handle joining a session/room
            if (msg.type === "join") {
                const roomCode = msg.room;
                rooms.set(ws, roomCode);
                console.log(`Client joined room: ${roomCode}`);
                ws.send(JSON.stringify({ type: "event", message: `Successfully joined room: ${roomCode}` }));
                return;
            }

            // Normal Message Broadcast within the same room
            const roomCode = rooms.get(ws);
            if (!roomCode) {
                ws.send(JSON.stringify({ type: "error", message: "You must join a room first." }));
                return;
            }

            // Broadcast to everyone in the same room EXCEPT the sender
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === WebSocket.OPEN && rooms.get(client) === roomCode) {
                    client.send(data.toString());
                }
            });

        } catch (err) {
            console.error("Error processing message:", err);
        }
    });

    ws.on("close", () => {
        rooms.delete(ws);
        console.log("Client disconnected.");
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`PANOLIVE Remote Unified Server running on port ${PORT}`);
});
