import { createHash } from "node:crypto";
import { ImapFlow, type FetchMessageObject, type ImapFlowOptions } from "imapflow";
import { simpleParser } from "mailparser";
import type { SourceItemInput } from "@/lib/db/finance-db";
import { readIcloudCredentials, type MailAccount } from "@/lib/mail-accounts";

const imapHost = "imap.mail.me.com";
const imapPort = 993;
const inbox = "INBOX";
const maxMessages = 250;
const maxSourceBytes = 256 * 1024;
const defaultTimeoutMs = 30_000;
const maxSummaryCharacters = 2_000;
const relevantMailPattern = /\b(receipt|order|invoice|purchase|payment|charged|booking|reservation)\b/iu;

interface ParsedIcloudMessage {
  date?: Date;
  from?: { address?: string; name?: string };
  subject?: string;
  text?: string;
}

export interface IcloudImapClient {
  close(): void;
  connect(): Promise<void>;
  fetchAll(
    range: string,
    query: { envelope: true; internalDate: true; uid: true }
  ): Promise<Array<Pick<FetchMessageObject, "seq" | "uid">>>;
  fetchOne(
    uid: number,
    query: {
      envelope: true;
      internalDate: true;
      source: { maxLength: number; start: number };
      uid: true;
    },
    options: { uid: true }
  ): Promise<FetchMessageObject | false | undefined>;
  logout(): Promise<void>;
  mailboxOpen(path: string, options: { readOnly: true }): Promise<{ exists: number; uidValidity: bigint }>;
  on(event: "error", listener: (error: Error) => void): unknown;
}

interface IcloudSourceOptions {
  createClient?: (options: ImapFlowOptions) => IcloudImapClient;
  parseMessage?: (source: Buffer) => Promise<ParsedIcloudMessage>;
  readCredentials?: (accountId: string) => Promise<{ appPassword: string; email: string }>;
  maxMessages?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class IcloudSourceError extends Error {
  constructor(
    message: string,
    readonly code: "authentication" | "cancelled" | "configuration" | "connection" | "timeout"
  ) {
    super(message);
    this.name = "IcloudSourceError";
  }
}

export async function fetchIcloudSourceItems(
  account: MailAccount,
  options: IcloudSourceOptions = {}
): Promise<{ hasMore: boolean; items: SourceItemInput[]; partial?: boolean }> {
  if (account.provider !== "icloud") {
    throw new IcloudSourceError("The selected mail profile is not an iCloud account.", "configuration");
  }

  const readCredentials = options.readCredentials ?? readIcloudCredentials;
  const credentials = await readCredentials(account.id);
  const createClient: (config: ImapFlowOptions) => IcloudImapClient =
    options.createClient ?? ((config) => new ImapFlow(config));
  const client: IcloudImapClient = createClient({
    auth: { pass: credentials.appPassword, user: credentials.email },
    connectionTimeout: options.timeoutMs ?? defaultTimeoutMs,
    disableAutoIdle: true,
    greetingTimeout: options.timeoutMs ?? defaultTimeoutMs,
    host: imapHost,
    logger: false,
    port: imapPort,
    secure: true,
    socketTimeout: options.timeoutMs ?? defaultTimeoutMs,
    tls: { rejectUnauthorized: true }
  });
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  let timedOut = false;
  let completed = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const messageLimit = Math.min(Math.max(Math.trunc(options.maxMessages ?? maxMessages), 1), maxMessages);
  let rejectClientFailure: (error: Error) => void = () => undefined;
  const clientFailure = new Promise<never>((_resolve, reject) => {
    rejectClientFailure = reject;
  });
  void clientFailure.catch(() => undefined);
  client.on("error", (error) => {
    client.close();
    rejectClientFailure(error);
  });
  let rejectCancellation: (error: IcloudSourceError) => void = () => undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  void cancellation.catch(() => undefined);
  const abort = () => {
    client.close();
    rejectCancellation(new IcloudSourceError("iCloud Mail refresh was cancelled.", "cancelled"));
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const operation = options.signal?.aborted
    ? cancellation
    : fetchFromInbox(client, account, messageLimit, options.parseMessage ?? parseMessage);
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      client.close();
      reject(new IcloudSourceError("iCloud Mail refresh timed out.", "timeout"));
    }, timeoutMs);
    timeout.unref?.();
  });

  try {
    const result = await Promise.race([operation, deadline, clientFailure, cancellation]);
    completed = true;
    return result;
  } catch (error) {
    throw sanitizeIcloudError(error, timedOut);
  } finally {
    if (timeout) clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
    if (completed) {
      await closeGracefully(client);
    } else {
      client.close();
      void operation.catch(() => undefined);
    }
  }
}

