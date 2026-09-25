import { ScalarType } from "@bufbuild/protobuf";
import type { MockContext, ScalarGenerator, ScalarGenerators } from "./types.js";

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;
const UINT32_MAX = 4294967295;
const INT64_MIN = -9223372036854775808n;
const INT64_MAX = 9223372036854775807n;
const UINT64_MAX = 18446744073709551615n;

function bigintBetween(ctx: MockContext, min: bigint, max: bigint): bigint {
  // faker.number.bigInt takes the range directly and is inclusive on both ends.
  return ctx.faker.number.bigInt({ min, max });
}

/**
 * The default generator for each proto scalar type.
 *
 * Values span the full range the type can hold rather than a comfortable
 * subset, so mocks exercise the edges of a schema. Narrow them per type with
 * the `scalars` option, or per field with `overrides`.
 *
 * 64-bit integer types always produce a `bigint`, including fields declared
 * with `jstype = JS_STRING` — protofaker writes through protobuf-es reflection,
 * which converts to the string representation itself.
 */
export const defaultScalarGenerators: ScalarGenerators = {
  [ScalarType.DOUBLE]: (ctx) =>
    ctx.faker.number.float({ min: -1e6, max: 1e6, fractionDigits: 6 }),
  // Round-trip through float32 so the value survives binary serialization
  // unchanged.
  [ScalarType.FLOAT]: (ctx) =>
    Math.fround(ctx.faker.number.float({ min: -1e5, max: 1e5, fractionDigits: 3 })),
  [ScalarType.INT32]: (ctx) => ctx.faker.number.int({ min: INT32_MIN, max: INT32_MAX }),
  [ScalarType.SINT32]: (ctx) => ctx.faker.number.int({ min: INT32_MIN, max: INT32_MAX }),
  [ScalarType.SFIXED32]: (ctx) => ctx.faker.number.int({ min: INT32_MIN, max: INT32_MAX }),
  [ScalarType.UINT32]: (ctx) => ctx.faker.number.int({ min: 0, max: UINT32_MAX }),
  [ScalarType.FIXED32]: (ctx) => ctx.faker.number.int({ min: 0, max: UINT32_MAX }),
  [ScalarType.INT64]: (ctx) => bigintBetween(ctx, INT64_MIN, INT64_MAX),
  [ScalarType.SINT64]: (ctx) => bigintBetween(ctx, INT64_MIN, INT64_MAX),
  [ScalarType.SFIXED64]: (ctx) => bigintBetween(ctx, INT64_MIN, INT64_MAX),
  [ScalarType.UINT64]: (ctx) => bigintBetween(ctx, 0n, UINT64_MAX),
  [ScalarType.FIXED64]: (ctx) => bigintBetween(ctx, 0n, UINT64_MAX),
  [ScalarType.BOOL]: (ctx) => ctx.faker.datatype.boolean(),
  [ScalarType.STRING]: (ctx) => ctx.faker.lorem.words({ min: 1, max: 3 }),
  [ScalarType.BYTES]: (ctx) =>
    new Uint8Array(
      ctx.faker.helpers.multiple(() => ctx.faker.number.int({ min: 0, max: 255 }), {
        count: { min: 4, max: 16 },
      }),
    ),
};

/** Scalar types that can hold a string. */
export const STRING_TYPES: readonly ScalarType[] = [ScalarType.STRING];

/** Scalar types represented as a JavaScript `number`. */
export const NUMBER_TYPES: readonly ScalarType[] = [
  ScalarType.DOUBLE,
  ScalarType.FLOAT,
  ScalarType.INT32,
  ScalarType.SINT32,
  ScalarType.SFIXED32,
  ScalarType.UINT32,
  ScalarType.FIXED32,
];

/** Signed and unsigned 32-bit integer types. */
export const INT32_TYPES: readonly ScalarType[] = [
  ScalarType.INT32,
  ScalarType.SINT32,
  ScalarType.SFIXED32,
  ScalarType.UINT32,
  ScalarType.FIXED32,
];

/** All 64-bit integer types, which protobuf-es represents as `bigint`. */
export const INT64_TYPES: readonly ScalarType[] = [
  ScalarType.INT64,
  ScalarType.SINT64,
  ScalarType.SFIXED64,
  ScalarType.UINT64,
  ScalarType.FIXED64,
];

/** Types a map key may be declared as. */
export const MAP_KEY_TYPES: readonly ScalarType[] = [
  ScalarType.STRING,
  ScalarType.BOOL,
  ...INT32_TYPES,
  ...INT64_TYPES,
];

/**
 * Generates a scalar value of the given type, honouring the `scalars` option.
 */
export function generateScalar(type: ScalarType, ctx: MockContext): unknown {
  const generator: ScalarGenerator | undefined = ctx.options.scalars[type];
  if (generator === undefined) {
    throw new Error(`protofaker: no generator registered for scalar type ${String(type)}`);
  }
  return generator(ctx);
}

/**
 * Generates a map key. Keys have to be unique within a map, so callers retry;
 * to keep retries from spinning, integer keys are drawn from a small range and
 * strings from a word list wide enough to make collisions rare.
 */
export function generateMapKey(type: ScalarType, ctx: MockContext): unknown {
  switch (type) {
    case ScalarType.STRING:
      return ctx.faker.lorem.word();
    case ScalarType.BOOL:
      return ctx.faker.datatype.boolean();
    case ScalarType.INT64:
    case ScalarType.SINT64:
    case ScalarType.SFIXED64:
      return BigInt(ctx.faker.number.int({ min: -1000, max: 1000 }));
    case ScalarType.UINT64:
    case ScalarType.FIXED64:
      return BigInt(ctx.faker.number.int({ min: 0, max: 1000 }));
    case ScalarType.UINT32:
    case ScalarType.FIXED32:
      return ctx.faker.number.int({ min: 0, max: 1000 });
    default:
      return ctx.faker.number.int({ min: -1000, max: 1000 });
  }
}
