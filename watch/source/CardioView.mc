import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Timer;
import Toybox.WatchUi;

// Interval timer for the session's cardio: steps through the phases from the
// plan (warm-up, hard/easy rounds, cool-down) with a vibration at each change.
class CardioView extends WatchUi.View {
    hidden var phases;
    hidden var idx = 0;
    var running = false;
    var finished = false;
    hidden var phaseEnd = 0;
    hidden var left = 0;
    hidden var activeMs = 0;
    hidden var lastTick = 0;
    hidden var timer;

    function initialize() {
        View.initialize();
        phases = getApp().session["cardio"]["phases"];
        left = phases[0][1] * 1000;
        timer = new Timer.Timer();
    }

    function onUpdate(dc) {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;
        Theme.clear(dc);

        if (finished) {
            Theme.ring(dc, 1, Theme.GOOD);
            Theme.text(dc, cx, h * 0.36, Graphics.FONT_SMALL, Theme.MUTED, "Cardio done");
            Theme.text(dc, cx, h * 0.52, Graphics.FONT_NUMBER_MEDIUM, Theme.GOOD, clock(activeMs / 1000));
            Theme.text(dc, cx, h * 0.70, Graphics.FONT_SMALL, Theme.MUTED, "Saved. Tap to go back");
            return;
        }

        var p = phases[idx];
        var color = kindColor(p[2]);
        var phaseSecs = p[1];
        Theme.ring(dc, phaseSecs > 0 ? 1.0 - remaining().toFloat() / phaseSecs : 0, color);

        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        fitText(dc, cx, h * 0.24, w * 0.6, p[0].toUpper());
        Theme.text(dc, cx, h * 0.47, Graphics.FONT_NUMBER_THAI_HOT, Theme.TEXT, clock(remaining()));

        Theme.heartRate(dc, cx, h * 0.67);
        var rounds = countHard(phases.size());
        if (rounds > 0 && (p[2].equals("hard") || p[2].equals("easy"))) {
            Theme.dots(dc, cx, h * 0.76, rounds, countHard(idx + 1) - 1, Theme.HARD);
        }
        if (!running) {
            Theme.text(dc, cx, h * 0.85, Graphics.FONT_SMALL, Theme.ACCENT, "Tap to start");
        } else if (idx + 1 < phases.size()) {
            Theme.text(dc, cx, h * 0.85, Graphics.FONT_SMALL, Theme.MUTED, "Next  " + phases[idx + 1][0]);
        }
    }

    function countHard(upTo) {
        var n = 0;
        for (var i = 0; i < upTo; i++) {
            if (phases[i][2].equals("hard")) {
                n++;
            }
        }
        return n;
    }

    function toggle() {
        if (finished) {
            WatchUi.popView(WatchUi.SLIDE_RIGHT);
            return;
        }
        var now = System.getTimer();
        if (running) {
            tickActive(now);
            left = phaseEnd - now;
            running = false;
            timer.stop();
        } else {
            running = true;
            lastTick = now;
            phaseEnd = now + left;
            timer.start(method(:onTick), 1000, true);
            buzz(1);
        }
        WatchUi.requestUpdate();
    }

    function onTick() as Void {
        var now = System.getTimer();
        tickActive(now);
        if (phaseEnd - now <= 0) {
            advance();
        }
        WatchUi.requestUpdate();
    }

    function tickActive(now) {
        activeMs += now - lastTick;
        lastTick = now;
    }

    function skip() {
        if (!finished) {
            advance();
            WatchUi.requestUpdate();
        }
    }

    function advance() {
        idx++;
        if (idx >= phases.size()) {
            finish();
            return;
        }
        var ms = phases[idx][1] * 1000;
        if (running) {
            phaseEnd = System.getTimer() + ms;
        } else {
            left = ms;
        }
        buzz(phases[idx][2].equals("hard") ? 2 : 1);
    }

    function finish() {
        running = false;
        finished = true;
        timer.stop();
        idx = phases.size() - 1;
        buzz(3);
        var minutes = (activeMs / 60000.0 + 0.5).toNumber();
        getApp().logCardio(minutes < 1 ? 1 : minutes);
    }

    function stop() {
        timer.stop();
    }

    function remaining() {
        var ms = running ? phaseEnd - System.getTimer() : left;
        return ms <= 0 ? 0 : (ms + 999) / 1000;
    }
}

function kindColor(kind) {
    if (kind.equals("hard")) {
        return Theme.HARD;
    }
    if (kind.equals("warm") || kind.equals("cool")) {
        return Theme.ACCENT;
    }
    return Theme.GOOD;
}

class CardioDelegate extends WatchUi.BehaviorDelegate {
    hidden var view;

    function initialize(v) {
        BehaviorDelegate.initialize();
        view = v;
    }

    function onSelect() {
        view.toggle();
        return true;
    }

    function onTap(evt) {
        view.toggle();
        return true;
    }

    function onNextPage() {
        view.skip();
        return true;
    }

    function onBack() {
        view.stop();
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }
}
