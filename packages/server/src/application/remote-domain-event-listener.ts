import type { EventBus } from './event-bus.js';
import type { BroadcastRegistrar } from './broadcast-registrar.js';

/**
 * Remote listener — reacts to domain events received from the hub (i.e.
 * emitted by OTHER server instances).
 *
 * Only registers UI broadcasts. Never registers side-effects (auto-trigger
 * agents, auto-review workflow, etc.) — those run exclusively on the
 * originator server via DomainEventListener. This is the core property that
 * prevents duplicate execution in multi-instance deployments.
 *
 * The BroadcastRegistrar passed in MUST be the same instance used by the
 * local listener, so that both local and remote events push to the same
 * WS clients via the same broadcast funcs.
 */
export class RemoteDomainEventListener {
  constructor(
    private readonly remoteEventBus: EventBus,
    private readonly broadcastRegistrar: BroadcastRegistrar,
  ) {}

  register(): void {
    this.broadcastRegistrar.register(this.remoteEventBus);
  }
}
