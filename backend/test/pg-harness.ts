import { execFileSync, execSync, spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import { Client } from "pg";

const BIN = path.join(
  __dirname,
  "..",
  "node_modules",
  "@embedded-postgres",
  "linux-x64",
  "native",
  "bin",
);

export type PgHandle = {
  port: number;
  url: string;
  stop: () => void;
};

function nativeLibDir(): string {
  const lib = path.join(path.dirname(BIN), "lib");
  const linkDir = path.join("/tmp", "dc-pg-lib");
  fs.mkdirSync(linkDir, { recursive: true });
  for (const file of fs.readdirSync(lib)) {
    const src = path.join(lib, file);
    const dest = path.join(linkDir, file);
    try {
      fs.symlinkSync(src, dest);
    } catch {
      /* exists */
    }
    const m = file.match(/^(lib[^.]+)\.so\.(\d+)\./);
    if (m) {
      const soname = `${m[1]}.so.${m[2]}`;
      try {
        fs.symlinkSync(src, path.join(linkDir, soname));
      } catch {
        /* exists */
      }
    }
  }
  return linkDir;
}

function preloadEnv(): NodeJS.ProcessEnv {
  const so = path.join(__dirname, "notroot.so");
  if (!fs.existsSync(so)) {
    const src = path.join(__dirname, "notroot.c");
    execSync(`gcc -shared -fPIC -o ${so} ${src} -ldl`);
  }
  return {
    ...process.env,
    HOME: "/tmp",
    LD_PRELOAD: so,
    LD_LIBRARY_PATH: nativeLibDir(),
  };
}

function run(bin: string, args: string[]) {
  execFileSync(bin, args, { stdio: "inherit", env: preloadEnv() });
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const socket = net.connect({ host: "127.0.0.1", port }, () => {
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`postgres did not accept connections on ${port}`));
        } else {
          setTimeout(tryOnce, 200);
        }
      });
    };
    tryOnce();
  });
}

async function createDatabase(port: number, name: string): Promise<void> {
  const deadline = Date.now() + 15000;
  let last: unknown;
  while (Date.now() < deadline) {
    const client = new Client({
      host: "127.0.0.1",
      port,
      user: "postgres",
      database: "postgres",
    });
    try {
      await client.connect();
      await client.query(`CREATE DATABASE ${name}`);
      await client.end();
      return;
    } catch (e) {
      last = e;
      try {
        await client.end();
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw last instanceof Error ? last : new Error("CREATE DATABASE failed");
}

export async function startLocalPostgres(): Promise<PgHandle> {
  const port = 55432 + Math.floor(Math.random() * 400);
  const dataDir = path.join("/tmp", `dc-pg-${port}`);
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });

  run(`${BIN}/initdb`, [
    "-D",
    dataDir,
    "--auth=trust",
    "--username=postgres",
    "--no-locale",
    "--encoding=UTF8",
  ]);

  fs.appendFileSync(
    path.join(dataDir, "postgresql.conf"),
    `\nport = ${port}\nlisten_addresses = '127.0.0.1'\n`,
  );

  const child: ChildProcess = spawn(
    `${BIN}/postgres`,
    ["-D", dataDir, "-p", String(port)],
    { stdio: "ignore", detached: true, env: preloadEnv() },
  );
  child.unref();

  try {
    await waitForPort(port, 20000);
    await createDatabase(port, "dulcecalle_test");
  } catch (e) {
    try {
      run(`${BIN}/pg_ctl`, ["-D", dataDir, "-m", "fast", "stop"]);
    } catch {
      if (child.pid) {
        try {
          process.kill(child.pid, "SIGTERM");
        } catch {
          /* ignore */
        }
      }
    }
    throw e;
  }

  const url = `postgresql://postgres@127.0.0.1:${port}/dulcecalle_test?schema=public`;
  return {
    port,
    url,
    stop: () => {
      try {
        run(`${BIN}/pg_ctl`, ["-D", dataDir, "-m", "fast", "stop"]);
      } catch {
        if (child.pid) {
          try {
            process.kill(child.pid, "SIGTERM");
          } catch {
            /* ignore */
          }
        }
      }
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
