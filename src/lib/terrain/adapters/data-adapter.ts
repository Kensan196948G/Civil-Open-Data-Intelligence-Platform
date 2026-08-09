import type { Provenance } from "../domain";

export interface RawArtifact {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly sourceUrl: string;
  readonly fetchedAt: string;
  readonly httpStatus: number;
}

export interface FetchContext {
  readonly requestId: string;
  readonly signal?: AbortSignal;
}

export interface NormalizeContext {
  readonly requestId: string;
}

export interface DataAdapter<TRequest, TNormalized> {
  readonly sourceKey: string;
  validateRequest(input: unknown): TRequest;
  buildRequests(input: TRequest): URL[];
  fetch(input: TRequest, ctx: FetchContext): Promise<RawArtifact[]>;
  normalize(raw: RawArtifact[], ctx: NormalizeContext): Promise<TNormalized>;
  provenance(raw: RawArtifact[]): Provenance[];
}
