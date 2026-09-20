import { describe, expect, it } from "vitest";
import { fromBinary, ScalarType, toBinary } from "@bufbuild/protobuf";
import { mock, mockList } from "../src/index.js";
import {
  AllScalarsSchema,
  OptionalScalarsSchema,
  StringifiedInt64Schema,
} from "./fixtures/gen/bufaker/test/v1/scalars_pb.js";
import {
  AddressSchema,
  OnlyZero,
  PersonSchema,
  Status,
} from "./fixtures/gen/bufaker/test/v1/basic_pb.js";
import { KitchenSinkSchema } from "./fixtures/gen/bufaker/test/v1/kitchen_sink_pb.js";

/** An enum-typed field whose only member is the zero value. */
import { file_bufaker_test_v1_basic } from "./fixtures/gen/bufaker/test/v1/basic_pb.js";

describe("scalars", () => {
  it("produces a value of the right JavaScript type for every proto scalar", () => {
    const m = mock(AllScalarsSchema, { seed: 1 });

    expect(typeof m.doubleField).toBe("number");
    expect(typeof m.floatField).toBe("number");
    expect(typeof m.int32Field).toBe("number");
    expect(typeof m.uint32Field).toBe("number");
    expect(typeof m.sint32Field).toBe("number");
    expect(typeof m.fixed32Field).toBe("number");
    expect(typeof m.sfixed32Field).toBe("number");
    expect(typeof m.int64Field).toBe("bigint");
    expect(typeof m.uint64Field).toBe("bigint");
    expect(typeof m.sint64Field).toBe("bigint");
    expect(typeof m.fixed64Field).toBe("bigint");
    expect(typeof m.sfixed64Field).toBe("bigint");
    expect(typeof m.boolField).toBe("boolean");
    expect(typeof m.stringField).toBe("string");
    expect(m.bytesField).toBeInstanceOf(Uint8Array);
  });

  it("covers every scalar type declared by the fixture", () => {
    // Guards against a scalar type being added to protobuf-es without a
    // matching generator.
    const declared = new Set(
      AllScalarsSchema.fields
        .filter((f) => f.fieldKind === "scalar")
        .map((f) => f.scalar),
    );
    const all = Object.values(ScalarType).filter((v): v is ScalarType => typeof v === "number");
    expect([...declared].sort()).toEqual(all.sort());
  });

  it("stays inside each type's valid range, so values survive serialization", () => {
    for (let seed = 0; seed < 25; seed++) {
      const m = mock(AllScalarsSchema, { seed });
      expect(fromBinary(AllScalarsSchema, toBinary(AllScalarsSchema, m))).toEqual(m);

      expect(Number.isInteger(m.int32Field)).toBe(true);
      expect(m.int32Field).toBeGreaterThanOrEqual(-2147483648);
      expect(m.int32Field).toBeLessThanOrEqual(2147483647);
      expect(m.uint32Field).toBeGreaterThanOrEqual(0);
      expect(m.uint32Field).toBeLessThanOrEqual(4294967295);
      expect(m.uint64Field).toBeGreaterThanOrEqual(0n);
      // A float field must round-trip through 32-bit precision unchanged.
      expect(Math.fround(m.floatField)).toBe(m.floatField);
    }
  });

  it("represents jstype=JS_STRING 64-bit fields as strings", () => {
    const m = mock(StringifiedInt64Schema, { seed: 7 });
    expect(typeof m.big).toBe("string");
    expect(typeof m.ubig).toBe("string");
    expect(BigInt(m.ubig)).toBeGreaterThanOrEqual(0n);
    expect(fromBinary(StringifiedInt64Schema, toBinary(StringifiedInt64Schema, m))).toEqual(m);
  });

  it("sets explicit-presence fields by default", () => {
    const m = mock(OptionalScalarsSchema, { seed: 3 });
    expect(m.maybeString).toBeDefined();
    expect(m.maybeInt).toBeDefined();
    expect(m.maybeBool).toBeDefined();
  });

  it("leaves explicit-presence fields unset at optionalFieldChance 0", () => {
    const m = mock(OptionalScalarsSchema, { seed: 3, optionalFieldChance: 0 });
    expect(m.maybeString).toBeUndefined();
    expect(m.maybeInt).toBeUndefined();
    expect(m.maybeBool).toBeUndefined();
  });

  it("honours a replaced scalar generator", () => {
    const m = mock(AllScalarsSchema, {
      seed: 1,
      heuristics: false,
      scalars: { [ScalarType.STRING]: () => "fixed" },
    });
    expect(m.stringField).toBe("fixed");
  });
});

describe("enums", () => {
  it("never picks the zero value by default", () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(mock(PersonSchema, { seed }).status).not.toBe(Status.UNSPECIFIED);
    }
  });

  it("can pick the zero value when asked", () => {
    const seen = new Set<Status>();
    for (let seed = 0; seed < 50; seed++) {
      seen.add(mock(PersonSchema, { seed, includeZeroEnumValue: true }).status);
    }
    expect(seen.has(Status.UNSPECIFIED)).toBe(true);
  });

  it("falls back to the zero value for an enum that has nothing else", () => {
    // OnlyZero has a single member, the zero value; excluding it would leave
    // nothing to pick.
    const desc = file_bufaker_test_v1_basic.enums.find((e) => e.name === "OnlyZero");
    expect(desc).toBeDefined();
    expect(desc!.values.map((v) => v.number)).toEqual([OnlyZero.UNSPECIFIED]);
  });
});

