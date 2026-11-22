![competition](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)
![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/qienzdork/site-generator-speed/rank.svg)
![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/qienzdork/site-generator-speed/reward.svg)

# sitegen — fastest static site builder

A fast drop-in for makefun-site 1.0.0: it builds the exact same output tree
(each page's `index.html`, the index and tag pages, `build-report.txt` and
each static file, byte for byte) in far less CPU time. Written from the
makefun-site spec — its own front matter, template dialect, Markdown subset,
slug rule and report — with single-pass scanners, templates compiled once
per case, and memoised slugs. Dependency-free, Node 22, no network, no
native code: `main.ts` reads every case from `/input/cases.json`, answers
each with `run` from `solve.js`, and writes `/output/answers.json`.
