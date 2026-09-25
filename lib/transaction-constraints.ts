const TOKEN_SCALE = 1_000_000;

export function tokenAmountIssue(input: string, available: number | null, symbol: string): string | null {
  const formatIssue = amountFormatIssue(input);
  if (formatIssue) return formatIssue;
  const amount = Number(input.trim());
  if (available === null) return "Checking your wallet balance…";
  const units = Math.round(amount * TOKEN_SCALE);
  const availableUnits = Math.round(available * TOKEN_SCALE);
  if (units > availableUnits) {
    const display = available.toLocaleString("en-US", { maximumFractionDigits: 6 });
    return `Not enough ${symbol}. Available: ${display} ${symbol}.`;
  }
  return null;
}

export function amountFormatIssue(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return "Enter an amount.";
  if (!/^\d+(?:\.\d{1,6})?$/.test(trimmed)) return "Use a positive amount with up to six decimal places.";
  const amount = Number(trimmed);
  const units = Math.round(amount * TOKEN_SCALE);
  if (!Number.isSafeInteger(units) || units <= 0) return "Enter an amount of at least 0.000001.";
  return null;
}

export function slippageIssue(input: string): string | null {
  const trimmed = input.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return "Enter slippage with up to two decimal places.";
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value >= 100) return "Slippage must be below 100%.";
  return null;
}

export function maxTokenAmount(balance: number): string {
  const units = Math.max(0, Math.floor(balance * TOKEN_SCALE + 0.00001));
  return (units / TOKEN_SCALE).toFixed(6).replace(/\.?0+$/, "");
}
