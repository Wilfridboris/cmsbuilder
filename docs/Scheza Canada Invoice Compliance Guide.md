# Scheza Canada Invoice Compliance Guide

## Executive position

For Scheza’s initial Ontario skilled-trades market, the safest default is a **full-detail invoice on every transaction**, even though the federal GST/HST documentary rules use lower requirements below $100 and between $100 and $499.99. Every generated invoice should identify the legal supplier, customer, invoice date and unique number, work and service location, line-item goods and services, subtotal, discounts, each applicable tax and rate, total, deposits or credits, balance due, due date, payment methods, and contractual references.

A tax-compliant invoice is not automatically a compliant contract. Ontario home-renovation and other consumer transactions may require a separate written agreement, while construction work may need a “proper invoice” containing specific information to trigger statutory prompt-payment rights.[^1][^2]

This guide is legal and tax information for product design, not a legal opinion for a particular transaction. Scheza should have an Ontario lawyer and CPA review the production templates, tax engine, Terms of Service, and industry modules before release.

## The core checklist

Scheza should require or automatically generate these fields on its standard Canadian invoice:

### Supplier block

- Legal name of the sole proprietor, partnership, or corporation.
- Registered trade or operating name, if different.
- Business address.
- Telephone number and business email.
- GST/HST registration account number in the format `123456789 RT 0001`, when the supplier is registered and tax is being charged.
- Applicable provincial sales-tax registration number, such as a QST or PST number, when required.
- Optional website, licence number, and remittance address.

Ontario businesses operating under a registered name must show both the registered name and the underlying person’s or corporation’s name on contracts and invoices. The invoice must never display a Social Insurance Number, personal tax return information, or a personal bank password.[^3][^4]

### Invoice identity

- The word **Invoice**; use **Credit Note**, **Receipt**, **Estimate**, or **Pro Forma Invoice** only when that is the actual document type.
- A unique, immutable invoice number.
- Invoice issue date.
- Supply, service, or billing period.
- Original invoice reference for a correction or credit.
- Currency, especially if it is not Canadian dollars.

A unique invoice number is a strong accounting control rather than a universal federal requirement for every ordinary commercial invoice. CRA audit guidance recommends pre-numbered manual sales invoices and sequence controls, including explanations for cancelled or missing numbers.[^5]

### Customer and job block

- Customer’s legal or business name.
- Billing address and email.
- Service address or delivery destination.
- Customer account number, if used.
- Contract number, purchase order, work order, quote, job, or project number.
- Customer tax or exemption number only when relevant and lawfully required.

The customer’s name becomes federally prescribed documentary information for the highest GST/HST tier, currently sales of $500 or more. Scheza should collect it for every invoice because trades invoices commonly exceed that amount and B2B customers need reliable documents for input tax credit claims.[^6][^7]

### Line items

Each line should show:

- Plain-language description of the good, part, material, labour, rental, travel, disposal fee, permit, subcontracted service, or other charge.
- Service date or period.
- Quantity and unit.
- Unit price.
- Discount, where applicable.
- Line subtotal before tax.
- Tax treatment: taxable, zero-rated, exempt, or out of scope.
- Applicable tax code and rate.

For skilled trades, avoid vague descriptions such as “services rendered.” Prefer descriptions such as “Furnace diagnostic — 1.5 hours,” “OEM inducer motor — quantity 1,” or “Snow removal service — January 1–31, 2027.” A sufficiently clear description is federally required in the $500-and-over tier and is also part of an Ontario Construction Act proper invoice.[^7][^1]

### Totals and payment

- Subtotal before taxes.
- Discounts before or after tax, as the applicable tax rule requires.
- GST, HST, QST, and PST as separately identifiable tax lines where applicable.
- Total payable.
- Deposits, retainage/holdback, prior payments, and credits applied.
- Balance due.
- Due date and payment terms, such as “Due on receipt” or “Net 30.”
- Accepted payment methods and accurate remittance instructions.
- Late-interest terms only if agreed and legally enforceable.

A GST/HST registrant must disclose either the tax amount separately or state clearly that the total includes GST/HST, and must show the total HST rate rather than splitting HST into federal and provincial components. Scheza should display tax separately by default because that is clearer for customers, bookkeeping, and audits.[^8][^9]

## Federal tax tiers

