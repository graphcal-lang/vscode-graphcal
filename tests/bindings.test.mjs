import { readFileSync } from "node:fs";
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
