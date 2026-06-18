/**
 * Formats a coin amount into a compact string representation using K, M, B suffixes.
 * E.g., 1000 -> 1K, 1500 -> 1.5K, 1200000 -> 1.2M, 500 -> 500
 * Appends a gold coin emoji (🪙) to all formatted outputs.
 */
export function formatCoins(amount: number): string {
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);

  let formatted = '';
  if (absAmount >= 1e9) {
    formatted = (absAmount / 1e9).toFixed(2).replace(/\.00$/, '') + 'B';
  } else if (absAmount >= 1e6) {
    formatted = (absAmount / 1e6).toFixed(2).replace(/\.00$/, '') + 'M';
  } else if (absAmount >= 1e3) {
    formatted = (absAmount / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  } else {
    // Keep 2 decimal places if it has fractional parts, otherwise integer
    formatted = absAmount % 1 !== 0 ? absAmount.toFixed(2) : absAmount.toFixed(0);
  }

  const result = isNegative ? `-${formatted}` : formatted;
  return `${result} 🪙`;
}

/**
 * Formats user count into a compact string representation with K, M, B suffixes.
 */
export function formatActiveCount(count: number): string {
  const absCount = Math.abs(count);
  if (absCount >= 1e9) {
    return (absCount / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  } else if (absCount >= 1e6) {
    return (absCount / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  } else if (absCount >= 1e3) {
    return (absCount / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return absCount.toString();
}

