import Toybox.Attention;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Timer;
import Toybox.WatchUi;

// One exercise: shows the next set (kg x reps), logs it on tap or START,
// then runs the rest countdown with vibrations.
class ExerciseView extends WatchUi.View {
    var li;
    var kg = "";
    var reps = "";
    var fail = false;
    var resting = false;
    hidden var restEnd = 0;
    hidden var warned = false;
    hidden var timer;

    function initialize(index) {
        View.initialize();
        li = index;
        var l = lift();
        kg = l["kg"] == null ? "" : l["kg"];
        reps = l["repT"].toString();
        timer = new Timer.Timer();
    }

    function lift() {
        return getApp().session["lifts"][li];
    }

    function nextSet() {
        return lift()["logged"].size();
    }

    function allDone() {
        return nextSet() >= lift()["sets"];
    }

    function onUpdate(dc) {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;
        var c = Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER;
        var l = lift();
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.17, Graphics.FONT_XTINY, shorten(l["name"], 22), c);

        if (resting) {
            dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.30, Graphics.FONT_SMALL, "REST", c);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.52, Graphics.FONT_NUMBER_THAI_HOT, clock(remaining()), c);
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.74, Graphics.FONT_XTINY, "Next: set " + (nextSet() + 1) + " of " + l["sets"], c);
            dc.drawText(cx, h * 0.84, Graphics.FONT_XTINY, "Tap: skip  Swipe up: +15s", c);
            return;
        }

        if (allDone()) {
            dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.45, Graphics.FONT_MEDIUM, "All sets done", c);
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.62, Graphics.FONT_XTINY, "Tap to go back", c);
            return;
        }

        dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.29, Graphics.FONT_SMALL, "Set " + (nextSet() + 1) + " of " + l["sets"], c);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.46, Graphics.FONT_NUMBER_MEDIUM, kg.length() > 0 ? kg : "-", c);
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.57, Graphics.FONT_XTINY, l["load"], c);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.68, Graphics.FONT_MEDIUM, "x " + reps + (fail ? "  FAIL" : ""), c);

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.80, Graphics.FONT_XTINY, "Target " + l["reps"] + "  Tap: done", c);
        dc.drawText(cx, h * 0.88, Graphics.FONT_XTINY, "Tap top: edit  Swipe: reps", c);
    }

    // Tap / START: finish the set, skip the rest, or leave when all sets are done.
    function primary() {
        if (resting) {
            endRest();
            return;
        }
        if (allDone()) {
            stop();
            WatchUi.popView(WatchUi.SLIDE_RIGHT);
            return;
        }
        getApp().logSet(li, kg, reps, fail);
        fail = false;
        if (allDone()) {
            buzz(2);
            WatchUi.requestUpdate();
            return;
        }
        startRest(lift()["rest"]);
    }

    function changeReps(delta) {
        if (resting) {
            if (delta > 0) {
                restEnd += 15000;
                WatchUi.requestUpdate();
            }
            return;
        }
        var r = reps.toNumber();
        if (r == null) {
            r = 0;
        }
        r += delta;
        if (r < 0) {
            r = 0;
        }
        reps = r.toString();
        WatchUi.requestUpdate();
    }

    function startRest(secs) {
        resting = true;
        warned = false;
        restEnd = System.getTimer() + secs * 1000;
        timer.start(method(:onTick), 1000, true);
        WatchUi.requestUpdate();
    }

    function onTick() as Void {
        var left = remaining();
        if (!warned && left <= 10 && left > 0) {
            warned = true;
            buzz(1);
        }
        if (left <= 0) {
            endRest();
            buzz(3);
        }
        WatchUi.requestUpdate();
    }

    function endRest() {
        resting = false;
        timer.stop();
        WatchUi.requestUpdate();
    }

    function stop() {
        timer.stop();
    }

    function remaining() {
        var ms = restEnd - System.getTimer();
        return ms <= 0 ? 0 : (ms + 999) / 1000;
    }
}

class ExerciseDelegate extends WatchUi.BehaviorDelegate {
    hidden var view;

    function initialize(v) {
        BehaviorDelegate.initialize();
        view = v;
    }

    function onSelect() {
        view.primary();
        return true;
    }

    function onTap(evt) {
        var xy = evt.getCoordinates();
        if (!view.resting && !view.allDone() && xy[1] < System.getDeviceSettings().screenHeight * 0.3) {
            openEdit();
        } else {
            view.primary();
        }
        return true;
    }

    function onMenu() {
        if (!view.resting) {
            openEdit();
        }
        return true;
    }

    // Swipe up / down button: reps -1 (or +15 s of rest). Swipe down / up button: reps +1.
    function onNextPage() {
        view.changeReps(view.resting ? 1 : -1);
        return true;
    }

    function onPreviousPage() {
        view.changeReps(1);
        return true;
    }

    function onBack() {
        view.stop();
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }

    function openEdit() {
        var menu = new EditMenu(view);
        WatchUi.pushView(menu, new EditMenuDelegate(view, menu), WatchUi.SLIDE_UP);
    }
}

function shorten(text, max) {
    return text.length() > max ? text.substring(0, max - 1) + "." : text;
}

function clock(secs) {
    return (secs / 60).format("%d") + ":" + (secs % 60).format("%02d");
}

// 1: short (10 s left), 2: double (exercise done / hard interval), 3: long (rest over).
function buzz(kind) {
    if (Attention has :vibrate) {
        var pattern;
        if (kind == 1) {
            pattern = [new Attention.VibeProfile(50, 200)];
        } else if (kind == 2) {
            pattern = [new Attention.VibeProfile(100, 300), new Attention.VibeProfile(0, 150), new Attention.VibeProfile(100, 300)];
        } else {
            pattern = [new Attention.VibeProfile(100, 800)];
        }
        Attention.vibrate(pattern);
    }
    if (kind == 3 && Attention has :backlight) {
        try {
            Attention.backlight(true);
        } catch (e) {
        }
    }
}
