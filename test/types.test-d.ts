import { describe, expectTypeOf, it } from "vitest";
import type { MessageShape } from "@bufbuild/protobuf";
import { mock, mockList } from "../src/index.js";
import type { MockContext } from "../src/index.js";
import {
  AddressSchema,
  PersonSchema,
  Status,
  TreeNodeSchema,
} from "./fixtures/gen/bufaker/test/v1/basic_pb.js";
import type { Address, Person, TreeNode } from "./fixtures/gen/bufaker/test/v1/basic_pb.js";
import { AllScalarsSchema } from "./fixtures/gen/bufaker/test/v1/scalars_pb.js";
import { KitchenSinkSchema } from "./fixtures/gen/bufaker/test/v1/kitchen_sink_pb.js";
import type { KitchenSink } from "./fixtures/gen/bufaker/test/v1/kitchen_sink_pb.js";

describe("mock() return type", () => {
  it("is inferred from the schema, with no cast needed", () => {
    expectTypeOf(mock(PersonSchema)).toEqualTypeOf<Person>();
    expectTypeOf(mock(AddressSchema)).toEqualTypeOf<Address>();
    expectTypeOf(mock(TreeNodeSchema)).toEqualTypeOf<TreeNode>();
    expectTypeOf(mock(KitchenSinkSchema)).toEqualTypeOf<KitchenSink>();
  });

  it("matches MessageShape of the schema for an arbitrary descriptor", () => {
    expectTypeOf(mock(PersonSchema)).toEqualTypeOf<MessageShape<typeof PersonSchema>>();
    expectTypeOf(mock(AllScalarsSchema)).toEqualTypeOf<MessageShape<typeof AllScalarsSchema>>();
  });

  it("carries through to the generated field types", () => {
    const person = mock(PersonSchema);
    expectTypeOf(person.id).toEqualTypeOf<string>();
    expectTypeOf(person.age).toEqualTypeOf<number>();
    expectTypeOf(person.status).toEqualTypeOf<Status>();
    expectTypeOf(person.address).toEqualTypeOf<Address | undefined>();
    expectTypeOf(person.nicknames).toEqualTypeOf<string[]>();
    expectTypeOf(person.previousAddresses).toEqualTypeOf<Address[]>();
    expectTypeOf(person.labels).toEqualTypeOf<{ [key: string]: string }>();
  });

  it("preserves 64-bit and jstype representations", () => {
    const scalars = mock(AllScalarsSchema);
    expectTypeOf(scalars.int64Field).toEqualTypeOf<bigint>();
    expectTypeOf(scalars.bytesField).toEqualTypeOf<Uint8Array>();
    expectTypeOf(scalars.doubleField).toEqualTypeOf<number>();
  });

  it("preserves the oneof discriminated union", () => {
    const person = mock(PersonSchema);
    if (person.contactMethod.case === "rawHandle") {
      expectTypeOf(person.contactMethod.value).toEqualTypeOf<string>();
    }
  });
});

describe("mockList() return type", () => {
  it("is an array of the schema's message type", () => {
    expectTypeOf(mockList(PersonSchema, 3)).toEqualTypeOf<Person[]>();
  });
});

describe("options", () => {
  it("types the override context", () => {
    mock(PersonSchema, {
      overrides: {
        email: (ctx) => {
          expectTypeOf(ctx).toEqualTypeOf<MockContext>();
          expectTypeOf(ctx.path).toEqualTypeOf<string>();
          expectTypeOf(ctx.depth).toEqualTypeOf<number>();
          return ctx.faker.internet.email();
        },
      },
    });
  });

  it("accepts a number or a range for lengths", () => {
    mock(PersonSchema, { listLength: 3, mapSize: [1, 2] });
  });

  it("rejects an unknown option", () => {
    // @ts-expect-error `depth` is not an option; the option is `maxDepth`.
    mock(PersonSchema, { depth: 2 });
  });

  it("rejects a non-descriptor first argument", () => {
    // @ts-expect-error a plain object is not a DescMessage.
    mock({ typeName: "nope" });
  });
});
