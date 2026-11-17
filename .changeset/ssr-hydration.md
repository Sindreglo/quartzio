---
'@quartzio/gantt-react': patch
---

Server rendering hydrates without mismatches from the host: the server renders the chart only with an explicit `locale`, a project time zone and a timeline that doesn't depend on the clock, and otherwise an empty frame that fills in on hydration. The today line shows once hydrated.
