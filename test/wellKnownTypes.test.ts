import { describe, expect, it } from "vitest";
import { fromBinary, toBinary, toJson } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { BUFAKER_EPOCH, mock, UNSUPPORTED_WELL_KNOWN_TYPES, wellKnownGenerators } from "../src/index.js";
import {
  RepeatedWellKnownSchema,
  UnsupportedSchema,
  WellKnownSchema,
} from "./fixtures/gen/bufaker/test/v1/wkt_pb.js";

describe("google.protobuf.Timestamp", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("produces a valid instant shortly before the reference date", () => {
    const m = mock(WellKnownSchema, { seed: 1 });
    expect(m.createdAt).toBeDefined();
    const ms = timestampDate(m.createdAt!).getTime();
    // A seeded run is pinned to BUFAKER_EPOCH so it stays reproducible.
    expect(ms).toBeLessThanOrEqual(BUFAKER_EPOCH.getTime());
    expect(BUFAKER_EPOCH.getTime() - ms).toBeLessThan(31 * DAY);
    expect(m.createdAt!.nanos).toBeGreaterThanOrEqual(0);
    expect(m.createdAt!.nanos).toBeLessThan(1_000_000_000);
  });

  it("is recent relative to now when unseeded", () => {
    const ms = timestampDate(mock(WellKnownSchema).createdAt!).getTime();
    expect(ms).toBeLessThanOrEqual(Date.now() + 1000);
    expect(Date.now() - ms).toBeLessThan(31 * DAY);
  });

  it("follows an explicit refDate", () => {
    const refDate = new Date("2030-06-15T12:00:00.000Z");
    const ms = timestampDate(mock(WellKnownSchema, { seed: 1, refDate }).createdAt!).getTime();
    expect(ms).toBeLessThanOrEqual(refDate.getTime());
    expect(refDate.getTime() - ms).toBeLessThan(31 * DAY);
  });

  it("stays valid for a pre-1970 reference date", () => {
    // Splitting milliseconds by hand gets this wrong: JavaScript's % yields a
    // negative remainder for negative timestamps, producing negative nanos.
    const refDate = new Date("1960-06-15T00:00:00.000Z");
    for (let seed = 0; seed < 25; seed++) {
      const m = mock(WellKnownSchema, { seed, refDate });
      expect(m.createdAt!.nanos).toBeGreaterThanOrEqual(0);
      expect(m.createdAt!.nanos).toBeLessThan(1_000_000_000);
      expect(m.createdAt!.seconds).toBeLessThan(0n);
      // The JSON encoder enforces the Timestamp invariants, so this is the
      // check that actually matters.
      expect(() => toJson(WellKnownSchema, m)).not.toThrow();
      expect(timestampDate(m.createdAt!).getTime()).toBeLessThanOrEqual(refDate.getTime());
    }
  });

  it("is reproducible for a seed regardless of when it runs", () => {
    // The whole point of `seed`: no wall-clock time may leak in.
    expect(mock(WellKnownSchema, { seed: 99 }).createdAt).toEqual(
      mock(WellKnownSchema, { seed: 99 }).createdAt,
    );
  });
});

describe("google.protobuf.Duration", () => {
  it("produces seconds and nanos that agree in sign", () => {
    for (let seed = 0; seed < 20; seed++) {
      const m = mock(WellKnownSchema, { seed });
      expect(m.timeout!.seconds).toBeGreaterThanOrEqual(0n);
      expect(m.timeout!.nanos).toBeGreaterThanOrEqual(0);
      expect(m.timeout!.nanos).toBeLessThan(1_000_000_000);
    }
  });
});

describe("wrapper types", () => {
  // protobuf-es unwraps the google.protobuf.*Value types in generated code:
  // a `StringValue` field is typed `string | undefined`, not a message. The
  // walker writes through reflection, which performs that conversion, so the
  // values below are bare scalars rather than wrappers.
  it("unwraps to a value of the wrapped scalar's type", () => {
    const m = mock(WellKnownSchema, { seed: 1 });
    expect(typeof m.nickname).toBe("string");
    expect(typeof m.retries).toBe("number");
    expect(typeof m.bigCount).toBe("bigint");
    expect(typeof m.unsignedRetries).toBe("number");
    expect(typeof m.bigUnsigned).toBe("bigint");
    expect(typeof m.enabled).toBe("boolean");
    expect(typeof m.ratio).toBe("number");
    expect(typeof m.score).toBe("number");
    expect(m.blob).toBeInstanceOf(Uint8Array);
  });

  it("respects each wrapped type's range", () => {
    for (let seed = 0; seed < 20; seed++) {
      const m = mock(WellKnownSchema, { seed });
      expect(m.unsignedRetries!).toBeGreaterThanOrEqual(0);
      expect(m.unsignedRetries!).toBeLessThanOrEqual(4294967295);
      expect(m.bigUnsigned!).toBeGreaterThanOrEqual(0n);
      expect(Math.fround(m.score!)).toBe(m.score!);
      expect(Number.isInteger(m.retries!)).toBe(true);
    }
  });

  it("distinguishes an unset wrapper from a zero value", () => {
    // A wrapper exists precisely to make "0" and "absent" different, so the
    // walker must actually set it rather than leave it out.
    const m = mock(WellKnownSchema, { seed: 1 });
    expect(m.nickname).not.toBeUndefined();
    expect(m.enabled).not.toBeUndefined();
  });
});

