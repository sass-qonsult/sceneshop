# SceneShop Governed Commerce Core R0.1

## Doctrine
The Commerce Track does not freeze price, seller or marketplace. It points to a governed Product/CommercialAsset. Commerce Core resolves current authorized commercial destinations separately.

## Domain
Organization → Sponsor/Brand → Campaign → Product/CommercialAsset → Merchant Connection → External Offer → Routing Policy.

## Provider abstraction
Providers are capabilities, not dependencies. SceneShop supports brand-direct, custom/private stores, Amazon, Mercado Livre, Shopee, lead generation, dealer locator and reservation through the same provider contract.

## Governance
- Every Sponsor, Campaign, Merchant Connection, External Offer and Routing Policy is organization-scoped.
- `COMMERCE_READ` and `COMMERCE_WRITE` capabilities control access.
- Organization MFA policy applies to write operations.
- Offers may define independent commission, price, currency, territory, validity, availability and CTA.
- Routing policies authorize the offer set and the ordering strategy.

## Routing strategies
- `PRIORITY`
- `FIRST_AVAILABLE`
- `LOWEST_PRICE`
- `BRAND_DIRECT_FIRST`

## Security boundary
Tenant isolation is enforced at repository/database level. A routing policy cannot authorize an offer belonging to another organization.
