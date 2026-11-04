# Group administration

The saved workspace includes Administration for an active `fencher_admin` attached
to an active Fencher organisation. A verified phone/authenticator session is
required; the database checks actual session/factor state and current membership,
not user-editable metadata. Other roles cannot open these operations.

## First group

1. Open Administration and enter the group's real name, two-letter country code,
   supported currency, IANA time zone, maximum meeting shares, cycle dates and
   integer share price in the currency's smallest units. No financial setting is
   inferred. Group, cycle and initial ledger accounts are created atomically.
2. Register each ledger member or explicitly select an existing person. An optional
   phone uses international format. Registration does not create an Auth account,
   invent an email address, or send an SMS.
3. Assign a group role to an existing person. Member roles do not require sign-in;
   secretary/treasurer/chair require an existing verified phone and TOTP account.
   Only secretary can record share purchases. Platform administration itself does
   not grant transaction-posting permission.
4. Return to saved records, select the new group and record its first purchase.

Currency references currently contain UGX. An IANA example is `Africa/Kampala`.
UGX has no fractional minor units, so a price of `5000` means UGX 5,000. Dates and
limits must come from the actual group agreement.

Financial configuration can be corrected before the first posted transaction.
After posting, the existing cycle/settings are locked to preserve recorded rules.
The configuration operation uses the same organisation lock as share posting, so
an edit cannot race the first transaction. Closing/replacing a posted cycle is a
separate workflow, not an undocumented reset of history.

## Controls

- API origin/body/role checks are repeated by database permissions.
- The non-login administration executor has no RLS bypass and no Auth-table or
  journal-write permissions. Its private functions have fixed search paths and
  explicit execution grants. Clients still cannot write tables directly.
- Each command binds its request UUID to its actor, action and exact payload.
  Repeating the same request returns its original result; changing its payload
  conflicts. Receipts and the audit trail are append-only.
- An interrupted browser response keeps the form frozen for a retry with its
  original reference. Finish that retry before leaving/reloading the page. The
  browser does not automatically repeat mutations.
- Role removal takes effect through the current database membership check, even
  with an existing cookie. These forms cannot assign platform administrator roles.

This release manages Groups and existing verified staff memberships. Creating
additional Auth accounts, inviting staff by SMS, PIN/lost-factor recovery, broader
organisation types and programme relationships remain separate work. No live
group or member is created during deployment; fixtures run only in disposable CI.
