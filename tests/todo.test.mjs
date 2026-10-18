import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";

const grammar = JSON.parse(
  readFileSync(new URL("../syntaxes/graphcal.tmLanguage.json", import.meta.url), "utf8"),
);
const marker = new RegExp(grammar.repository["todo-hole"].match);

test("TODO marker is highlighted only before a typed hole", () => {
  for (const source of [
    "node missing: Length = todo<Length> {};",
    "node missing: Length=todo<Length>{ @input };",
    "node total: Length = @a + todo<Length> { @b } * 2.0;",
    "node grid: Length[Axis] = todo<Length[Axis]> {};",
    "node v: Vec3<Length, ECI> = todo<Vec3<Length, ECI>> { @r };",
    "|s, prev_t, t| todo<Dimensionless> { s, @action[prev_t] })",
  ]) {
    expect(marker.exec(source)?.[1], source).toBe("todo");
  }
  for (const source of [
    "param todo: Length = 1.0 m;",
    "node copy: Length = @todo;",
    "node state: State = todo(value: 1.0 m);",
    "node called: Length = todo<Length>(1.0 m);",
    "node lt: Bool = todo < x;",
    "dag todo {}",
    "match todo { Idle => 1.0 }",
    "if value == todo { 1.0 }",
    "if value >= todo { 1.0 }",
  ]) {
    expect(marker.test(source), source).toBe(false);
  }
});
