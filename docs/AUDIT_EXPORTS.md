# Group audit extracts

Verified group officers and verified platform administrators can download an audit PDF from the Audit extract tab. Members have no audit-export permission. Dates are inclusive in the group's configured time zone. An optional immutable record or journal reference narrows an investigation and includes its original/reversing evidence.

The report includes saved action, actor, device and record references; immutable source financial records; and balanced linked journals. Names are current display labels, not a claim about a historical name. Linked source/journal dates may fall outside the action window. Evidence stays text throughout the API so PostgreSQL integer values do not lose digits in JavaScript. Exports create no financial records.

The database executor uses a separate SELECT-only role with organisation policies. Client roles cannot call the internal source helper or write journals. Existing real-session, MFA and lost-authenticator locks apply. Responses are private downloads with no-store caching and an export rate limit.

Exports fail explicitly when evidence exceeds 5,000 actions, 5,000 financial sources, 5,000 journals, 20,000 journal lines, two million evidence bytes, or 500 PDF pages. Narrow the dates/reference; no silently truncated PDF is returned.

Tests cover exact large amounts, invalid/incomplete evidence, balanced journals, embedded fonts, pagination, verified officer/admin access, member and foreign-group denial, linked reversals, no money writes, and desktop/phone downloads. All fixtures are restricted to disposable local services. Production data and SMS are not used for these tests.
