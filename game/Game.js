const Deck = require('./Deck');
const Player = require('./Player');
const HandEvaluator = require('./HandEvaluator');

class Game {
  constructor(roomId, options = {}) {
    this.roomId = roomId;
    this.players = [];
    this.deck = new Deck();
    this.communityCards = [];
    this.pot = 0;
    this.phase = 'waiting';
    this.currentPlayerIndex = 0;
    this.dealerIndex = 0;
    this.currentBet = 0;
    this.smallBlind = options.smallBlind || 10;
    this.bigBlind = options.bigBlind || 20;
    this.startingChips = options.startingChips || 1000;
    this.lastRaiseIndex = -1;
    this.actionLog = [];

    // 时间设定
    this.totalGameTime = (options.totalGameTime || 0) * 60 * 1000; // 分钟转毫秒，0=不限
    this.thinkTime = (options.thinkTime || 30) * 1000; // 秒转毫秒
    this.gameStartTime = null;
    this.thinkTimer = null;
    this.onTimeout = null; // 超时回调，由 server.js 注入
  }

  addPlayer(id, name) {
    if (this.players.length >= 9) return null;
    if (this.phase !== 'waiting') return null;
    const player = new Player(id, name, this.startingChips);
    if (this.players.length === 0) this.hostId = id;
    this.players.push(player);
    return player;
  }

  removePlayer(id) {
    this.players = this.players.filter(p => p.id !== id);
  }

  rebuy(id, amount) {
    const player = this.players.find(p => p.id === id);
    if (!player) return false;
    player.chips += amount;
    player.allIn = false;
    this.actionLog.push(`${player.name} 带入 ${amount} 筹码`);
    return true;
  }

  canStart() {
    return this.players.length >= 2 && this.phase === 'waiting';
  }

  startRound() {
    if (this.players.length < 2) return false;

    // 检查总时间是否到期
    if (this.totalGameTime > 0 && this.gameStartTime) {
      if (Date.now() - this.gameStartTime >= this.totalGameTime) {
        this.phase = 'gameover';
        return false;
      }
    }

    this.deck.reset();
    this.communityCards = [];
    this.pot = 0;
    this.currentBet = 0;
    this.actionLog = [];
    this.lastWinners = null;
    this.players.forEach(p => p.reset());

    this.players = this.players.filter(p => p.chips > 0);
    if (this.players.length < 2) return false;

    if (!this.gameStartTime) this.gameStartTime = Date.now();

    for (const player of this.players) {
      player.holeCards = this.deck.deal(2);
    }

    const n = this.players.length;
    this.dealerIndex = this.dealerIndex % n;
    const sbIndex = (this.dealerIndex + 1) % n;
    const bbIndex = (this.dealerIndex + 2) % n;

    this._collectBet(sbIndex, this.smallBlind);
    this._collectBet(bbIndex, this.bigBlind);
    this.currentBet = this.bigBlind;

    // preflop: 2人时庄家先行动，多人时大盲下一位
    if (n === 2) {
      this.currentPlayerIndex = this.dealerIndex;
    } else {
      this.currentPlayerIndex = (bbIndex + 1) % n;
    }
    this.lastRaiseIndex = bbIndex;
    this.phase = 'preflop';

    this._startThinkTimer();
    return true;
  }

  _startThinkTimer() {
    this._clearThinkTimer();
    if (this.thinkTime <= 0) return;
    this.thinkTimerEnd = Date.now() + this.thinkTime;
    this.thinkTimer = setTimeout(() => {
      // 超时自动弃牌
      const player = this.getCurrentPlayer();
      if (player && !player.folded && !player.allIn) {
        this.processAction(player.id, 'fold', 0, true);
        if (this.onTimeout) this.onTimeout();
      }
    }, this.thinkTime);
  }

  _clearThinkTimer() {
    if (this.thinkTimer) {
      clearTimeout(this.thinkTimer);
      this.thinkTimer = null;
    }
    this.thinkTimerEnd = null;
  }

  _collectBet(playerIndex, amount) {
    const player = this.players[playerIndex];
    const actual = player.placeBet(amount);
    this.pot += actual;
    return actual;
  }

  getActivePlayers() {
    return this.players.filter(p => !p.folded);
  }

  getActiveNonAllIn() {
    return this.players.filter(p => !p.folded && !p.allIn);
  }

  getCurrentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  processAction(playerId, action, amount = 0, isTimeout = false) {
    const player = this.getCurrentPlayer();
    if (!player || player.id !== playerId) return { error: '不是你的回合' };
    if (player.folded || player.allIn) return { error: '无效操作' };

    this._clearThinkTimer();

    const callAmount = this.currentBet - player.bet;

    switch (action) {
      case 'fold':
        player.folded = true;
        this.actionLog.push(`${player.name} ${isTimeout ? '超时弃牌' : '弃牌'}`);
        break;

      case 'check':
        if (callAmount > 0) return { error: '需要跟注或加注' };
        this.actionLog.push(`${player.name} 过牌`);
        break;

      case 'call':
        if (callAmount <= 0) return { error: '无需跟注' };
        this._collectBet(this.currentPlayerIndex, callAmount);
        this.actionLog.push(`${player.name} 跟注 ${callAmount}`);
        break;

      case 'raise': {
        const minRaise = this.currentBet + this.bigBlind;
        const raiseTotal = Math.max(amount, minRaise);
        const needed = raiseTotal - player.bet;
        if (needed >= player.chips) {
          const actual = this._collectBet(this.currentPlayerIndex, player.chips);
          if (player.totalBet > this.currentBet) {
            this.currentBet = player.totalBet;
            this.lastRaiseIndex = this.currentPlayerIndex;
          }
          this.actionLog.push(`${player.name} All-in ${actual}`);
        } else {
          this._collectBet(this.currentPlayerIndex, needed);
          this.currentBet = raiseTotal;
          this.lastRaiseIndex = this.currentPlayerIndex;
          this.actionLog.push(`${player.name} 加注至 ${raiseTotal}`);
        }
        break;
      }

      case 'allin': {
        const actual = this._collectBet(this.currentPlayerIndex, player.chips);
        if (player.totalBet > this.currentBet) {
          this.currentBet = player.totalBet;
          this.lastRaiseIndex = this.currentPlayerIndex;
        }
        this.actionLog.push(`${player.name} All-in ${actual}`);
        break;
      }

      default:
        return { error: '未知操作' };
    }

    const active = this.getActivePlayers();
    if (active.length === 1) {
      this._endRound(active);
      return { success: true };
    }

    this._nextPlayer();
    return { success: true };
  }

