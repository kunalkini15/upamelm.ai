# Translate Lessons

1. Preserve IDs, order, counts, evidence refs, metric display values, numbers, units, and proper nouns byte-identically; translate only the prose fields in contracts.md.
2. Empty source prose stays empty; a missing translation is a recorded gap, never a silent English passthrough.
3. Normalize languages early: accept names or codes case-insensitively, map to ISO codes (Hindi to hi, Kannada to kn, Tamil to ta, Telugu to te), dedupe before lane planning, and fail unknown values as unresolved.
