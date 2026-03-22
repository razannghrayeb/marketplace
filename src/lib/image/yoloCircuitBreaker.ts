/**
 * Simple circuit breaker for YOLO HTTP calls (closed → open → half-open).
 * When open, callers fail fast so shop-the-look can fall back without stalling.
 */

export type CircuitState = "closed" | "open" | "half_open";

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function yoloCircuitFailureThreshold(): number {
  return envInt("YOLO_CB_FAILURE_THRESHOLD", 3, 1, 20);
}

export function yoloCircuitOpenMs(): number {
  return envInt("YOLO_CB_OPEN_MS", 30_000, 1_000, 300_000);
}

export class YoloCircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private openedAt = 0;
  private halfOpenProbe = false;

  getState(): CircuitState {
    return this.state;
  }

  /** Call before attempting a YOLO request. Throws if circuit is open (fail-fast). */
  beforeRequest(): void {
    const now = Date.now();
    if (this.state === "open") {
      if (now - this.openedAt >= yoloCircuitOpenMs()) {
        this.state = "half_open";
        this.halfOpenProbe = false;
      } else {
        throw new YoloCircuitOpenError(
          `YOLO circuit open; retry after ${Math.ceil((yoloCircuitOpenMs() - (now - this.openedAt)) / 1000)}s`,
        );
      }
    }
    if (this.state === "half_open") {
      if (this.halfOpenProbe) {
        throw new YoloCircuitOpenError("YOLO circuit half-open: probe already in flight");
      }
      this.halfOpenProbe = true;
    }
  }

  onSuccess(): void {
    this.failures = 0;
    if (this.state === "half_open") {
      this.halfOpenProbe = false;
    }
    this.state = "closed";
  }

  onFailure(): void {
    if (this.state === "half_open") {
      this.halfOpenProbe = false;
      this.state = "open";
      this.openedAt = Date.now();
      this.failures = yoloCircuitFailureThreshold();
      return;
    }
    this.failures += 1;
    if (this.failures >= yoloCircuitFailureThreshold()) {
      this.state = "open";
      this.openedAt = Date.now();
      console.warn(
        `[YOLOv8] circuit OPEN after ${this.failures} failures (will fail fast for ${yoloCircuitOpenMs()}ms)`,
      );
    }
  }
}

export class YoloCircuitOpenError extends Error {
  readonly code = "YOLO_CIRCUIT_OPEN";
  constructor(message: string) {
    super(message);
    this.name = "YoloCircuitOpenError";
  }
}

export function isYoloCircuitOpenError(e: unknown): boolean {
  return e instanceof YoloCircuitOpenError;
}
