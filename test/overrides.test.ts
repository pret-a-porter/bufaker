import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { mock, normalizeSegment, overrideCandidates } from "../src/index.js";
import type { MockContext } from "../src/index.js";
import {
  AddressSchema,
  EmailContactSchema,
  PersonSchema,
} from "./fixtures/gen/bufaker/test/v1/basic_pb.js";
import { AllScalarsSchema } from "./fixtures/gen/bufaker/test/v1/scalars_pb.js";

const cityField = AddressSchema.fields.find((f) => f.name === "city")!;

describe("key matching", () => {
  it("normalizes case and underscores", () => {
    expect(normalizeSegment("postal_code")).toBe("postalcode");
    expect(normalizeSegment("postalCode")).toBe("postalcode");
    expect(normalizeSegment("PostalCode")).toBe("postalcode");
  });

  it("offers candidates from most to least specific", () => {
    expect(overrideCandidates("bufaker.test.v1.Person.address.city", cityField)).toEqual([
      "bufaker.test.v1.Person.address.city",
      "test.v1.Person.address.city",
      "v1.Person.address.city",
      "Person.address.city",
      "address.city",
      "Address.city",
      "city",
    ]);
  });
});

describe("overrides", () => {
  it("applies a bare field name wherever it appears", () => {
    const m = mock(PersonSchema, { seed: 1, overrides: { city: "Springfield" } });
    expect(m.address?.city).toBe("Springfield");
    for (const a of m.previousAddresses) {
      expect(a.city).toBe("Springfield");
    }
  });

  it("applies a literal value without calling it", () => {
    const m = mock(PersonSchema, { seed: 1, overrides: { name: "Ada Lovelace" } });
    expect(m.name).toBe("Ada Lovelace");
  });

  it("calls a generator function once per value", () => {
    let calls = 0;
    const m = mock(PersonSchema, {
      seed: 1,
      listLength: 3,
      mapSize: 0,
      overrides: { street: () => `street ${++calls}` },
    });
    // One for Person.address, three for the three previous addresses.
    expect(calls).toBe(4);
    expect(m.address?.street).toBe("street 1");
    expect(m.previousAddresses.map((a) => a.street)).toEqual([
      "street 2",
      "street 3",
      "street 4",
    ]);
  });

  it("prefers a path-qualified key over a bare name", () => {
    const m = mock(PersonSchema, {
      seed: 1,
      overrides: {
        city: "generic",
        "Person.address.city": "specific",
      },
    });
    expect(m.address?.city).toBe("specific");
    // The bare key still covers the addresses reached by another path.
    for (const a of m.previousAddresses) {
      expect(a.city).toBe("generic");
    }
  });

  it("matches a fully-qualified path", () => {
    const m = mock(PersonSchema, {
      seed: 1,
      overrides: { "bufaker.test.v1.Person.id": "fq" },
    });
    expect(m.id).toBe("fq");
  });

  it("matches by declaring message type", () => {
    const m = mock(PersonSchema, { seed: 1, overrides: { "Address.country": "Atlantis" } });
    expect(m.address?.country).toBe("Atlantis");
    for (const a of m.previousAddresses) {
      expect(a.country).toBe("Atlantis");
    }
  });

  it("ignores case and underscores in keys", () => {
    const m = mock(PersonSchema, { seed: 1, overrides: { postal_code: "00000" } });
    expect(m.address?.postalCode).toBe("00000");
  });

  it("replaces an entire repeated field", () => {
    const m = mock(PersonSchema, { seed: 1, overrides: { nicknames: ["a", "b"] } });
    expect(m.nicknames).toEqual(["a", "b"]);
  });

  it("replaces an entire map field", () => {
    const m = mock(PersonSchema, { seed: 1, overrides: { labels: { env: "prod" } } });
    expect(m.labels).toEqual({ env: "prod" });
  });

  it("replaces a message field with a constructed message", () => {
    const address = create(AddressSchema, { city: "Nowhere" });
    const m = mock(PersonSchema, { seed: 1, overrides: { "Person.address": address } });
    expect(m.address).toBe(address);
  });

  it("leaves a field unset when the generator returns undefined", () => {
    const m = mock(PersonSchema, { seed: 1, overrides: { "Person.address": () => undefined } });
    expect(m.address).toBeUndefined();
  });

  it("selects the oneof branch that an override targets", () => {
    for (let seed = 0; seed < 20; seed++) {
      const m = mock(PersonSchema, {
        seed,
        overrides: { rawHandle: "@ada" },
      });
      expect(m.contactMethod).toEqual({ case: "rawHandle", value: "@ada" });
    }
  });

  it("selects a message-typed oneof branch that an override targets", () => {
    const contact = create(EmailContactSchema, { email: "a@b.c", verified: true });
    for (let seed = 0; seed < 10; seed++) {
      const m = mock(PersonSchema, { seed, overrides: { emailContact: contact } });
      expect(m.contactMethod.case).toBe("emailContact");
    }
  });

  it("hands the generator a context describing the field", () => {
    const contexts: MockContext[] = [];
    mock(PersonSchema, {
      seed: 1,
      listLength: 1,
      mapSize: 1,
      overrides: {
        city: (ctx) => {
          contexts.push(ctx);
          return "x";
        },
      },
    });
    // Address is reached three ways: a singular field, a repeated field and a
    // map value. List elements and map values add no path segment of their own.
    expect(contexts.length).toBe(3);
    const paths = contexts.map((c) => c.path).sort();
    expect(paths).toEqual([
      "bufaker.test.v1.Person.address.city",
      "bufaker.test.v1.Person.addresses_by_kind.city",
      "bufaker.test.v1.Person.previous_addresses.city",
    ]);
    expect(contexts[0]!.field?.name).toBe("city");
    expect(contexts[0]!.message.typeName).toBe("bufaker.test.v1.Address");
    expect(contexts[0]!.depth).toBe(1);
    expect(contexts[0]!.stack).toEqual([
      "bufaker.test.v1.Person",
      "bufaker.test.v1.Address",
    ]);
    expect(contexts[0]!.faker).toBeDefined();
  });

  it("wins over a heuristic", () => {
    const m = mock(PersonSchema, { seed: 1, overrides: { email: "not-an-email" } });
    expect(m.email).toBe("not-an-email");
  });
});

