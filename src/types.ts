import type { Faker } from "@faker-js/faker";
import type { DescEnum, DescField, DescMessage, ScalarType } from "@bufbuild/protobuf";

/**
 * A range of counts. A bare number means "exactly this many".
 */
export type CountRange = number | readonly [min: number, max: number];

/**
 * Everything a generator function is told about the value it is producing.
 *
 * The same context object shape is handed to scalar generators, heuristics and
 * user overrides, so a generator written for one can be reused in another.
 */
export interface MockContext {
  /** The faker instance driving this run. Seeded when `seed` was passed. */
  readonly faker: Faker;
  /**
   * Dotted path from the root message to this field, using proto field names
   * and rooted at the fully-qualified message name — for example
   * `bufaker.test.v1.Person.address.city`.
   *
   * List elements and map values do not add a path segment: every element of
   * `Person.nicknames` has the path `…Person.nicknames`.
   */
  readonly path: string;
  /** The field being generated. `undefined` for a root message. */
  readonly field: DescField | undefined;
  /** The message that declares `field`. */
  readonly message: DescMessage;
  /** Fully-qualified names of the messages currently being recursed through. */
  readonly stack: readonly string[];
  /** Message nesting depth. The root message is 0. */
  readonly depth: number;
  /** The resolved options for this run. */
  readonly options: ResolvedMockOptions;
}

/**
 * Produces a value for a field. Called once per value — a repeated field with
 * three elements calls it three times.
 */
export type OverrideFn = (ctx: MockContext) => unknown;

/**
 * Any value an override may hold that is not a generator function.
 *
 * Spelled out rather than written as `unknown`, because `OverrideFn | unknown`
 * collapses to `unknown` and TypeScript then has no signature to contextually
 * type `(ctx) => …` against, leaving `ctx` an implicit `any`.
 */
export type StaticOverride =
  | string
  | number
  | bigint
  | boolean
  | symbol
  | null
  | undefined
  | object;

/**
 * An override is either a generator function or a literal value.
 *
 * A function is always treated as a generator. To use a function as a literal
 * value, return it from a generator: `() => myFunction`.
 */
export type Override = OverrideFn | StaticOverride;

/**
 * Overrides keyed by field path.
 *
 * Keys are matched against the field's path from the root message, and the
 * longest match wins, so more specific keys beat less specific ones:
 *
 * ```ts
 * {
 *   "email": () => "fallback@example.com",   // any field named `email`
 *   "Person.email": () => "person@example.com", // only Person's
 *   "Person.address.city": "Berlin",         // a literal value
 * }
 * ```
 *
 * Segment matching ignores case and underscores, so `postal_code` and
 * `postalCode` are the same key.
 */
export type Overrides = Record<string, Override>;

/** Generates a value for one proto scalar type. */
export type ScalarGenerator = (ctx: MockContext) => unknown;

/** A generator per proto scalar type. */
export type ScalarGenerators = Record<ScalarType, ScalarGenerator>;

/**
 * A field-name heuristic: when `test` matches a field's name and the field's
 * scalar type is in `types`, `generate` produces the value.
 */
export interface Heuristic {
  /** Normalized field names (lowercase, no underscores) this applies to. */
  readonly names: readonly string[];
  /** Scalar types this heuristic can produce a valid value for. */
  readonly types: readonly ScalarType[];
  readonly generate: ScalarGenerator;
}

export interface MockOptions {
  /**
   * Seed faker before generating, making the result reproducible.
   *
   * Applies to the whole call: `mockList(Schema, 3, { seed: 1 })` produces
   * three different messages, but the same three every time.
   */
  seed?: number;
  /**
   * Maximum message nesting depth below the root. Message-typed fields deeper
   * than this are left unset, which is what stops self-referential and
   * mutually-recursive schemas from recursing forever.
   *
   * @default 3
   */
  maxDepth?: number;
  /**
   * Number of elements generated for a repeated field.
   * @default [1, 3]
   */
  listLength?: CountRange;
  /**
   * Number of entries generated for a map field. A `map<bool, …>` is capped at
   * two entries regardless, since it has only two possible keys.
   * @default [1, 3]
   */
  mapSize?: CountRange;
  /**
   * Include the zero value (conventionally `*_UNSPECIFIED`) when picking an
   * enum value. An enum whose only member is the zero value always yields it.
   * @default false
   */
  includeZeroEnumValue?: boolean;
  /**
   * Apply the built-in field-name heuristics (`email` → an email address,
   * `id` → a UUID, and so on). Overrides always win over heuristics.
   * @default true
   */
  heuristics?: boolean;
  /**
   * Extra heuristics, checked before the built-in ones.
   * @default []
   */
  extraHeuristics?: readonly Heuristic[];
  /**
   * Probability (0–1) that a field with explicit presence — a proto3
   * `optional` or a proto2 field — is set at all.
   * @default 1
   */
  optionalFieldChance?: number;
  /**
   * Probability (0–1) that a oneof group has a member selected. At 1 every
   * oneof is populated.
   * @default 1
   */
  oneofChance?: number;
  /** Per-field generators. See {@link Overrides}. */
  overrides?: Overrides;
  /**
   * Replace individual scalar generators. Missing entries fall back to the
   * built-in table.
   */
  scalars?: Partial<ScalarGenerators>;
  /**
   * Reference point for generated dates: a `google.protobuf.Timestamp`, and
   * the date heuristics, produce values shortly before it.
   *
   * Defaults to the current time — except when `seed` is set, where it
   * defaults to {@link SEEDED_REF_DATE}. Wall-clock time would otherwise leak
   * into a seeded run and stop it being reproducible, which is the one thing
   * `seed` is for. Set this explicitly to control both cases.
   */
  refDate?: Date | number;
  /**
   * Use this faker instance instead of bufaker's own. Passing your own
   * instance means `seed` seeds yours.
   */
  faker?: Faker;
}

/** {@link MockOptions} with defaults applied. */
export interface ResolvedMockOptions {
  readonly faker: Faker;
  readonly maxDepth: number;
  readonly listLength: readonly [number, number];
  readonly mapSize: readonly [number, number];
  readonly includeZeroEnumValue: boolean;
  readonly heuristics: boolean;
  readonly extraHeuristics: readonly Heuristic[];
  readonly optionalFieldChance: number;
  readonly oneofChance: number;
  readonly overrides: Overrides;
  readonly scalars: ScalarGenerators;
  readonly refDate: Date;
}

/** Picks a value for an enum field. Exported for testing and reuse. */
export type EnumPicker = (desc: DescEnum, ctx: MockContext) => number;
