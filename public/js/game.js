const socket = io();

const roomId = sessionStorage.getItem('roomId');
let isHost = sessionStorage.getItem('isHost') === 'true';
let mySocketId = null;
let currentState = null;

if (!roomId) {
  window.location.href = '/';
}

// ===== 大厅界面 =====
document.getElementById('roomIdDisplay').textContent = roomId;

document.getElementById('copyRoomBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(roomId);
  document.getElementById('copyRoomBtn').textContent = '已复制';
  setTimeout(() => document.getElementById('copyRoomBtn').textContent = '复制', 1500);
});

document.getElementById('startBtn').addEventListener('click', () => {
  socket.emit('start_game');
});

document.getElementById('nextRoundBtn').addEventListener('click', () => {
  socket.emit('next_round');
  document.getElementById('resultOverlay').style.display = 'none';
});

// ===== Socket 事件 =====
socket.on('connect', () => {
  mySocketId = socket.id;
  const name = sessionStorage.getItem('playerName') || '玩家';
  const pending = sessionStorage.getItem('pendingAction');

  if (pending) {
    sessionStorage.removeItem('pendingAction');
    const p = JSON.parse(pending);
    if (p.action === 'create') {
      socket.emit('create_room', { name: p.name, smallBlind: p.smallBlind, bigBlind: p.bigBlind, startingChips: p.startingChips });
    } else if (p.action === 'join') {
      socket.emit('join_room', { name: p.name, roomId: p.roomId });
    }
  } else if (roomId) {
    socket.emit('rejoin_room', { roomId, name });
  }
});

socket.on('room_created', ({ roomId: id }) => {
  sessionStorage.setItem('roomId', id);
  sessionStorage.setItem('isHost', 'true');
  isHost = true;
  document.getElementById('roomIdDisplay').textContent = id;
  document.getElementById('startBtn').style.display = 'block';
  document.getElementById('waitMsg').style.display = 'none';
});

socket.on('room_joined', ({ roomId: id }) => {
  sessionStorage.setItem('roomId', id);
  document.getElementById('roomIdDisplay').textContent = id;
});

socket.on('room_update', ({ players, phase }) => {
  const list = document.getElementById('playerList');
  // 第一个玩家是房主，根据 socket.id 判断自己是否是房主
  const firstPlayerId = players[0]?.id;
  if (firstPlayerId === socket.id) {
    isHost = true;
    sessionStorage.setItem('isHost', 'true');
  }

  list.innerHTML = players.map((p, i) =>
    `<div class="player-item"><span>${i === 0 ? '👑 ' : ''}${p.name}</span><span>💰 ${p.chips}</span></div>`
  ).join('');

  // 更新开始按钮显示
  if (isHost) {
    document.getElementById('startBtn').style.display = 'block';
    document.getElementById('waitMsg').style.display = 'none';
  }

  if (phase !== 'waiting') {
    showGameScreen();
  }
});

socket.on('game_state', (state) => {
  currentState = state;
  mySocketId = mySocketId || socket.id;
  showGameScreen();
  renderGame(state);
});

socket.on('error', ({ message }) => {
  alert(message);
});

// ===== 界面切换 =====
function showGameScreen() {
  document.getElementById('lobby-screen').style.display = 'none';
  document.getElementById('game-screen').style.display = 'flex';
  document.getElementById('game-screen').style.flexDirection = 'column';
}

// ===== 渲染游戏 =====
function renderGame(state) {
  // 公共牌
  const cc = document.getElementById('communityCards');
  cc.innerHTML = state.communityCards.map(c => cardHTML(c)).join('');

  // 底池
  document.getElementById('potAmount').textContent = state.pot;

  // 阶段
  const phaseNames = { preflop:'翻牌前', flop:'翻牌', turn:'转牌', river:'河牌', showdown:'摊牌', waiting:'等待' };
  document.getElementById('phaseLabel').textContent = phaseNames[state.phase] || '';

  // 座位
  renderSeats(state);

  // 我的手牌
  const me = state.players.find(p => p.id === socket.id);
  const myCardsEl = document.getElementById('myCards');
  if (me && me.holeCards) {
    myCardsEl.innerHTML = me.holeCards.map(c => cardHTML(c, false)).join('');
  } else {
    myCardsEl.innerHTML = '';
  }

  // 操作面板
  const actionPanel = document.getElementById('actionPanel');
  if (state.currentPlayerId === socket.id && state.phase !== 'showdown' && state.phase !== 'waiting') {
    actionPanel.style.display = 'flex';
    updateActionButtons(state, me);
  } else {
    actionPanel.style.display = 'none';
  }

  // 日志
  const log = document.getElementById('actionLog');
  log.innerHTML = (state.actionLog || []).map(l => `<div>${l}</div>`).join('');
  log.scrollTop = log.scrollHeight;

  // 结果
  if (state.phase === 'showdown' && state.lastWinners) {
    showResult(state.lastWinners);
  }
}

