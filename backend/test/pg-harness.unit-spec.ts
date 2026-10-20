import * as fs from "fs";
import * as net from "net";
import { Client } from "pg";
import { startLocalPostgres } from "./pg-harness";

/**
 * loop/v1 jest flake: the harness picked `55432 + random(400)` without
 * checking it was free and reused `/tmp/dc-pg-<port>`. When that port was
 * already taken (another suite in parallel, another worktree/agent on the
 * shared box, the client-pg harness), our postgres failed to bind, the
 * readiness probe connected to the OTHER listener, CREATE DATABASE failed
 * (or hit someone else's cluster) and the whole suite failed in beforeAll.
 */
jest.setTimeout(90_000);

test("a taken port is never used: the harness starts its own postgres elsewhere and leaves the other data dir alone", async () => {
  const taken = 55432 + 7;
  const squatter = net.createServer((s) => s.on("data", () => undefined)); // accepts, never speaks postgres
  await new Promise<void>((r) => squatter.listen(taken, "127.0.0.1", () => r()));
  const foreignDir = `/tmp/dc-pg-${taken}`;
  fs.mkdirSync(foreignDir, { recursive: true });
  fs.writeFileSync(`${foreignDir}/OTHER_CLUSTER`, "x");
  const spy = jest.spyOn(Math, "random").mockReturnValue(7 / 400);
  let handle: Awaited<ReturnType<typeof startLocalPostgres>> | null = null;
  try {
    handle = await startLocalPostgres();
    spy.mockRestore();
    expect(handle.port).not.toBe(taken);
    expect(fs.existsSync(`${foreignDir}/OTHER_CLUSTER`)).toBe(true);
    const c = new Client({ host: "127.0.0.1", port: handle.port, user: "postgres", database: "dulcecalle_test" });
    await c.connect();
    const res = (await c.query("select 1 as one")) as { rows: Array<{ one: number }> };
    expect(res.rows[0].one).toBe(1);
    await c.end();
  } finally {
    spy.mockRestore();
    handle?.stop();
    squatter.close();
    fs.rmSync(foreignDir, { recursive: true, force: true });
  }
});
