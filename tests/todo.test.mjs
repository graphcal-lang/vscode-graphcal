import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";

const grammar = JSON.parse(
  readFileSync(new URL("../syntaxes/graphcal.tmLanguage.json", import.meta.url), "utf8"),
);
const marker = new RegExp(grammar.repository["todo-definition"].match);

test("TODO marker is highlighted only at an initializer boundary", () => {
  for (const source of [
    "node missing: Length = todo {};",
    "node missing: Length=todo { @input };",
  ]) {
    expect(marker.exec(source)?.[2]).toBe("todo");
  }
  for (const source of [
    "param todo: Length = 1.0 m;",
    "node copy: Length = @todo;",
    "node state: State = todo(value: 1.0 m);",
    "dag todo {}",
    "match todo { Idle => 1.0 }",
    "if value == todo { 1.0 }",
    "if value != todo { 1.0 }",
    "if value >= todo { 1.0 }",
  ]) {
    expect(marker.test(source), source).toBe(false);
  }
});
