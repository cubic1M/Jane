# When Jane gets something wrong

The process for a mistake Jane makes while acting for someone. It has to work before the first real email goes out (roadmap, Stage 2). Today only the demo bank and sample people have acts to report: nothing real has happened yet. A map for the founders and counsel, not legal advice.

## What happens by itself

1. The person taps "This was wrong" on the act, on `/jane` under "Everything Jane did".
2. It goes on the record (`act_mistakes`, and `audit_log`).
3. Anything still going on that action stops: the agent sends nothing more on it.
4. That area goes back to asking. Jane does nothing more there by itself until the person turns it on again.

## What a person does

Open `/admin/mistakes`. For each one:

1. **Read it:** the act, what was sent and what came back, and what the person said.
2. **Stop the harm first.** If a company was told something wrong, write to them from a founder's address and correct it. Don't use the agent.
3. **Tell the person** what happened and what you did, the same day.
4. **Make them whole.** If it cost them money, say how you'll put it right. Counsel should say what Jane owes here, and insurance may apply.
5. **Close it** with what was done, on `/admin/mistakes`. The note is kept.
6. **Fix the cause.** Each mistake gets a test, like every founder-found bug. If it's a kind of request that can't be made safe yet, take it off `AGENT_FIRST_TYPES`.

## The number

`/admin/mistakes` shows the rate: mistakes over acts, real ones only, never a trial person's. The gate to Stage 3 asks for about 100 real actions with this rate tracked. The rehearsal's rate on the demo bank is shown apart.

## Still needed from the founders

- Who picks these up, and how fast. Set a real target before Stage 2.
- Counsel's view on liability, and what the Terms say about mistakes.
- A pause rule: at what rate does the agent stop for everyone? Nothing does this yet.
