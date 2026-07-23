# Indeed Application JSON Export

Indeed offers a per-candidate JSON download of the raw application data
(schemaVersion 1.4 as of May 2026). It is an **application-time snapshot** —
everything the candidate submitted, in one structured document. Explored
2026-07-15 using a real application (applicant details redacted).

## Why it matters for this agent

The one file contains everything the **screen** stage currently assembles from
multiple sources — resume text, screener answers, contact info, timestamps —
already structured and machine-readable. If these exports can be pulled in bulk
(or via webhook), they could replace the resume scraping/parsing we do today,
and the qualification answers could feed scoring deterministically.

It contains **nothing about interviews**: no scheduling, messages, invites, or
dispositions. The interview booking + results flow (sheet columns,
`processInterviewResults` in `src/agent.ts`) is unaffected.

## High-value fields

| Field | What it is |
|---|---|
| `applicant.resume.file.data` | Full resume **PDF, base64-encoded inline**. Decode → parse text → feed the screening LLM. No scraping needed. |
| `applicant.email`, `applicant.phoneNumber` | **Real** (unmasked) contact info — normally hidden behind Indeed's relay. Enables direct outreach. |
| `applicant.emailAlias` | The `@indeedemail.com` relay address (also included, alongside the real one). |
| `applicant.verified` | `true` when Indeed has verified the account — mild anti-fake signal. |
| `screenerQuestionsAndAnswers` | Our custom screener answers as structured data (e.g. driver's license Yes/No, years of experience as an integer). Deterministically scorable. |
| `indeedQualificationQuestionsAndAnswers` | Indeed's qualification checklist **with matching criteria included**: each question carries `qualification.match.values` (the "qualified" answer) and whether it's blocking. Easy programmatic flag, e.g. "qualified on 9/10, missing CPR cert". |
| `appliedOnMillis` | Exact application timestamp (epoch ms) — useful for time-to-contact metrics in the weekly report. |

## Metadata fields

- `analytics` — applicant IP, user agent, device type; `sponsored: true` +
  `applicationSourceAttribution: SPONSORED_JOBS` shows whether the application
  came via **paid sponsorship** (cost-attribution per hire). `proctorGroups` is
  Indeed's internal A/B test buckets — ignore.
- `job` — job key, title, and posting URL, so applications can be tied to a
  specific posting when running multiple.
- `demographicQuestionsAndAnswers` — EEO-type data (empty in the sample).
  **Keep out of any screening logic.**

## Decoding the embedded resume

```sh
jq -r '.applicant.resume.file.data' application.json | base64 -D -o resume.pdf
pdftotext resume.pdf -   # or any PDF text extractor
```

Verified working: decoded the sample's PDF and recovered the full resume text
(work history, education, certifications).
