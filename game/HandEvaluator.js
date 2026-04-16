class HandEvaluator {
  // 从7张牌中找出最优5张并返回牌型等级
  static evaluate(cards) {
    const combos = this.getCombinations(cards, 5);
    let best = null;
    for (const combo of combos) {
      const score = this.scoreHand(combo);
      if (!best || this.compare(score, best) > 0) best = score;
    }
    return best;
  }

  static getCombinations(arr, k) {
    if (k === 0) return [[]];
    if (arr.length === k) return [arr];
    const [first, ...rest] = arr;
    const withFirst = this.getCombinations(rest, k - 1).map(c => [first, ...c]);
    const withoutFirst = this.getCombinations(rest, k);
    return [...withFirst, ...withoutFirst];
  }

  static scoreHand(cards) {
    const values = cards.map(c => c.value).sort((a, b) => b - a);
    const suits = cards.map(c => c.suit);
    const isFlush = suits.every(s => s === suits[0]);
    const isStraight = this.checkStraight(values);
    const counts = {};
    for (const v of values) counts[v] = (counts[v] || 0) + 1;
    const groups = Object.entries(counts).sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const groupCounts = groups.map(g => g[1]);
    const groupVals = groups.map(g => parseInt(g[0]));

    if (isFlush && isStraight && values[0] === 14 && values[4] === 10)
      return { rank: 9, tiebreak: [14] };
    if (isFlush && isStraight)
      return { rank: 8, tiebreak: [isStraight] };
    if (groupCounts[0] === 4)
      return { rank: 7, tiebreak: groupVals };
    if (groupCounts[0] === 3 && groupCounts[1] === 2)
      return { rank: 6, tiebreak: groupVals };
    if (isFlush)
      return { rank: 5, tiebreak: values };
    if (isStraight)
      return { rank: 4, tiebreak: [isStraight] };
    if (groupCounts[0] === 3)
      return { rank: 3, tiebreak: groupVals };
    if (groupCounts[0] === 2 && groupCounts[1] === 2)
      return { rank: 2, tiebreak: groupVals };
    if (groupCounts[0] === 2)
      return { rank: 1, tiebreak: groupVals };
    return { rank: 0, tiebreak: values };
  }

  static checkStraight(sortedValues) {
    // 处理 A-2-3-4-5 低顺
    const vals = sortedValues[0] === 14
      ? [...sortedValues, 1]
      : sortedValues;
    for (let i = 0; i <= vals.length - 5; i++) {
      const slice = vals.slice(i, i + 5);
      if (slice[0] - slice[4] === 4 && new Set(slice).size === 5)
        return slice[0];
    }
    return 0;
  }

  static compare(a, b) {
    if (a.rank !== b.rank) return a.rank - b.rank;
    for (let i = 0; i < Math.max(a.tiebreak.length, b.tiebreak.length); i++) {
      const diff = (a.tiebreak[i] || 0) - (b.tiebreak[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }

  static rankName(rank) {
    return ['高牌','一对','两对','三条','顺子','同花','葫芦','四条','同花顺','皇家同花顺'][rank];
  }
}

module.exports = HandEvaluator;
