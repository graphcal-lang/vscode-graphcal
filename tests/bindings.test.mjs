import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import oniguruma from "vscode-oniguruma";
import textmate from "vscode-textmate";
import { expect, test } from "vite-plus/test";

const grammar = JSON.parse(
  readFileSync(new URL("../syntaxes/graphcal.tmLanguage.json", import.meta.url), "utf8"),
);
const marked = new RegExp(grammar.repository["marked-param-binding"].begin);
const markedEnd = new RegExp(grammar.repository["marked-param-binding"].end);
const inlineCall = new RegExp(grammar.repository["inline-dag-call"].begin);

test("a marker selects the value grammar of a DAG input binding", () => {
  for (const [source, category, name] of [
    ["type T: Vec3<Length, Eci>", "type", "T"],
    ["dim D: Length / Time", "dim", "D"],
    ["index I: Fin(3)", "index", "I"],
    ["index Axis : Phase", "index", "Axis"],
  ]) {
    const match = marked.exec(source);
    expect(match?.[1], source).toBe(category);
    expect(match?.[2], source).toBe(name);
  }
  for (const source of ["x: @y", "types: @y", "param p: @y"]) {
    expect(marked.test(source), source).toBe(false);
  }
  // A marked value ends before the next binding or the closing parenthesis.
  expect(markedEnd.exec("Length / Time, x: @y")?.index).toBe(13);
  expect(markedEnd.exec("Phase)")?.index).toBe(5);
});

test("an inline DAG call opens its binding list", () => {
  for (const [source, path] of [
    ["@scale(factor: 2.0)::v", "scale"],
    ["@lib.model(type T: Vec3<Length, Eci>)::out", "lib.model"],
  ]) {
    expect(inlineCall.exec(source)?.[2], source).toBe(path);
  }
  for (const source of ["@instance::out", "@x + f(1)"]) {
    expect(inlineCall.test(source), source).toBe(false);
  }
});

const grammarPath = new URL("../syntaxes/graphcal.tmLanguage.json", import.meta.url);
const tokenizer = (async () => {
  const wasm = readFileSync(
    createRequire(import.meta.url).resolve("vscode-oniguruma/release/onig.wasm"),
  );
  await oniguruma.loadWASM(wasm.buffer);
  const registry = new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
      createOnigString: (text) => new oniguruma.OnigString(text),
    }),
    loadGrammar: async () =>
      textmate.parseRawGrammar(readFileSync(grammarPath, "utf8"), grammarPath.pathname),
  });
  return registry.loadGrammar("source.graphcal");
})();

/** Tokenize one line into `[text, innermost scope]` pairs, dropping whitespace tokens. */
async function tokenize(line) {
  const { tokens } = (await tokenizer).tokenizeLine(line, textmate.INITIAL);
  return tokens
    .map(({ startIndex, endIndex, scopes }) => [line.slice(startIndex, endIndex), scopes.at(-1)])
    .filter(([text]) => text.trim() !== "");
}

test("nested parentheses stay inside a marked value", async () => {
  expect(await tokenize("@f(index I: Fin((3 + 1) * 2), type T: Bool)::out")).toEqual([
    ["@", "punctuation.definition.variable.graphcal"],
    ["f", "entity.name.function.graphcal"],
    ["(", "punctuation.brackets.round.graphcal"],
    ["index", "keyword.declaration.input-category.graphcal"],
    ["I", "variable.other.graphcal"],
    [":", "punctuation.separator.colon.graphcal"],
    ["Fin", "keyword.other.finite-index.graphcal"],
    ["(", "punctuation.brackets.round.graphcal"],
    ["(", "punctuation.brackets.round.graphcal"],
    ["3", "constant.numeric.graphcal"],
    ["+", "keyword.operator.arithmetic.graphcal"],
    ["1", "constant.numeric.graphcal"],
    [")", "punctuation.brackets.round.graphcal"],
    ["*", "keyword.operator.arithmetic.graphcal"],
    ["2", "constant.numeric.graphcal"],
    [")", "punctuation.brackets.round.graphcal"],
    [",", "punctuation.separator.comma.graphcal"],
    ["type", "keyword.declaration.input-category.graphcal"],
    ["T", "variable.other.graphcal"],
    [":", "punctuation.separator.colon.graphcal"],
    ["Bool", "support.type.graphcal"],
    [")", "punctuation.brackets.round.graphcal"],
    ["::", "punctuation.accessor.graphcal"],
    ["out", "variable.other.graphcal"],
  ]);
});

test("each marked value is scoped up to the next binding", async () => {
  expect(
    await tokenize(
      "@f(dim D: (Length / Time), type T: Velocity[Fin(2 * (1 + 1)), Mode], x: @a)::v",
    ),
  ).toEqual([
    ["@", "punctuation.definition.variable.graphcal"],
    ["f", "entity.name.function.graphcal"],
    ["(", "punctuation.brackets.round.graphcal"],
    ["dim", "keyword.declaration.input-category.graphcal"],
    ["D", "variable.other.graphcal"],
    [":", "punctuation.separator.colon.graphcal"],
    ["(", "punctuation.brackets.round.graphcal"],
    ["Length", "entity.name.type.graphcal"],
    ["/", "keyword.operator.arithmetic.graphcal"],
    ["Time", "entity.name.type.graphcal"],
    [")", "punctuation.brackets.round.graphcal"],
    [",", "punctuation.separator.comma.graphcal"],
    ["type", "keyword.declaration.input-category.graphcal"],
    ["T", "variable.other.graphcal"],
    [":", "punctuation.separator.colon.graphcal"],
    ["Velocity", "entity.name.type.graphcal"],
    ["[", "punctuation.brackets.square.graphcal"],
    ["Fin", "keyword.other.finite-index.graphcal"],
    ["(", "punctuation.brackets.round.graphcal"],
    ["2", "constant.numeric.graphcal"],
    ["*", "keyword.operator.arithmetic.graphcal"],
    ["(", "punctuation.brackets.round.graphcal"],
    ["1", "constant.numeric.graphcal"],
    ["+", "keyword.operator.arithmetic.graphcal"],
    ["1", "constant.numeric.graphcal"],
    [")", "punctuation.brackets.round.graphcal"],
    [")", "punctuation.brackets.round.graphcal"],
    [",", "punctuation.separator.comma.graphcal"],
    ["Mode", "entity.name.type.graphcal"],
    ["]", "punctuation.brackets.square.graphcal"],
    [",", "punctuation.separator.comma.graphcal"],
    ["x", "variable.other.graphcal"],
    [":", "punctuation.separator.colon.graphcal"],
    ["@", "punctuation.definition.variable.graphcal"],
    ["a", "variable.other.graphcal"],
    [")", "punctuation.brackets.round.graphcal"],
    ["::", "punctuation.accessor.graphcal"],
    ["v", "variable.other.graphcal"],
  ]);
});
