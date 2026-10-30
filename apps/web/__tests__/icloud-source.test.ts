// @vitest-environment node

import type { ImapFlowOptions } from "imapflow";
import { describe, expect, it, vi } from "vitest";
import {
  fetchIcloudSourceItems,
  type IcloudImapClient
} from "@/lib/icloud-source";
import type { MailAccount } from "@/lib/mail-accounts";

describe("iCloud read-only mail source", () => {
  it("uses fixed TLS and read-only INBOX settings with a bounded newest-message window", async () => {
    const configs: ImapFlowOptions[] = [];
    const client = fakeClient({ exists: 500, uidValidity: 99n });

    const result = await fetchIcloudSourceItems(account("primary"), {
      createClient: (config) => {
        configs.push(config);
        return client;
      },
      parseMessage: async () => ({
        date: new Date("2026-09-01T12:00:00.000Z"),
        from: { address: "store@example.com", name: "Example Store" },
        subject: "Your receipt",
        text: "Thanks for your purchase. Total $12.34."
      }),
      maxMessages: 250,
      readCredentials: async () => ({ appPassword: "test-app-password", email: "user@icloud.com" })
    });

    expect(configs).toEqual([expect.objectContaining({
      auth: { pass: "test-app-password", user: "user@icloud.com" },
      disableAutoIdle: true,
      host: "imap.mail.me.com",
      logger: false,
      port: 993,
      secure: true,
      tls: expect.objectContaining({ rejectUnauthorized: true })
    })]);
    expect(client.mailboxOpen).toHaveBeenCalledWith("INBOX", { readOnly: true });
    expect(client.fetchAll).toHaveBeenCalledWith("251:*", { envelope: true, internalDate: true, uid: true });
    expect(client.fetchOne).toHaveBeenCalledWith(500, {
      envelope: true,
      internalDate: true,
      source: { maxLength: 256 * 1024, start: 0 },
      uid: true
    }, { uid: true });
    expect(client.logout).toHaveBeenCalledOnce();
    expect(result.hasMore).toBe(true);
    expect(result.items[0]).toMatchObject({
      externalId: "99:500",
      kind: "email",
      merchantName: "Example Store",
      sourceId: "source_icloud_mail__primary",
      title: "Your receipt"
    });
    expect(result.items[0]?.metadata).toMatchObject({ body_truncated: false });
    expect(result.items[0]?.metadata).not.toHaveProperty("headers");
    expect(result.items[0]?.metadata).not.toHaveProperty("attachments");
  });

  it("reports a partial read when a bounded message cannot be parsed", async () => {
    const result = await fetchIcloudSourceItems(account("malformed"), {
      createClient: () => fakeClient(),
      parseMessage: async () => { throw new Error("malformed MIME with secret details"); },
      readCredentials: async () => ({ appPassword: "test", email: "malformed@icloud.com" })
    });

    expect(result).toEqual({ hasMore: false, items: [], partial: true });
  });

  it("closes the socket when the caller cancels verification", async () => {
    const controller = new AbortController();
    const client = fakeClient({ connect: new Promise<void>(() => {}) });
    const run = fetchIcloudSourceItems(account("cancelled"), {
      createClient: () => client,
      readCredentials: async () => ({ appPassword: "test", email: "cancelled@icloud.com" }),
      signal: controller.signal
    });
    const rejection = expect(run).rejects.toMatchObject({ code: "cancelled" });

    controller.abort();
    await rejection;
    expect(client.close).toHaveBeenCalled();
  });

  it("keeps identical mailbox UIDs distinct and stable across accounts", async () => {
    const first = await fetchOneAccount(account("first"), 77n, 42);
    const second = await fetchOneAccount(account("second"), 77n, 42);
    const firstAgain = await fetchOneAccount(account("first"), 77n, 42);

    expect(first.items[0]?.externalId).toBe("77:42");
    expect(second.items[0]?.externalId).toBe("77:42");
    expect(first.items[0]?.sourceId).not.toBe(second.items[0]?.sourceId);
    expect(first.items[0]?.id).not.toBe(second.items[0]?.id);
    expect(first.items[0]?.id).toBe(firstAgain.items[0]?.id);
  });

  it("honors a smaller caller limit without inspecting older messages", async () => {
    const client = fakeClient({ exists: 10, uid: 10 });

    await fetchIcloudSourceItems(account("verify"), {
      createClient: () => client,
      maxMessages: 1,
      parseMessage: async () => ({ subject: "Receipt", text: "Receipt body" }),
      readCredentials: async () => ({ appPassword: "test", email: "verify@icloud.com" })
    });

    expect(client.fetchAll).toHaveBeenCalledWith("10:*", { envelope: true, internalDate: true, uid: true });
    expect(client.fetchOne).toHaveBeenCalledOnce();
  });

  it("closes the socket and returns a sanitized timeout error", async () => {
    vi.useFakeTimers();
    const client = fakeClient({ connect: new Promise<void>(() => {}) });
    const run = fetchIcloudSourceItems(account("slow"), {
      createClient: () => client,
      readCredentials: async () => ({ appPassword: "secret-that-must-not-leak", email: "user@icloud.com" }),
      timeoutMs: 25
    });
    const rejection = expect(run).rejects.toMatchObject({
      code: "timeout",
      message: "iCloud Mail refresh timed out."
    });

    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(client.close).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("sanitizes authentication failures and closes the client", async () => {
    const client = fakeClient({ connectError: new Error("AUTHENTICATIONFAILED secret-value") });

    await expect(fetchIcloudSourceItems(account("bad-auth"), {
      createClient: () => client,
      readCredentials: async () => ({ appPassword: "secret-value", email: "user@icloud.com" })
    })).rejects.toMatchObject({
      code: "authentication",
      message: "iCloud Mail authentication failed. Check the email address and app-specific password."
    });
    expect(client.close).toHaveBeenCalled();
  });

  it("sanitizes asynchronous TLS errors emitted outside awaited IMAP calls", async () => {
    const client = fakeClient({
      connect: new Promise<void>(() => {}),
      eventError: new Error("certificate failure with private server detail")
    });

    await expect(fetchIcloudSourceItems(account("tls"), {
      createClient: () => client,
      readCredentials: async () => ({ appPassword: "secret", email: "tls@icloud.com" })
    })).rejects.toMatchObject({
      code: "connection",
      message: "Unable to read iCloud Mail over a secure IMAP connection."
    });
    expect(client.close).toHaveBeenCalled();
  });
});

async function fetchOneAccount(mailAccount: MailAccount, uidValidity: bigint, uid: number) {
  return fetchIcloudSourceItems(mailAccount, {
    createClient: () => fakeClient({ exists: 1, uid, uidValidity }),
    parseMessage: async () => ({
      date: new Date("2026-09-01T12:00:00.000Z"),
      from: { address: "orders@example.com", name: "Example" },
      subject: "Order receipt",
      text: "Order confirmation"
    }),
    readCredentials: async () => ({ appPassword: "test", email: mailAccount.email })
  });
}

function account(profile: string): MailAccount {
  return {
    email: `${profile}@icloud.com`,
    id: `source_icloud_mail__${profile}`,
    label: profile,
    profile,
    provider: "icloud"
  };
}

function fakeClient({
  connect,
  connectError,
  eventError,
  exists = 1,
  uid = exists,
  uidValidity = 1n
}: {
  connect?: Promise<void>;
  connectError?: Error;
  eventError?: Error;
  exists?: number;
  uid?: number;
  uidValidity?: bigint;
} = {}): IcloudImapClient & Record<string, ReturnType<typeof vi.fn>> {
  return {
    close: vi.fn(),
    connect: vi.fn(async () => {
      if (connectError) throw connectError;
      return connect;
    }),
    fetchAll: vi.fn(async () => [{ seq: exists, uid }]),
    fetchOne: vi.fn(async () => ({
      internalDate: new Date("2026-09-01T12:00:00.000Z"),
      seq: exists,
      source: Buffer.from("Subject: receipt\r\n\r\nReceipt body"),
      uid
    })),
    logout: vi.fn(async () => undefined),
    mailboxOpen: vi.fn(async () => ({ exists, uidValidity })),
    on: vi.fn((_event: "error", listener: (error: Error) => void) => {
      if (eventError) queueMicrotask(() => listener(eventError));
    })
  };
}
