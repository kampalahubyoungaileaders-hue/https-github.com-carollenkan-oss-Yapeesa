# Share purchase PDF statements

The saved workspace's **Download PDF statement** button generates a server-side
PDF of all share purchases the signed-in account may read in the selected group.
The member filter narrows the export. Member accounts remain restricted to their
own rows; officers and verified platform administrators use their existing RLS
permissions. The report does not use a service key or a separate reporting database.

Each record includes its meeting date, member, share count, amount, journal
reference, recorded timestamp, note and calculation-review flag. Totals use
integer minor units and the organisation's currency precision. These are recorded
share purchases, not cash balances, complete financial statements or proof of a
payment. The current saved workflow has no loan, social-fund or reversal posting
endpoint, so those reports are not implied by this export.

The API returns `application/pdf` as an attachment with `Cache-Control: no-store`.
It rechecks the live session and permissions on every download. Unknown or
invisible member IDs return 404. Invalid query parameters are rejected. PDF
generation is limited to six requests per minute per IP and 5,000 selected rows;
larger statements fail explicitly rather than silently dropping records. Use the
member filter to narrow a large group statement. Exported files contain personal
financial records and should be shared only with intended recipients.

PDFKit 0.20.2 (MIT) generates the document on the server. DejaVu Sans is embedded
for common accented names; its upstream licence is included beside the font.
No browser printing, external rendering service, SMS or extra hosting is used.
Additional scripts/languages need fonts tested for those country packs.

Tests cover integer precision, member filters, invalid backend amounts,
pagination, embedded fonts, real-Auth cross-group/member denial and browser
downloads on desktop and 360px screens. Rendering is visually checked with
Poppler using disposable sample data, never live invented transactions.
