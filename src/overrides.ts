import { ScalarType } from "@bufbuild/protobuf";
import type { DescField } from "@bufbuild/protobuf";
import type { Heuristic, MockContext, Override, OverrideFn, Overrides } from "./types.js";
import { INT32_TYPES, NUMBER_TYPES, STRING_TYPES } from "./scalars.js";

/**
 * Normalizes one path segment so that `postal_code`, `postalCode` and
 * `PostalCode` are all the same key.
 */
export function normalizeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function normalizePath(path: string): string {
  return path.split(".").map(normalizeSegment).join(".");
}

// Normalizing every override key on every field lookup is wasteful, and the
// overrides object is stable for the length of a run, so the index is cached
// against it.
const indexCache = new WeakMap<Overrides, Map<string, Override>>();

function indexOf(overrides: Overrides): Map<string, Override> {
  let index = indexCache.get(overrides);
  if (index === undefined) {
    index = new Map<string, Override>();
    for (const [key, value] of Object.entries(overrides)) {
      index.set(normalizePath(key), value);
    }
    indexCache.set(overrides, index);
  }
  return index;
}

/**
 * Every override key that could apply to a field, most specific first.
 *
 * Exported so that the matching rules can be tested directly, and so callers
 * can see why a given override did or did not fire.
 */
export function overrideCandidates(path: string, field: DescField): string[] {
  const segments = path.split(".");
  const candidates: string[] = [];
  // Progressively shorter suffixes of the path from the root, down to two
  // segments: `Person.address.city`, then `address.city`.
  for (let i = 0; i + 2 <= segments.length; i++) {
    candidates.push(segments.slice(i).join("."));
  }
  // `Address.city` — the message that declares the field, rather than the path
  // taken to reach it.
  candidates.push(`${field.parent.name}.${field.name}`);
  // A bare field name matches wherever it appears.
  candidates.push(field.name);
  return candidates;
}

/** The result of looking a field up in the overrides. */
export interface OverrideMatch {
  /** The override key that matched, in its normalized form. */
  readonly key: string;
  readonly override: Override;
}

/** Finds the most specific override for a field, if any. */
export function findOverride(
  path: string,
  field: DescField,
  overrides: Overrides,
): OverrideMatch | undefined {
  const index = indexOf(overrides);
  if (index.size === 0) {
    return undefined;
  }
  for (const candidate of overrideCandidates(path, field)) {
    const normalized = normalizePath(candidate);
    if (index.has(normalized)) {
      return { key: normalized, override: index.get(normalized) as Override };
    }
  }
  return undefined;
}

/**
 * Resolves an override to a value. Functions are called; anything else is
 * returned as-is.
 */
export function applyOverride(override: Override, ctx: MockContext): unknown {
  return typeof override === "function" ? (override as OverrideFn)(ctx) : override;
}

const ALL_INTS: readonly ScalarType[] = INT32_TYPES;

/**
 * Field-name heuristics, checked in order. The first whose name and scalar
 * type both match wins.
 *
 * These are what make `mock()` produce something that reads like real data
 * instead of lorem ipsum. They are on by default; pass `heuristics: false` to
 * get purely type-driven values.
 */
