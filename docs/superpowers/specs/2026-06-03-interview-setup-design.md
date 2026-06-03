# Interview Setup Design

## Goal

Replace the placeholder `triggerScheduler` + standalone `sendMessage` approve flow with a real `setupInterview` method that fills out Indeed's schedule interview modal — duration, format, message, hiring team, scheduling mode — and sends the request. Remove `sendMessage` entirely since rejections are handled by Indeed's automated 3-day follow-up after sentiment is marked "no".

---

## What Changes

### Removed
- `sendMessage` — removed from `IndeedAdapter`, `IndeedService`, `FakeIndeedAdapter`, and both agent flows (approve and reject)
- `triggerScheduler` — replaced by `setupInterview`
- `messages.rejection` config field — no longer sent by the agent
- `messages.intro` config field — renamed to `messages.interview_request`

### Added
- `setupInterview(applicantId, options)` on `IndeedAdapter` and `IndeedService`
- `messages.interview_request` config field with `{FIRST_NAME}` and `{LAST_NAME}` token support

---

## `setupInterview` Method

### Signature

```typescript
setupInterview(applicantId: string, options: {
  message: string;
  hiringTeamEmails: string[];
}): Promise<void>
```

### Browser Flow

Navigates to `https://employers.indeed.com/candidates/view?id=${applicantId}`, then:

1. Click `[data-testid="prioritized-schedule-interview-button"]`
2. Wait for modal: `[data-testid="ScheduleInterviewModal-SendInterviewButton"]` (confirms modal opened)
3. Set duration: click `[data-testid="InterviewTimesSelector-duration"]`, then `[data-testid="InterviewTimesSelector-duration-30"]`
4. Set format to phone: click `[data-testid="gt-interview-details-interview-type"]`
5. Fill message: click `[data-testid="gt-interview-form-message-to-candidate-text-area"]`, type with per-character delay
6. Enable hiring team switch: click `[data-testid="gt-interview-details-hiring-team-switch"]`
7. Fill hiring team emails: type into `[data-testid="gt-interview-details-interviewer-list"]`
8. Select availability scheduling: click `[data-value="availabilityBasedScheduling"]`
9. Click send: `[data-testid="ScheduleInterviewModal-SendInterviewButton"]`
10. Wait for modal to close (send button disappears from DOM)

Jitter (random delay) between each step throughout.

---

## Config Changes

`messages.interview_request` replaces `messages.intro`. Tokens use `{FIRST_NAME}` and `{LAST_NAME}`. `messages.rejection` is removed.

```yaml
messages:
  interview_request: "Hi {FIRST_NAME}, thank you for applying to Firstlight Home Care! We'd love to set up a quick phone screen. Please use the link below to choose a time that works for you."
```

`renderTemplate` in `src/messages.ts` is updated to replace `{FIRST_NAME}` and `{LAST_NAME}` tokens (replacing the old `{name}` token).

---

## Approve Flow (updated)

1. Clear `humanDecision` in Sheets
2. Mark sentiment `yes` on Indeed
3. `setupInterview` — fills and sends the interview request modal (includes the message)
4. Move Drive folder from Awaiting Automation Action → recruiting root
5. Update status → `'Screened - Invite Sent'`, update `lastContact`

## Reject Flow (updated)

1. Clear `humanDecision` in Sheets
2. Mark sentiment `no` on Indeed — Indeed sends an automated follow-up message 3 days later
3. Move Drive folder → `_Rejected`
4. Move row from Active → Rejected tab

---

## Spreadsheet

No new columns. Existing statuses cover the states:

| Status | Meaning |
|---|---|
| `Awaiting Review` | Evaluated, waiting for human decision |
| `Screened - Invite Sent` | Interview request sent via Indeed |
| `Interview Scheduled` | Candidate booked a time (future flow) |

---

## FakeIndeedAdapter

`sendMessage` and `triggerScheduler` removed. New method added:

```typescript
interviewsSetUp: { applicantId: string; options: { message: string; hiringTeamEmails: string[] } }[] = [];

async setupInterview(applicantId: string, options: { message: string; hiringTeamEmails: string[] }): Promise<void> {
  this.interviewsSetUp.push({ applicantId, options });
}
```

---

## What Does NOT Change

- `markSentiment` — unchanged
- `downloadResume`, `fetchProfileText`, `getNewApplications`, `getBookedInterviews` — unchanged
- Checkback Later and Hold flows — unchanged
- Drive folder structure — unchanged
- All evaluate logic — unchanged
