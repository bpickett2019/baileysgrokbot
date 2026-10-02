# Ego skill reference (not auto-installed)

This directory preserves the complete installed CitroLabs `ego-browser` skill,
version 2.0.0, including its references, installer, and example learnings. The
copied files are unmodified; the installer has **not** been run. MIT attribution
is in [LICENSE](LICENSE).

Upstream: https://github.com/citrolabs/ego-lite/tree/main/skills/ego-browser

The skill, references, and learnings match upstream commit
`dca7003349c5f7132189ba00547cbbd7ff8e597e`. The installed `scripts/install.sh` is
the separately captured v1.5 installer, rather than that commit's installer.

`SKILL.md` SHA-256:
`9402bf03db895209a755d5e2af9b436dbf98eed0911907110a4ea482c30632de`.

This is reference documentation, deliberately outside auto-discovered skills
folders. Do not import it as an active Linux Team Computer skill: its JavaScript
examples need the Ego Lite browser and native runtime. Copying these instructions
does not add those APIs to Chromium or install a Linux version of Ego Lite.

For the existing signed-in Team screen, use
[the Cvent build skill](../../cvent-team/skills/cvent-build.md).
For an explicitly configured separate Mac Ego browser, see
[the optional host adapter](../../ego-navigation.md). Do not combine their human
handoff instructions or silently switch between the two browser sessions.
