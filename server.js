const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Game = require('./game/Game');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling']
});

app.use(express.static('public'));

// 设置 CSP 允许 socket.io 所需的 eval
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-eval'; connect-src 'self' ws: wss:;");
  next();
});

// roomId -> Game
const rooms = {};
// socketId -> { roomId, playerName }
const socketMap = {};

io.on('connection', (socket) => {

  socket.on('create_room', ({ name, smallBlind, bigBlind, startingChips }) => {
    const roomId = Math.random().toString(36).substr(2, 6).toUpperCase();
    const game = new Game(roomId, { smallBlind, bigBlind, startingChips });
    rooms[roomId] = game;
    game.addPlayer(socket.id, name);
    socketMap[socket.id] = { roomId, name };
    socket.join(roomId);
    socket.emit('room_created', { roomId });
    broadcastRoomUpdate(roomId);
  });

  socket.on('join_room', ({ name, roomId }) => {
    const game = rooms[roomId];
    if (!game) return socket.emit('error', { message: '房间不存在' });
    if (game.phase !== 'waiting') return socket.emit('error', { message: '游戏已开始' });
    if (game.players.length >= 9) return socket.emit('error', { message: '房间已满' });
    game.addPlayer(socket.id, name);
    socketMap[socket.id] = { roomId, name };
    socket.join(roomId);
    socket.emit('room_joined', { roomId });
    broadcastRoomUpdate(roomId);
  });

  socket.on('start_game', () => {
    const info = socketMap[socket.id];
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game) return;
    if (game.players[0].id !== socket.id) return socket.emit('error', { message: '只有房主可以开始游戏' });
    if (!game.canStart()) return socket.emit('error', { message: '至少需要2名玩家' });
    game.startRound();
    broadcastRoomUpdate(info.roomId);
    broadcastGameState(info.roomId);
  });

  socket.on('player_action', ({ action, amount }) => {
    const info = socketMap[socket.id];
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game) return;
    const result = game.processAction(socket.id, action, amount);
    if (result && result.error) return socket.emit('error', { message: result.error });
    broadcastGameState(info.roomId);
  });

  socket.on('next_round', () => {
    const info = socketMap[socket.id];
    if (!info) return;
    const game = rooms[info.roomId];
    if (!game || game.phase !== 'showdown') return;
    if (game.players[0].id !== socket.id) return;
    game.lastWinners = null;
    const started = game.startRound();
    if (!started) {
      game.phase = 'waiting';
    }
    broadcastGameState(info.roomId);
  });

  socket.on('rejoin_room', ({ roomId, name }) => {
    const game = rooms[roomId];
    if (!game) return;
    // 检查是否已在房间（重连场景）
    const existing = game.players.find(p => p.id === socket.id);
    if (!existing) {
      // 新连接但 sessionStorage 有 roomId，尝试重新加入（仅 waiting 阶段）
      if (game.phase === 'waiting') {
        game.addPlayer(socket.id, name);
        socketMap[socket.id] = { roomId, name };
        socket.join(roomId);
        broadcastRoomUpdate(roomId);
      }
    } else {
      socketMap[socket.id] = { roomId, name };
      socket.join(roomId);
      if (game.phase !== 'waiting') {
        const state = game.getState(socket.id);
        socket.emit('game_state', state);
      } else {
        broadcastRoomUpdate(roomId);
      }
    }
  });

  socket.on('disconnect', () => {
    const info = socketMap[socket.id];
    if (!info) return;
    const game = rooms[info.roomId];
    if (game) {
      game.removePlayer(socket.id);
      if (game.players.length === 0) {
        delete rooms[info.roomId];
      } else {
        broadcastRoomUpdate(info.roomId);
        if (game.phase !== 'waiting') broadcastGameState(info.roomId);
      }
    }
    delete socketMap[socket.id];
  });
});

function broadcastRoomUpdate(roomId) {
  const game = rooms[roomId];
  if (!game) return;
  io.to(roomId).emit('room_update', {
    players: game.players.map(p => ({ id: p.id, name: p.name, chips: p.chips })),
    phase: game.phase
  });
}

function broadcastGameState(roomId) {
  const game = rooms[roomId];
  if (!game) return;
  // 给每个玩家发送包含自己手牌的状态
  for (const player of game.players) {
    const socketId = player.id;
    const state = game.getState(socketId);
    io.to(socketId).emit('game_state', state);
  }
  // 给旁观者（如果有）发送不含手牌的状态
  io.to(roomId).emit('game_state_public', game.getState(null));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`德州扑克服务器运行在 http://localhost:${PORT}`);
});
