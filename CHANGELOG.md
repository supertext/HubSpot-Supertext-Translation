# Changelog

All notable changes to Supertext Translation for HubSpot.

## Unreleased

- Added: *Settings → HubSpot → Connect HubSpot again*: grants new permissions (such as publishing knowledge base articles) and keeps the API key, settings and history.
- Changed: the Translate page marks each language with an icon instead of text: a green check opens the version in HubSpot, a dashed circle means not translated; the language's name and the state are in the tooltip, with a legend under the list.
- Changed: the language columns on the Translate page and in batch results are headed by the short language code (`DE-CH`), with the language's name as a tooltip, so many languages fit.
- Added: a **History** tab with every translation, 50 per page, filtered by kind of content and *With failures* / *Running*; each opens its full result. *Recent translations* links to it, and the Translate page's result box shows the latest translation of the open tab (not of another kind).
- Added: *Settings → Translation → Publish translations right away* (off by default): website pages, landing pages, blog posts and knowledge base articles are published as soon as they are translated, and updating a version publishes its new text. Marketing emails are never sent; they stay drafts. Publishing knowledge base articles needs a new optional HubSpot permission: accounts connected before need to connect HubSpot again. If HubSpot refuses to publish, the version stays a draft and the result says why.
- Added: translate up to **50 items at once**: tick several pages, posts, emails or articles (or all on the page) and click *Translate 2 items into 3 languages with Supertext*. The items run one after the other; the result shows a row per item and a column per language, and an item that fails doesn't stop the others. Links between items of the same batch point to each other's new versions.
- Added: long lists on the Translate page: all items are loaded (not only the latest 25), 50 per page with *Previous page* / *Next page*, **search by name or URL**, and the filters *Languages missing* and *All languages done*. The list is kept for a minute (*Reload the list* loads it again at once) and reloaded after each translation.
- Changed: after a translation the page reloads with that job and its items ticked; opening the Translate page later starts with nothing ticked.
- Changed: *Point links to the translated pages, posts and articles* is marked **Beta** (in the settings and on the Links page) and is off by default for new accounts; accounts that already saved the setting keep their choice.
- Added: *Update links now* explains what it does in a tooltip.
- Changed: the list of links between translations has its own **Links** tab in the top bar (before, it was only linked from the settings).
## 1.3.0 — 2026-11-27

Links that follow the language, and translated addresses.

