import "reflect-metadata";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as httpSetup from "./http-setup";

describe("Render cached build + production throttle guard (R2-A)", () => {
  const backendRoot = path.resolve(__dirname, "..");

  it("tsconfig.build.json disables incremental and two consecutive nest builds emit dist/main.js and dist/shared/errors.js", () => {
    const buildCfg = JSON.parse(
      fs.readFileSync(path.join(backendRoot, "tsconfig.build.json"), "utf8"),
    ) as { compilerOptions?: { incremental?: boolean } };
    expect(buildCfg.compilerOptions?.incremental).toBe(false);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-nest-build-"));
    const tmpTsconfig = path.join(backendRoot, `tsconfig.build.${process.pid}.json`);
    const outDir = path.join(tmpDir, "dist");
    try {
      fs.writeFileSync(
        tmpTsconfig,
        JSON.stringify({
          extends: "./tsconfig.build.json",
          compilerOptions: {
            outDir,
            tsBuildInfoFile: path.join(tmpDir, "tsconfig.build.tsbuildinfo"),
          },
        }),
      );
      const cfgRel = path.basename(tmpTsconfig);
      execSync(`npx nest build -p ${cfgRel}`, { cwd: backendRoot, stdio: "pipe" });
      execSync(`npx nest build -p ${cfgRel}`, { cwd: backendRoot, stdio: "pipe" });
      expect(fs.existsSync(path.join(outDir, "main.js"))).toBe(true);
      expect(fs.existsSync(path.join(outDir, "shared", "errors.js"))).toBe(true);
    } finally {
      fs.rmSync(tmpTsconfig, { force: true });
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("DISABLE_THROTTLE=1 is ignored when NODE_ENV === 'production'", () => {
    const fn = (httpSetup as { shouldSkipThrottle?: (env?: Record<string, string | undefined>) => boolean }).shouldSkipThrottle;
    expect(typeof fn).toBe("function");
    expect(fn!({ NODE_ENV: "production", DISABLE_THROTTLE: "1" })).toBe(false);
    expect(fn!({ NODE_ENV: "test", DISABLE_THROTTLE: "1" })).toBe(true);
    expect(fn!({ NODE_ENV: "test", DISABLE_THROTTLE: "0" })).toBe(false);
  });
});
