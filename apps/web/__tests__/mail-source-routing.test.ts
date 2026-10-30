// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { saveMailAccount } from "@/lib/mail-accounts";
import { allSourceAdapterDefinitions, syncSourceAdapter, invalidateSourceAdapterProbes } from "@/lib/source-adapters";
import { closeFinanceDbForTests, listSourceItems } from "@/lib/db/finance-db";
const oldPath = process.env.PATH;
const oldRegistry = process.env.KOBAN_MAIL_ACCOUNTS_FILE;
let root: string | undefined;
afterEach(async () => {
  await closeFinanceDbForTests();
  invalidateSourceAdapterProbes();
  process.env.PATH = oldPath;
  process.env.KOBAN_MAIL_ACCOUNTS_FILE = oldRegistry;
  delete process.env.AI_FINANCES_PGLITE_DIR;
  if (root) await rm(root, { recursive: true, force: true });
});

describe("named mailbox routing", () => {
  it("keeps identical message IDs separate and always selects the intended Gmail or Outlook account", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "koban-mail-routing-"));
    const bin = path.join(root, "bin");
    const log = path.join(root, "commands.jsonl");
    await mkdir(bin);
    process.env.KOBAN_MAIL_ACCOUNTS_FILE = path.join(root, "accounts.json");
    process.env.AI_FINANCES_PGLITE_DIR = path.join(root, "pglite");
    process.env.PATH = `${bin}:${oldPath}`;
    for (const binary of ["gog", "outlook-email-pp-cli"]) {
      const payload = binary === "gog" ? { messages: [{ id: "same-id", internalDate: "1780272000000", snippet: "Receipt for groceries $42.50", payload: { headers: [{ name: "Subject", value: "Receipt" }] } }] }
        : { value: [{ id: "same-id", subject: "Receipt", bodyPreview: "Groceries $42.50", receivedDateTime: "2026-06-01T00:00:00Z" }] };
      const script = `#!/usr/bin/env node\nconst fs=require('node:fs');fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({binary:${JSON.stringify(binary)},args:process.argv.slice(2)})+'\\n');console.log(${JSON.stringify(JSON.stringify(payload))});\n`;
      await writeFile(path.join(bin, binary), script);
      await chmod(path.join(bin, binary), 0o755);
    }
    const accounts = [];
    for (const provider of ["gmail", "outlook"] as const) {
      for (const profile of ["personal", "work"]) accounts.push(await saveMailAccount({ provider, profile, email: `${profile}@example.test` }));
    }
    const ids = new Set<string>();
    for (const account of accounts) {
      const result = await syncSourceAdapter(account.id);
      expect(result.runStatus).toBe("succeeded");
      const items = await listSourceItems({ sourceId: account.id });
      expect(items).toHaveLength(1);
      expect(items[0].sourceId).toBe(account.id);
      ids.add(items[0].id);
    }
    expect(ids.size).toBe(4);
    const icloud = await saveMailAccount({ provider: "icloud", profile: "personal", email: "personal@icloud.com", appPassword: "fixture-password" });
    const icloudDefinition = allSourceAdapterDefinitions().find((definition) => definition.id === icloud.id);
    expect(icloudDefinition?.authCommand).toBe("koban connectors login icloud --profile personal --password-file PATH");
    expect(icloudDefinition?.setupSteps).toContain(icloudDefinition?.authCommand);
    const calls = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { binary: string; args: string[] });
    for (const account of accounts) {
      const usesProfileConfig = (item: { args: string[] }) => item.args.some((arg) => arg.endsWith(`/${account.profile}.json`));
      const call = calls.find((item) => account.provider === "gmail"
        ? item.binary === "gog" && item.args.includes(account.email)
        : item.binary === "outlook-email-pp-cli" && usesProfileConfig(item) && item.args.includes("messages"));
      expect(call).toBeDefined();
      if (account.provider === "gmail") expect(call?.args).toContain("--account");
      else {
        // The hourly Microsoft token is refreshed against the same profile first.
        expect(calls.some((item) => item.binary === "outlook-email-pp-cli" && usesProfileConfig(item) && item.args.includes("refresh"))).toBe(true);
        expect(call?.args).toContain("--config");
        expect(call?.args).toContain("live");
        expect(call?.args).toContain("--no-cache");
        expect(call?.args).not.toContain("local");
      }
    }
  }, 30_000);
});
