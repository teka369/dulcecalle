import { Test } from "@nestjs/testing";
import { CatalogModule } from "./catalog.module";
import { CatalogService } from "./catalog.service";
import { CLOUDINARY_FETCH, MediaService } from "./media.service";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Regression test for the Render boot crash:
 * `Nest can't resolve dependencies of the MediaService (PrismaService, ?)`
 *
 * The `?` was the bare `fetch` function parameter, which Nest cannot map
 * to any provider. `CLOUDINARY_FETCH` is now an explicit token registered
 * in `CatalogModule`. Compiling the REAL module metadata (not a hand-built
 * provider list) guarantees the fix holds: if anyone adds another
 * unresolvable constructor parameter, this test fails before Render does.
 */
describe("CatalogModule dependency injection", () => {
  it("compiles and resolves CatalogService + MediaService", async () => {
    const prismaMock = {
      product: { findFirst: async () => null },
      productImage: {
        findFirst: async () => null,
        findMany: async () => [],
        findUnique: async () => null,
      },
      $transaction: async () => ({}),
    };
    const fetchMock = async () =>
      new Response(JSON.stringify({ result: "ok" }), { status: 200 });

    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, CatalogModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(CLOUDINARY_FETCH)
      .useValue(fetchMock)
      .compile();

    expect(moduleRef.get(CatalogService, { strict: false })).toBeDefined();
    expect(moduleRef.get(MediaService, { strict: false })).toBeDefined();

    await moduleRef.close();
  });

  it("exposes CLOUDINARY_FETCH as an overridable provider", async () => {
    const fetchMock = async () => new Response("{}", { status: 200 });
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, CatalogModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ product: {}, productImage: {}, $transaction: async () => ({}) })
      .overrideProvider(CLOUDINARY_FETCH)
      .useValue(fetchMock)
      .compile();

    expect(moduleRef.get(CLOUDINARY_FETCH, { strict: false })).toBe(fetchMock);

    await moduleRef.close();
  });
});
