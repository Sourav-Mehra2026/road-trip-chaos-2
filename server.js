import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { randomBytes } from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: "*" },
  pingInterval: 25000,
  pingTimeout: 20000
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({
    game: "ROAD TRIP CHAOS",
    status: "online"
  });
});

const rooms = new Map();
const MAX_PLAYERS = 16;

function createCode() {
  let code;
  do {
    code = randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(code));
  return code;
}

function createPlayer(id, username) {
  return {
    id,
    username: String(username || "Player").slice(0, 18),
    x: 3,
    z: 5,
    yaw: 0,
    color: Math.floor(Math.random() * 0xffffff),
    seated: false
  };
}

function createRoom(code, owner) {
  return {
    code,
    owner,
    driverId: owner,
    players: new Map(),
    vehicle: {
      x: 0,
      z: 0,
      yaw: 0,
      speed: 0,
      gear: "P",
      fuel: 100,
      health: 100
    }
  };
}

function publicState(room) {
  return {
    code: room.code,
    driverId: room.driverId,
    players: [...room.players.values()],
    vehicle: { ...room.vehicle }
  };
}

function sendState(room) {
  io.to(room.code).emit("state", publicState(room));
}

function removePlayer(socket) {
  const code = socket.data.roomCode;
  if (!code) return;

  const room = rooms.get(code);
  if (!room) return;

  room.players.delete(socket.id);
  socket.leave(code);
  socket.data.roomCode = null;

  if (room.players.size === 0) {
    rooms.delete(code);
    return;
  }

  if (room.driverId === socket.id) {
    room.driverId = room.players.keys().next().value;
  }

  sendState(room);
}

io.on("connection", socket => {
  console.log("Connected:", socket.id);

  socket.on("createRoom", (data = {}, callback) => {
    if (socket.data.roomCode) removePlayer(socket);

    const code = createCode();
    const room = createRoom(code, socket.id);

    room.players.set(
      socket.id,
      createPlayer(socket.id, data.username)
    );

    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;

    const result = {
      ok: true,
      code,
      state: publicState(room)
    };

    if (typeof callback === "function") callback(result);
    sendState(room);
  });

  socket.on("joinRoom", (data = {}, callback) => {
    if (socket.data.roomCode) removePlayer(socket);

    const code = String(data.code || "").toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      if (typeof callback === "function")
        callback({ ok: false, error: "Room नहीं मिला।" });
      return;
    }

    if (room.players.size >= MAX_PLAYERS) {
      if (typeof callback === "function")
        callback({ ok: false, error: "Room भर चुका है।" });
      return;
    }

    room.players.set(
      socket.id,
      createPlayer(socket.id, data.username)
    );

    socket.join(code);
    socket.data.roomCode = code;

    const result = {
      ok: true,
      code,
      state: publicState(room)
    };

    if (typeof callback === "function") callback(result);
    sendState(room);
  });

  socket.on("move", data => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.players.has(socket.id)) return;

    const player = room.players.get(socket.id);

    if (Number.isFinite(data?.x)) {
      player.x = Math.max(-250, Math.min(250, data.x));
    }

    if (Number.isFinite(data?.z)) {
      player.z = Math.max(-250, Math.min(250, data.z));
    }

    if (Number.isFinite(data?.yaw)) {
      player.yaw = data.yaw;
    }

    sendState(room);
  });

  socket.on("drive", data => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.driverId !== socket.id) return;

    const allowedGears = ["P", "R", "N", "1", "2", "3", "4"];
    const gear = String(data?.gear || "P");

    if (!allowedGears.includes(gear)) return;

    room.vehicle.gear = gear;

    // Driving physics will be added in the next development stage.
    // Only the current driver can send vehicle controls.
  });

  socket.on("throwPlayer", targetId => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.players.has(socket.id)) return;

    if (targetId === socket.id) return;

    if (!room.players.has(targetId)) return;

    io.to(room.code).emit("toast", "Player interaction requested.");
  });

  socket.on("disconnect", () => {
    removePlayer(socket);
    console.log("Disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`ROAD TRIP CHAOS running on port ${PORT}`);
});
