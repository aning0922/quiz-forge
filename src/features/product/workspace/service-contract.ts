import "server-only";
import type { P2aDatabase } from "@/lib/db/client";
import type { StudioWriteCredentials } from "@/lib/auth/write";
import type {
  Page,
  ProductDto,
  ProductCreate,
  ProductReplaceMetadata,
  ProductLifecycle,
  ProductMutation,
  ProductListQuery,
  TaxonomyKind,
  TaxonomyDto,
  TaxonomyCreate,
  TaxonomyRename,
  TaxonomyLifecycle,
  TaxonomyMutation,
  TaxonomyListQuery,
} from "./contracts";

/** Frozen signatures for service.ts; this declaration does not pretend to execute CRUD. */
export interface WorkspaceService {
  listProducts(
    database: P2aDatabase,
    sessionToken: string | null,
    query: ProductListQuery,
  ): Promise<Page<ProductDto>>;
  readProduct(
    database: P2aDatabase,
    sessionToken: string | null,
    productId: string,
  ): Promise<ProductDto>;
  createProduct(
    database: P2aDatabase,
    credentials: StudioWriteCredentials,
    input: ProductCreate,
  ): Promise<ProductDto>;
  replaceProductMetadata(
    database: P2aDatabase,
    credentials: StudioWriteCredentials,
    productId: string,
    input: ProductReplaceMetadata,
  ): Promise<ProductMutation>;
  archiveProduct(
    database: P2aDatabase,
    credentials: StudioWriteCredentials,
    productId: string,
    input: ProductLifecycle,
  ): Promise<ProductMutation>;
  restoreProduct(
    database: P2aDatabase,
    credentials: StudioWriteCredentials,
    productId: string,
    input: ProductLifecycle,
  ): Promise<ProductMutation>;
  listTaxonomy(
    database: P2aDatabase,
    sessionToken: string | null,
    kind: TaxonomyKind,
    query: TaxonomyListQuery,
  ): Promise<Page<TaxonomyDto>>;
  createTaxonomy(
    database: P2aDatabase,
    credentials: StudioWriteCredentials,
    kind: TaxonomyKind,
    input: TaxonomyCreate,
  ): Promise<TaxonomyDto>;
  renameTaxonomy(
    database: P2aDatabase,
    credentials: StudioWriteCredentials,
    kind: TaxonomyKind,
    id: string,
    input: TaxonomyRename,
  ): Promise<TaxonomyMutation>;
  archiveTaxonomy(
    database: P2aDatabase,
    credentials: StudioWriteCredentials,
    kind: TaxonomyKind,
    id: string,
    input: TaxonomyLifecycle,
  ): Promise<TaxonomyMutation>;
  restoreTaxonomy(
    database: P2aDatabase,
    credentials: StudioWriteCredentials,
    kind: TaxonomyKind,
    id: string,
    input: TaxonomyLifecycle,
  ): Promise<TaxonomyMutation>;
}
