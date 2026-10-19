# Spanish, French and Hindi translation review

**Review material only. Every proposal is agent-generated, unreviewed and outside the shipped locale catalogs.**

These drafts were explicitly requested by juscghwe for manual language review. This request does not change the repository’s default translation policy or authorize unattended translations in other work. None of these files attests that a fluent speaker has approved the wording.

| Language | Review sheets | Proposed strings | Human-reviewed |
| --- | --- | ---: | ---: |
| Spanish (Spain), `es-ES` | [Start Spanish review](es-es/README.md) | 512 | 0 |
| French (France), `fr-FR` | [Start French review](fr-fr/README.md) | 512 | 0 |
| Hindi, `hi` | [Start Hindi review](hi/README.md) | 512 | 0 |

Spanish and French are intended for juscghwe’s review. The Hindi reviewer has not yet agreed to participate. No approval or authorship is attributed to that friend.

## Review from a phone

1. Open a language index and choose a screen or component. Each batch contains at most 25 strings, with English directly above the proposed translation.
2. Correct wording here in chat using the language plus number or key, e.g. `fr-FR 129: <correction>`. State which entries or ranges you approve; silence is not approval.
3. Alternatively edit a Markdown page on GitHub and tick individual review boxes after checking their wording. Record the reviewer and the exact approved revision when preparing a translation PR. Index totals are the initial snapshot and do not update themselves.
4. Only explicitly reviewed entries should later be copied into a focused, single-language catalog PR. Leave unreviewed keys absent so the application can use English fallback.

Checkboxes are all unchecked initially. They are a review aid, not an automatic import or release mechanism. This branch adds no runtime catalogs, language admission, fonts, dependencies, actions or policy changes.

## Wording and context

- Preserve interpolation tokens exactly, including braces: `{{count}}`, `{{domain}}`, etc. Numbered `_one` and `_other` entries are separate source keys and need language-specific plural review.
- Preserve markup tags such as `<code>`, `<strong>` and `<tld>`; the sheets show them as literal text. Keep technical identifiers, Caddy directives, environment variables, API paths and HTTP headers unchanged.
- Homepage is an integration name, not a home page. Caddy, Docker, Prometheus, ntfy, Pushover, Discord and Slack are product names.
- Check destructive actions and security guarantees carefully: failed writes, rollback failure, one-time secrets, recovery logout, read-only scopes, HTTP interception and the unauthenticated metrics setting.
- Check UI context in the existing localization playground when needed. These draft sheets are not selectable playground locales. Ask for the relevant component preview before approving ambiguous wording.
- Verify translated operating-system instructions against real device menus. Menu labels can differ by OS version and language.
- French currently uses vous; Spanish uses tú. Hindi uses polite, neutral wording and technical loanwords. These are proposed conventions for the fluent reviewers to decide.

## Source and later integration

English source: [`src/frontend/src/i18n/locales/en.js`](https://github.com/zackwag/caddy-ui/blob/c4b0e32a59917d84e769721cc83254bc1cfd4ee5/src/frontend/src/i18n/locales/en.js), commit `c4b0e32a59917d84e769721cc83254bc1cfd4ee5`.

The [English snapshot](english-source.json) records all 512 keys, their exact source text and stable review numbers for this draft revision. If English changes, review the affected entries again rather than silently carrying approval to new text.

After review, proposed catalog filenames are `es-es.js`, `fr-fr.js` and `hi.js`, following the existing lowercase filename validation. Keep the existing `es-mx.js` separate. Do not silently repurpose Mexican Spanish or broaden a regional review to all Spanish/French variants.

Regional browser-language matching and Hindi glyph/font rendering need verification when integrating the catalogs. The current browser detector reduces navigator languages to base codes, so regional catalog auto-selection needs a separate, reviewed adjustment. No runtime change is included here.

Default availability remains a maintainer decision in `REVIEWED_LANGUAGES`, independent of completeness. Fluent review must precede any catalog PR under the [localization contribution policy](../docs/src/contributing-localization.md).
