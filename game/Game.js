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
    this.sidePots = [];
    this.phase = 'waiting'; // waiting, preflop, flop, turn, river, showdown
    this.currentPlayerIndex = 0;
    this.dealerIndex = 0;
    this.currentBet = 0;
    this.smallBlind = options.smallBlind || 10;
    this.bigBlind = options.bigBlind || 20;
    this.startingChips = options.startingChips || 1000;
    this.lastRaiseIndex = -1;
    this.actionLog = [];
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

  canStart() {
    return this.players.length >= 2 && this.phase === 'waiting';
  }

  startRound() {
    if (this.players.length < 2) return false;
    this.deck.reset();
    this.communityCards = [];
    this.pot = 0;
    this.sidePots = [];
    this.currentBet = 0;
    this.actionLog = [];
    this.players.forEach(p => p.reset());

    // 移除筹码为0的玩家
    this.players = this.players.filter(p => p.chips > 0);
    if (this.players.length < 2) return false;

    // 发手牌
    for (const player of this.players) {
      player.holeCards = this.deck.deal(2);
    }

    // 确定盲注位置
    const n = this.players.length;
    this.dealerIndex = this.dealerIndex % n;
    const sbIndex = (this.dealerIndex + 1) % n;
    const bbIndex = (this.dealerIndex + 2) % n;

    // 收盲注
    this._collectBet(sbIndex, this.smallBlind);
    this._collectBet(bbIndex, this.bigBlind);
    this.currentBet = this.bigBlind;

    // preflop 从大盲下一位开始
    this.currentPlayerIndex = (bbIndex + 1) % n;
    this.lastRaiseIndex = bbIndex;
    this.phase = 'preflop';
    return true;
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

  processAction(playerId, action, amount = 0) {
    const player = this.getCurrentPlayer();
    if (!player || player.id !== playerId) return { error: '不是你的回合' };
    if (player.folded || player.allIn) return { error: '无效操作' };

    const callAmount = this.currentBet - player.bet;

    switch (action) {
      case 'fold':
        player.folded = true;
        this.actionLog.push(`${player.name} 弃牌`);
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
          // all-in
          const actual = this._collectBet(this.currentPlayerIndex, player.chips);
          if (raiseTotal > this.currentBet) {
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

    // 检查是否只剩一人
    const active = this.getActivePlayers();
    if (active.length === 1) {
      return this._endRound(active);
    }

    // 移动到下一个玩家
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

    // 检查本轮下注是否结束
    if (this._isBettingRoundOver(next)) {
      this._advancePhase();
    } else {
      this.currentPlayerIndex = next;
    }
  }

  _isBettingRoundOver(nextIndex) {
    const active = this.getActiveNonAllIn();
    if (active.length === 0) return true;
    // 所有未弃牌且未all-in的玩家都已下注相同金额
    const allCalled = active.every(p => p.bet === this.currentBet);
    // 且已经绕了一圈（回到了最后加注者的下一位）
    return allCalled && nextIndex === (this.lastRaiseIndex + 1) % this.players.length;
  }

  _advancePhase() {
    // 重置每轮下注
    this.players.forEach(p => { p.bet = 0; });
    this.currentBet = 0;

    const active = this.getActivePlayers();
    if (active.length === 1) {
      this._endRound(active);
      return;
    }

    const n = this.players.length;
    // 下注从庄家左边第一个未弃牌玩家开始
    let startIndex = (this.dealerIndex + 1) % n;
    while (this.players[startIndex].folded || this.players[startIndex].allIn) {
      startIndex = (startIndex + 1) % n;
      if (startIndex === this.dealerIndex) break;
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
        break;
    }

    // 如果所有人都all-in，直接发完公共牌
    if (this.getActiveNonAllIn().length === 0 && this.phase !== 'showdown') {
      this._advancePhase();
    }
  }

  _showdown() {
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
      amount: share
    }));

    this.phase = 'showdown';
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
  }

  _endRound(activePlayers) {
    const winner = activePlayers[0];
    winner.chips += this.pot;
    this.lastWinners = [{ id: winner.id, name: winner.name, handRank: '其他人弃牌', amount: this.pot }];
    this.phase = 'showdown';
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
    return { success: true };
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
        holeCards: p.id === forPlayerId ? p.holeCards : null
      })),
      lastWinners: this.lastWinners || null,
      actionLog: this.actionLog.slice(-10)
    };
  }
}

module.exports = Game;
