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
        var c = Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER;
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        if (finished) {
            dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.40, Graphics.FONT_MEDIUM, "Cardio done", c);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.55, Graphics.FONT_SMALL, clock(activeMs / 1000) + " total", c);
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.70, Graphics.FONT_XTINY, "Saved. Tap to go back", c);
            return;
        }

        var p = phases[idx];
        dc.setColor(kindColor(p[2]), Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.24, Graphics.FONT_MEDIUM, p[0].toUpper(), c);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.47, Graphics.FONT_NUMBER_THAI_HOT, clock(remaining()), c);

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        var rounds = countHard(phases.size());
        if (rounds > 0 && (p[2].equals("hard") || p[2].equals("easy"))) {
            dc.drawText(cx, h * 0.67, Graphics.FONT_XTINY, "Round " + countHard(idx + 1) + " of " + rounds, c);
        }
        if (idx + 1 < phases.size()) {
            dc.drawText(cx, h * 0.75, Graphics.FONT_XTINY, "Next: " + phases[idx + 1][0] + " " + clock(phases[idx + 1][1]), c);
        }
        dc.drawText(cx, h * 0.85, Graphics.FONT_XTINY, running ? "Tap: pause  Swipe: skip" : "Tap to start", c);
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
        return Graphics.COLOR_RED;
    }
    if (kind.equals("warm") || kind.equals("cool")) {
        return Graphics.COLOR_ORANGE;
    }
    return Graphics.COLOR_GREEN;
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
