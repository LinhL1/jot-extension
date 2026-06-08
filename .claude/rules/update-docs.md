# Rule: Keep HOW_IT_WORKS.md current

When completing a task, use the following criteria to decide whether
`docs/HOW_IT_WORKS.md` needs to be updated:

UPDATE the doc if the task involved any of:
- A new user-facing feature or screen
- A new component that other parts of the codebase interact with
- A change to the storage schema or data model
- A new architectural pattern or utility introduced to the project
- Anything a future developer would need to know to work on this
  codebase confidently

DO NOT update the doc for:
- Bug fixes that don't change how a feature works
- CSS or visual styling changes
- Refactors that preserve existing behaviour
- Minor copy or label changes

When an update is warranted, append the entry to the relevant section
of HOW_IT_WORKS.md following the same teaching-oriented style: explain
what it does, how it works technically, and note any key decisions made.
Never fabricate details — only document what is in the code.
