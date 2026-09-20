import { create, ScalarType } from "@bufbuild/protobuf";
import type { DescMessage, Message } from "@bufbuild/protobuf";
import type { MockContext } from "./types.js";
import { generateScalar } from "./scalars.js";

/**
 * Generates a well-known type. Returning `undefined` means "leave this field
 * unset" — that is how `Any` and `FieldMask` are handled in v1.
 */
export type WellKnownGenerator = (desc: DescMessage, ctx: MockContext) => Message | undefined;

function fieldNamed(desc: DescMessage, name: string) {
  const field = desc.fields.find((f) => f.name === name);
  if (field === undefined) {
    throw new Error(
      `bufaker: expected ${desc.typeName} to declare a field named "${name}". ` +
        `This usually means a non-standard definition of a google.protobuf type is in use.`,
    );
  }
  return field;
}

function makeTimestamp(desc: DescMessage, ctx: MockContext): Message {
  const ms = ctx.faker.date.recent({ days: 30, refDate: ctx.options.refDate }).getTime();
  return create(desc, {
    seconds: BigInt(Math.floor(ms / 1000)),
    nanos: (ms % 1000) * 1_000_000,
  });
}

function makeDuration(desc: DescMessage, ctx: MockContext): Message {
  // protobuf requires seconds and nanos to agree in sign; staying non-negative
  // sidesteps that entirely.
  return create(desc, {
    seconds: BigInt(ctx.faker.number.int({ min: 0, max: 86_400 })),
    nanos: ctx.faker.number.int({ min: 0, max: 999_999_999 }),
  });
}

/** `google.protobuf.*Value` wrapper type name -> the scalar it wraps. */
const WRAPPER_SCALARS: Record<string, ScalarType> = {
  "google.protobuf.DoubleValue": ScalarType.DOUBLE,
  "google.protobuf.FloatValue": ScalarType.FLOAT,
  "google.protobuf.Int64Value": ScalarType.INT64,
  "google.protobuf.UInt64Value": ScalarType.UINT64,
  "google.protobuf.Int32Value": ScalarType.INT32,
  "google.protobuf.UInt32Value": ScalarType.UINT32,
  "google.protobuf.BoolValue": ScalarType.BOOL,
  "google.protobuf.StringValue": ScalarType.STRING,
  "google.protobuf.BytesValue": ScalarType.BYTES,
};

/** How deep a generated Struct/Value/ListValue tree may nest. */
const STRUCT_MAX_DEPTH = 2;

function makeValue(desc: DescMessage, ctx: MockContext, depth: number): Message {
  const leafKinds = ["numberValue", "stringValue", "boolValue", "nullValue"] as const;
  const kinds: string[] = depth >= STRUCT_MAX_DEPTH
    ? [...leafKinds]
    : [...leafKinds, "structValue", "listValue"];
  const kind = ctx.faker.helpers.arrayElement(kinds);

  switch (kind) {
    case "nullValue":
      // NULL_VALUE is the enum's only member, and its number is 0.
      return create(desc, { kind: { case: "nullValue", value: 0 } });
    case "numberValue":
      return create(desc, {
        kind: { case: "numberValue", value: ctx.faker.number.float({ min: -1000, max: 1000, fractionDigits: 3 }) },
      });
    case "boolValue":
      return create(desc, { kind: { case: "boolValue", value: ctx.faker.datatype.boolean() } });
    case "structValue": {
      const structDesc = fieldNamed(desc, "struct_value").message;
      if (structDesc === undefined) {
        throw new Error("bufaker: google.protobuf.Value.struct_value is not a message field");
      }
      return create(desc, { kind: { case: "structValue", value: makeStruct(structDesc, ctx, depth + 1) } });
    }
    case "listValue": {
      const listDesc = fieldNamed(desc, "list_value").message;
      if (listDesc === undefined) {
        throw new Error("bufaker: google.protobuf.Value.list_value is not a message field");
      }
      return create(desc, { kind: { case: "listValue", value: makeListValue(listDesc, ctx, depth + 1) } });
    }
    default:
      return create(desc, { kind: { case: "stringValue", value: ctx.faker.lorem.words({ min: 1, max: 3 }) } });
  }
}

function valueDescOfStruct(structDesc: DescMessage): DescMessage {
  const fields = fieldNamed(structDesc, "fields");
  if (fields.fieldKind !== "map" || fields.mapKind !== "message") {
    throw new Error("bufaker: google.protobuf.Struct.fields is not a map of messages");
  }
  return fields.message;
}

function valueDescOfListValue(listDesc: DescMessage): DescMessage {
  const values = fieldNamed(listDesc, "values");
  if (values.fieldKind !== "list" || values.listKind !== "message") {
    throw new Error("bufaker: google.protobuf.ListValue.values is not a list of messages");
  }
  return values.message;
}

function makeStruct(desc: DescMessage, ctx: MockContext, depth: number): Message {
  const valueDesc = valueDescOfStruct(desc);
  const fields: Record<string, Message> = {};
  const count = ctx.faker.number.int({ min: 1, max: 3 });
  for (let i = 0; i < count; i++) {
    fields[ctx.faker.lorem.word()] = makeValue(valueDesc, ctx, depth);
  }
  return create(desc, { fields });
}

function makeListValue(desc: DescMessage, ctx: MockContext, depth: number): Message {
  const valueDesc = valueDescOfListValue(desc);
  const count = ctx.faker.number.int({ min: 1, max: 3 });
  const values: Message[] = [];
  for (let i = 0; i < count; i++) {
    values.push(makeValue(valueDesc, ctx, depth));
  }
  return create(desc, { values });
}

/**
 * Well-known types bufaker deliberately leaves unset in v1.
 *
 * `Any` would need a type registry to pick and pack a payload, and a
 * `FieldMask` is only meaningful against a specific request, so a random one
 * carries no information. Both are skipped rather than raising, so that a
 * message which merely happens to contain one still mocks successfully.
 */
export const UNSUPPORTED_WELL_KNOWN_TYPES: readonly string[] = [
  "google.protobuf.Any",
  "google.protobuf.FieldMask",
];

const skip: WellKnownGenerator = () => undefined;

/**
 * The generator for each supported well-known type, keyed by fully-qualified
 * name. Consulted before the walker's generic recursion, so entries here also
 * serve as a way to special-case any type by name.
 */
export const wellKnownGenerators: Record<string, WellKnownGenerator> = {
  "google.protobuf.Timestamp": makeTimestamp,
  "google.protobuf.Duration": makeDuration,
  "google.protobuf.Struct": (desc, ctx) => makeStruct(desc, ctx, 0),
  "google.protobuf.Value": (desc, ctx) => makeValue(desc, ctx, 0),
  "google.protobuf.ListValue": (desc, ctx) => makeListValue(desc, ctx, 0),
  "google.protobuf.Empty": (desc) => create(desc, {}),
  ...Object.fromEntries(
    Object.entries(WRAPPER_SCALARS).map(([typeName, scalar]): [string, WellKnownGenerator] => [
      typeName,
      (desc, ctx) => create(desc, { value: generateScalar(scalar, ctx) }),
    ]),
  ),
  ...Object.fromEntries(UNSUPPORTED_WELL_KNOWN_TYPES.map((n) => [n, skip])),
};

/**
 * Returns the special-case generator for a message type, or `undefined` if the
 * walker should recurse into it generically.
 */
export function getWellKnownGenerator(desc: DescMessage): WellKnownGenerator | undefined {
  return wellKnownGenerators[desc.typeName];
}