The current federal GST/HST supporting-document thresholds have been $100 and $500 since April 20, 2021. Older guidance showing $30 and $150 is obsolete for this purpose.[^6]

| Information | Under $100 | $100–$499.99 | $500 or more |
|---|---:|---:|---:|
| Supplier or trade name | Required | Required | Required |
| Invoice date, or tax-paid/payable date if no invoice | Required | Required | Required |
| Total paid or payable | Required | Required | Required |
| GST/HST amount or clear tax-included statement at applicable rate | Not prescribed in this tier | Required | Required |
| Status of items when taxable and exempt supplies are mixed | Not prescribed in this tier | Required | Required |
| Supplier GST/HST registration number | Not prescribed in this tier | Required | Required |
| Customer or authorized agent name | Not prescribed in this tier | Not prescribed in this tier | Required |
| Brief description of goods or services | Not prescribed in this tier | Not prescribed in this tier | Required |
| Payment terms | Not prescribed in this tier | Not prescribed in this tier | Required |

These are minimum documentary elements needed to support the customer’s input tax credit; they should not become three different Scheza layouts. The product should use the $500-and-over standard for every ordinary invoice and validate a registrant’s GST/HST number whenever tax is applied.[^7][^6]

## Registration logic

A business generally must register when it makes taxable supplies in Canada and is no longer a small supplier. The ordinary small-supplier threshold is $30,000 of worldwide taxable supplies, including associated businesses, measured under the single-quarter and four-consecutive-quarter tests.[^10][^11]

Key Scheza rules:

- **Not registered:** do not calculate or label an amount as GST/HST and do not print a GST/HST registration number.
- **Voluntarily registered:** charge, collect, report, and remit GST/HST on taxable supplies from the effective registration date.
- **Threshold exceeded in one quarter:** the business generally loses small-supplier status on the sale that causes it to exceed $30,000 and must register within 29 days.[^12]
- **Threshold exceeded over four consecutive quarters:** registration timing follows the separate CRA transition rule; Scheza should not infer the effective date without the user confirming it or consulting an adviser.[^12]
- **Registration status changes:** preserve old invoices exactly as issued and apply the new status only from its effective date.

Scheza should ask for the full GST/HST account number during onboarding, validate the format, and optionally help the user verify the first nine digits and transaction date against the CRA GST/HST Registry. CRA states that suppliers must include the account number on business papers for taxable supplies of $100 or more and provides a free registry for verification.[^13][^14]

## Tax rates and location

The correct tax normally depends on the type of supply and its **place of supply**, not simply where the seller is incorporated or where its office is located. For goods, delivery destination is often decisive; real-property work is generally tied to the province where the property is located; services have their own address and performance rules.[^15][^16]

| Place of supply | Federal GST/HST rate |
|---|---:|
| Ontario | 13% HST |
| Nova Scotia | 14% HST |
| New Brunswick | 15% HST |
| Newfoundland and Labrador | 15% HST |
| Prince Edward Island | 15% HST |
| Alberta, British Columbia, Manitoba, Northwest Territories, Nunavut, Québec, Saskatchewan, Yukon | 5% GST |

These are the federal GST/HST rates current in September 2026. Québec, British Columbia, Saskatchewan, and Manitoba also operate separate provincial sales-tax systems, so “5% GST” does not necessarily represent the complete tax obligation.[^17][^15]

For Québec, the common rates are 5% GST plus 9.975% QST, calculated on the pre-GST selling price. Manitoba’s general RST rate is 7%, while British Columbia generally imposes 7% PST on taxable goods and services within its PST base. Provincial rules differ substantially for contractors—for example, whether the contractor pays tax on materials as the consumer or charges tax to the customer—so Scheza must use province- and industry-specific tax codes rather than adding a generic “PST” percentage.[^18][^19][^20][^21]

## Ontario supplier identity

A Scheza invoice from an Ontario corporation using a trade name should present identity like this:

> **Northern Peak HVAC**  
> Registered business name of **12345678 Ontario Inc.**  
> 100 King Street West, Toronto, Ontario M5X 1A9  
> GST/HST No. 123456789 RT0001

This makes the trade identity useful to the customer while satisfying Ontario’s rule that the registered name and legal person be set out on invoices. The product should store `legal_name`, `operating_name`, `entity_type`, and `registered_business_name_jurisdiction` separately rather than using one free-text “company name” field.[^22][^3]