function renderSeats(state) {
  const seatsEl = document.getElementById('seats');
  seatsEl.innerHTML = '';
  const players = state.players;
  const n = players.length;
  const positions = getSeatPositions(n);

  players.forEach((p, i) => {
    const pos = positions[i];
    const isMe = p.id === socket.id;
    const isActive = p.id === state.currentPlayerId;
    const isDealer = i === state.dealerIndex;

    const seat = document.createElement('div');
    seat.className = `seat${isMe ? ' me' : ''}${isActive ? ' active' : ''}${p.folded ? ' folded' : ''}`;
    seat.style.left = pos.x + '%';
    seat.style.top = pos.y + '%';

    const cards = p.holeCards
      ? p.holeCards.map(c => cardHTML(c, false, true)).join('')
      : (p.cardCount > 0 ? Array(p.cardCount).fill(cardBackHTML(true)).join('') : '');

    seat.innerHTML = `
      <div class="avatar">${p.name.charAt(0).toUpperCase()}</div>
      <div class="seat-name">${p.name}${isDealer ? '<span class="dealer-btn">D</span>' : ''}</div>
      <div class="seat-chips">💰${p.chips}</div>
      ${p.bet > 0 ? `<div class="seat-bet">下注:${p.bet}</div>` : ''}
      ${p.allIn ? '<div class="seat-bet" style="color:#e67e22">All-in</div>' : ''}
      <div class="seat-cards">${cards}</div>
    `;
    seatsEl.appendChild(seat);
  });
}

function getSeatPositions(n) {
  // 椭圆形座位分布，从底部中间开始顺时针
  const positions = [];
  const cx = 50, cy = 50, rx = 44, ry = 40;
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI / 2) + (2 * Math.PI * i / n);
    positions.push({
      x: cx + rx * Math.cos(angle),
      y: cy - ry * Math.sin(angle)
    });
  }
  return positions;
}

function updateActionButtons(state, me) {
  const callAmount = state.currentBet - (me ? me.bet : 0);
  const checkBtn = document.getElementById('checkBtn');
  const callBtn = document.getElementById('callBtn');
  const raiseSlider = document.getElementById('raiseSlider');
  const raiseAmount = document.getElementById('raiseAmount');

  checkBtn.style.display = callAmount <= 0 ? 'block' : 'none';
  callBtn.style.display = callAmount > 0 ? 'block' : 'none';
  if (callAmount > 0) callBtn.textContent = `跟注 ${callAmount}`;

  const minRaise = state.currentBet * 2 || 20;
  const maxRaise = me ? me.chips + (me.bet || 0) : 1000;
  raiseSlider.min = minRaise;
  raiseSlider.max = maxRaise;
  raiseSlider.value = minRaise;
  raiseAmount.textContent = minRaise;

  raiseSlider.oninput = () => {
    raiseAmount.textContent = raiseSlider.value;
  };
}

// ===== 操作按钮 =====
document.getElementById('foldBtn').addEventListener('click', () => {
  socket.emit('player_action', { action: 'fold' });
});

document.getElementById('checkBtn').addEventListener('click', () => {
  socket.emit('player_action', { action: 'check' });
});

document.getElementById('callBtn').addEventListener('click', () => {
  socket.emit('player_action', { action: 'call' });
});

document.getElementById('raiseBtn').addEventListener('click', () => {
  const amount = parseInt(document.getElementById('raiseSlider').value);
  socket.emit('player_action', { action: 'raise', amount });
});

document.getElementById('allinBtn').addEventListener('click', () => {
  socket.emit('player_action', { action: 'allin' });
});

// ===== 结果显示 =====
function showResult(winners) {
  const overlay = document.getElementById('resultOverlay');
  const title = document.getElementById('resultTitle');
  const detail = document.getElementById('resultDetail');
  const nextBtn = document.getElementById('nextRoundBtn');
  const waitMsg = document.getElementById('waitNextMsg');

  title.textContent = winners.length > 1 ? '平局！' : `${winners[0].name} 获胜！`;
  detail.innerHTML = winners.map(w =>
    `<div class="winner-item">+${w.amount} 筹码 <span class="hand">${w.handRank}</span></div>`
  ).join('');

  if (isHost) {
    nextBtn.style.display = 'block';
    waitMsg.style.display = 'none';
  } else {
    nextBtn.style.display = 'none';
    waitMsg.style.display = 'block';
  }

  overlay.style.display = 'flex';
}

// ===== 牌面渲染 =====
function cardHTML(card, large = false, small = false) {
  const isRed = card.suit === '♥' || card.suit === '♦';
  const cls = `card${small ? ' card-small' : ''}${isRed ? ' red' : ' black'}`;
  return `<div class="${cls}">${card.rank}<br>${card.suit}</div>`;
}

function cardBackHTML(small = false) {
  return `<div class="card back${small ? ' card-small' : ''}"></div>`;
}
