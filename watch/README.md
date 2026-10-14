# Iron + Engine watch app (Garmin Connect IQ)

Your session on the wrist: today's exercises, set-by-set kg × reps, a rest
countdown that vibrates, and the cardio interval timer. Finished sets upload to
your log through your phone's Garmin Connect app (they queue up if the phone is
out of reach and upload later).

## Build and install

1. Install the Connect IQ SDK and the **Monkey C** VS Code extension, and use
   the SDK Manager to download the **Venu 4** devices.
2. Open this `watch/` folder in VS Code.
3. Run **Monkey C: Edit Products** and tick both Venu 4 sizes. This fills
   `<iq:products>` in `manifest.xml`; the build fails while it's empty.
4. Run **Monkey C: Generate a Developer Key** once if you don't have one.
5. Try it in the simulator: **Run → Start Debugging**. In the simulator use
   **File → Edit Persistent Storage → Edit Application.Properties data** to set
   the server address and watch key.
6. On your watch: **Monkey C: Build for Device**, then copy the `.prg` to
   `GARMIN/APPS` on the watch over USB. (Or upload it to the Connect IQ store
   as a private beta.)

If the type checker blocks the build, set **Monkey C: Type Check Level** to
*Gradual* (or *Silent*) in VS Code settings.

## Settings

In the Garmin Connect phone app: **Connect IQ apps → Iron + Engine → Settings**.

| Setting | Value |
|---|---|
| Server address | Your public base URL, e.g. `https://your-domain/iron`. The watch calls `<address>/watch/...` |
| Watch key | Iron + Engine web app → your name → Garmin watch → Show watch key |

The server must be reachable over HTTPS from the phone. With a reverse proxy in
front of a Home Assistant add-on, forward `/iron/watch/` to the add-on's
`/watch/` path, as for the connector.

## Using it

- **Session menu**: one row per exercise ("1/4 sets 6-8 @ 40"), then
  **Cardio**, **Other day** (another session this week, or the next
  unfinished one), and **Sync** (upload waiting sets and reload).
- **Exercise screen**: shows the next set's weight and reps.
  - START: set done. The rest countdown starts; a short buzz at 10 s left, a
    long buzz and the screen lights when rest is over.
  - Taps only edit, so a stray touch never logs a set: tap the weight or the
    reps to change it, anywhere else (or hold/menu) for the edit menu, which
    also marks the set as taken to failure.
  - Changing a value: tap - / + (weight: 2.5 kg top row, 1 kg bottom row) or
    swipe right / left for +1 / -1. Save or START keeps it; Back cancels.
  - The "i" on the left opens the how-to (one step per page, swipe up for the
    next); the picture on the right opens the start and finish photos (tap to
    switch). Photos come from `/watch/photo/` on the server.
  - During rest, taps are ignored. START skips the rest; swipe up adds 15 s.
  - Swipe up/down: reps -1/+1.
  - Back: return to the menu.
- **Cardio**: tap to start/pause, swipe up to skip a part. Each phase change
  buzzes (double buzz when a hard interval starts). Minutes are saved at the end.
- **Garmin activity**: opening the first exercise starts recording a strength
  training activity (red dot at the top); each exercise and the cardio get a
  lap, and the rest and cardio screens show live heart rate. "Finish workout"
  (or Back from the menu) saves it to Garmin Connect or discards it; leaving
  the app another way saves it. The duration, heart rate and calories are sent
  to the server and shown on that session in the web app.

## Server API

All requests send `X-Watch-Key: <key>` (or `?key=`). The key only reaches its
own person's training.

| Method | Path | Body / query |
|---|---|---|
| GET | `/watch/session` | optional `?week=&day=` (indexes); default is the next unfinished session |
| POST | `/watch/set` | `{ week, day, lift, set, kg, reps, fail }` (indexes into the session) |
| POST | `/watch/cardio` | `{ week, day, min }` |
| POST | `/watch/workout` | `{ week, day, min, avgHr, maxHr, kcal }`, stored as the session's `-watch` log entry |
| GET | `/watch/photo/<photo>-<0\|1>.jpg` | start / finish photo of an exercise |
