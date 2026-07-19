declare module "undici" {
  export class Agent {
    constructor(options?: unknown);
  }

  export function fetch(
    input: string | URL | Request,
    init?: RequestInit & { dispatcher?: Agent },
  ): Promise<Response>;
}
