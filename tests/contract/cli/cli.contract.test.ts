import { beforeAll, describe, expect, it } from "vitest";
import { moduleExists } from "../../helpers/module-availability.js";

type CliModule = {
  createCli?: () => unknown;
  runCli?: (argv: string[]) => Promise<{ exitCode: number; stdout?: string; stderr?: string }>;
};

const describeCli = moduleExists("src/cli/index.ts") ? describe : describe.skip;

describeCli("cli contract", () => {
  let cliModule: CliModule;

  beforeAll(async () => {
    cliModule = (await import("../../../src/cli/index.js")) as CliModule;
  });

  it("exposes a callable CLI entrypoint", () => {
    expect(
      typeof cliModule.runCli === "function" || typeof cliModule.createCli === "function",
    ).toBe(true);
  });

  it("supports sync dry-run JSON output", async () => {
    if (!cliModule.runCli) {
      return;
    }

    const result = await cliModule.runCli(["sync", "--dry-run", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout ?? "").toMatch(/install|update|remove|conflicts|unchanged/);
  });

  it("supports status and validate commands", async () => {
    if (!cliModule.runCli) {
      return;
    }

    await expect(cliModule.runCli(["status", "--json"])).resolves.toMatchObject({ exitCode: 0 });
    await expect(cliModule.runCli(["validate", "--json"])).resolves.toMatchObject({
      exitCode: 0,
    });
  });
});

