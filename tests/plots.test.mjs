import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";

const grammar = JSON.parse(
  readFileSync(new URL("../syntaxes/graphcal.tmLanguage.json", import.meta.url), "utf8"),
);
const keyword = new RegExp(grammar.repository["plots-keyword"].match);

test("plots is highlighted as a figure/layer field keyword", () => {
  for (const source of [
    "    plots: [curve_a, curve_b],",
    'figure f = { plots:[a], title: "T" };',
    "layer l = { plots : [ line_layer ] };",
  ]) {
    expect(keyword.exec(source)?.[1], source).toBe("plots");
  }
  for (const source of [
    "param plots: Length = 1.0 m;",
    "node total = plots + 1;",
    "subplots: [a],",
  ]) {
    expect(keyword.test(source), source).toBe(false);
  }
});