async function closeGracefully(client: IcloudImapClient): Promise<void> {
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.logout(),
      new Promise<void>((resolve) => {
        closeTimer = setTimeout(() => {
          client.close();
          resolve();
        }, 1_000);
        closeTimer.unref?.();
      })
    ]);
  } catch {
    client.close();
  } finally {
    if (closeTimer) clearTimeout(closeTimer);
  }
}

async function fetchFromInbox(
  client: IcloudImapClient,
  account: MailAccount,
  messageLimit: number,
  parseMessage: (source: Buffer) => Promise<ParsedIcloudMessage>
): Promise<{ hasMore: boolean; items: SourceItemInput[]; partial?: boolean }> {
  await client.connect();
  const mailbox = await client.mailboxOpen(inbox, { readOnly: true });
  if (mailbox.exists === 0) {
    return { hasMore: false, items: [] };
  }

  const firstSequence = Math.max(1, mailbox.exists - messageLimit + 1);
  const messages = await client.fetchAll(`${firstSequence}:*`, {
    envelope: true,
    internalDate: true,
    uid: true
  });
  messages.sort((left, right) => right.seq - left.seq);
  const items: SourceItemInput[] = [];
  let partial = false;

  for (const message of messages.slice(0, messageLimit)) {
    const fetched = await client.fetchOne(message.uid, {
      envelope: true,
      internalDate: true,
      source: { maxLength: maxSourceBytes, start: 0 },
      uid: true
    }, { uid: true });
    if (!fetched || !fetched.source) {
      partial = true;
      continue;
    }

    let parsed: ParsedIcloudMessage;
    try {
      parsed = await parseMessage(fetched.source);
    } catch {
      partial = true;
      continue;
    }
    const title = cleanText(parsed.subject) || cleanText(fetched.envelope?.subject) || "iCloud Mail message";
    const summary = truncate(cleanText(parsed.text), maxSummaryCharacters);
    if (!relevantMailPattern.test(`${title}\n${summary}`)) continue;
    const occurredAt = validDate(parsed.date) ?? validDate(fetched.internalDate) ?? validDate(fetched.envelope?.date);
    const externalId = `${mailbox.uidValidity.toString()}:${message.uid}`;
    const senderName = cleanText(parsed.from?.name);
    const senderAddress = cleanText(parsed.from?.address);

    items.push({
      externalId,
      id: stableSourceItemId(account.id, externalId),
      kind: "email",
      ...(occurredAt ? { occurredAt: occurredAt.toISOString() } : {}),
      ...(senderName || senderAddress ? { merchantName: senderName || merchantFromAddress(senderAddress) } : {}),
      metadata: {
        body_truncated: fetched.source.length >= maxSourceBytes,
        mailbox: inbox,
        sender_address: senderAddress || undefined,
        uid: message.uid,
        uid_validity: mailbox.uidValidity.toString()
      },
      sourceId: account.id,
      summary,
      title
    });
  }

  return {
    hasMore: mailbox.exists > Math.min(messages.length, messageLimit),
    items,
    ...(partial ? { partial: true } : {})
  };
}

async function parseMessage(source: Buffer): Promise<ParsedIcloudMessage> {
  const parsed = await simpleParser(source, {
    maxHtmlLengthToParse: maxSourceBytes,
    skipImageLinks: true,
    skipTextToHtml: true
  });
  const sender = parsed.from?.value[0];
  return {
    date: parsed.date,
    from: sender && "address" in sender
      ? { address: sender.address, name: sender.name }
      : undefined,
    subject: parsed.subject,
    text: parsed.text
  };
}

function sanitizeIcloudError(error: unknown, timedOut: boolean): IcloudSourceError {
  if (error instanceof IcloudSourceError) return error;
  if (timedOut) return new IcloudSourceError("iCloud Mail refresh timed out.", "timeout");
  const message = error instanceof Error ? error.message : "";
  if (/auth|authentication|credentials|login|password/iu.test(message)) {
    return new IcloudSourceError(
      "iCloud Mail authentication failed. Check the email address and app-specific password.",
      "authentication"
    );
  }
  return new IcloudSourceError("Unable to read iCloud Mail over a secure IMAP connection.", "connection");
}

function cleanText(value: string | undefined): string {
  return (value ?? "").replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}…`;
}

function validDate(value: Date | string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function merchantFromAddress(address: string): string {
  const local = address.split("@", 1)[0] ?? address;
  return local.replace(/[._+-]+/gu, " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function stableSourceItemId(sourceId: string, externalId: string): string {
  return `src_item_${createHash("sha256").update(`${sourceId}:${externalId}`).digest("hex").slice(0, 24)}`;
}
