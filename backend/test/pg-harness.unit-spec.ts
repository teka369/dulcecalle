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
  // Port 0: the OS picks a free port, so this test never collides with a
  // parallel run (a fixed 55439 hit EADDRINUSE).
  const squatter = net.createServer((s) => s.on("data", () => undefined)); // accepts, never speaks postgres
  await new Promise<void>((r) => squatter.listen(0, "127.0.0.1", () => r()));
  const taken = (squatter.address() as net.AddressInfo).port;
  const foreignDir = `/tmp/dc-pg-${taken}`;
  fs.mkdirSync(foreignDir, { recursive: true });
  fs.writeFileSync(`${foreignDir}/OTHER_CLUSTER`, "x");
  const spy = // The old harness mapped Math.random() to `55432 + random*400`: point it at the taken port.
  jest.spyOn(Math, "random").mockReturnValue((taken - 55432) / 400);
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
