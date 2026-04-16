class Player {
  constructor(id, name, chips = 1000) {
    this.id = id;
    this.name = name;
    this.chips = chips;
    this.holeCards = [];
    this.bet = 0;
    this.totalBet = 0;
    this.folded = false;
    this.allIn = false;
    this.isReady = false;
  }

  reset() {
    this.holeCards = [];
    this.bet = 0;
    this.totalBet = 0;
    this.folded = false;
    this.allIn = false;
  }

  placeBet(amount) {
    const actual = Math.min(amount, this.chips);
    this.chips -= actual;
    this.bet += actual;
    this.totalBet += actual;
    if (this.chips === 0) this.allIn = true;
    return actual;
  }
}

module.exports = Player;