## Ontario consumer work

An invoice does not replace a consumer contract. Ontario guidance states that home-renovation and roofing contracts worth more than $50 must be written, and the contract should identify the parties, describe and itemize the work and materials, state warranties, total cost and applicable taxes, payment schedule, work dates, and subcontracting arrangements.[^2]

Scheza should therefore support this flow:

1. **Estimate/quote:** describes proposed scope and price; it is not an invoice.
2. **Consumer agreement:** records acceptance, mandatory disclosures, schedule, payment terms, warranties, and signatures.
3. **Change order:** records and obtains acceptance for added scope or price.
4. **Invoice:** bills only the work authorized under the agreement and approved changes.
5. **Receipt:** confirms payment and remaining balance.

Ontario’s current Consumer Protection Act, 2002 remains in effect until the replacement 2023 Act is proclaimed in force. Under current Ontario guidance, if an estimate is part of a home-renovation contract, the final price generally cannot exceed the estimate by more than 10% unless the consumer agreed to new work or a new price.[^23][^24]

Scheza should display a warning when an invoice exceeds the accepted estimate by more than 10%, require a linked approved change order, and preserve the acceptance evidence. It should not silently increase the amount.

## Ontario construction work

For work that is an “improvement” under Ontario’s Construction Act, Scheza should offer a **Construction Act proper invoice** mode. A proper invoice must include:

- Contractor’s name and address.
- Invoice date and the period, milestone, or other contractual payment entitlement.
- Contract, purchase order, line-item, or other authorization reference.
- Description and quantity, where appropriate, of services or materials.
- Amount payable and payment terms.
- Name or department, title, mailing address, and telephone number for payment.
- Other accounts-payable information reasonably requested by the owner, plus valid contractual requirements.[^25][^1]

The Act generally requires the owner to pay a proper invoice within 28 days unless it gives a compliant notice of non-payment; the owner generally has 14 days after receiving the invoice to issue that notice. Proper invoices are generally submitted monthly unless the contract provides otherwise.[^26][^1]

The Construction Act also generally requires each payer to retain a 10% statutory holdback on contracts or subcontracts under which a lien may arise. Scheza must keep `gross_claim`, `statutory_holdback`, `other_retention`, `tax`, `net_current_payment`, and `holdback_release` as distinct values; it should not treat holdback as a discount.[^27]

A practical construction invoice calculation should therefore show:

| Calculation | Example |
|---|---:|
| Current work and materials | $10,000.00 |
| Statutory holdback, 10% | ($1,000.00) |
| Taxable amount/tax timing | Determined by applicable GST/HST holdback rules |
| Other approved credits | As applicable |
| Current amount due | Calculated transparently |

GST/HST timing for a legislatively sanctioned or written-contract construction holdback can differ from ordinary invoicing: tax on the holdback generally becomes payable on the earlier of payment or expiry of the holdback period. This requires a dedicated construction tax rule, not the ordinary “tax entire invoice immediately” rule.[^28]

## Deposits and progress bills

A true deposit given as security is not treated as payment for GST/HST until the supplier applies it to the purchase price; if it is forfeited, special tax treatment applies. The label alone does not control: an advance payment may be taxable when paid even if the business calls it a deposit.[^29][^30]

Scheza should distinguish:

- **Security deposit:** held unapplied; generally no GST/HST at receipt.
- **Advance payment:** consideration for the supply; tax may become payable when paid.
- **Progress payment:** tax generally becomes payable at the earlier of payment or when that instalment becomes due.
- **Retainage/holdback:** separate construction timing may apply.

For ordinary taxable supplies, GST/HST is generally reportable at the earlier of when payment is received and when payment becomes due; CRA commonly treats payment as due on the invoice date or an earlier date specified by agreement. A business can owe tax on an unpaid invoice, so Scheza must not calculate tax reporting solely from payment records.[^31][^29]

## Discounts and late charges

If an invoice offers an early-payment discount, GST/HST generally remains calculated on the original invoiced consideration even when the customer takes the discount. If the invoice is issued already net of the discount, tax applies to that net amount.[^32][^33]

CRA states that a separate late-payment surcharge is not subject to additional GST/HST; GST/HST remains based on the original invoice amount. Scheza should post late charges to a separate non-tax line instead of recalculating the original sales tax.[^32]

