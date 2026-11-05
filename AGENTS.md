# Agent notes for this repository

## This repository is public

The repository is mirrored to a public host, so **everything committed here is public,
including the whole git history**. Deleting a file later does not un-publish it; removing
something from history means a rewrite of every clone. Check before you commit, not after.

Never commit, in code, docs, skills, tests, fixtures or commit messages:

- Secrets of any kind: API keys, tokens, passwords, signing keys and certificates
  (`*.p8`, `*.p12`, `*.jks`, keystores), store credentials, `.env` contents, and log lines
  or screenshots that contain typed passwords.
- Store and release material: App Store / Play listing texts, store screenshots and
  graphics, signed builds. They live outside this repository.
- Internal planning, market or competitor research, and private notes.
- Personal or infrastructure details: people's names (beyond the git author), host names,
  internal domains, LAN IPs, ports of private services, real device names, serials or
  UDIDs, personal emulator/simulator names, and absolute paths under a home directory.

Use placeholders instead (`<serial>`, `<your-server>`, `example.com`) and describe how to find
the real value. Config that needs real values ships as a template with placeholders
(e.g. `apps/mobile/eas.example.json`); the real file stays untracked.

Before committing, review the staged diff with that list in mind (`git diff --cached`), and
stage explicit paths rather than `git add -A`.

## Agent skills

Repo-local skills live in `.pi/skills/` (for example `mobile-android-e2e`). They are
self-improving: when you learn something verified while using one, update it in the same
change. The public-repository rules above apply to skills too; write them so they hold on
any developer's machine.
