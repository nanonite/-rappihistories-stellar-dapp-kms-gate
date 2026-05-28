const DEFAULT_MAX_REQUESTS_PER_WINDOW = 10;
const DEFAULT_WINDOW_SECONDS = 60;

export interface RequesterRateLimiterOptions {
  readonly maxRequestsPerWindow?: number;
  readonly windowSeconds?: number;
}

interface RequestWindow {
  readonly windowStartedAt: number;
  requestCount: number;
}

export class RequesterRateLimiter {
  private readonly maxRequestsPerWindow: number;
  private readonly windowSeconds: number;
  private readonly windowsByRequester = new Map<string, RequestWindow>();

  constructor(options: RequesterRateLimiterOptions = {}) {
    this.maxRequestsPerWindow =
      options.maxRequestsPerWindow ?? DEFAULT_MAX_REQUESTS_PER_WINDOW;
    this.windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  }

  tryConsume(requester: string, nowSeconds: number): boolean {
    const currentWindow = this.windowsByRequester.get(requester);

    if (
      currentWindow === undefined ||
      nowSeconds - currentWindow.windowStartedAt >= this.windowSeconds
    ) {
      this.windowsByRequester.set(requester, {
        windowStartedAt: nowSeconds,
        requestCount: 1,
      });
      return true;
    }

    if (currentWindow.requestCount >= this.maxRequestsPerWindow) {
      return false;
    }

    currentWindow.requestCount += 1;
    return true;
  }
}
