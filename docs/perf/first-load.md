# First load of a signed-in page

How long a signed-in page takes on the server, from production's logs. Every signed-in render writes
one line, `render timing`, after it has finished streaming (src/lib/render-timing.ts):

| Field | Meaning |
| --- | --- |
| page | the first part of the path only (`/report`, never `/report/<id>`) |
| kind | `document` (a first load or reload), `rsc` (a tab, preload or refresh), `action` |
| ms | from reading the session to the end of the stream: when the last figure is in |
| dbMs | time with at least one statement in flight (parallel ones count once) |
| roundTrips, sqlCount | trips to the database, and the statements they carried |
| connects, connectMs | new database connections the render waited for |
| cold | the first render this function instance served |
| uptimeS, region | the instance's age, and where it runs |

Nothing about the person. A streamed page sends its headers before the render ends, so these numbers
can't go in a Server-Timing header.

Reading them:

```bash
vercel logs --cwd /Users/andrewli/Desktop/Jane --environment production --since 1d --query "render timing" --json -n 500
```

Every round trip pays the distance between the function and the database. Both must stay in the same
region: Neon is in AWS us-west-2, and Vercel's matching region is pdx1 (Portland).
