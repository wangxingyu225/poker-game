const socket = io();

document.getElementById('createBtn').addEventListener('click', () => {
  const name = document.getElementById('playerName').value.trim();
  if (!name) return showError('请输入昵称');
  const smallBlind = parseInt(document.getElementById('smallBlind').value) || 10;
  const bigBlind = parseInt(document.getElementById('bigBlind').value) || 20;
  const startingChips = parseInt(document.getElementById('startingChips').value) || 1000;
  sessionStorage.setItem('playerName', name);
  socket.emit('create_room', { name, smallBlind, bigBlind, startingChips });
});

document.getElementById('joinBtn').addEventListener('click', () => {
  const name = document.getElementById('playerName').value.trim();
  const roomId = document.getElementById('roomIdInput').value.trim().toUpperCase();
  if (!name) return showError('请输入昵称');
  if (!roomId) return showError('请输入房间号');
  sessionStorage.setItem('playerName', name);
  socket.emit('join_room', { name, roomId });
});

socket.on('room_created', ({ roomId }) => {
  sessionStorage.setItem('roomId', roomId);
  sessionStorage.setItem('isHost', 'true');
  window.location.href = '/game.html';
});

socket.on('room_joined', ({ roomId }) => {
  sessionStorage.setItem('roomId', roomId);
  sessionStorage.setItem('isHost', 'false');
  window.location.href = '/game.html';
});

socket.on('error', ({ message }) => showError(message));

function showError(msg) {
  document.getElementById('errorMsg').textContent = msg;
}
