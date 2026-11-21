/**
 * What the Factory needs of a mailbox to fill its Gmail intakes, whatever reads it. Today that is gogcli
 * (`infrastructure/google/gog-mail.source.ts`); another tool would be another adapter of this contract, and nothing
 * in the Factory would change.
 */

/** One message, as the intakes read it. */
export interface MailMessage {
  id: string;
  /** The conversation it belongs to: one item per thread. */
  threadId: string;
  /** When the mailbox received it (ISO). */
  at: string;
  from: string; to: string; cc: string;
  subject: string;
  /** Its text, decoded; may be long. */
  body: string;
  /** Label names, as the mailbox says them (INBOX, IMPORTANT, a label of yours). */
  labels: string[];
  attachments: number;
  /** Where a person opens its thread, if the source knows. */
  url: string | null;
}

/** Whether the mailbox can be read now, and if not, why. */
export interface MailSourceStatus {
  /** The tool that reads it (`gogcli`). */
  provider: string;
  installed: boolean;
  version: string | null;
  /** It can read the mailbox: installed, authorized. */
  connected: boolean;
  /** The account it reads, when known. */
  account: string | null;
  error: string | null;
  setupUrl: string;
}

/** Why a read failed: the tool is missing, not set up, slowed down by the mailbox, or something else. */
export type MailSourceFailure = 'not_installed' | 'not_connected' | 'rate_limited' | 'failed';
export class MailSourceError extends Error {
  constructor(message: string, readonly kind: MailSourceFailure) {
    super(message);
    this.name = 'MailSourceError';
  }
}

export interface MailSourcePort {
  readonly provider: string;
  status(refresh?: boolean): Promise<MailSourceStatus>;
  /**
   * The messages the mailbox's own search finds that came after `since`, oldest first. `query` is in the mailbox's
   * search syntax (Gmail's), empty for everything. Throws `MailSourceError`.
   */
  search(query: string, since: Date): Promise<MailMessage[]>;
}
