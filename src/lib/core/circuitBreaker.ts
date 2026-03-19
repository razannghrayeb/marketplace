/**
 * Circuit Breaker Pattern for External API Resilience
 * 
 * Implements the circuit breaker pattern to prevent cascading failures
 * when external services (Vertex AI, Gemini, OpenSearch) are unavailable.
 */

// ============================================================================
// Types
// ============================================================================

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerConfig {
  name: string;
  failureThreshold: number;     // Number of failures before opening
  resetTimeoutMs: number;       // Time before attempting half-open
  halfOpenMaxCalls: number;     // Max calls in half-open state
  successThreshold: number;     // Successes needed to close from half-open
}

export interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: Date | null;
  lastSuccess: Date | null;
  totalCalls: number;
  totalFailures: number;
}

// ============================================================================
// Default Configurations
// ============================================================================

const DEFAULT_CONFIG: Omit<CircuitBreakerConfig, "name"> = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,      // 30 seconds
  halfOpenMaxCalls: 3,
  successThreshold: 2,
};

export const CIRCUIT_CONFIGS: Record<string, CircuitBreakerConfig> = {
  "vertex-ai": {
    name: "vertex-ai",
    failureThreshold: 3,
    resetTimeoutMs: 60000,      // 1 minute (Vertex AI failures often persist)
    halfOpenMaxCalls: 2,
    successThreshold: 2,
  },
  "gemini": {
    name: "gemini",
    failureThreshold: 5,
    resetTimeoutMs: 30000,
    halfOpenMaxCalls: 3,
    successThreshold: 2,
  },
  "opensearch": {
    name: "opensearch",
    failureThreshold: 5,
    resetTimeoutMs: 10000,      // 10 seconds (local service)
    halfOpenMaxCalls: 5,
    successThreshold: 3,
  },
  "ranker": {
    name: "ranker",
    failureThreshold: 3,
    resetTimeoutMs: 15000,
    halfOpenMaxCalls: 2,
    successThreshold: 2,
  },
};

// ============================================================================
// Circuit Breaker Implementation
// ============================================================================

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime: Date | null = null;
  private lastSuccessTime: Date | null = null;
  private halfOpenCalls: number = 0;
  private totalCalls: number = 0;
  private totalFailures: number = 0;
  
  constructor(private config: CircuitBreakerConfig) {}
  
  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      throw new CircuitOpenError(this.config.name, this.getResetTime());
    }
    
    this.totalCalls++;
    
    if (this.state === "half-open") {
      this.halfOpenCalls++;
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  /**
   * Check if execution is allowed
   */
  canExecute(): boolean {
    switch (this.state) {
      case "closed":
        return true;
        
      case "open":
        // Check if reset timeout has elapsed
        if (this.shouldAttemptReset()) {
          this.transitionToHalfOpen();
          return true;
        }
        return false;
        
      case "half-open":
        return this.halfOpenCalls < this.config.halfOpenMaxCalls;
    }
  }
  
  /**
   * Record a successful call
   */
  private onSuccess(): void {
    this.lastSuccessTime = new Date();
    
    switch (this.state) {
      case "closed":
        this.failures = 0;
        break;
        
      case "half-open":
        this.successes++;
        if (this.successes >= this.config.successThreshold) {
          this.transitionToClosed();
        }
        break;
    }
  }
  
  /**
   * Record a failed call
   */
  private onFailure(): void {
    this.lastFailureTime = new Date();
    this.totalFailures++;
    
    switch (this.state) {
      case "closed":
        this.failures++;
        if (this.failures >= this.config.failureThreshold) {
          this.transitionToOpen();
        }
        break;
        
      case "half-open":
        // Any failure in half-open immediately reopens
        this.transitionToOpen();
        break;
    }
  }
  
  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) return true;
    
    const elapsed = Date.now() - this.lastFailureTime.getTime();
    return elapsed >= this.config.resetTimeoutMs;
  }
  
  private getResetTime(): number {
    if (!this.lastFailureTime) return 0;
    
    const elapsed = Date.now() - this.lastFailureTime.getTime();
    return Math.max(0, this.config.resetTimeoutMs - elapsed);
  }
  
  private transitionToOpen(): void {
    console.warn(`[CircuitBreaker] ${this.config.name}: OPEN (failures: ${this.failures})`);
    this.state = "open";
    this.halfOpenCalls = 0;
    this.successes = 0;
  }
  
  private transitionToHalfOpen(): void {
    console.info(`[CircuitBreaker] ${this.config.name}: HALF-OPEN (attempting recovery)`);
    this.state = "half-open";
    this.halfOpenCalls = 0;
    this.successes = 0;
  }
  
  private transitionToClosed(): void {
    console.info(`[CircuitBreaker] ${this.config.name}: CLOSED (recovered)`);
    this.state = "closed";
    this.failures = 0;
    this.successes = 0;
    this.halfOpenCalls = 0;
  }
  
  /**
   * Get current circuit stats
   */
  getStats(): CircuitStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailureTime,
      lastSuccess: this.lastSuccessTime,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
    };
  }
  
  /**
   * Force reset the circuit (for testing/admin)
   */
  reset(): void {
    this.state = "closed";
    this.failures = 0;
    this.successes = 0;
    this.halfOpenCalls = 0;
  }
}

// ============================================================================
// Circuit Open Error
// ============================================================================

export class CircuitOpenError extends Error {
  constructor(
    public readonly circuitName: string,
    public readonly resetInMs: number
  ) {
    super(`Circuit breaker ${circuitName} is OPEN. Retry in ${Math.ceil(resetInMs / 1000)}s`);
    this.name = "CircuitOpenError";
  }
}

// ============================================================================
// Circuit Breaker Registry
// ============================================================================

const circuits = new Map<string, CircuitBreaker>();

/**
 * Get or create a circuit breaker by name
 */
export function getCircuit(name: string): CircuitBreaker {
  if (!circuits.has(name)) {
    const config = CIRCUIT_CONFIGS[name] ?? { name, ...DEFAULT_CONFIG };
    circuits.set(name, new CircuitBreaker(config));
  }
  return circuits.get(name)!;
}

/**
 * Execute with circuit breaker by name
 */
export async function withCircuitBreaker<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  return getCircuit(name).execute(fn);
}

/**
 * Get all circuit stats (for health endpoint)
 */
export function getAllCircuitStats(): Record<string, CircuitStats> {
  const stats: Record<string, CircuitStats> = {};
  for (const [name, circuit] of circuits) {
    stats[name] = circuit.getStats();
  }
  return stats;
}

/**
 * Check if a specific circuit is healthy (closed or half-open)
 */
export function isCircuitHealthy(name: string): boolean {
  const circuit = circuits.get(name);
  if (!circuit) return true; // Not registered = healthy
  
  const stats = circuit.getStats();
  return stats.state !== "open";
}
