const socket = io();

const roomId = sessionStorage.getItem('roomId');
let isHost = sessionStorage.getItem('isHost') === 'true';
let mySocketId = null;
let currentState = null;
let statsMap = {}; // playerId -> { name, net }

const pending = sessionStorage.getItem('pendingAction');
if (!pending && (!roomId || roomId === '__pending__')) {
  window.location.href = '/';
}

// ===== 大厅界面 =====
document.getElementById('copyRoomBtn').addEventListener('click', () => {
  const id = sessionStorage.getItem('roomId');
  navigator.clipboard.writeText(id || '');
  document.getElementById('copyRoomBtn').textContent = '已复制';
  setTimeout(() => document.getElementById('copyRoomBtn').textContent = '复制', 1500);
});

document.getElementById('startBtn').addEventListener('click', () => {
  socket.emit('start_game');
});

// ===== 带入筹码 =====
document.getElementById('rebuyBtn').addEventListener('click', () => {
  const me = currentState && currentState.players.find(p => p.id === socket.id);
  document.getElementById('myChipsDisplay').textContent = me ? me.chips : 0;
  document.getElementById('rebuyOverlay').style.display = 'flex';
});

document.getElementById('rebuyConfirmBtn').addEventListener('click', () => {
  const amount = parseInt(document.getElementById('rebuyAmount').value) || 0;
  if (amount > 0) socket.emit('rebuy', { amount });
  document.getElementById('rebuyOverlay').style.display = 'none';
});

document.getElementById('rebuyCancelBtn').addEventListener('click', () => {
  document.getElementById('rebuyOverlay').style.display = 'none';
});

