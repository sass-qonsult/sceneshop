# SceneShop Commerce Resolution & Attribution R0.1

## Principle
A Commerce Track identifies what is commercially active in a scene. It does not freeze the seller, marketplace, price or CTA. Those are resolved at interaction time under an organization-governed routing policy.

## Runtime flow
1. Consumer selects a published Product/Placement.
2. SceneShop validates it against the current Commerce Track.
3. Resolver evaluates organization, Product/Asset, Work, Placement, Campaign, territory, availability and validity windows.
4. Most-specific eligible Routing Policy is selected: `Placement > Campaign > Work > Product > Territory/Global`.
5. Authorized offers are ordered by strategy (`PRIORITY`, `FIRST_AVAILABLE`, `LOWEST_PRICE`, `BRAND_DIRECT_FIRST`).
6. A 30-minute Resolution freezes the exact ordered offer set presented to the consumer.
7. Public payload exposes SceneShop activation URLs, not merchant destination URLs.
8. Activation is recorded first; SceneShop then performs an HTTP/HTTPS redirect to the authorized destination.

## Attribution/privacy
- Viewer/device identifier is stored only as SHA-256 in the Resolution.
- Resolution freezes provider, connection, price, CTA, commission and ordering as presented.
- Activation is first-party SceneShop evidence before the external redirect.
- Raw destination URLs stay server-side in the public consumer path.

## Studio preview
`POST /api/commerce/resolve-preview` evaluates the same routing logic for the selected organization without creating a Resolution or attribution record. It is intended for commercial validation before campaign publication.
