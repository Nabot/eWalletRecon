import { describe, expect, it } from "vitest";
import {
  DESTRUCTIVE_SEED_CONFIRM,
  assertSafeToSeed,
  isLocalDatabaseHost,
  looksLikeManagedRemoteHost,
  parseDatabaseHost,
} from "../prisma/seedSafety";

describe("seedSafety", () => {
  it("parses mysql hosts", () => {
    expect(
      parseDatabaseHost("mysql://u:p@localhost:3306/ewallet_recon"),
    ).toBe("localhost");
    expect(
      parseDatabaseHost(
        "mysql://u:p@db-mysql-nyc1-example.ondigitalocean.com:25060/ewallet?sslaccept=strict",
      ),
    ).toBe("db-mysql-nyc1-example.ondigitalocean.com");
  });

  it("classifies local vs remote hosts", () => {
    expect(isLocalDatabaseHost("localhost")).toBe(true);
    expect(isLocalDatabaseHost("127.0.0.1")).toBe(true);
    expect(isLocalDatabaseHost("mysql")).toBe(true);
    expect(isLocalDatabaseHost("db.example.com")).toBe(false);
    expect(looksLikeManagedRemoteHost("db.ondigitalocean.com")).toBe(true);
    expect(looksLikeManagedRemoteHost("localhost")).toBe(false);
  });

  it("allows local development seed", () => {
    expect(() =>
      assertSafeToSeed({
        NODE_ENV: "development",
        DATABASE_URL: "mysql://ewallet:ewallet@localhost:3306/ewallet_recon",
      }),
    ).not.toThrow();
  });

  it("blocks production NODE_ENV", () => {
    expect(() =>
      assertSafeToSeed({
        NODE_ENV: "production",
        DATABASE_URL: "mysql://ewallet:ewallet@localhost:3306/ewallet_recon",
      }),
    ).toThrow(/NODE_ENV=production/);
  });

  it("blocks DigitalOcean hosts", () => {
    expect(() =>
      assertSafeToSeed({
        NODE_ENV: "development",
        DATABASE_URL:
          "mysql://u:p@db-mysql-nyc1-example.ondigitalocean.com:25060/ewallet?sslaccept=accept_invalid_certificates",
      }),
    ).toThrow(/not a local database/);
  });

  it("blocks unknown remote hosts", () => {
    expect(() =>
      assertSafeToSeed({
        NODE_ENV: "development",
        DATABASE_URL: "mysql://u:p@api.example.com:3306/ewallet",
      }),
    ).toThrow(/not a local database/);
  });

  it("allows explicit destructive override", () => {
    expect(() =>
      assertSafeToSeed({
        NODE_ENV: "production",
        DATABASE_URL: "mysql://u:p@db.ondigitalocean.com:25060/ewallet",
        ALLOW_DESTRUCTIVE_SEED: DESTRUCTIVE_SEED_CONFIRM,
      }),
    ).not.toThrow();
  });
});
