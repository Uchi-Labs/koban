// @vitest-environment node

import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getMailAccount,
  getMailAccountSecret,
  listMailAccounts,
  listMailAccountsSync,
  outlookConfigPath,
  readIcloudCredentials,
  saveMailAccount
} from "@/lib/mail-accounts";

let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(path.join(os.tmpdir(), "koban-mail-accounts-"));
});

afterEach(async () => {
  await rm(homeDir, { force: true, recursive: true });
});

describe("mail account registry", () => {
  it("persists stable provider-scoped public accounts without secrets", async () => {
    const saved = await saveMailAccount({
      appPassword: "fixture-app-password",
      email: "Person@icloud.com",
      label: "Personal iCloud",
      profile: "personal",
      provider: "icloud"
    }, { homeDir });

    expect(saved).toEqual({
      email: "person@icloud.com",
      id: "source_icloud_mail__personal",
      label: "Personal iCloud",
      profile: "personal",
      provider: "icloud"
    });
    expect(JSON.stringify(await listMailAccounts({ homeDir }))).not.toContain("fixture-app-password");
    expect(JSON.stringify(listMailAccountsSync({ homeDir }))).not.toContain("fixture-app-password");
    await expect(readIcloudCredentials(saved.id, { homeDir })).resolves.toEqual({
      appPassword: "fixture-app-password",
      email: "person@icloud.com"
    });
    await expect(getMailAccountSecret(saved.id, { homeDir })).resolves.toEqual({ appPassword: "fixture-app-password" });

    const file = path.join(homeDir, ".config", "koban", "mail-accounts.json");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("serializes concurrent saves without losing accounts", async () => {
    await Promise.all([
      saveMailAccount({ email: "one@gmail.com", profile: "work", provider: "gmail" }, { homeDir }),
      saveMailAccount({ email: "two@outlook.com", profile: "work", provider: "outlook" }, { homeDir })
    ]);

    expect((await listMailAccounts({ homeDir })).map(({ id }) => id)).toEqual([
      "source_gmail__work",
      "source_outlook_email__work"
    ]);
  });

  it("keeps identity immutable while allowing label and iCloud secret rotation", async () => {
    await saveMailAccount({ appPassword: "old-secret", email: "me@icloud.com", profile: "main", provider: "icloud" }, { homeDir });
    await saveMailAccount({ appPassword: "new-secret", email: "me@icloud.com", label: "Updated", profile: "main", provider: "icloud" }, { homeDir });
    await expect(getMailAccount("source_icloud_mail__main", { homeDir })).resolves.toMatchObject({ label: "Updated" });
    await expect(readIcloudCredentials("source_icloud_mail__main", { homeDir })).resolves.toMatchObject({ appPassword: "new-secret" });
    await saveMailAccount({ appPassword: "rotated-secret", email: "me@icloud.com", profile: "main", provider: "icloud" }, { homeDir });
    await expect(getMailAccount("source_icloud_mail__main", { homeDir })).resolves.toMatchObject({ label: "Updated" });

    await expect(saveMailAccount({ email: "other@icloud.com", profile: "main", provider: "icloud" }, { homeDir }))
      .rejects.toMatchObject({ code: "conflict" });
  });

  it("fails closed on corrupt registries", async () => {
    const directory = path.join(homeDir, ".config", "koban");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(directory, { recursive: true }));
    await writeFile(path.join(directory, "mail-accounts.json"), "{broken", { mode: 0o600 });
    await expect(listMailAccounts({ homeDir })).rejects.toMatchObject({ code: "storage" });
  });

  it("fails closed when registry permissions expose credentials", async () => {
    await saveMailAccount({ email: "person@gmail.com", profile: "main", provider: "gmail" }, { homeDir });
    const file = path.join(homeDir, ".config", "koban", "mail-accounts.json");
    await chmod(file, 0o644);
    await expect(listMailAccounts({ homeDir })).rejects.toThrow("permissions are unsafe");
    expect(() => listMailAccountsSync({ homeDir })).toThrow("permissions are unsafe");
  });

  it("provides a safe local Outlook profile path", () => {
    expect(outlookConfigPath("work", { homeDir })).toBe(
      path.join(homeDir, ".config", "koban", "mail-profiles", "outlook", "work.json")
    );
    expect(() => outlookConfigPath("../escape", { homeDir })).toThrow("safe slug");
  });
});
