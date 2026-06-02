export const currency = (value: number, compact = true) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
  }).format(value);

export const number = (value: number, digits = 1) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);

export const percent = (value: number, digits = 1) =>
  new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: digits }).format(value);

export const growth = (current: number, previous: number) => {
  if (!previous) return 0;
  return (current - previous) / Math.abs(previous);
};

export const dateTime = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
