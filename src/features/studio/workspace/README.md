# Studio workspace presentation (V2-B)

The authenticated shell owns one responsive navigation and one account owner.
The server supplies the initial session; same-owner recovery updates the live
identity only after explicit confirmation. Ordinary internal navigation advances
request acceptance without revoking the retained owner. Actual logout, login and
authority failure still invalidate old work. Navigation never grants permission.

The product directory uses the existing bounded operations read model. Product
metadata, current draft, exact review and testing facts remain distinct. Historical
approved content does not approve the current draft. Suggested actions depend on
the current role; unknown reads never imply an empty or approved state. The list
uses a desktop table and mobile cards, with compact category/tag popups and
explicit server-side filter application. No artwork, sales, participation totals
or business progress are inferred from prototype data.

One product workspace exposes four tasks: content, preview, review and testing.
Its canonical route is `/studio/products/[productId]?task=...`. Generic legacy
content/preview/import/version/settings pages and the old six-step navigation
were removed. Exact import/validation, revision, preview/review and version object
routes remain real current features and use the same four-task frame. Fixed
`draftId`/`revision` query targets never silently fall back to the latest revision.
History and metadata use one drawer, short operations use one retained task
modal, and the actual preview uses a large view. A summary refresh does not
remount the original File input, pending write, fixed preview or selected history.

Creation uses the same form in the task modal and `/studio/new-product`.
Empty close ends the task; actual input can be retained or explicitly discarded.
UNKNOWN and CAS keep the original operation, identity and inputs. Directory
metadata reads do not settle uncertain writes. Product metadata and taxonomy
continue through existing services and server permissions, without new database
fields or global operations endpoints.

The root leave boundary registers live dirty/pending state. Sidebar logout checks
it both before opening and before sending. Only a confirmed logout response
permits its one document exit; failed or external-stale responses cannot clear
pending tasks or trigger a replay. Account setup links and access codes are only
available through their original private result flow, never through history.

Current delivery evidence and remaining limits are in `docs/S1_ACCEPTANCE.md`.
Component probes use actual React with synthetic HTTP; production browser and
isolated PostgreSQL evidence are recorded separately. Existing unchanged service,
transaction, scoring, report and recovery evidence is reused.