If a contract states interest as a monthly or other period shorter than a year, the federal Interest Act generally requires the equivalent annual rate to be expressly stated; otherwise, recovery above the statutory fallback can be restricted. A compliant clause should therefore say, for example, “1.5% per month (18% per annum),” but enforceability also depends on the agreement, consumer law, and surrounding facts. The criminal interest threshold is an annual percentage rate exceeding 35%, and “interest” can include more than the stated interest line.[^34][^35][^36]

Scheza should not add interest merely because an invoice is late. It should require an accepted contract term, record the annualized rate, avoid compounding unless reviewed, and provide a jurisdiction warning.

## Credits and corrections

Never overwrite a finalized invoice that has been sent or posted. Correct it through a linked credit note, debit note, or replacement invoice with a complete audit trail.

A GST/HST credit or debit note for a tax adjustment must include:

- A clear indication that it is a credit or debit note.
- Supplier or trade name and GST/HST registration number.
- Recipient’s name.
- Issue date.
- Amount of the tax adjustment.
- Preferably the original invoice date and number, and separate price and tax adjustments when the original invoice showed them separately.[^37]

Scheza should use negative quantities or negative totals only inside a document explicitly typed as a credit note, not by mutating the original invoice. Number credit notes in their own controlled sequence, such as `CN-2026-0001`.

## Electronic records

CRA generally requires business records and source documents to be retained for at least six years from the end of the relevant taxation year. When records originate electronically, they must be retained in an electronically readable format even when a PDF or paper copy also exists.[^38][^39]

Scheza should retain:

- Original invoice and each rendered version.
- Structured line-item and tax data.
- Estimate, contract, work order, change order, and proof of acceptance.
- Delivery or completion evidence.
- Email or portal delivery log.
- Payment and refund records.
- Credit/debit notes.
- Tax settings and rate version used.
- User, timestamp, and reason for every state change.
- Cancelled and voided numbers rather than deleting them.

CRA must be able to receive accessible, usable electronic records in a common format. Scheza should export invoices and related ledgers as PDF plus CSV/JSON, maintain Canada-hosted backups consistent with its product promise, and support legal holds that override scheduled deletion.[^40]

## Privacy and delivery

Invoices can contain names, home addresses, email addresses, purchase history, and payment information, all of which can be personal information. PIPEDA requires limited collection, appropriate use and retention, accuracy, accountability, and safeguards appropriate to sensitivity.[^41][^42]

Scheza should:

- Collect only information needed for the transaction, tax, collection, warranty, and legal obligations.
- Encrypt invoice data in transit and at rest.
- Apply tenant isolation and role-based access.
- Use expiring, authenticated portal links for sensitive invoices rather than publicly accessible URLs.
- Verify the recipient address before sending.
- Avoid full card numbers and unnecessary bank details.
- Maintain breach-response, access, correction, and deletion workflows subject to tax-retention obligations.

The Office of the Privacy Commissioner specifically identifies passwords, encryption, need-to-know access, and destination checks as relevant safeguards. Scheza’s service provider contracts must provide a comparable level of protection when personal data is transferred for processing.[^43][^44]

An invoice email should remain transactional. Adding marketing content can turn the message into a commercial electronic message that engages Canada’s Anti-Spam Legislation requirements such as consent, sender identification, and unsubscribe functionality. The safest product design is to separate billing emails from promotional campaigns.[^45]

## Provincial expansion

Scheza should not present a single toggle named “Canadian tax.” It needs a tax jurisdiction and rule engine with at least:

- Federal GST/HST registration and effective dates.
- Province of supply.
- Supply category: goods, general service, real-property service, digital service, rental, transportation, and others.
- Federal tax status: standard-rated, zero-rated, exempt, or outside scope.
- Provincial tax registration and effective dates.
- Province-specific tax base and contractor treatment.
- Exemption reason, customer number/certificate, and supporting document.
- Tax rate version with effective-from and effective-to dates.

Québec invoices can require both GST and QST numbers and additional QST information depending on the transaction tier. In British Columbia, PST must be separately shown when it is charged, and exemption documentation or a purchaser PST number may need to be recorded. Saskatchewan real-property contractors may have to collect PST on the total charge, with special vendor-licence and subcontractor documentation rules.[^46][^47][^48][^49]

