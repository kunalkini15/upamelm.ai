# UI Agent Rules

These rules apply to the dedicated UI validation agent.

- The validator is read-only with respect to UI source, backend source, promoted
  studies, translations, and assets.
- It may write only beneath its invocation `output_dir`.
- It must test the application through the backend API; it must not load study
  packages directly from `public/` or construct filesystem URLs in the browser.
- Deterministic build, test, API, and Playwright evidence is authoritative.
  Model visual review supplements that evidence and may not fabricate results.
- The workhorse performs the complete audit. The flagship reviewer is bounded
  to one read-only call and runs only when the audit has findings.
- A completed audit with defects is successful execution with findings, not an
  incomplete workflow. `partial` is reserved for an audit that could not finish.
- Every process or container started by a run must be stopped, including after
  timeouts and failures.
- Screenshots are evidence only after they have been visually inspected. Keep
  at most six representative screenshots, plus screenshots attached to unique
  material failures.
- Do not add document-, city-, publisher-, or report-specific UI exceptions.

