export const MAX_REFRESH_INTERVAL_MINUTES = Math.floor(2_147_483_647 / 60_000);

const DEFAULT_PORT = 3000;
const DEFAULT_REFRESH_INTERVAL_MINUTES = 60;
const MIN_PORT = 1;
const MAX_PORT = 65_535;

export function readPort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new Error("PORT 必须是 1 到 65535 之间的整数");
  }
  return port;
}

export function readRefreshIntervalMinutes(value: string | undefined): number {
  if (value === undefined) return DEFAULT_REFRESH_INTERVAL_MINUTES;
  const interval = Number(value);
  if (
    !Number.isInteger(interval) ||
    interval <= 0 ||
    interval > MAX_REFRESH_INTERVAL_MINUTES
  ) {
    throw new Error(
      `REFRESH_INTERVAL_MINUTES 必须大于 0 且不超过 ${MAX_REFRESH_INTERVAL_MINUTES}`,
    );
  }
  return interval;
}