  _nextPlayer() {
    const n = this.players.length;
    let next = (this.currentPlayerIndex + 1) % n;
    let loops = 0;
    while (loops < n) {
      const p = this.players[next];
      if (!p.folded && !p.allIn) break;
      next = (next + 1) % n;
      loops++;
    }

    if (this._isBettingRoundOver(next)) {
      this._advancePhase();
    } else {
      this.currentPlayerIndex = next;
      this._startThinkTimer();
    }
  }

  _isBettingRoundOver(nextIndex) {
    const active = this.getActiveNonAllIn();
    if (active.length === 0) return true;

    // 所有未弃牌且未all-in的玩家下注金额相同
    const allCalled = active.every(p => p.bet === this.currentBet);
    if (!allCalled) return false;

    // 回到了最后加注者的下一个有效玩家
    const n = this.players.length;
    let expected = (this.lastRaiseIndex + 1) % n;
    while (this.players[expected].folded || this.players[expected].allIn) {
      expected = (expected + 1) % n;
    }
    return nextIndex === expected;
  }

  _advancePhase() {
    this.players.forEach(p => { p.bet = 0; });
    this.currentBet = 0;

    const active = this.getActivePlayers();
    if (active.length === 1) {
      this._endRound(active);
      return;
    }

    const n = this.players.length;
    let startIndex = (this.dealerIndex + 1) % n;
    let checked = 0;
    while ((this.players[startIndex].folded || this.players[startIndex].allIn) && checked < n) {
      startIndex = (startIndex + 1) % n;
      checked++;
    }
    this.lastRaiseIndex = (startIndex - 1 + n) % n;

    switch (this.phase) {
      case 'preflop':
        this.communityCards.push(...this.deck.deal(3));
        this.phase = 'flop';
        this.currentPlayerIndex = startIndex;
        break;
      case 'flop':
        this.communityCards.push(...this.deck.deal(1));
        this.phase = 'turn';
        this.currentPlayerIndex = startIndex;
        break;
      case 'turn':
        this.communityCards.push(...this.deck.deal(1));
        this.phase = 'river';
        this.currentPlayerIndex = startIndex;
        break;
      case 'river':
        this.phase = 'showdown';
        this._showdown();
        return;
    }

    if (this.getActiveNonAllIn().length === 0 && this.phase !== 'showdown') {
      this._advancePhase();
    } else {
      this._startThinkTimer();
    }
  }

  _showdown() {
    this._clearThinkTimer();
    const active = this.getActivePlayers();
    const results = active.map(p => {
      const allCards = [...p.holeCards, ...this.communityCards];
      const score = HandEvaluator.evaluate(allCards);
      return { player: p, score };
    });

    results.sort((a, b) => HandEvaluator.compare(b.score, a.score));
    const winners = [results[0]];
    for (let i = 1; i < results.length; i++) {
      if (HandEvaluator.compare(results[i].score, results[0].score) === 0) {
        winners.push(results[i]);
      }
    }

    const share = Math.floor(this.pot / winners.length);
    winners.forEach(w => { w.player.chips += share; });

    this.lastWinners = winners.map(w => ({
      id: w.player.id,
      name: w.player.name,
      handRank: HandEvaluator.rankName(w.score.rank),
      amount: share,
      holeCards: w.player.holeCards
    }));

    this.phase = 'showdown';
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
  }

  _endRound(activePlayers) {
    this._clearThinkTimer();
    const winner = activePlayers[0];
    winner.chips += this.pot;
    this.lastWinners = [{ id: winner.id, name: winner.name, handRank: '其他人弃牌', amount: this.pot }];
    this.phase = 'showdown';
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
  }

  getRemainingTime() {
    if (!this.totalGameTime || !this.gameStartTime) return null;
    return Math.max(0, this.totalGameTime - (Date.now() - this.gameStartTime));
  }

  getThinkTimeRemaining() {
    if (!this.thinkTimerEnd) return null;
    return Math.max(0, this.thinkTimerEnd - Date.now());
  }

  getState(forPlayerId = null) {
    return {
      phase: this.phase,
      pot: this.pot,
      communityCards: this.communityCards,
      currentPlayerId: this.getCurrentPlayer()?.id,
      currentBet: this.currentBet,
      dealerIndex: this.dealerIndex,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        chips: p.chips,
        bet: p.bet,
        folded: p.folded,
        allIn: p.allIn,
        cardCount: p.holeCards.length,
        holeCards: (p.id === forPlayerId || this.phase === 'showdown') ? p.holeCards : null
      })),
      lastWinners: this.lastWinners || null,
      actionLog: this.actionLog.slice(-10),
      remainingTime: this.getRemainingTime(),
      thinkTimeRemaining: this.getThinkTimeRemaining(),
      thinkTime: this.thinkTime / 1000
    };
  }
}

module.exports = Game;
