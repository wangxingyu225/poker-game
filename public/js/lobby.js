const socket = io();

document.getElementById('createBtn').addEventListener('click', () => {
  const name = document.getElementById('playerName').value.trim();
  if (!name) return showError('请输入昵称');
  const smallBlind = parseInt(document.getElementById('smallBlind').value) || 10;
  const bigBlind = parseInt(document.getElementById('bigBlind').value) || 20;
  const startingChips = parseInt(document.getElementById('startingChips').value) || 1000;
  sessionStorage.setItem('playerName', name);
  sessionStorage.setItem('isHost', 'true');
  sessionStorage.setItem('pendingAction', JSON.stringify({ action: 'create', name, smallBlind, bigBlind, startingChips }));
  window.location.href = '/game.html';
});

document.getElementById('joinBtn').addEventListener('click', () => {
  const name = document.getElementById('playerName').value.trim();
  const roomId = document.getElementById('roomIdInput').value.trim().toUpperCase();
  if (!name) return showError('请输入昵称');
  if (!roomId) return showError('请输入房间号');
  sessionStorage.setItem('playerName', name);
  sessionStorage.setItem('isHost', 'false');
  sessionStorage.setItem('pendingAction', JSON.stringify({ action: 'join', name, roomId }));
  window.location.href = '/game.html';
});

socket.on('error', ({ message }) => showError(message));

function showError(msg) {
  document.getElementById('errorMsg').textContent = msg;
}