export const defaultHeuristics: readonly Heuristic[] = [
  // Identifiers.
  {
    names: ["id", "uuid", "guid", "userid", "personid", "accountid", "requestid", "traceid"],
    types: STRING_TYPES,
    generate: (ctx) => ctx.faker.string.uuid(),
  },
  { names: ["id", "userid", "accountid"], types: ALL_INTS, generate: (ctx) => ctx.faker.number.int({ min: 1, max: 1_000_000 }) },
  { names: ["slug"], types: STRING_TYPES, generate: (ctx) => ctx.faker.lorem.slug() },
  {
    names: ["token", "apikey", "secret", "accesstoken", "refreshtoken"],
    types: STRING_TYPES,
    generate: (ctx) => ctx.faker.string.alphanumeric(32),
  },

  // People.
  {
    names: ["email", "emailaddress", "mail"],
    types: STRING_TYPES,
    generate: (ctx) => ctx.faker.internet.email(),
  },
  { names: ["firstname", "givenname"], types: STRING_TYPES, generate: (ctx) => ctx.faker.person.firstName() },
  { names: ["lastname", "surname", "familyname"], types: STRING_TYPES, generate: (ctx) => ctx.faker.person.lastName() },
  {
    names: ["name", "fullname", "displayname", "personname"],
    types: STRING_TYPES,
    generate: (ctx) => ctx.faker.person.fullName(),
  },
  { names: ["username", "handle", "login", "nickname"], types: STRING_TYPES, generate: (ctx) => ctx.faker.internet.username() },
  {
    names: ["phone", "phonenumber", "mobile", "telephone", "tel"],
    types: STRING_TYPES,
    generate: (ctx) => ctx.faker.phone.number(),
  },
  { names: ["age"], types: ALL_INTS, generate: (ctx) => ctx.faker.number.int({ min: 0, max: 99 }) },
  { names: ["gender"], types: STRING_TYPES, generate: (ctx) => ctx.faker.person.gender() },
  { names: ["jobtitle", "job", "title", "occupation"], types: STRING_TYPES, generate: (ctx) => ctx.faker.person.jobTitle() },
  { names: ["bio", "biography", "about"], types: STRING_TYPES, generate: (ctx) => ctx.faker.person.bio() },

  // Addresses.
  { names: ["street", "streetaddress", "address", "addressline1", "line1"], types: STRING_TYPES, generate: (ctx) => ctx.faker.location.streetAddress() },
  { names: ["city", "town", "locality"], types: STRING_TYPES, generate: (ctx) => ctx.faker.location.city() },
  { names: ["state", "province", "region"], types: STRING_TYPES, generate: (ctx) => ctx.faker.location.state() },
  { names: ["postalcode", "zip", "zipcode", "postcode"], types: STRING_TYPES, generate: (ctx) => ctx.faker.location.zipCode() },
  { names: ["country"], types: STRING_TYPES, generate: (ctx) => ctx.faker.location.country() },
  { names: ["countrycode"], types: STRING_TYPES, generate: (ctx) => ctx.faker.location.countryCode() },
  { names: ["timezone", "tz"], types: STRING_TYPES, generate: (ctx) => ctx.faker.location.timeZone() },
  { names: ["latitude", "lat"], types: NUMBER_TYPES, generate: (ctx) => ctx.faker.location.latitude() },
  { names: ["longitude", "lng", "lon"], types: NUMBER_TYPES, generate: (ctx) => ctx.faker.location.longitude() },

  // Internet.
  { names: ["url", "uri", "link", "website", "homepage"], types: STRING_TYPES, generate: (ctx) => ctx.faker.internet.url() },
  { names: ["imageurl", "avatarurl", "avatar", "photourl", "thumbnailurl"], types: STRING_TYPES, generate: (ctx) => ctx.faker.image.url() },
  { names: ["domain", "domainname", "host", "hostname"], types: STRING_TYPES, generate: (ctx) => ctx.faker.internet.domainName() },
  { names: ["ip", "ipaddress", "ipv4"], types: STRING_TYPES, generate: (ctx) => ctx.faker.internet.ipv4() },
  { names: ["ipv6"], types: STRING_TYPES, generate: (ctx) => ctx.faker.internet.ipv6() },
  { names: ["mac", "macaddress"], types: STRING_TYPES, generate: (ctx) => ctx.faker.internet.mac() },
  { names: ["useragent"], types: STRING_TYPES, generate: (ctx) => ctx.faker.internet.userAgent() },
  { names: ["port"], types: ALL_INTS, generate: (ctx) => ctx.faker.internet.port() },
  { names: ["password"], types: STRING_TYPES, generate: (ctx) => ctx.faker.internet.password() },
  { names: ["mimetype", "contenttype"], types: STRING_TYPES, generate: (ctx) => ctx.faker.system.mimeType() },
  { names: ["filename", "file"], types: STRING_TYPES, generate: (ctx) => ctx.faker.system.fileName() },

  // Commerce and business.
  { names: ["company", "companyname", "organization", "org"], types: STRING_TYPES, generate: (ctx) => ctx.faker.company.name() },
  { names: ["product", "productname"], types: STRING_TYPES, generate: (ctx) => ctx.faker.commerce.productName() },
  { names: ["price", "amount", "cost", "total"], types: NUMBER_TYPES, generate: (ctx) => ctx.faker.number.float({ min: 0, max: 10_000, fractionDigits: 2 }) },
  { names: ["currency", "currencycode"], types: STRING_TYPES, generate: (ctx) => ctx.faker.finance.currencyCode() },
  { names: ["iban"], types: STRING_TYPES, generate: (ctx) => ctx.faker.finance.iban() },
  { names: ["color", "colour"], types: STRING_TYPES, generate: (ctx) => ctx.faker.color.rgb() },
  { names: ["count", "quantity", "size", "length"], types: ALL_INTS, generate: (ctx) => ctx.faker.number.int({ min: 0, max: 1000 }) },
  { names: ["version"], types: STRING_TYPES, generate: (ctx) => ctx.faker.system.semver() },

  // Text.
  { names: ["description", "summary", "comment", "note", "notes", "message", "body", "text"], types: STRING_TYPES, generate: (ctx) => ctx.faker.lorem.sentence() },

  // Timestamps that are modelled as strings rather than google.protobuf.Timestamp.
  {
    names: ["createdat", "updatedat", "deletedat", "modifiedat", "timestamp", "date", "time", "expiresat"],
    types: STRING_TYPES,
    generate: (ctx) => ctx.faker.date.recent({ days: 30, refDate: ctx.options.refDate }).toISOString(),
  },
  {
    names: ["createdat", "updatedat", "deletedat", "modifiedat", "timestamp", "expiresat", "epoch", "unixtime"],
    types: [...INT32_TYPES, ScalarType.INT64, ScalarType.UINT64, ScalarType.SINT64, ScalarType.SFIXED64, ScalarType.FIXED64],
    generate: (ctx) => {
      const recent = ctx.faker.date.recent({ days: 30, refDate: ctx.options.refDate });
      return Math.floor(recent.getTime() / 1000);
    },
  },
];

/**
 * Finds the heuristic that applies to a field, if heuristics are enabled.
 *
 * `extraHeuristics` are checked before the built-in table, so a caller can
 * shadow any of it without replacing the whole thing.
 */
export function findHeuristic(
  field: DescField,
  scalar: ScalarType,
  ctx: MockContext,
): Heuristic | undefined {
  if (!ctx.options.heuristics && ctx.options.extraHeuristics.length === 0) {
    return undefined;
  }
  const name = normalizeSegment(field.name);
  const tables = ctx.options.heuristics
    ? [ctx.options.extraHeuristics, defaultHeuristics]
    : [ctx.options.extraHeuristics];
  for (const table of tables) {
    for (const heuristic of table) {
      if (heuristic.names.includes(name) && heuristic.types.includes(scalar)) {
        return heuristic;
      }
    }
  }
  return undefined;
}
