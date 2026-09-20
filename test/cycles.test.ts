import { describe, expect, it } from "vitest";
import type { Message } from "@bufbuild/protobuf";
import { mock } from "../src/index.js";
import { PingSchema, TreeNodeSchema } from "./fixtures/gen/bufaker/test/v1/basic_pb.js";
import type { TreeNode } from "./fixtures/gen/bufaker/test/v1/basic_pb.js";

/** Longest chain of nested messages below the root. */
function messageDepth(value: unknown, depth = 0): number {
  if (value === null || typeof value !== "object") {
    return depth;
  }
  if (Array.isArray(value)) {
    return value.reduce<number>((max, item) => Math.max(max, messageDepth(item, depth)), depth);
  }
  if (value instanceof Uint8Array) {
    return depth;
  }
  const isMessage = "$typeName" in (value as Message);
  const childDepth = isMessage ? depth + 1 : depth;
  let max = depth;
  for (const [key, child] of Object.entries(value)) {
    if (key === "$typeName" || key === "$unknown") continue;
    max = Math.max(max, messageDepth(child, childDepth));
  }
  return max;
}

describe("depth guard", () => {
  it("terminates on a directly self-referential message", () => {
    for (let seed = 0; seed < 20; seed++) {
      expect(() => mock(TreeNodeSchema, { seed })).not.toThrow();
    }
  });

  it("terminates on mutually recursive messages", () => {
    for (let seed = 0; seed < 20; seed++) {
      expect(() => mock(PingSchema, { seed })).not.toThrow();
    }
  });

  it("stops at maxDepth, counting the root as depth 0", () => {
    // maxDepth 1 permits the root plus one level of nested messages.
    const one = mock(TreeNodeSchema, { seed: 1, maxDepth: 1, listLength: 1 });
    expect(messageDepth(one)).toBe(2);

    const three = mock(TreeNodeSchema, { seed: 1, maxDepth: 3, listLength: 1 });
    expect(messageDepth(three)).toBe(4);
  });

  it("leaves message fields unset rather than throwing at maxDepth 0", () => {
    const t = mock(TreeNodeSchema, { seed: 1, maxDepth: 0 });
    expect(t.label).toBeTypeOf("string");
    expect(t.child).toBeUndefined();
    expect(t.children).toEqual([]);
  });

  it("leaves repeated message fields empty at the depth limit", () => {
    function deepest(node: TreeNode, depth: number): void {
      if (depth === 2) {
        expect(node.child).toBeUndefined();
        expect(node.children).toEqual([]);
        return;
      }
      expect(node.child).toBeDefined();
      deepest(node.child!, depth + 1);
    }
    deepest(mock(TreeNodeSchema, { seed: 4, maxDepth: 2, listLength: 1 }), 0);
  });

  it("alternates correctly through a mutually recursive pair", () => {
    const ping = mock(PingSchema, { seed: 2, maxDepth: 2 });
    expect(ping.$typeName).toBe("bufaker.test.v1.Ping");
    expect(ping.pong?.$typeName).toBe("bufaker.test.v1.Pong");
    expect(ping.pong?.ping?.$typeName).toBe("bufaker.test.v1.Ping");
    // Depth 3 would exceed maxDepth 2.
    expect(ping.pong?.ping?.pong).toBeUndefined();
  });

  it("does not blow the stack at a large maxDepth", () => {
    expect(() => mock(TreeNodeSchema, { seed: 1, maxDepth: 40, listLength: 0 })).not.toThrow();
  });
});
