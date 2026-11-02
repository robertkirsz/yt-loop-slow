# YouTube Loop & Slow

A small Chrome extension for transcribing music from YouTube: slow a video down without changing its pitch, and loop an A–B section over and over.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this `yt-loop-slow` folder.
4. Reload any YouTube tabs that were already open.

After editing the code, click the reload icon on the extension's card, then reload the YouTube tab.

## Use

A panel appears on YouTube watch pages. Drag it by its header; collapse it with ▴. The ✕ button hides it; the toolbar icon or **Alt+Shift+L** shows it again.

- **Speed:** 25%–200% in 5% steps, plus presets. "Keep original pitch" is on by default; turn it off to hear the slowed-down pitch, like a tape slowdown.
- **Loop:** press **Set** next to A at the start of the phrase, then **Set** next to B at the end. The loop turns on by itself. Fine-tune with ‹ › (0.05 s per click, 1 s with Shift), or type a time such as `1:23.45`. Moving A replays from the new start. Moving B replays the last 1.5 s so you can hear the new end.
- **Pause before repeat:** waits at A for the set number of seconds before each repeat, so you have time to write down what you heard. Press play to skip the wait.
- **Saved loops:** named loops are stored per video (in the extension's local storage). Click one to jump to it and start looping.
- The loop range shows on YouTube's progress bar.

## Keyboard shortcuts

These don't fire while you're typing in a text field.

| Key | Action |
| --- | --- |
| `[` | Set A to the current time |
| `]` | Set B to the current time |
| `\` | Turn the loop on or off |
| `;` | Jump to A |
| `-` / `=` | Slower / faster by 5% |

YouTube's own shortcuts (`k` play/pause, `,` `.` frame step, `←` `→` seek) still work.

## License

MIT — see [LICENSE](LICENSE).
