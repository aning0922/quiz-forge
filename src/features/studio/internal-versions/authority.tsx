"use client";
import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { StudioClientError } from "../client";
const authorityErrors = new Set([
  "UNAUTHENTICATED",
  "CAPABILITY_DENIED",
  "CSRF_REJECTED",
  "ORIGIN_REJECTED",
]);
declare const authorityTicket: unique symbol;
export type InternalAuthorityTicket = Readonly<{
  generation: number;
  [authorityTicket]: true;
}>;
/** Local acceptance authority only. A fresh authenticated page must create a new instance after revocation. */
export class InternalProductAuthority {
  private generation = 0;
  private revoked = false;
  private tickets = new WeakSet<InternalAuthorityTicket>();
  private listeners = new Set<() => void>();
  constructor(readonly productId: string) {}
  getSnapshot = () => this.generation;
  getServerSnapshot = () => 0;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  get isRevoked() {
    return this.revoked;
  }
  capture() {
    const ticket = Object.freeze({
      generation: this.generation,
    }) as InternalAuthorityTicket;
    this.tickets.add(ticket);
    return ticket;
  }
  accepts(ticket: InternalAuthorityTicket) {
    return (
      !this.revoked &&
      this.tickets.has(ticket) &&
      ticket.generation === this.generation
    );
  }
  observe(error: unknown) {
    if (
      !(error instanceof StudioClientError) ||
      !authorityErrors.has(error.code) ||
      this.revoked
    )
      return;
    this.revoked = true;
    this.generation++;
    for (const listener of this.listeners) listener();
  }
}
const Context = createContext<InternalProductAuthority | undefined>(undefined);
export function InternalAuthorityProvider({
  productId,
  children,
}: {
  productId: string;
  children: ReactNode;
}) {
  const [authority] = useState(() => new InternalProductAuthority(productId));
  if (authority.productId !== productId)
    throw Error("INTERNAL_PRODUCT_AUTHORITY_SCOPE_CHANGED");
  return <Context.Provider value={authority}>{children}</Context.Provider>;
}
export function useInternalAuthority() {
  const authority = useContext(Context);
  if (!authority) throw Error("INTERNAL_PRODUCT_AUTHORITY_REQUIRED");
  useSyncExternalStore(
    authority.subscribe,
    authority.getSnapshot,
    authority.getServerSnapshot,
  );
  return authority;
}
