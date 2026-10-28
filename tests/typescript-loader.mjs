import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";

const simulationRoot = new URL("../vendor/ascii-sharks/src/", import.meta.url).href;

// Run the vendored TypeScript directly without adding a test runtime dependency.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(simulationRoot) && /^\.\/[^.]+$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(simulationRoot) && url.endsWith(".ts")) {
      const { outputText } = ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      });
      return { format: "module", source: outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