// ===== Socket 连接 =====
socket.on('connect', () => {
  mySocketId = socket.id;
  const name = sessionStorage.getItem('playerName') || '玩家';
  const pendingRaw = sessionStorage.getItem('pendingAction');

  if (pendingRaw) {
    sessionStorage.removeItem('pendingAction');
    const p = JSON.parse(pendingRaw);
    if (p.action === 'create') {
      socket.emit('create_room', { name: p.name, smallBlind: p.smallBlind, bigBlind: p.bigBlind, startingChips: p.startingChips, totalGameTime: p.totalGameTime, thinkTime: p.thinkTime });
    } else if (p.action === 'join') {
      socket.emit('join_room', { name: p.name, roomId: p.roomId });
    }
  } else if (roomId && roomId !== '__pending__') {
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
  sessionStorage.setItem('isHost', 'false');
  isHost = false;
  document.getElementById('roomIdDisplay').textContent = id;
});

socket.on('room_update', ({ players, phase }) => {
  const list = document.getElementById('playerList');
  if (players[0]?.id === socket.id) {
    isHost = true;
    sessionStorage.setItem('isHost', 'true');
    document.getElementById('startBtn').style.display = 'block';
    document.getElementById('waitMsg').style.display = 'none';
  }
  list.innerHTML = players.map((p, i) =>
    `<div class="player-item"><span>${i === 0 ? '👑 ' : ''}${p.name}</span><span>💰 ${p.chips}</span></div>`
  ).join('');
  if (phase !== 'waiting') showGameScreen();
});

socket.on('game_state', (state) => {
  currentState = state;
  mySocketId = socket.id;
  showGameScreen();
  renderGame(state);
  updateStats(state);
});

socket.on('error', ({ message }) => alert(message));

// ===== 界面切换 =====
function showGameScreen() {
  document.getElementById('lobby-screen').style.display = 'none';
  const gs = document.getElementById('game-screen');
  gs.style.display = 'flex';
}

// ===== 战绩汇总 =====
function updateStats(state) {
  // 初始化新玩家
  for (const p of state.players) {
    if (!statsMap[p.id]) {
      statsMap[p.id] = { name: p.name, net: 0, startChips: p.chips };
    }
  }
  // 如果有获胜者，更新净盈亏
  if (state.lastWinners && state.phase === 'showdown') {
    for (const p of state.players) {
      if (statsMap[p.id]) {
        statsMap[p.id].chips = p.chips;
      }
    }
  }
  // 实时显示当前筹码 vs 初始筹码
  const rows = state.players.map(p => {
    if (!statsMap[p.id]) statsMap[p.id] = { name: p.name, startChips: p.chips };
    const start = statsMap[p.id].startChips || p.chips;
    const net = p.chips - start;
    const color = net > 0 ? '#2ecc71' : net < 0 ? '#e74c3c' : '#aaa';
    const sign = net > 0 ? '+' : '';
    return `<div class="stats-row">
      <span class="stats-name">${p.name}</span>
      <span class="stats-chips">💰${p.chips}</span>
      <span class="stats-net" style="color:${color}">${sign}${net}</span>
    </div>`;
  }).join('');
  document.getElementById('statsTable').innerHTML = rows;
}

// ===== 渲染游戏 =====
function renderGame(state) {
  const cc = document.getElementById('communityCards');
  cc.innerHTML = state.communityCards.map(c => cardHTML(c)).join('');

  document.getElementById('potAmount').textContent = state.pot;

  const phaseNames = { preflop:'翻牌前', flop:'翻牌', turn:'转牌', river:'河牌', showdown:'摊牌', waiting:'等待' };
  document.getElementById('phaseLabel').textContent = phaseNames[state.phase] || '';

  updateGameTimer(state.remainingTime !== undefined ? state.remainingTime : null);

  renderSeats(state);

  const sid = socket.id;
  const me = state.players.find(p => p.id === sid);
  const myCardsEl = document.getElementById('myCards');
  if (me && me.holeCards) {
    myCardsEl.innerHTML = me.holeCards.map(c => cardHTML(c)).join('');
  } else {
    myCardsEl.innerHTML = '';
  }

  // 带入筹码按钮：筹码为0且游戏在进行中时显示
  const rebuyBtn = document.getElementById('rebuyBtn');
  if (me && me.chips === 0 && state.phase !== 'waiting') {
    rebuyBtn.style.display = 'block';
  } else {
    rebuyBtn.style.display = 'none';
  }

  const actionPanel = document.getElementById('actionPanel');
  if (state.currentPlayerId === sid && state.phase !== 'showdown' && state.phase !== 'waiting') {
    actionPanel.style.display = 'flex';
    updateActionButtons(state, me);
    if (state.thinkTimeRemaining > 0) startThinkTimer(state.thinkTimeRemaining);
  } else {
    actionPanel.style.display = 'none';
    clearInterval(thinkTimerInterval);
    const el = document.getElementById('thinkTimer');
    if (el) el.textContent = '';
  }

  const log = document.getElementById('actionLog');
  log.innerHTML = (state.actionLog || []).map(l => `<div>${l}</div>`).join('');
  log.scrollTop = log.scrollHeight;

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
  raiseSlider.oninput = () => { raiseAmount.textContent = raiseSlider.value; };
}

// ===== 操作按钮 =====
document.getElementById('foldBtn').addEventListener('click', () => socket.emit('player_action', { action: 'fold' }));
document.getElementById('checkBtn').addEventListener('click', () => socket.emit('player_action', { action: 'check' }));
document.getElementById('callBtn').addEventListener('click', () => socket.emit('player_action', { action: 'call' }));
document.getElementById('raiseBtn').addEventListener('click', () => {
  const amount = parseInt(document.getElementById('raiseSlider').value);
  socket.emit('player_action', { action: 'raise', amount });
});
document.getElementById('allinBtn').addEventListener('click', () => socket.emit('player_action', { action: 'allin' }));

// ===== 计时器 =====
let thinkTimerInterval = null;

function startThinkTimer(ms) {
  clearInterval(thinkTimerInterval);
  const el = document.getElementById('thinkTimer');
  if (!el || ms <= 0) { if (el) el.textContent = ''; return; }
  let remaining = Math.ceil(ms / 1000);
  el.textContent = `⏱ ${remaining}s`;
  thinkTimerInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) { clearInterval(thinkTimerInterval); el.textContent = ''; }
    else el.textContent = `⏱ ${remaining}s`;
  }, 1000);
}

function updateGameTimer(remainingMs) {
  const el = document.getElementById('gameTimer');
  if (!el) return;
  if (remainingMs === null || remainingMs === undefined) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const mins = Math.floor(remainingMs / 60000);
  const secs = Math.floor((remainingMs % 60000) / 1000);
  el.textContent = `剩余 ${mins}:${secs.toString().padStart(2, '0')}`;
}

// ===== 结果显示 =====
function showResult(winners) {
  const overlay = document.getElementById('resultOverlay');
  document.getElementById('resultTitle').textContent = winners.length > 1 ? '平局！' : `${winners[0].name} 获胜！`;
  document.getElementById('resultDetail').innerHTML = winners.map(w => {
    const cards = w.holeCards ? w.holeCards.map(c => cardHTML(c, false, true)).join('') : '';
    return `<div class="winner-item">${w.name} +${w.amount} <span class="hand">${w.handRank}</span>
      <div style="display:flex;gap:4px;justify-content:center;margin-top:4px">${cards}</div></div>`;
  }).join('');
  overlay.style.display = 'flex';
  setTimeout(() => { overlay.style.display = 'none'; }, 3000);
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
