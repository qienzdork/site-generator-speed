[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/qienzdork/site-generator-speed/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/qienzdork/site-generator-speed/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

# sitegen — fastest static site builder

A fast drop-in for makefun-site 1.0.0: it builds the exact same output tree
(each page's `index.html`, the index and tag pages, `build-report.txt` and
each static file, byte for byte) in far less CPU time. Written from the
makefun-site spec — its own front matter, template dialect, Markdown subset,
slug rule and report — with single-pass scanners, templates compiled once
per case, and memoised slugs. Dependency-free, Node 22, no network, no
native code: `main.ts` reads every case from `/input/cases.json`, answers
each with `run` from `solve.js`, and writes `/output/answers.json`.