describe("Struct, Value and ListValue", () => {
  // protobuf-es types a `Struct` field as JsonObject, while `Value` and
  // `ListValue` fields stay messages.
  it("generates a JSON-like object for a Struct field", () => {
    const m = mock(WellKnownSchema, { seed: 1 });
    expect(m.metadata).toBeTypeOf("object");
    expect(Object.keys(m.metadata!).length).toBeGreaterThan(0);
    // Everything in it must be representable as JSON.
    expect(() => JSON.stringify(m.metadata)).not.toThrow();
  });

  it("generates a Value with exactly one branch set", () => {
    const m = mock(WellKnownSchema, { seed: 1 });
    expect(m.anyValue!.kind.case).toBeDefined();
  });

  it("generates a non-empty ListValue", () => {
    // Unlike Struct, a ListValue field stays a message in generated code.
    const m = mock(WellKnownSchema, { seed: 1 });
    expect(m.values!.$typeName).toBe("google.protobuf.ListValue");
    expect(m.values!.values.length).toBeGreaterThan(0);
    for (const v of m.values!.values) {
      expect(v.kind.case).toBeDefined();
    }
  });

  it("bounds how deeply a Struct nests", () => {
    // Struct/Value/ListValue are mutually recursive with no schema-level
    // bottom, so the generator carries its own depth budget.
    for (let seed = 0; seed < 30; seed++) {
      expect(() => mock(WellKnownSchema, { seed })).not.toThrow();
    }
  });

  it("covers every Value branch across seeds", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const m = mock(WellKnownSchema, { seed });
      seen.add(m.anyValue!.kind.case as string);
    }
    expect(seen).toEqual(
      new Set(["nullValue", "numberValue", "stringValue", "boolValue", "structValue", "listValue"]),
    );
  });
});

describe("google.protobuf.Empty", () => {
  it("is generated as an empty message rather than skipped", () => {
    const m = mock(WellKnownSchema, { seed: 1 });
    expect(m.nothing).toBeDefined();
    expect(m.nothing!.$typeName).toBe("google.protobuf.Empty");
  });
});

describe("unsupported well-known types", () => {
  it("names Any and FieldMask", () => {
    expect([...UNSUPPORTED_WELL_KNOWN_TYPES].sort()).toEqual([
      "google.protobuf.Any",
      "google.protobuf.FieldMask",
    ]);
  });

  it("leaves them unset instead of throwing", () => {
    for (let seed = 0; seed < 20; seed++) {
      const m = mock(UnsupportedSchema, { seed });
      expect(m.payload).toBeUndefined();
      expect(m.updateMask).toBeUndefined();
      // The rest of the message is still populated.
      expect(m.alwaysSet).toBeTypeOf("string");
      expect(m.alwaysSet).not.toBe("");
    }
  });
});

describe("well-known types in lists and maps", () => {
  it("populates repeated and mapped well-known values", () => {
    const m = mock(RepeatedWellKnownSchema, { seed: 1, listLength: 2, mapSize: 2 });
    expect(m.timestamps).toHaveLength(2);
    for (const t of m.timestamps) {
      expect(t.$typeName).toBe("google.protobuf.Timestamp");
    }
    const durations = Object.values(m.durations);
    expect(durations.length).toBeGreaterThan(0);
    for (const d of durations) {
      expect(d.$typeName).toBe("google.protobuf.Duration");
    }
  });
});

describe("serialization", () => {
  it("round-trips a message full of well-known types", () => {
    for (let seed = 0; seed < 25; seed++) {
      const m = mock(WellKnownSchema, { seed });
      expect(fromBinary(WellKnownSchema, toBinary(WellKnownSchema, m))).toEqual(m);
    }
  });
});

describe("the generator table", () => {
  it("is keyed by fully-qualified type name and is overridable", () => {
    expect(Object.keys(wellKnownGenerators)).toContain("google.protobuf.Timestamp");
    expect(Object.keys(wellKnownGenerators).every((k) => k.startsWith("google.protobuf."))).toBe(true);
  });
});
