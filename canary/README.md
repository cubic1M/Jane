# The daily canary task

The same small coding task, every day, with the same prompt. A product or model change can make agents
worse past code review and tests, and from inside it looks like your own bug. A fixed task shows the
change as a shift in solved, turns or minutes on the numbers page.

- `task/` is what the agent gets, copied to an empty folder with no access to this repository.
- `hidden/` is scored afterwards and the agent never sees it. Don't edit either: a changed task breaks
  the comparison with every earlier day.
