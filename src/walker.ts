import { create } from "@bufbuild/protobuf";
import type { DescEnum, DescField, DescMessage, DescOneof, Message, ScalarType } from "@bufbuild/protobuf";
import { reflect } from "@bufbuild/protobuf/reflect";
import type { ReflectList, ReflectMap, ReflectMessage } from "@bufbuild/protobuf/reflect";
import { FeatureSet_FieldPresence } from "@bufbuild/protobuf/wkt";
import { ScalarType as Scalar } from "@bufbuild/protobuf";

import { canDescend } from "./cycles.js";
import { applyOverride, findHeuristic, findOverride } from "./overrides.js";
import { generateMapKey, generateScalar } from "./scalars.js";
import type { CountRange, MockContext } from "./types.js";
import { getWellKnownGenerator } from "./wellKnownTypes.js";

/** Resolves a {@link CountRange} to a concrete count. */
function pickCount(range: CountRange, ctx: MockContext): number {
  if (typeof range === "number") {
    return Math.max(0, Math.trunc(range));
  }
  const [min, max] = range;
  return ctx.faker.number.int({ min: Math.max(0, min), max: Math.max(0, max) });
}

/** A probability check that treats 1 and 0 as certainties, without rolling. */
function chance(probability: number, ctx: MockContext): boolean {
  if (probability >= 1) return true;
  if (probability <= 0) return false;
  return ctx.faker.number.float({ min: 0, max: 1 }) < probability;
}

function fieldContext(ctx: MockContext, field: DescField): MockContext {
  return { ...ctx, path: `${ctx.path}.${field.name}`, field };
}

function nestedContext(ctx: MockContext, desc: DescMessage): MockContext {
  return {
    ...ctx,
    message: desc,
    depth: ctx.depth + 1,
    stack: [...ctx.stack, desc.typeName],
  };
}

/**
 * Picks a value for an enum field.
 *
 * The zero value is excluded by default: by protobuf convention it is
 * `*_UNSPECIFIED`, and a mock that leaves every enum unspecified is not
 * exercising much. An enum with nothing but a zero value still yields it,
 * since there is nothing else to pick.
 */
export function pickEnumValue(desc: DescEnum, ctx: MockContext): number {
  const all = desc.values;
  if (all.length === 0) {
    return 0;
  }
  const candidates = ctx.options.includeZeroEnumValue
    ? all
    : all.filter((v) => v.number !== 0);
  const pool = candidates.length > 0 ? candidates : all;
  return ctx.faker.helpers.arrayElement(pool).number;
}

/** Produces a scalar value, letting a name heuristic take precedence. */
function scalarValue(field: DescField, scalar: ScalarType, ctx: MockContext): unknown {
  const heuristic = findHeuristic(field, scalar, ctx);
  if (heuristic !== undefined) {
    return heuristic.generate(ctx);
  }
  return generateScalar(scalar, ctx);
}

/**
 * Writes an overridden value straight onto the message.
 *
 * Overrides bypass reflection deliberately: the caller supplies a value in the
 * shape of the generated TypeScript type (a plain array for a repeated field,
 * a record for a map), which is what they can actually see in their editor,
 * rather than protobuf-es's reflection wrappers.
 */
function assignOverride(msg: Message, field: DescField, value: unknown): void {
  const target = msg as unknown as Record<string, unknown>;
  if (value === undefined) {
    return;
  }
  if (field.oneof !== undefined) {
    target[field.oneof.localName] = { case: field.localName, value };
    return;
  }
  target[field.localName] = value;
}

/** Generates one element of a repeated field. */
function listItem(field: DescField & { fieldKind: "list" }, ctx: MockContext): unknown {
  switch (field.listKind) {
    case "scalar":
      return scalarValue(field, field.scalar, ctx);
    case "enum":
      return pickEnumValue(field.enum, ctx);
    case "message": {
      const nested = generateMessage(field.message, nestedContext(ctx, field.message));
      return nested === undefined ? undefined : reflect(field.message, nested);
    }
  }
}

/** Generates one value of a map field. */
function mapValue(field: DescField & { fieldKind: "map" }, ctx: MockContext): unknown {
  switch (field.mapKind) {
    case "scalar":
      return scalarValue(field, field.scalar, ctx);
    case "enum":
      return pickEnumValue(field.enum, ctx);
    case "message": {
      const nested = generateMessage(field.message, nestedContext(ctx, field.message));
      return nested === undefined ? undefined : reflect(field.message, nested);
    }
  }
}