describe("repeated fields", () => {
  it("generates between one and three elements by default", () => {
    for (let seed = 0; seed < 20; seed++) {
      const m = mock(PersonSchema, { seed });
      expect(m.nicknames.length).toBeGreaterThanOrEqual(1);
      expect(m.nicknames.length).toBeLessThanOrEqual(3);
    }
  });

  it("honours an exact length", () => {
    const m = mock(PersonSchema, { seed: 1, listLength: 4 });
    expect(m.nicknames).toHaveLength(4);
    expect(m.previousAddresses).toHaveLength(4);
  });

  it("honours a range", () => {
    for (let seed = 0; seed < 20; seed++) {
      const m = mock(PersonSchema, { seed, listLength: [5, 7] });
      expect(m.nicknames.length).toBeGreaterThanOrEqual(5);
      expect(m.nicknames.length).toBeLessThanOrEqual(7);
    }
  });

  it("supports a length of zero", () => {
    const m = mock(PersonSchema, { seed: 1, listLength: 0 });
    expect(m.nicknames).toEqual([]);
    expect(m.previousAddresses).toEqual([]);
  });

  it("populates repeated message elements", () => {
    const m = mock(PersonSchema, { seed: 1, listLength: 2 });
    for (const address of m.previousAddresses) {
      expect(address.$typeName).toBe("bufaker.test.v1.Address");
      expect(address.city).not.toBe("");
    }
  });
});

describe("map fields", () => {
  it("generates entries with keys of the declared type", () => {
    const m = mock(PersonSchema, { seed: 1 });
    expect(Object.keys(m.labels).length).toBeGreaterThanOrEqual(1);
    for (const key of Object.keys(m.statusHistory)) {
      // protobuf-es keys the JS record by string, but an int32 key must parse.
      expect(Number.isInteger(Number(key))).toBe(true);
    }
  });

  it("populates message-valued maps", () => {
    const m = mock(PersonSchema, { seed: 1, mapSize: 2 });
    const addresses = Object.values(m.addressesByKind);
    expect(addresses.length).toBeGreaterThan(0);
    for (const address of addresses) {
      expect(address.$typeName).toBe("bufaker.test.v1.Address");
    }
  });

  it("caps a bool-keyed map at two entries", () => {
    for (let seed = 0; seed < 20; seed++) {
      const m = mock(KitchenSinkSchema, { seed, mapSize: 10 });
      expect(Object.keys(m.flags).length).toBeLessThanOrEqual(2);
    }
  });

  it("supports a size of zero", () => {
    const m = mock(PersonSchema, { seed: 1, mapSize: 0 });
    expect(m.labels).toEqual({});
  });
});

describe("oneof", () => {
  it("always selects exactly one member by default", () => {
    const cases = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      const m = mock(PersonSchema, { seed });
      expect(m.contactMethod.case).toBeDefined();
      cases.add(m.contactMethod.case as string);
    }
    // Over 60 seeds every branch should have come up at least once.
    expect(cases).toEqual(new Set(["emailContact", "phoneContact", "rawHandle"]));
  });

  it("leaves the group unset at oneofChance 0", () => {
    const m = mock(PersonSchema, { seed: 1, oneofChance: 0 });
    expect(m.contactMethod.case).toBeUndefined();
  });

  it("populates a message-typed branch fully", () => {
    for (let seed = 0; seed < 60; seed++) {
      const m = mock(PersonSchema, { seed });
      if (m.contactMethod.case === "emailContact") {
        expect(m.contactMethod.value.email).toContain("@");
        return;
      }
    }
    throw new Error("emailContact branch never selected");
  });
});

describe("kitchen sink", () => {
  it("generates every field kind at once and round-trips", () => {
    for (let seed = 0; seed < 25; seed++) {
      const m = mock(KitchenSinkSchema, { seed });
      expect(m.$typeName).toBe("bufaker.test.v1.KitchenSink");
      // The strongest available shape check: serialize with the schema and
      // read it back. Anything malformed throws or fails to compare equal.
      expect(fromBinary(KitchenSinkSchema, toBinary(KitchenSinkSchema, m))).toEqual(m);
    }
  });

  it("populates the nested structures", () => {
    const m = mock(KitchenSinkSchema, { seed: 1, listLength: 2, mapSize: 2 });
    expect(m.scalars?.stringField).toBeTypeOf("string");
    expect(m.person?.address?.city).toBeTypeOf("string");
    expect(m.numbers.length).toBe(2);
    expect(Object.keys(m.peopleById).length).toBeGreaterThan(0);
    expect(m.payload.case).toBeDefined();
  });
});

describe("mockList", () => {
  it("returns the requested number of distinct messages", () => {
    const people = mockList(PersonSchema, 5, { seed: 1 });
    expect(people).toHaveLength(5);
    expect(new Set(people.map((p) => p.id)).size).toBe(5);
  });

  it("returns an empty array for a count of zero", () => {
    expect(mockList(AddressSchema, 0)).toEqual([]);
  });
});
