import type { DescMessage } from "@bufbuild/protobuf";
import type { MockContext } from "./types.js";

/**
 * Whether the walker may descend into a nested message.
 *
 * Depth alone is what guarantees termination: a schema like
 * `message TreeNode { TreeNode child = 1; }` has no structural bottom, so the
 * only thing that stops recursion is refusing to go deeper than `maxDepth`.
 * A message field that is refused is simply left unset, which is always valid
 * — protobuf has no non-nullable message fields.
 *
 * The root message is depth 0, so `maxDepth: 3` yields at most three levels of
 * nested messages beneath it.
 */
export function canDescend(ctx: MockContext): boolean {
  return ctx.depth < ctx.options.maxDepth;
}

/**
 * How many times a message type already appears in the current ancestry.
 *
 * Not used to stop recursion — `canDescend` does that — but exposed on the
 * context so override functions can tell "the Address inside a Person" from
 * "the Address inside a Person inside a Company".
 */
export function recursionCount(desc: DescMessage, ctx: MockContext): number {
  let count = 0;
  for (const name of ctx.stack) {
    if (name === desc.typeName) {
      count++;
    }
  }
  return count;
}