function populateList(r: ReflectMessage, field: DescField & { fieldKind: "list" }, ctx: MockContext): void {
  // A repeated message field that would exceed the depth budget becomes an
  // empty list, which for proto3 is indistinguishable from unset.
  if (field.listKind === "message" && !canDescend(ctx)) {
    return;
  }
  const list = r.get(field) as ReflectList;
  const count = pickCount(ctx.options.listLength, ctx);
  for (let i = 0; i < count; i++) {
    const item = listItem(field, ctx);
    if (item !== undefined) {
      list.add(item);
    }
  }
}

function populateMap(r: ReflectMessage, field: DescField & { fieldKind: "map" }, ctx: MockContext): void {
  if (field.mapKind === "message" && !canDescend(ctx)) {
    return;
  }
  const map = r.get(field) as ReflectMap;
  let count = pickCount(ctx.options.mapSize, ctx);
  // A bool-keyed map has exactly two possible keys.
  if (field.mapKey === Scalar.BOOL) {
    count = Math.min(count, 2);
  }
  const seen = new Set<unknown>();
  // Keys must be unique, and the key generators draw from small pools, so
  // collisions are expected. Give up after a bounded number of attempts rather
  // than looping until a distinct key turns up.
  const maxAttempts = count * 10 + 10;
  for (let attempt = 0; seen.size < count && attempt < maxAttempts; attempt++) {
    const key = generateMapKey(field.mapKey, ctx);
    if (seen.has(key)) {
      continue;
    }
    const value = mapValue(field, ctx);
    if (value === undefined) {
      continue;
    }
    seen.add(key);
    map.set(key, value);
  }
}

/**
 * Populates a single field. `forced` skips the explicit-presence roll, which
 * is how a field chosen as a oneof's active member gets set unconditionally.
 */
function populateField(
  r: ReflectMessage,
  msg: Message,
  field: DescField,
  ctx: MockContext,
  forced = false,
): void {
  const fieldCtx = fieldContext(ctx, field);

  const match = findOverride(fieldCtx.path, field, ctx.options.overrides);
  if (match !== undefined) {
    assignOverride(msg, field, applyOverride(match.override, fieldCtx));
    return;
  }

  if (
    !forced &&
    field.oneof === undefined &&
    field.presence === FeatureSet_FieldPresence.EXPLICIT &&
    !chance(ctx.options.optionalFieldChance, fieldCtx)
  ) {
    return;
  }

  switch (field.fieldKind) {
    case "scalar":
      r.set(field, scalarValue(field, field.scalar, fieldCtx));
      return;
    case "enum":
      r.set(field, pickEnumValue(field.enum, fieldCtx));
      return;
    case "message": {
      if (!canDescend(fieldCtx)) {
        return;
      }
      const nested = generateMessage(field.message, nestedContext(fieldCtx, field.message));
      if (nested === undefined) {
        return;
      }
      r.set(field, reflect(field.message, nested));
      return;
    }
    case "list":
      populateList(r, field, fieldCtx);
      return;
    case "map":
      populateMap(r, field, fieldCtx);
      return;
  }
}

/**
 * Populates exactly one member of a oneof group, leaving the rest unset.
 *
 * If an override targets one of the members, that member is the one selected —
 * otherwise `overrides: { "Person.emailContact": … }` would only take effect
 * on the runs where that branch happened to be picked at random.
 */
function populateOneof(r: ReflectMessage, msg: Message, oneof: DescOneof, ctx: MockContext): void {
  const targeted = oneof.fields.filter(
    (f) => findOverride(fieldContext(ctx, f).path, f, ctx.options.overrides) !== undefined,
  );
  if (targeted.length > 0) {
    populateField(r, msg, ctx.faker.helpers.arrayElement(targeted), ctx, true);
    return;
  }
  if (oneof.fields.length === 0 || !chance(ctx.options.oneofChance, ctx)) {
    return;
  }
  populateField(r, msg, ctx.faker.helpers.arrayElement(oneof.fields), ctx, true);
}

/**
 * Generates a message from its descriptor.
 *
 * Returns `undefined` when the type is one bufaker deliberately does not mock
 * (`google.protobuf.Any`, `google.protobuf.FieldMask`), which callers turn
 * into "leave the field unset".
 */
export function generateMessage(desc: DescMessage, ctx: MockContext): Message | undefined {
  const wellKnown = getWellKnownGenerator(desc);
  if (wellKnown !== undefined) {
    return wellKnown(desc, ctx);
  }

  const msg = create(desc);
  const r = reflect(desc, msg);
  for (const member of desc.members) {
    if (member.kind === "oneof") {
      populateOneof(r, msg, member, ctx);
    } else {
      populateField(r, msg, member, ctx);
    }
  }
  return msg;
}
