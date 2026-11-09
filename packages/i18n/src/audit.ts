export const audit = {
  auditTitle: 'Audit extract',
  auditHelp:
    'Download recorded actions, original financial records and linked journals for this group. Enter a record or journal reference to investigate a dispute. Dates use the group’s time zone.',
  auditFrom: 'Audit actions from',
  auditTo: 'Audit actions through',
  auditReference: 'Record or journal reference',
  auditReferenceInput: 'Record or journal reference (optional)',
  auditDownload: 'Download audit PDF',
  auditReady: 'Your audit download has started.',
  auditTooLarge:
    'This extract is too large. Narrow the dates or enter a record reference; no partial report has been produced.',
  auditError:
    'Could not produce this audit extract. Check the dates and your verified access, then try again.',
  auditPdfTitle: 'Group audit extract',
  auditPdfScope:
    'Recorded actions in the inclusive date range below. Actor names are current display labels; saved actor, device and record references remain authoritative. Original evidence is reproduced without changing recorded amounts.',
  auditLinkedScope:
    'These records and journals are linked to the selected actions. Their recording dates can fall outside the action window.',
  auditGroupRef: 'Group reference',
  auditExporter: 'Exported by',
  auditActions: 'Recorded actions',
  auditSources: 'Original financial records',
  auditJournals: 'Linked journals',
  auditEmpty: 'No recorded actions match this range and reference.',
  auditAction: 'Action',
  auditActor: 'Actor',
  auditDevice: 'Recorded device or service reference',
  auditEvent: 'Audit event',
  auditEvidence: 'Recorded evidence',
  auditRecorded: 'Recorded at',
  auditVersion: 'Calculation version',
} as const;
