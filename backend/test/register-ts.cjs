/**
 * Require hook so the client-pg listener runs from source with
 * emitDecoratorMetadata. tsx/esbuild drop that metadata and Nest then
 * fails to inject MediaService. __dirname stays the source directory.
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");
const ts = require("typescript");

const configPath = path.join(__dirname, "..", "tsconfig.json");
const parsed = ts.readConfigFile(configPath, ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(
  parsed.config,
  ts.sys,
  path.dirname(configPath),
).options;
options.module = ts.ModuleKind.CommonJS;
options.target = ts.ScriptTarget.ES2022;
options.esModuleInterop = true;
options.emitDecoratorMetadata = true;
options.experimentalDecorators = true;

const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, extra) {
  try {
    return resolveFilename.call(this, request, parent, isMain, extra);
  } catch (error) {
    if (typeof request === "string" && request.startsWith(".")) {
      return resolveFilename.call(this, `${request}.ts`, parent, isMain, extra);
    }
    throw error;
  }
};

require.extensions[".ts"] = function (module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: options,
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};
