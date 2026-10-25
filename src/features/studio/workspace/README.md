# Studio workspace presentation (S1)

The authenticated Studio shell owns one responsive navigation. The original
`WorkspaceNav` export remains as a no-op for existing page imports. The shell
receives a presentation-only `authenticated` prop from the server layout, which
uses the existing page-session read. The shell stays portable for browser
captures without importing server-only authentication. Each page and API still
checks its own authority. Navigation is never a write capability.
Login/unavailable entry markers also suppress retained layout navigation during
client routing; this is presentation and does not grant or clear session authority.
Global navigation does not prefetch authenticated pages. The auth browser suite
also revokes its own synthetic session through the real logout API, then follows
a client-side workspace link without the panel's router refresh and checks the
login presentation. Ordinary button logout remains covered at the other widths.

Global link activation also emits the existing same-window authority invalidation
in capture phase, before routing. It does not broadcast a logout to other tabs.
Menu expansion and empty navigation space do not revoke. The focused real-shell
synthetic HTTP/browser regression is `tests/browser/studio-consumer.ts
--navigation-only` (run with the root tsconfig and an installed Playwright browser).
It retains the old mount while preventing only destination navigation, tests
pointer/Enter and another live tab, and releases delayed authorization/POST
responses to prove old work cannot resume or replace the original pending record.
This is browser/controller evidence with synthetic HTTP, not real DB authorization
or production E2E. Without that argument the original scenarios still run.

The product list links to `/studio/new-product`, outside the product ID namespace.
The original create form, POST and exact submitted-ID reconciliation live in
`product-create.tsx`. Read-only direct visits render the read-only notice.

Product metadata state, mutation and reconciliation stay in `ProductEditor`.
Only its ordinary fields and submit form are inside the native details element
with summary “编辑测评信息”. Closing it keeps the form mounted. Product status,
unknown/CAS reconciliation and archive/restore controls remain outside. Normal
identity/version support fields are expandable; uncertainty shows the exact
product identity and local metadata version next to recovery. `InternalAuthorityProvider` and `StableInternalWorkspace` retain
their original product-keyed relationship; workspace read errors do not unmount
the independent recovery section. Presentation does not turn a current GET into
proof that a previous uncertain write succeeded.

Existing workspace CSS class names remain available to other Studio domains.
S1 adds layout classes without modifying flow/controller/storage/HTTP, product
contracts, preview/consumer renderers, or frozen implementation descriptors.

The workspace browser suite now enters the separate create page and explicitly
expands editing. It retains the original response-loss, CAS, read-only, taxonomy
association and cleanup assertions, and adds single responsive navigation,
keyboard opening, wide-content, form persistence and visible unknown recovery
checks. These browser assertions and screenshots require the root-owned real
synthetic environment; authoring/typechecking them is not a browser pass.

The business usability follow-up uses “测评名称/保存测评信息/分类”, highlights
real import/content links, and keeps archival in a secondary section with its
original confirmation. Creation still explicitly requires the immutable package
product ID and a unique slug, now explained as 测评编号/测评英文标识 with examples;
there is no automatic identity generation or uncertain-write identity change.
Taxonomy pickers compact only confirmed unfiltered first-page empty options;
search misses and later empty pages keep recovery/search/navigation. Selected
and archived associations and the read hook stay mounted. Management opens in a
separate tab to preserve this form, with an explicit reload control on return.
Typechecking and representative browser checks are performed once by integration;
unchanged authority/CAS/unknown semantics reuse the existing S1 evidence.

## V2-A1 catalog

The catalog uses the existing ProductDto fields only: title, immutable ID, slug,
primary category, tags, archive status and directory updatedAt. Desktop uses a
semantic table, mobile a card list. No artwork, description, content stage,
preview approval, access-code totals or global business progress is inferred.
The existing API still orders by createdAt descending, then ID ascending; the
updatedAt column is directory metadata time, not a new sort or content timestamp.

`list-query.ts` reuses parseWorkspaceQuery and productListQuerySchema. Filters,
page and pageSize round-trip through the address. Duplicate, unsupported,
non-canonical or contradictory parameters render explicit reset/back recovery
without mounting the product reader. Valid but not yet resolved category/tag
IDs remain selected; the picker never invents a TaxonomySummary or silently
clears a valid deep-link filter because its name is not on the current page.
Search matches exactly the existing name/ID/slug API, not tag text. Every
applied filter and page change issues the original server query; current-page
rows are never used to simulate global filtering.

`catalog-location.ts` only pushes this read-only list's query and subscribes to
popstate plus its own update event. It does not patch global routing or persist
form data. Reload and browser history reconstruct committed query state, while
unsubmitted list filters remain ordinary local input. A reset also clears local
filter controls when the committed URL already points at the default list.

ProductCreateForm, ProductEditor, TaxonomyCreateForm and TaxonomyRow register
actual dirty fields and mutation.blocked with root's useStudioLeaveProtection.
Metadata dirty comparison uses association IDs, so refreshed directory labels or
tag ordering do not manufacture unsaved changes. Create success marks only its
own registration saved after a confirmed ProductDto, then replaces the document
with the existing detail URL. UNKNOWN/CAS never call markSaved. An UNKNOWN creation lookup that finds a current
ProductDto offers an explicit new-tab server-record link; it does not settle the
original operation or unload the blocked original form. The existing
mutation, explicit reconciliation, source identities, read authority, archive
confirmations and locally held input stay in the original component. Creation
input also participates in the existing taxonomy kind-switch guard.

Targeted pure checks cover strict URL recovery/round trips and unsaved metadata
identity. The workspace browser suite includes real reload/Back/Forward and an
invalid-address zero-product-read case. Browser execution, shared boundary,
login/logout/deep-link integration and the new isolated demo remain root-owned;
authored browser assertions are not a browser pass. No A2 aggregation API, six-tab
workspace or new database field is part of A1.