No province should be activated merely by reusing Ontario’s HST setup. Each launch jurisdiction needs a signed-off tax matrix and industry-specific tests.

## Specialized invoice modules

Certain sectors have extra statutory invoice requirements. Scheza should use industry modules rather than assuming the standard template covers them.

For example, Ontario vehicle-repair invoices require extensive customer, repairer, vehicle, authorization, date, odometer, part classification, labour-calculation, estimate, warranty, payment, and restriction information. Similar specialized rules exist for travel, utilities, health claims, regulated professionals, and public procurement.[^50][^51]

For Scheza’s first skilled-trades release, the recommended modules are:

- General service invoice.
- Ontario consumer home-service invoice linked to a compliant agreement.
- Ontario Construction Act proper invoice.
- Recurring service invoice for landscaping, maintenance, and snow removal.
- Progress invoice with deposit and holdback accounting.
- Credit note and receipt.

## Scheza data model

The invoice feature should use relational records, not a single generated PDF blob.

### Core entities

| Entity | Key fields |
|---|---|
| Business legal profile | Legal name, operating name, entity type, addresses, contacts, registrations, licences |
| Tax registration | Tax type, account number, jurisdiction, effective date, cancellation date, verification status |
| Customer | Legal/trade name, billing contact, billing/service address, tax/exemption data |
| Contract | Contract number, accepted terms, estimate, scope, dates, payment and interest terms |
| Job/work order | Service location, authorization, technician, completion evidence, contract link |
| Invoice | Number, type, status, issue/supply/due dates, currency, customer snapshot, totals |
| Invoice line | Description, quantity, unit, unit price, discount, tax category, work date, source job |
| Tax line | Tax type, jurisdiction, rate, taxable base, amount, rule version |
| Payment | Date, amount, method, reference, invoice allocation |
| Credit/debit note | Number, reason, original invoice, price adjustment, tax adjustment |
| Audit event | Actor, timestamp, old/new state, reason, delivery and acceptance evidence |

Customer and supplier identity must be **snapshotted onto the finalized invoice**. If a business later changes its address or customer record, historical invoices must continue to show what was issued at the time.

### Invoice states

Use a controlled state machine:

`Draft → Approved → Issued → Partially paid → Paid`

Additional terminal or corrective states should be `Void`, `Written off`, `Credited`, and `Replaced`. Once issued, money, tax, identity, and line items should be immutable; any correction creates a linked document.

### Validation rules

Block issuance when:

- Supplier legal identity is missing.
- Tax is charged but no valid registration exists for the transaction date.
- The tax rate conflicts with the place-of-supply result.
- An HST line is improperly split into federal and provincial components.
- A $100-or-more taxable invoice lacks the supplier’s GST/HST number.
- A $500-or-more invoice lacks customer name, description, or payment terms.
- Totals do not reconcile to line items, discounts, taxes, credits, and payments.
- Currency is non-CAD but unidentified.
- A construction proper invoice lacks contract authority, claim period/milestone, payee information, or payment terms.
- A home-service invoice exceeds an accepted estimate by more than 10% without an approved change order.
- A finalized invoice number is duplicated or missing without a void/cancellation reason.

Warn, but permit authorized override with a recorded reason, where the legal result depends on facts Scheza cannot determine—such as supply classification, exemption eligibility, or whether an amount is a true deposit.

## Recommended invoice layout

```text
INVOICE                                  Invoice no.: INV-2026-00421
                                         Issue date: 2026-09-27
NORTHERN PEAK HVAC                       Service period: 2026-09-26
Registered name of 12345678 Ontario Inc. Due date: 2026-10-27
100 King St W, Toronto ON M5X 1A9        Currency: CAD
billing@northernpeak.ca | 416-555-0100
GST/HST No. 123456789 RT0001

BILL TO                                  SERVICE LOCATION
Maple Street Foods Ltd.                  50 Industrial Road
Accounts Payable                         Mississauga ON L5B 1M2
[Billing address]

Contract: HVAC-2026-019   PO: 450033   Work order: WO-1882

Description                    Qty    Rate        Amount     Tax
Emergency rooftop-unit repair  2.0 h  $165.00     $330.00    HST 13%
Contactor, model ABC-40        1      $120.00     $120.00    HST 13%

Subtotal                                            $450.00
HST 13%                                              $58.50
Total                                               $508.50
Deposit/credit applied                                $0.00
BALANCE DUE                                         $508.50

Payment terms: Net 30. Pay by EFT to [verified instructions].
Late interest, only if agreed in the contract: 1.5% per month (18% per annum).
```

