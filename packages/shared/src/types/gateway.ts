export interface Gateway {
  readonly id: string;
  readonly name: string;
  readonly hostname: string | null;
  readonly publicKey: string | null;  // Ed25519 public key (hex)
  readonly status: 'online' | 'offline';
  readonly lastSeenAt: string | null;
  readonly createdAt: string;
}

export interface GatewayRegisterRequest {
  readonly name: string;
  readonly hostname?: string;
  readonly publicKey: string;  // Ed25519 public key (hex)
}

export interface GatewayRegisterResponse {
  readonly id: string;
  readonly name: string;
  readonly serverUrl: string;
}