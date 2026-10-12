import "server-only";
import type { P2aDatabase } from "@/lib/db/client";
import type { StudioWriteCredentials } from "@/lib/auth/write";
import type { MediaOperationContext } from "../server/media/contracts";
import type {
  Page,
  PrepareValidation,
  PreparedValidationDto,
  StartValidation,
  StartValidationResult,
  ValidationCas,
  ValidationDto,
  ValidationListQuery,
} from "./contracts";
/** One handler-start context and exclusive DB; cancellation permanently invalidates that DB. */
export type ValidationContext = MediaOperationContext;
export interface QuizpackValidationService {
  prepareValidation(
    db: P2aDatabase,
    credentials: StudioWriteCredentials,
    productId: string,
    importId: string,
    input: PrepareValidation,
    context: ValidationContext,
  ): Promise<PreparedValidationDto>;
  startValidation(
    db: P2aDatabase,
    credentials: StudioWriteCredentials,
    productId: string,
    importId: string,
    input: StartValidation,
    context: ValidationContext,
  ): Promise<StartValidationResult>;
  readValidation(
    db: P2aDatabase,
    token: string | null,
    productId: string,
    importId: string,
    validationId: string,
  ): Promise<ValidationDto>;
  listValidations(
    db: P2aDatabase,
    token: string | null,
    productId: string,
    importId: string,
    query: ValidationListQuery,
  ): Promise<Page<ValidationDto>>;
  recoverValidation(
    db: P2aDatabase,
    credentials: StudioWriteCredentials,
    productId: string,
    importId: string,
    validationId: string,
    input: ValidationCas,
    context: ValidationContext,
  ): Promise<ValidationDto>;
  retryValidation(
    db: P2aDatabase,
    credentials: StudioWriteCredentials,
    productId: string,
    importId: string,
    validationId: string,
    input: ValidationCas,
    context: ValidationContext,
  ): Promise<ValidationDto>;
}