For construction mode, add the claim period or milestone, statutory holdback, payment contact, and the precise contractual authorization. For consumers, link the accepted estimate, agreement, and change orders rather than crowding all contract terms into the invoice.

## Product priorities

### Must ship

- Full-detail invoice template regardless of invoice amount.
- Legal name plus operating-name handling.
- GST/HST registration effective dates and validation.
- Place-of-supply-driven Ontario HST calculation.
- Separate invoice, estimate, receipt, and credit-note document types.
- Immutable issued invoices and append-only audit history.
- Contract, work order, and change-order links.
- PDF plus machine-readable export.
- Six-year minimum retention configuration and legal holds.
- Ontario consumer and Construction Act modes.
- Privacy controls, authenticated sharing, and delivery logs.

### Ship before national rollout

- Complete QST, BC PST, Saskatchewan PST, and Manitoba RST engines.
- Province-specific contractor-consumer rules.
- Exemption-certificate management.
- Multi-currency reporting and exchange-rate evidence.
- Specialized regulated-sector templates.
- French templates reviewed for legal terminology, especially for Québec.

### Avoid

- Letting users type any tax label or percentage without a jurisdiction and registration.
- Calling every advance a “deposit.”
- Editing or deleting sent invoices.
- Applying tax only when cash is received.
- Treating an invoice as proof of customer acceptance of new terms.
- Automatically adding a late fee that was not agreed.
- Using HST as separate GST and provincial components.
- Putting promotional material into transactional invoice emails by default.

## Final legal review

Before production, counsel should review the Ontario consumer agreement, Construction Act proper-invoice mode, late-interest clause, privacy and processor terms, electronic delivery language, and collections workflow. A Canadian indirect-tax specialist should review the registration logic, place-of-supply decision tree, deposits, progress billings, holdbacks, exemptions, and every province activated in the tax engine.

Scheza’s product promise should be precise: it can help users create invoices containing configured compliance information, but it should not claim that every invoice is legally compliant without knowing the business, transaction, contract, customer type, supply classification, and jurisdiction.

---

## References