- Added: links between translations point to the same language: from and to website pages, landing pages, blog posts and knowledge base articles, and from marketing emails (in text and in HubSpot's link fields such as buttons). Items can be translated in any order: a link to an item without a translation yet waits and is updated when the app translates that item. *Settings → Translation → See the list* shows all links, filtered by *Waiting*, *Translated* or *Kept on the original* (*Keep the original link*, *Update links now*). On by default; *Point links to the translated pages, posts and articles*.
- Added: new language versions get their address (URL) in their language: `/de-ch/about-us` becomes `/de-ch/ueber-uns`, for pages, blog posts and knowledge base articles. On by default; *Settings → Translation → Translate the addresses (URLs) of new versions*. Existing versions keep their address.

## 1.2.0 — 2026-11-26

- Added: Indonesian, Romanian, Thai and Vietnamese (`id`, `ro`, `th`, `vi`) can be chosen as Supertext languages, all with formal and informal address (Supertext SDK 0.7.0).

## 1.1.0 — 2026-11-26

Knowledge base articles, website and landing pages, blog posts and marketing emails tested on a real HubSpot account (26 November 2026).

- Added: *Send configuration to Supertext* on the settings page: sends the account's language mapping to Supertext support in one report (Supertext Plugin Health 0.4.0). Nothing is sent while version reports are off.
- Changed: a knowledge base translation is created before anything is sent to Supertext, so a language the knowledge base doesn't have costs no translation; it fails with *The knowledge base has no “it-ch” version in HubSpot yet* and says where to add it.
- Changed: version reports go to `https://pluginhealth.supertext.com` (Supertext Plugin Health 0.4.0).
- Changed: the docs screenshots show real Supertext translations: CI takes them with the live API (secret `SUPERTEXT_API_KEY`); the Supertext stand-in translates only without the key. Version reports still go to the stand-in.
- Changed: language lists name Supertext's languages the way Supertext's own language list does, in the interface language: *German (Switzerland)*, *Deutsch (Schweiz)*, *allemand (Suisse)*, *tedesco (Svizzera)* instead of *Swiss High German*, *Schweizer Hochdeutsch*, *allemand suisse*, *alto tedesco svizzero* (likewise *French (Switzerland)*, *English (United States)* …).
- Fixed: translations glued personalization tokens to the word before them (*Hallo{{ contact.firstname }}*) and, in emails, moved the comma after the token into the next paragraph. The token now travels to Supertext with its own text, so the AI reads a normal sentence, and a space the original had next to a token is put back.
- Fixed: *Open in HubSpot* for a knowledge base article opened a page that doesn't exist; it now opens the article editor (`/knowledge-article/<account>/editor/<article>/content`).
- Fixed: knowledge base translations failed with *The following tag ids were not found in the knowledge base*: HubSpot's tags belong to one language, so translations are now created without the original's tags (add tags in that language in HubSpot).
- Fixed: knowledge base articles failed with *HubSpot answered with HTTP 400 … Some required fields were not set: [knowledgeBaseId]*. A translation is now created in its original's knowledge base (found on a real HubSpot account).

## 1.0.0 — 2026-11-10

First stable release. Every plugin release is now tested end to end against the live Supertext API (`.github/workflows/e2e.yml`).

- Support: the Supertext support form is linked in the README, the user guide and GitHub's "New issue" page.
- Docs: demo movie in the README (`docs/images/demo.gif`, recorded against the stand-ins with `npm run docs:movie`; the MP4 version, not committed, is narrated with the Piper voice “alba”) and an install and configuration movie (`npm run docs:movie:install`: connecting HubSpot, the API key, the language mapping, *Test connection*; narrated MP4, not committed).
First version, tested on a real HubSpot account (17 October 2026: installing with OAuth, token refresh, blog posts into language variants and updating their drafts) and against a stand-in of the HubSpot APIs; pages, emails and the knowledge base still to be tried on a real account.

- Hosted app installed in HubSpot with OAuth (`content` scope; the knowledge base scopes when the account has them). The HubSpot app definition is in `hubspot-project/` (developer platform 2026.09).
- Translates website pages, landing pages, blog posts, marketing emails and knowledge base articles with Supertext AI on the app's *Translate* page. Pages and posts become HubSpot language variants in the original's multi-language group, emails get one copy per language, articles a linked translation; everything as a draft, nothing published or sent.
- Translates titles, meta descriptions, subject line, preview text, plain-text version, rich text and the text fields of modules and drag-and-drop sections; keeps layout, images, links, forms and HubL / personalization tokens (refuses a translation that lost one).
- *Update existing versions* is ticked by default (with a warning that changes made by hand are replaced); unticked, existing language versions are kept. A sent email copy is never changed.
- Settings per HubSpot account: Supertext API key (stored encrypted, with account and API key links) with the automatic key check and *Test connection*, the content language, target languages with their Supertext codes chosen from a searchable dropdown of Supertext's languages (type part of a name or code), the same language's variants first, preselected with the exact code or the usual variant (German → `de-DE`, English → `en-US`, Chinese (China) → `zh-Hans`, Spanish (Mexico) → `es`), which also applies to a language nobody mapped; languages without one (`fr-be`, `en-au`, `no` …) show *— choose —* and aren't translated until chosen, form of address, *Send version information to Supertext* (Commando Center through Supertext Plugin Health 0.1.0; Supertext SDK 0.4.0), disconnecting, and the app version linked to its release.
- **Translation review** per language (Settings → Languages, a checkbox next to the language's Supertext code, off by default): translations into a ticked language go through Supertext's review service (Supertext Localization Review), where customers and Supertext linguists correct them on the website with a Chrome extension; corrections come back into HubSpot with the next translation, and texts translated before keep their (reviewed) wording. Same API key, billing, languages and messages; other languages keep going directly to Supertext. New server variable `SUPERTEXT_REVIEW_URL` (defaults to Supertext's review service; empty turns review off for every account and hides the column). All four interface languages.
- Requests to Supertext (and the review service) name the app's version in the User-Agent (`HubSpot-Supertext-Translation/<version>`).
- Recent translations with the result per language and links into HubSpot's editors.
- Export for translation (XLIFF 1.2 or HTML) and import of translated files; Supertext SDK 0.5.0. On the Translate page, *Export for translation* downloads the chosen item's texts for the ticked languages as an XLIFF file (for translation tools; personalization tokens as protected tags) or an HTML file (one language, e.g. for Supertext's web app); the new *Import translation* page reads the translated file back and writes the language versions as drafts like a Supertext translation, with a summary of imported, skipped (source changed since the export; optional), untranslated, invalid and missing texts. No API key needed; uploads up to 10 MB, never stored.
- Supertext's look: the Supertext logo in a deep-green header, Supertext's colours, pill buttons and the Inter font (bundled), and the Supertext favicon.
- Interface in English, German, French and Italian, in the browser's language unless *Settings → Interface language* chooses another one for that browser (no language switch in the header), also on phones (the pages fit the screen; wide tables scroll inside their card; Save stays at the bottom of the settings). The stylesheet and script addresses change with every release, so browsers, Safari on iPhone included, load the new layout right away instead of a cached one.
- `npm run hubspot:probe` to look at a real account (read-only).
- A language version is made in HubSpot before its texts are translated, so a version HubSpot refuses (for example a blog without that language) costs no translation; *The blog has no “fr-ch” version in HubSpot yet* explains how to add it. A version made for a translation that then fails is removed again.
- Hosted on Railway at https://hubspot-production-ac4d.up.railway.app; the HubSpot app definition is uploaded by the *Upload HubSpot app* workflow.
