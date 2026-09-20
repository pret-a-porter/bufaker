import { create } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { Faker, en } from "@faker-js/faker";

import { defaultScalarGenerators } from "./scalars.js";
import type { MockContext, MockOptions, ResolvedMockOptions } from "./types.js";
import { generateMessage } from "./walker.js";

export type {
  CountRange,
  EnumPicker,
  Heuristic,
  MockContext,
  MockOptions,
  Override,
  OverrideFn,
  Overrides,
  ResolvedMockOptions,
  ScalarGenerator,
  ScalarGenerators,
} from "./types.js";

export {
  defaultScalarGenerators,
  generateMapKey,
  generateScalar,
  INT32_TYPES,
  INT64_TYPES,
  MAP_KEY_TYPES,
  NUMBER_TYPES,
  STRING_TYPES,
} from "./scalars.js";
export {
  applyOverride,
  defaultHeuristics,
  findHeuristic,
  findOverride,
  normalizeSegment,
  overrideCandidates,
} from "./overrides.js";
export type { OverrideMatch } from "./overrides.js";
export {
  getWellKnownGenerator,
  UNSUPPORTED_WELL_KNOWN_TYPES,
  wellKnownGenerators,
} from "./wellKnownTypes.js";
export type { WellKnownGenerator } from "./wellKnownTypes.js";
export { canDescend, recursionCount } from "./cycles.js";
export { generateMessage, pickEnumValue } from "./walker.js";

/**
 * bufaker's own faker instance.
 *
 * Kept separate from the `faker` export of `@faker-js/faker` so that seeding a
 * mock never disturbs a caller's own faker state, and vice versa. Pass your
 * own instance via `options.faker` if you want them shared.
 */
export const bufakerFaker = new Faker({ locale: en });

/**
 * The reference date a seeded run uses when `refDate` is not given:
 * 2024-01-01T00:00:00Z.
 *
 * A seeded mock has to be reproducible tomorrow as well as today, so it cannot
 * take its dates from the wall clock.
 */
export const BUFAKER_EPOCH = new Date("2024-01-01T00:00:00.000Z");

const DEFAULT_LIST_LENGTH: readonly [number, number] = [1, 3];
const DEFAULT_MAP_SIZE: readonly [number, number] = [1, 3];
const DEFAULT_MAX_DEPTH = 3;

/** Applies bufaker's defaults to a partial set of options. */
export function resolveOptions(options: MockOptions = {}): ResolvedMockOptions {
  return {
    faker: options.faker ?? bufakerFaker,
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    listLength: normalizeRange(options.listLength, DEFAULT_LIST_LENGTH),
    mapSize: normalizeRange(options.mapSize, DEFAULT_MAP_SIZE),
    includeZeroEnumValue: options.includeZeroEnumValue ?? false,
    heuristics: options.heuristics ?? true,
    extraHeuristics: options.extraHeuristics ?? [],
    optionalFieldChance: options.optionalFieldChance ?? 1,
    oneofChance: options.oneofChance ?? 1,
    overrides: options.overrides ?? {},
    scalars: { ...defaultScalarGenerators, ...options.scalars },
    refDate: resolveRefDate(options),
  };
}

function resolveRefDate(options: MockOptions): Date {
  if (options.refDate !== undefined) {
    return new Date(options.refDate);
  }
  return options.seed !== undefined ? BUFAKER_EPOCH : new Date();
}

function normalizeRange(
  range: MockOptions["listLength"],
  fallback: readonly [number, number],
): readonly [number, number] {
  if (range === undefined) return fallback;
  if (typeof range === "number") return [range, range];
  return range;
}

function rootContext(schema: DescMessage, resolved: ResolvedMockOptions): MockContext {
  return {
    faker: resolved.faker,
    path: schema.typeName,
    field: undefined,
    message: schema,
    stack: [schema.typeName],
    depth: 0,
    options: resolved,
  };
}

/**
 * Generates a mock message from its protobuf-es schema.
 *
 * ```ts
 * import { mock } from "bufaker";
 * import { PersonSchema } from "./gen/person_pb.js";
 *
 * const person = mock(PersonSchema);          // fully typed as Person
 * const stable = mock(PersonSchema, { seed: 42 });
 * ```
 *
 * The return type is inferred from the schema, so there is nothing to cast.
 */
export function mock<Desc extends DescMessage>(
  schema: Desc,
  options: MockOptions = {},
): MessageShape<Desc> {
  const resolved = resolveOptions(options);
  if (options.seed !== undefined) {
    resolved.faker.seed(options.seed);
  }
  const message = generateMessage(schema, rootContext(schema, resolved));
  // `undefined` means the root type is one bufaker does not mock (Any,
  // FieldMask); an empty message of the right type is the honest answer.
  return (message ?? create(schema)) as MessageShape<Desc>;
}

/**
 * Generates `count` mock messages.
 *
 * A `seed` applies to the call as a whole: the messages differ from each
 * other, but the same seed always produces the same sequence.
 */
export function mockList<Desc extends DescMessage>(
  schema: Desc,
  count: number,
  options: MockOptions = {},
): MessageShape<Desc>[] {
  const resolved = resolveOptions(options);
  if (options.seed !== undefined) {
    resolved.faker.seed(options.seed);
  }
  const out: MessageShape<Desc>[] = [];
  for (let i = 0; i < count; i++) {
    const message = generateMessage(schema, rootContext(schema, resolved));
    out.push((message ?? create(schema)) as MessageShape<Desc>);
  }
  return out;
}