1. [Construction Act, R.S.O. 1990, c. C.30"](https://www.ontario.ca/laws/statute/90c30) - 6.4 (1) Subject to the giving of a notice of non-payment under subsection (2), an owner shall pay th...

2. [A guide for home renovation and roofing businesses](http://www.ontario.ca/page/guide-home-renovation-and-roofing-businesses) - You must have a written agreement for any contract worth more than $50. A written agreement is your ...

3. [[DOC] Business Names Act, R.S.O. 1990, c. B.17 - Ontario.ca](https://www.ontario.ca/laws/docs/elaws_statutes_90b17_e.doc)

4. [[DOC] Business Names Act, R.S.O. 1990, c. B.17 - Government of Ontario](https://www.ontario.ca/laws/docs/elaws_statutes_90b17_ev002.doc)

5. [Income Tax Audit Manual - Canada.ca](https://www.canada.ca/en/revenue-agency/services/tax/technical-information/income-tax-audit-manual-domestic-compliance-programs-branch-dcpb-13.html) - The Income Tax Audit Manual (ITAM) is published by the Compliance Programs branch of the Canada Reve...

6. [Excise and GST/HST News – No. 118](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/news118/news118-excise-gst-hst-news-no-118.html) - GST/HST registrants must provide specific information on invoices, become law, the thresholds of $30...

7. [Input tax credits](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/calculate-prepare-report/input-tax-credit.html) - As a GST/HST registrant, you recover the GST/HST paid or payable on your purchases and expenses rela...

8. [Access To Records](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/15-1/general-requirements-books-records.html) - Goods and services tax; Newsletters

9. [Charge and collect the GST/HST - Canada.ca](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate.html) - Determine which GST/HST rate to charge using place of supply rules, current provincial rates, exampl...

10. [GST/HST Information for the Travel and Convention Industry](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-specific-situations/gst-hst-information-travel-convention-industry.html) - Although you generally do not have to register if you are a small supplier, you may be able to regis...

11. [When to register for and start charging the GST/HST](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/when-register-charge.html) - Your effective date of registration is no later than the day of the first supply you make after you ...

12. [General Information for GST/HST Registrants](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc4022/general-information-gst-hst-registrants.html) - This guide provides basic information about GST/HST, including registration, charging and collecting...

13. [Confirming a GST/HST account number](https://www.canada.ca/en/revenue-agency/services/e-services/digital-services-businesses/confirming-a-gst-hst-account-number.html) - When your supplier does not provide their GST/HST account number, call the Canada Revenue Agency's B...

14. [Frequently asked questions](https://www.canada.ca/en/revenue-agency/services/e-services/digital-services-businesses/confirming-a-gst-hst-account-number/frequently-asked-questions.html) - Check that the information you entered matches what your supplier provided: business name; order of ...

15. [GST/HST rates and place-of-supply rules](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-place-supply.html) - 15% HST rate if the supply is made in any other participating province. For example, if a store in B...

16. [Place of Supply in a Province – General Rules for Services](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/3-3-6/plc-spply-prvnc-gnrl-rls-fr-srvcs.html) - GST/HST rates. Reference in this publication is made to supplies that are subject to the GST or the ...

17. [Place of Supply in a Province – Overview](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/3-3-2/place-supply-province-overview.html) - Listed below are the current GST/HST rates for each province. for participating provinces Province R...

18. [Province of Manitoba | finance - Retail Sales Tax](https://www.gov.mb.ca/finance/taxation/taxes/retail.html) - The tax is calculated on the selling price, before the GST (Good and Services Tax) is applied. The g...

19. [Telecommunication services - Province of British Columbia](https://www2.gov.bc.ca/gov/content/taxes/sales-taxes/pst/publications/telecommunication-services) - You calculate the PST using the following proportional formula: PST = purchase price × PST rate (7%)...

20. [Calculating the Taxes](https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/collecting-gst-and-qst/calculating-the-taxes/) - You must use the 9.975% rate to calculate the QST if your cash register calculates the GST and QST i...

21. [Basic Rules for Applying the GST/HST and QST](https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/basic-rules-for-applying-the-gsthst-and-qst/) - Québec sales tax (QST), which is calculated at a rate of 9.975% on the selling price excluding the G...

22. [Business Names Act - Ontario.ca](https://www.ontario.ca/laws/regulation/210399) - Business Names Act ONTARIO REGULATION 399/21 GENERAL Consolidation Period: From October 19, 2021 to ...

23. [Your rights when starting home renovations or repairs](http://www.ontario.ca/page/your-rights-when-starting-home-renovations-or-repairs) - Under Ontario law, any home renovation contract worth more than $50 must be in writing. Be prepared ...

24. [Business Guide to Consumer Protection - Ontario.ca](https://www.ontario.ca/document/business-guide-consumer-protection) - Read this guide to help you understand the Consumer Protection Act, 2002.

25. [Building Ontario For You Act (Budget Measures), 2024, SO ...](https://www.ontario.ca/laws/statute/s24020) - The contractor shall make payment of a holdback to a subcontractor not later than 14 days after rece...

26. [Construction Lien Amendment Act, 2017, S.O. 2017, c. 24](https://www.ontario.ca/laws/statute/s17024) - ... proper invoice no later than 28 days after receiving the proper invoice from the contractor. Exc...

27. [[DOC] Construction Act, R.S.O. 1990, c. C.30 - Ontario.ca](https://www.ontario.ca/laws/docs/90c30_eV017.doc)

28. [The 2008 GST/HST Rate Reduction - Canada.ca](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/gi-038/2008-gst-hst-rate-reduction.html) - The 2008 GST/HST Rate Reduction

29. [GST/HST and home construction - Taxes](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-home-construction.html) - The GST/HST for a taxable supply becomes payable on the earlier considers the payment for the supply...

30. [Deposits (GST 300-6-8) - Canada.ca](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/g300-6-8/deposits-gst-300-6-8.html) - Deposits (GST 300-6-8)

31. [Instructions for preparing a GST/HST return](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/calculate-prepare-report/instructions-preparing-return.html) - Line-by-line instructions for completing a GST/HST tax return, including explanations for calculatin...

32. [GST/HST in special cases](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-special-cases.html) - The credit terms of the invoice give the customer a 2% discount if the customer pays within 10 days....

33. [Early/Late Payments](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/3-9/early-late-payments.html) - When the amount invoiced is already net of the early payment discount, the tax is payable on the inv...

34. [Interest Act - Site Web de la législation (Justice)](https://laws-lois.justice.gc.ca/eng/acts/I-15/FullText.html) - Federal laws of Canada

35. [Interest Act - Site Web de la législation (Justice)](https://laws-lois.justice.gc.ca/eng/acts/I-15/section-4.html) - Federal laws of Canada

36. [Criminal Code ( RSC , 1985, c. C-46) - Justice Canada](https://laws-lois.justice.gc.ca/eng/acts/c-46/section-347.html) - criminal rate means an annual percentage rate of interest calculated in accordance with generally ac...

37. [Refund, Adjustment, or Credit of the GST/HST under ...](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/12-2/refund-adjustment-credit-gst-hst-under-section-232-excise-tax-act.html) - There is no requirement to issue a credit note or debit note unless a refund, adjustment or credit o...

38. [Electronic Record Keeping](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/ic05-1/electronic-record-keeping.html) - Subsection 230(4) requires that you must keep your business records for a minimum of six years from ...

39. [Income Tax Information Circular](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/ic78-10/books-records-retention-destruction.html) - Access to electronic records means that the taxpayer must provide an acceptable copy of the electron...

40. [Managing Books and Records](https://www.canada.ca/en/revenue-agency/news/cra-multimedia-library/businesses-video-gallery/managing-books-and-records.html) - Generally, you must keep your records for six years from the end of the taxation year to which they ...

41. [Businesses and your personal information](https://www.priv.gc.ca/en/privacy-topics/information-and-advice-for-individuals/your-privacy-rights/businesses-and-your-personal-information/) - PIPEDA protects information about an identifiable individual. Personal information includes your: E-...

42. [PIPEDA requirements in brief - Office of the Privacy ...](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda_brief/) - Under PIPEDA , personal information includes any factual or subjective information, recorded or not,...

43. [Interpretation Bulletin: Safeguards - Office of the Privacy ...](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda-compliance-help/pipeda-interpretation-bulletins/interpretations_08_sg/) - Interpretation of court decisions and findings related to 'Safeguards' and PIPEDA. Interpretations g...

44. [Leading by Example: Key developments in the first seven ...](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/r_o_p/lbe_080523/?wbdisable=true) - Principle 4.7 of PIPEDA requires organizations to protect personal information using security safegu...

45. [Frequently Asked Questions about Canada's Anti-Spam ...](https://crtc.gc.ca/eng/com500/faq500.htm) - Generally, most messages, where the primary purpose is to solicit a contribution, are excluded from ...

46. [Preparing Invoices](https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/collecting-gst-and-qst/preparing-invoices/) - If a customer has a bill totalling $500 or more. Less than $100 $100 to $499.99 $500 or more Supplie...

47. [PST exemptions and documentation requirements](https://www2.gov.bc.ca/gov/content/taxes/sales-taxes/pst/exemptions/exemptions-documentation) - If the collector obtains the customer's PST number, the collector is required to record the PST numb...

48. [PST.012+Services+to+Real+Property.pdf](https://sets.saskatchewan.ca/rptp/wcm/connect/adfe994a-c248-4182-8e35-12729540c6df/PST.012+Services+to+Real+Property.pdf?MOD=AJPERES&CACHEID=ROOTWORKSPACE-adfe994a-c248-4182-8e35-12729540c6df-p4ONpnz) - A contractor engaged in services to real property is required to collect PST on the total charge to ...

49. [[PDF] PST 301, Related Services - Gov.bc.ca](https://www2.gov.bc.ca/assets/gov/taxes/sales-taxes/publications/pst-301-related-services.pdf)

50. [O. Reg. 17/05: GENERAL"](https://www.ontario.ca/laws/regulation/r05017) - For the purpose of subsection 18 (8) of the Act, a consumer may commence an action if the consumer d...

51. [A guide for auto repair businesses](http://www.ontario.ca/page/guide-auto-repair-businesses) - What to include in an invoice. Customer, vehicle, and business information. customer's name; name, a...