describe("heuristics", () => {
  it("produces realistic values for recognised names by default", () => {
    const m = mock(PersonSchema, { seed: 1 });
    expect(m.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(m.email).toContain("@");
    expect(m.name).toMatch(/\s/);
    expect(m.age).toBeGreaterThanOrEqual(0);
    expect(m.age).toBeLessThanOrEqual(99);
  });

  it("can be turned off", () => {
    const m = mock(PersonSchema, { seed: 1, heuristics: false });
    expect(m.email).not.toContain("@");
    expect(m.id).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("only applies to compatible scalar types", () => {
    // `id` maps to a uuid for strings and to an integer for int fields; a
    // heuristic must never hand a string to an int32 field.
    const m = mock(PersonSchema, { seed: 1 });
    expect(typeof m.id).toBe("string");
    expect(typeof m.age).toBe("number");
  });

  it("does not fire for unrecognised names", () => {
    const m = mock(AllScalarsSchema, { seed: 1 });
    expect(typeof m.stringField).toBe("string");
  });

  it("accepts extra heuristics that shadow the built-ins", () => {
    const m = mock(PersonSchema, {
      seed: 1,
      extraHeuristics: [
        {
          names: ["email"],
          types: [9], // ScalarType.STRING
          generate: () => "custom@example.com",
        },
      ],
    });
    expect(m.email).toBe("custom@example.com");
  });

  it("applies extra heuristics even when the built-ins are off", () => {
    const m = mock(PersonSchema, {
      seed: 1,
      heuristics: false,
      extraHeuristics: [{ names: ["name"], types: [9], generate: () => "Only" }],
    });
    expect(m.name).toBe("Only");
    expect(m.email).not.toContain("@");
  });
});
