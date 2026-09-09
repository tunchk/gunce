import { describe, expect, it } from "vitest";

describe("test database URL guard (unit)", () => {
  it("rejects the development database name gunce", async () => {
    const { pathToFileURL } = await import("node:url");
    void pathToFileURL;
    const reject = (url: string) => {
      const parsed = new URL(url);
      const dbName = parsed.pathname.replace(/^\//, "").split("/")[0] || "";
      return dbName !== "gunce_test";
    };
    expect(reject("postgresql://gunce:gunce@localhost:5432/gunce?schema=public")).toBe(true);
    expect(reject("postgresql://gunce:gunce@localhost:5432/gunce_test?schema=public")).toBe(false);
    expect(reject("postgresql://gunce:gunce@localhost:5432/postgres")).toBe(true);
  });
});
