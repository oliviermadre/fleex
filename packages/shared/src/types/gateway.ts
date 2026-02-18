export interface Gateway {
  readonly id: string;
  readonly name: string;
  readonly hostname: string | null;
  readonly status: 'online' | 'offline';
  readonly lastSeenAt: string | null;
  readonly createdAt: string;
}

export interface GatewayRegisterRequest {
  readonly id: string;
  readonly name: string;
  readonly hostname?: string;
  readonly secret: string;
}

export interface GatewayHeartbeatRequest {
  readonly id: string;
  readonly secret: string;
}
